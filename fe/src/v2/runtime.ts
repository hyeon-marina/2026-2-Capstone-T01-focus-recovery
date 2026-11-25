import { AccessError, accessGeneration } from '../api/auth-fetch';
import { readCollectionAccess, accessRequest, validWithdrawal, type CollectionAccess } from './access';
import { sendRetraction, validRetractionAck, type RetractionRequest } from './retractions';
import { sendNotification, type NotificationReceipt } from './notifications';
import type { V2Alert } from './status';
import { API_BASE_URL, postJson } from '../api/client';
import { VisitDelivery } from '../background/visit-delivery';
import { BehaviorDelivery } from '../background/behavior-delivery';
import { SessionEndDelivery } from '../background/session-end';
import { serialExecutor } from '../background/serial';
import { behaviorSnapshot } from '../api/behavior';
import { savePageVisit } from '../api/visit';
import { updateVisitBehavior } from '../api/behavior';
import { endSession, getSession, matchesSession } from '../api/session-end';
import { isV2Session } from './contract';
import { V2Collector, canCompact, type Observation } from './collector';
import { V2Repository, drained } from './repository';
import { initialState, type V2State, type Stamp, type CompactReceipt } from './state';

export interface V2Transport {
  access: () => Promise<CollectionAccess>;
  withdraw?: (requestId: string) => Promise<unknown>;
  confirmQuarantine?: (sessionId: string) => Promise<unknown>;
  closeQuarantine?: (sessionId: string) => Promise<unknown>;
  retract?: (sessionId: string, request: RetractionRequest) => Promise<unknown>;
  start: (goalText: string, key: string) => Promise<unknown>;
  post: typeof savePageVisit; patch: typeof updateVisitBehavior;
  end: typeof endSession; query: typeof getSession;
}
// Browser entries enforce eligibility: closed synthetic catalog or locked participant preparation.
export class V2Runtime {
  private access?: CollectionAccess;
  private verifiedIdentity?: { participantId: string; expiresAt: string; credentialEpoch: number };
  private accessError?: string;
  private accessEpoch = 0;
  private accessChecks = 0;
  private settledAccessCheck = 0;
  private userPrivacyPending = 0;
  private credentialEpoch = accessGeneration();
  private withdrawalRunning = false;
  private serverWithdrawalSeen = false;
  private state = initialState(API_BASE_URL);
  private committed = structuredClone(this.state);
  private collector = new V2Collector(this.state);
  private enqueue = serialExecutor();
  private failed = false;
  private stopping = false;
  private held = false;
  private starting = false;
  private reconnectRequired = false;
  private notificationRunning = false;
  private retractionRunning = false;
  private compactedIds: string[] = [];
  private posts: VisitDelivery;
  private behaviors: BehaviorDelivery;
  private ending: SessionEndDelivery;
  constructor(private repository: V2Repository, private transport: V2Transport, private resumeIncomplete = false, private freeGoalSession = false) {
    this.collector = new V2Collector(this.state, undefined, resumeIncomplete);
    const protect = async <T>(send: () => Promise<T>) => {
      const epoch = this.accessEpoch, credential = accessGeneration();
      const current = () => epoch === this.accessEpoch && credential === accessGeneration();
      if (this.freeGoalSession) await this.verifyAccess();
      try {
        if (!this.freeGoalSession) await this.verifyAccess();
        if (this.freeGoalSession && (!current() || !this.canSend())) throw new AccessError('account');
        const result = await send();
        if (this.freeGoalSession && !current()) throw new AccessError('account');
        return result;
      } catch (error) {
        if (this.freeGoalSession && !current()) throw error;
        if (error instanceof AccessError && (!this.freeGoalSession || error.kind !== 'account')) {
          this.suspendAccess(); this.accessError = error.kind;
        }
        if (error && typeof error === 'object' && 'status' in error) {
          if (error.status === 401 || this.freeGoalSession && error.status === 403) {
            this.suspendAccess(); this.accessError = error.status === 401 ? 'authentication' : 'consent';
          }
        }
        if (error && typeof error === 'object' && 'code' in error && error.code === 'PRIVACY_RETRACTED') this.held = true;
        throw error;
      }
    };
    const mutate = <T>(op: () => T) => this.mutate(op).then(value => { this.kick(); return value; });
    this.posts = new VisitDelivery(mutate, () => this.canSend(), v => protect(() => transport.post(v)));
    this.behaviors = new BehaviorDelivery(mutate, id => this.canSend() && this.committed.posts.entries.some(e => e.visitId === id && e.phase === 'acked'), (s, id, b) => protect(() => transport.patch(s, id, b)));
    this.ending = new SessionEndDelivery(mutate, () => this.canSend(), () => drained(this.committed),
      () => [...this.state.posts.entries, ...this.state.behaviors.entries].some(e => e.code === 'SESSION_ENDED'), (s, b) => protect(() => transport.end(s, b)), s => protect(() => transport.query(s)), freeGoalSession);
  }
  suspendAccess() { this.accessEpoch++; this.access = undefined; this.accessError = 'AUTHENTICATION_REQUIRED';
    this.pauseAuthorization();
  }
  beginUserPrivacyChange() {
    if (this.userPrivacyPending++ === 0) this.suspendAccess();
    return () => { this.userPrivacyPending--; };
  }
  private pauseAuthorization() {
    if (this.freeGoalSession && this.committed.lifecycle === 'ACTIVE') this.reconnectRequired = true;
    for (const c of this.state.candidates) { c.cursor = undefined; if (!this.resumeIncomplete) c.closed = true; }
    if (!this.resumeIncomplete) this.state.tabs = {};
    delete this.state.lastVisit;
  }
  private authorized() {
    return !this.userPrivacyPending && !this.serverWithdrawalSeen && !!this.access && this.credentialEpoch === accessGeneration() && Date.parse(this.access.expiresAt) > Date.now()
      && !!this.committed.owner && this.access.participantId === this.committed.owner.participantId
      && this.access.consentId === this.committed.owner.consentId && this.access.consentValid && this.access.collectionEnabled && !this.access.withdrawn;
  }
  async verifyAccess(forStart = false, ownershipOnly = false) {
    if (this.userPrivacyPending && !ownershipOnly) throw new AccessError('authentication');
    const epoch = this.accessEpoch, credential = accessGeneration(), check = ++this.accessChecks;
    const current = () => epoch === this.accessEpoch && credential === accessGeneration()
      && (!this.freeGoalSession || check >= this.settledAccessCheck);
    try {
      const access = await this.transport.access();
      if (!current()) throw new AccessError('account');
      this.settledAccessCheck = check;
      if (!Number.isFinite(Date.parse(access.expiresAt)) || Date.parse(access.expiresAt) <= Date.now()) throw new AccessError('authentication');
      this.verifiedIdentity = { participantId: access.participantId, expiresAt: access.expiresAt, credentialEpoch: credential };
      const owner = this.committed.owner;
      const newSession = forStart && this.committed.lifecycle === 'ENDED' && (this.committed.quarantine ? this.committed.quarantineClose?.phase === 'acknowledged' && owner?.participantId === access.participantId : drained(this.committed)) && !this.committed.withdrawal;
      if (owner && access.participantId !== owner.participantId && !newSession || !owner && this.committed.lifecycle !== 'IDLE' && !newSession) throw new AccessError('account');
      if (access.withdrawn && owner) this.serverWithdrawalSeen = true;
      this.access = access; this.credentialEpoch = credential; this.accessError = undefined;
      if (Date.parse(access.expiresAt) <= Date.now()) throw new AccessError('authentication');
      if (this.freeGoalSession && this.committed.lifecycle === 'ACTIVE' && !this.authorized()) this.pauseAuthorization();
      if (!ownershipOnly && (this.serverWithdrawalSeen || !access.consentValid || !access.collectionEnabled || access.withdrawn
        || owner && access.consentId !== owner.consentId && !newSession)) throw new AccessError('consent');
      return access;
    } catch (e) {
      if (this.freeGoalSession && !current()) throw e;
      this.settledAccessCheck = check;
      this.pauseAuthorization();
      this.access = undefined; this.accessError = e instanceof AccessError ? e.kind : 'network';
      throw e;
    }
  }
  private needsReconnect() {
    return this.reconnectRequired && this.committed.lifecycle === 'ACTIVE';
  }
  accessSnapshot() {
    const identity = this.verifiedIdentity;
    const authenticated = !!identity && identity.credentialEpoch === accessGeneration() && Date.parse(identity.expiresAt) > Date.now()
      && this.accessError !== 'authentication' && this.accessError !== 'AUTHENTICATION_REQUIRED';
    return {
      authenticated,
      ownerVerified: authenticated && identity.participantId === this.committed.owner?.participantId,
      consentValid: this.access?.consentValid === true,
      collectionEnabled: this.access?.collectionEnabled === true,
      withdrawn: this.serverWithdrawalSeen || this.access?.withdrawn === true,
      privacyPending: this.userPrivacyPending > 0,
      reconnectRequired: this.needsReconnect(),
    };
  }
  get foregroundTab() { return this.committed.foreground; }
  collecting() { return this.authorized() && !this.needsReconnect() && !this.failed && !this.stopping && !this.held && !this.committed.quarantine && this.committed.lifecycle === 'ACTIVE'; }
  snapshot() { return { ...structuredClone(this.committed), accessError: this.accessError, authenticated: !!this.access, collectionAllowed: this.authorized(), storageFailed: this.failed, alertsSuppressed: !this.authorized() || this.failed || this.stopping || this.held || Boolean(this.committed.quarantine) }; }
  private canSend() { return this.authorized() && !this.needsReconnect() && !this.failed && !this.held && !this.committed.quarantine && !this.posts.blocked && !this.behaviors.blocked; }
  private install(s: V2State) {
    this.state = s; this.collector = new V2Collector(s, undefined, this.resumeIncomplete);
    this.posts.checkpoint = s.posts; this.behaviors.checkpoint = s.behaviors; this.ending.checkpoint = s.end;
  }
  async initialize() {
    try {
      const s = await this.repository.load();
      this.compactedIds = s.session ? await this.repository.compactedVisitIds(s.session.sessionId) : [];
      this.committed = structuredClone(s); this.install(s);
      this.reconnectRequired = this.freeGoalSession && s.lifecycle === 'ACTIVE';
      await this.mutate(() => {
        // Worker generation cannot establish a return interval, even for a surviving Chrome document.
        for (const c of s.candidates) {
          c.cursor = undefined;
          if (!this.resumeIncomplete || c.post || c.excluded) { c.closed = true; if (s.tabs[c.tabId] === c.id) delete s.tabs[c.tabId]; }
        }
        s.foreground = null; s.lastTab = null; delete s.lastVisit;
        this.posts.restore(s.posts, s.session?.sessionId); this.behaviors.restore(s.behaviors, s.posts.entries);
        this.ending.restore(s.end);
        for (const e of s.retractions ?? []) if (e.phase === 'sending') e.phase = 'pending';
        if (s.quarantine) this.queueRetractions();
      });
      await this.verifyAccess(false, true).catch(() => {});
      if (this.committed.withdrawal) await this.flushWithdrawal();
      if (!this.committed.quarantine && !this.committed.withdrawal) await this.verifyAccess().catch(() => {});
      this.kick();
    } catch (error) { this.failed = true; throw error; }
  }
  private sync(flush = false) {
    this.posts.collect(this.collector.ready());
    this.behaviors.collect(this.collector.transmissionVisits(flush), this.posts.checkpoint.entries);
    this.state.posts = this.posts.checkpoint; this.state.behaviors = this.behaviors.checkpoint; this.state.end = this.ending.checkpoint;
    if (this.state.end?.phase === 'acked') this.state.lifecycle = 'ENDED';
    if ([...this.state.posts.entries, ...this.state.behaviors.entries, ...(this.state.end ? [this.state.end] : [])].some(e => e.code === 'PRIVACY_RETRACTED')) {
      this.quarantineNow('PRIVACY_RETRACTED', Date.now());
    }
  }
  private mutate<T>(operation: () => T, receipts: CompactReceipt[] = []): Promise<T> {
    return this.enqueue(async () => {
      if (this.failed) throw new Error('V2_STORAGE_BLOCKED');
      try {
        const result = operation(); this.sync();
        await this.repository.save(this.state, this.committed.revision, receipts);
        this.committed = structuredClone(this.state);
        return result;
      } catch (error) {
        this.failed = true; this.install(structuredClone(this.committed));
        throw error;
      }
    });
  }
  wake() { this.kick(); }
  private kick() {
    if (this.committed.withdrawal) { void this.flushWithdrawal().catch(() => {}); return; }
    if (this.committed.quarantine) {
      // mutate already preserves the committed state and closes the storage gate on failure.
      void this.flushRetractions().catch(() => {}); return;
    }
    if (this.canSend()) { this.posts.kick(); this.behaviors.kick(); this.ending.kick(); }
  }
  async start(goalText: string, plannedSessionId?: string) {
    if (this.starting) throw new Error('V2_START_IN_FLIGHT');
    this.starting = true;
    try {
      await this.startOnce(goalText, plannedSessionId);
    } finally { this.starting = false; }
  }
  private async startOnce(goalText: string, plannedSessionId?: string) {
    if (!['IDLE', 'START_PENDING', 'ENDED'].includes(this.committed.lifecycle) || this.committed.withdrawal || this.committed.quarantine && this.committed.quarantineClose?.phase !== 'acknowledged' || this.stopping && this.committed.lifecycle !== 'ENDED') throw new Error('V2_START_BLOCKED');
    const access = await this.verifyAccess(true);
    const previousSessionId = this.committed.lifecycle === 'ENDED' ? this.committed.session?.sessionId : undefined;
    const previous = previousSessionId ? undefined : this.committed.start;
    const epoch = this.accessEpoch, credential = accessGeneration();
    if (previous && (previous.plannedSessionId && previous.plannedSessionId !== plannedSessionId || previous.goalText !== goalText || previous.collectionSpecVersion !== '2.0' || previous.apiBaseUrl !== API_BASE_URL)) throw new Error('V2_START_CONFLICT');
    const prepared = await this.mutate(() => {
      if (this.freeGoalSession && (epoch !== this.accessEpoch || credential !== accessGeneration() || this.userPrivacyPending
        || this.state.withdrawal)) return false;
      if (previousSessionId) {
        const revision = this.state.revision;
        this.posts.clear(); this.behaviors.clear(); this.ending.clear(); this.compactedIds = [];
        this.install({ ...initialState(API_BASE_URL), revision });
      }
      this.state.owner ??= { participantId: access.participantId, consentId: access.consentId };
      this.state.start ??= { ...(plannedSessionId ? { plannedSessionId } : {}),
        ...(this.freeGoalSession && previousSessionId ? { previousSessionId } : {}), goalText, idempotencyKey: crypto.randomUUID(), collectionSpecVersion: '2.0', apiBaseUrl: API_BASE_URL };
      this.state.lifecycle = 'START_PENDING';
      return true;
    });
    if (!prepared) throw new AccessError('account');
    if (this.freeGoalSession && (epoch !== this.accessEpoch || credential !== accessGeneration() || this.userPrivacyPending)) {
      throw new AccessError('account');
    }
    this.stopping = false; this.held = false;
    await this.verifyAccess();
    const response = await this.transport.start(goalText, this.committed.start!.idempotencyKey);
    if (!isV2Session(response) || response.status !== 'ACTIVE' || response.goalText !== goalText
      || response.sessionId === (previousSessionId ?? previous?.previousSessionId)) throw new Error('V2_VERSION_OR_SESSION_MISMATCH');
    const activated = await this.mutate(() => {
      if (this.freeGoalSession && (epoch !== this.accessEpoch || credential !== accessGeneration() || !this.authorized())) return false;
      const { sessionId, goalText, startedAt, status, endedAt, collectionSpecVersion } = response;
      this.state.session = this.freeGoalSession ? { sessionId, goalText, startedAt, status, endedAt, collectionSpecVersion } : response;
      this.state.lifecycle = 'ACTIVE'; this.reconnectRequired = false;
      return true;
    });
    if (!activated) throw new AccessError('authentication');
    this.kick();
  }
  async observe(observation: Observation) {
    if (this.stopping || this.held || this.committed.quarantine || this.committed.lifecycle !== 'ACTIVE') return;
    const sessionId = this.committed.session?.sessionId;
    try { await this.verifyAccess(); } catch { return; }
    if (this.freeGoalSession && !this.collecting()) return;
    if (this.committed.candidates.length >= 200) await this.compact(observation.stamp);
    if (this.stopping || this.held) return;
    if (!observation.safe || !observation.permitted) return this.quarantine('SENSITIVE_CONTENT', observation.stamp.wall);
    await this.mutate(() => {
      if (this.freeGoalSession && (!this.collecting() || sessionId !== this.committed.session?.sessionId)) return;
      this.collector.observe(observation);
      this.collector.expire(observation.stamp);
      // Backpressure preserves all unresolved data rather than evicting it.
      if (this.state.candidates.length > 200) throw new Error('V2_BACKPRESSURE');
    });
    this.kick();
  }
  async foreground(tab: number | null, stamp: Stamp, switchEvent = false) {
    if (this.failed) throw new Error('V2_STORAGE_BLOCKED');
    if (!this.collecting()) return;
    await this.mutate(() => {
      if (this.userPrivacyPending) return;
      this.collector.foreground(tab, stamp, switchEvent); this.sync(true);
    });
    this.kick();
  }
  async leave(tab: number, stamp: Stamp, navigation = false) {
    if (!this.collecting()) return;
    await this.mutate(() => {
      if (this.userPrivacyPending) return;
      navigation ? this.collector.invalidateTarget(tab, stamp) : this.collector.pause(tab, stamp); this.sync(true);
    });
    this.kick();
  }
  async stop(stamp: Stamp) {
    if (this.freeGoalSession && (this.userPrivacyPending || this.stopping && !this.committed.quarantine)) throw new Error('V2_STOP_BLOCKED');
    this.stopping = true; // Synchronous intent precedes queued writes and in-flight HTTP replies.
    if (this.committed.quarantine && this.committed.session && !this.committed.withdrawal) {
      if (this.committed.quarantineClose?.phase === 'acknowledged') return;
      await this.mutate(() => { this.state.quarantineClose ??= { sessionId: this.state.session!.sessionId, phase: 'pending' }; });
      await this.flushRetractions();
      return;
    }
    if (this.committed.lifecycle !== 'ACTIVE') return;
    const stopped = await this.mutate(() => {
      if (this.freeGoalSession && (this.state.withdrawal || this.userPrivacyPending)) return false;
      this.collector.finish(stamp); this.sync(true); this.ending.begin(this.state.session!, stamp.wall);
      this.state.lifecycle = 'END_PENDING';
      return true;
    });
    if (!stopped) { this.stopping = false; throw new Error('V2_STOP_BLOCKED'); }
    this.kick();
  }
  private quarantineNow(reason: NonNullable<V2State['quarantine']>['reason'], wall: number) {
    this.state.quarantine ??= { reason, observedAt: new Date(wall).toISOString(), visitIds: [...new Set([...this.state.candidates.map(c => c.id), ...this.compactedIds])], status: 'RETRACTION_REQUIRED' };
    for (const c of this.state.candidates) c.cursor = undefined;
    this.state.foreground = null;
    this.queueRetractions();
  }
  private queueRetractions() {
    const q = this.state.quarantine;
    if (!q || !this.state.session) return;
    this.state.retractions ??= [];
    for (const visitId of new Set([...q.visitIds, ...this.compactedIds])) {
      if (this.state.retractions.some(e => e.request.visitId === visitId)) continue;
      this.state.retractions.push({ request: { retractionId: crypto.randomUUID(), visitId, observedAt: q.observedAt,
        reasonCode: q.reason === 'CONSENT_WITHDRAWN' ? 'CONSENT_WITHDRAWN' : 'SENSITIVE_CONTENT' },
        phase: 'pending', attempts: 0, nextAttemptAt: 0 });
    }
  }
  async flushRetractions() {
    if (this.retractionRunning || this.failed || !this.committed.quarantine || !this.committed.session || this.committed.quarantineClose?.phase === 'acknowledged') return;
    this.retractionRunning = true;
    try {
      const sessionId = this.committed.session.sessionId;
      if (!this.committed.quarantineConfirmedFor && this.transport.confirmQuarantine && !this.committed.quarantineClose && !this.committed.retractions?.length) {
        await this.verifyAccess(false, true);
        const receipt = await this.transport.confirmQuarantine(sessionId) as { sessionId?: string; privacyStatus?: string };
        if (receipt?.sessionId !== sessionId || receipt.privacyStatus !== 'QUARANTINED') throw new Error('DELIVERY_UNCONFIRMED');
        await this.mutate(() => { this.state.quarantineConfirmedFor = sessionId; });
      }
      for (const saved of this.committed.retractions ?? []) {
        if (saved.phase === 'acknowledged' || saved.nextAttemptAt > Date.now()) continue;
        const id = saved.request.retractionId;
        await this.mutate(() => { const e = this.state.retractions!.find(e => e.request.retractionId === id)!; e.phase = 'sending'; e.attempts++; });
        try {
          await this.verifyAccess(false, true);
          const ack = await this.transport.retract!(this.committed.session.sessionId, structuredClone(saved.request));
          if (!validRetractionAck(ack, saved.request)) throw new Error('DELIVERY_UNCONFIRMED');
          await this.mutate(() => { const e = this.state.retractions!.find(e => e.request.retractionId === id)!; e.ack = ack; e.phase = 'acknowledged'; delete e.errorCode; });
        } catch {
          if (this.failed) return;
          await this.mutate(() => { const e = this.state.retractions!.find(e => e.request.retractionId === id)!;
            e.phase = 'pending'; e.errorCode = 'DELIVERY_UNCONFIRMED'; e.nextAttemptAt = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(e.attempts, 6)); });
        }
      }
      const close = this.committed.quarantineClose;
      if (close?.phase === 'pending' && this.transport.closeQuarantine &&
          !this.committed.retractions?.some(e => e.phase !== 'acknowledged')) {
        await this.verifyAccess(false, true);
        const receipt = await this.transport.closeQuarantine(close.sessionId) as { sessionId?: string; status?: string; privacyStatus?: string };
        if (receipt?.sessionId !== close.sessionId || receipt.status !== 'ENDED' || receipt.privacyStatus !== 'QUARANTINED') throw new Error('DELIVERY_UNCONFIRMED');
        await this.mutate(() => {
          this.state.quarantineClose = { ...close, phase: 'acknowledged' };
          this.ending.clear();
          this.state.lifecycle = 'ENDED';
        });
      }
    } finally { this.retractionRunning = false; }
  }
  async quarantine(reason: NonNullable<V2State['quarantine']>['reason'], wall: number) {
    this.held = true; // Also blocks a late ACK from releasing the next request before commit.
    await this.mutate(() => this.quarantineNow(reason, wall));
    this.kick();
  }
  async resume(plannedSessionId: string) {
    if (!plannedSessionId || this.committed.lifecycle !== 'ACTIVE' || this.committed.start?.plannedSessionId !== plannedSessionId || !this.committed.session || this.committed.quarantine || this.committed.withdrawal) throw new Error('V2_RESUME_BLOCKED');
    await this.verifyAccess();
    const session = await this.transport.query(this.committed.session);
    if (!isV2Session(session) || session.sessionId !== this.committed.session.sessionId || session.status !== 'ACTIVE') throw new Error('V2_RESUME_BLOCKED');
    await this.retry();
  }
  async resumeUserSession() {
    const { session, lifecycle, start, quarantine, withdrawal } = this.committed;
    if (!this.freeGoalSession || !session || lifecycle !== 'ACTIVE' || start?.plannedSessionId || quarantine || withdrawal || this.stopping) {
      throw new Error('V2_RESUME_BLOCKED');
    }
    this.reconnectRequired = true;
    const epoch = this.accessEpoch, credential = accessGeneration();
    await this.verifyAccess();
    const result = await this.transport.query(session);
    if (!matchesSession(result, session) || result.status !== 'ACTIVE' || this.committed.lifecycle !== 'ACTIVE'
      || this.committed.session?.sessionId !== session.sessionId || this.stopping || this.committed.quarantine
      || epoch !== this.accessEpoch || credential !== accessGeneration() || !this.authorized()) throw new Error('V2_RESUME_BLOCKED');
    this.reconnectRequired = false;
    await this.retry();
  }
  async retry() {
    if (this.failed) return;
    if (this.committed.withdrawal) { await this.flushWithdrawal(); return; }
    await this.verifyAccess(false, Boolean(this.committed.quarantine));
    if (this.committed.quarantine) {
      await this.mutate(() => { for (const e of this.state.retractions ?? []) e.nextAttemptAt = 0; });
      this.kick(); return;
    }
    await this.mutate(() => { this.posts.retry(); this.behaviors.retry(); this.ending.retry(); });
    this.kick();
  }
  async acknowledgeFailure(id: string) {
    await this.mutate(() => { const candidate = this.state.candidates.find(c => c.id === id); if (candidate?.excluded) candidate.failureAcknowledged = true; });
  }
  async compact(stamp: Stamp) {
    const receipts: CompactReceipt[] = [];
    await this.mutate(() => {
      this.collector.expire(stamp); this.sync(true);
      if (!this.state.quarantine) {
        const removed = this.state.candidates.filter(c => c.closed && !c.post && (!this.resumeIncomplete || c.failureAcknowledged) && (c.excluded || c.behavior.activeDurationMs < 5000));
        this.state.discardedCandidates += removed.length;
        this.state.candidates = this.state.candidates.filter(c => !removed.includes(c));
      }
      for (const p of [...this.state.posts.entries]) {
        const c = this.state.candidates.find(c => c.id === p.visitId)!;
        if (!canCompact(c, this.state)) break; // Only a complete prefix may advance the receipt watermark.
        const b = this.state.behaviors.entries.find(b => b.visitId === c.id)!;
        // Hash is supplied below before entering the synchronous IDB transaction.
        receipts.push({ visitId: c.id, sequence: p.sequence, originalHash: '', postAck: behaviorSnapshot(p.serverBehavior!), behaviorAck: behaviorSnapshot(b.ack!) });
      }
    });
    if (!receipts.length) return;
    for (const receipt of receipts) {
      const p = this.committed.posts.entries.find(p => p.visitId === receipt.visitId)!;
      receipt.originalHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(p.visit))))].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    await this.mutate(() => {
      const ids = new Set(receipts.map(r => r.visitId));
      if (this.state.quarantine || receipts.some(r => !canCompact(this.state.candidates.find(c => c.id === r.visitId)!, this.state))) throw new Error('V2_COMPACTION_CONFLICT');
      this.state.candidates = this.state.candidates.filter(c => !ids.has(c.id));
      this.state.posts.entries = this.state.posts.entries.filter(e => !ids.has(e.visitId));
      this.state.behaviors.entries = this.state.behaviors.entries.filter(e => !ids.has(e.visitId));
      if (this.state.lastVisit && ids.has(this.state.lastVisit)) delete this.state.lastVisit;
      this.state.compactedThrough = receipts.at(-1)!.sequence; this.state.compactedCount += receipts.length;
      this.install(this.state);
    }, receipts);
    this.compactedIds.push(...receipts.map(r => r.visitId));
  }
  async recordShown(alert: V2Alert, shownAt: string) {
    await this.verifyAccess();
    if (this.stopping || this.held || this.committed.lifecycle !== 'ACTIVE' || this.committed.quarantine
      || alert.sessionId !== this.committed.session?.sessionId) throw new Error('V2_ALERT_BLOCKED');
    await this.mutate(() => {
      const previous = this.state.notifications.find(r => r.alertId === alert.alertId);
      if (previous && previous.shownAt !== shownAt) throw new Error('V2_ALERT_SHOWN_CONFLICT');
      if (!previous) this.state.notifications.push({ alertId: alert.alertId, shownAt, shownAck: false });
    });
    await this.flushNotifications();
  }
  async selectAlert(alertId: string, selection: NonNullable<NotificationReceipt['selection']>) {
    await this.verifyAccess();
    if (this.held || this.committed.quarantine) throw new Error('V2_ALERT_BLOCKED');
    await this.mutate(() => {
      const receipt = this.state.notifications.find(r => r.alertId === alertId);
      if (!receipt) throw new Error('V2_ALERT_NOT_SHOWN');
      if (receipt.selection && JSON.stringify(receipt.selection) !== JSON.stringify(selection)) throw new Error('V2_ALERT_SELECTION_CONFLICT');
      receipt.selection = selection;
    });
    await this.flushNotifications();
  }
  async flushNotifications() {
    if (this.notificationRunning || this.failed || this.held || this.committed.quarantine || !this.committed.session) return;
    this.notificationRunning = true;
    try {
      for (const saved of this.committed.notifications) {
        if (this.held || this.committed.quarantine) break;
        if (saved.selection ? saved.selectionAck : saved.shownAck) continue;
        await this.verifyAccess();
        const ack = await sendNotification(this.committed.session.sessionId, structuredClone(saved));
        await this.mutate(() => {
          const receipt = this.state.notifications.find(r => r.alertId === saved.alertId)!;
          receipt.shownAck = true;
          if (ack === 'selection') receipt.selectionAck = true;
        });
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'PRIVACY_RETRACTED') await this.quarantine('PRIVACY_RETRACTED', Date.now());
      // Failed HTTP/ACK remains durable with the original timestamps for explicit retry.
    } finally { this.notificationRunning = false; }
  }
  async withdrawAll(wall = Date.now()) {
    this.suspendAccess();
    if (!this.freeGoalSession) this.held = true;
    const identity = this.verifiedIdentity;
    const current = identity && identity.credentialEpoch === accessGeneration() && Date.parse(identity.expiresAt) > Date.now();
    if (this.committed.owner && current && identity.participantId !== this.committed.owner.participantId) throw new AccessError('account');
    if (this.committed.owner && !current) await this.verifyAccess(false, true);
    if (!this.committed.owner) {
      const identity = await this.verifyAccess(false, true);
      await this.mutate(() => { this.state.owner = { participantId: identity.participantId, consentId: identity.consentId }; });
    }
    this.held = true;
    await this.mutate(() => {
      this.state.withdrawal ??= { requestId: crypto.randomUUID(), phase: 'pending', attempts: 0 };
      this.quarantineNow('CONSENT_WITHDRAWN', wall);
    });
    await this.flushWithdrawal();
  }
  async flushWithdrawal() {
    if (this.withdrawalRunning || this.failed || !this.committed.withdrawal || !this.transport.withdraw) return;
    const saved = this.committed.withdrawal;
    if (saved.phase === 'acknowledged') return;
    this.withdrawalRunning = true;
    try {
      await this.verifyAccess(false, true);
      await this.mutate(() => { this.state.withdrawal!.phase = 'sending'; this.state.withdrawal!.attempts++; });
      const ack = await this.transport.withdraw(saved.requestId);
      if (!validWithdrawal(ack, saved.requestId)) throw new Error('WITHDRAWAL_UNCONFIRMED');
      await this.mutate(() => { this.state.withdrawal!.phase = 'acknowledged'; this.state.withdrawal!.ack = ack; });
    } catch {
      if (!this.failed && this.state.withdrawal?.phase === 'sending') await this.mutate(() => { this.state.withdrawal!.phase = 'pending'; });
    } finally { this.withdrawalRunning = false; }
  }
  async idle() { await this.enqueue(async () => {}); }
}
export const v2HttpTransport: V2Transport = {
  access: readCollectionAccess,
  withdraw: requestId => accessRequest('/api/consent/withdrawals', { requestId }),
  start: (goalText, key) => postJson('/api/sessions', { goalText, collectionSpecVersion: '2.0' }, key),
  confirmQuarantine: id => accessRequest(`/api/sessions/${id}/visit-retractions/quarantine`, {}),
  closeQuarantine: id => accessRequest(`/api/sessions/${id}/visit-retractions/close`, {}),
  retract: sendRetraction,
  post: savePageVisit, patch: updateVisitBehavior, end: endSession, query: getSession,
};
