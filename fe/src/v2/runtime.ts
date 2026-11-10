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
import { endSession, getSession } from '../api/session-end';
import { isV2Session } from './contract';
import { V2Collector, canCompact, type Observation } from './collector';
import { V2Repository, drained } from './repository';
import { initialState, type V2State, type Stamp, type CompactReceipt } from './state';

export interface V2Transport {
  retract?: (sessionId: string, request: RetractionRequest) => Promise<unknown>;
  start: (goalText: string, key: string) => Promise<unknown>;
  post: typeof savePageVisit; patch: typeof updateVisitBehavior;
  end: typeof endSession; query: typeof getSession;
}
// No production entry point imports this module. Synthetic entry supplies a loopback-only transport.
export class V2Runtime {
  private state = initialState(API_BASE_URL);
  private committed = structuredClone(this.state);
  private collector = new V2Collector(this.state);
  private enqueue = serialExecutor();
  private failed = false;
  private stopping = false;
  private held = false;
  private starting = false;
  private notificationRunning = false;
  private retractionRunning = false;
  private compactedIds: string[] = [];
  private posts: VisitDelivery;
  private behaviors: BehaviorDelivery;
  private ending: SessionEndDelivery;
  constructor(private repository: V2Repository, private transport: V2Transport) {
    const protect = async <T>(send: () => Promise<T>) => {
      try { return await send(); }
      catch (e) { if (e && typeof e === 'object' && 'code' in e && e.code === 'PRIVACY_RETRACTED') this.held = true; throw e; }
    };
    const mutate = <T>(op: () => T) => this.mutate(op).then(value => { this.kick(); return value; });
    this.posts = new VisitDelivery(mutate, () => this.canSend(), v => protect(() => transport.post(v)));
    this.behaviors = new BehaviorDelivery(mutate, id => this.canSend() && this.committed.posts.entries.some(e => e.visitId === id && e.phase === 'acked'), (s, id, b) => protect(() => transport.patch(s, id, b)));
    this.ending = new SessionEndDelivery(mutate, () => this.canSend(), () => drained(this.committed),
      () => [...this.state.posts.entries, ...this.state.behaviors.entries].some(e => e.code === 'SESSION_ENDED'), (s, b) => protect(() => transport.end(s, b)), s => protect(() => transport.query(s)));
  }
  collecting() { return !this.failed && !this.stopping && !this.held && !this.committed.quarantine && this.committed.lifecycle === 'ACTIVE'; }
  snapshot() { return { ...structuredClone(this.committed), storageFailed: this.failed, alertsSuppressed: this.failed || this.stopping || this.held || Boolean(this.committed.quarantine) }; }
  private canSend() { return !this.failed && !this.held && !this.committed.quarantine && !this.posts.blocked && !this.behaviors.blocked; }
  private install(s: V2State) {
    this.state = s; this.collector = new V2Collector(s);
    this.posts.checkpoint = s.posts; this.behaviors.checkpoint = s.behaviors; this.ending.checkpoint = s.end;
  }
  async initialize() {
    try {
      const s = await this.repository.load();
      this.compactedIds = s.session ? await this.repository.compactedVisitIds(s.session.sessionId) : [];
      this.committed = structuredClone(s); this.install(s);
      await this.mutate(() => {
        // Worker generation cannot establish a return interval, even for a surviving Chrome document.
        for (const c of s.candidates) { c.cursor = undefined; c.closed = true; }
        s.tabs = {}; s.foreground = null; s.lastTab = null; delete s.lastVisit;
        this.posts.restore(s.posts, s.session?.sessionId); this.behaviors.restore(s.behaviors, s.posts.entries);
        this.ending.restore(s.end);
        for (const e of s.retractions ?? []) if (e.phase === 'sending') e.phase = 'pending';
        if (s.quarantine) this.queueRetractions();
      });
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
    if (this.committed.quarantine) {
      // mutate already preserves the committed state and closes the storage gate on failure.
      void this.flushRetractions().catch(() => {}); return;
    }
    if (this.canSend()) { this.posts.kick(); this.behaviors.kick(); this.ending.kick(); }
  }
  async start(goalText: string) {
    if (this.starting) throw new Error('V2_START_IN_FLIGHT');
    this.starting = true;
    try {
      await this.startOnce(goalText);
    } finally { this.starting = false; }
  }
  private async startOnce(goalText: string) {
    if (!['IDLE', 'START_PENDING', 'ENDED'].includes(this.committed.lifecycle) || this.committed.quarantine || this.stopping && this.committed.lifecycle !== 'ENDED') throw new Error('V2_START_BLOCKED');
    const previousSessionId = this.committed.lifecycle === 'ENDED' ? this.committed.session?.sessionId : undefined;
    const previous = previousSessionId ? undefined : this.committed.start;
    if (previous && (previous.goalText !== goalText || previous.collectionSpecVersion !== '2.0' || previous.apiBaseUrl !== API_BASE_URL)) throw new Error('V2_START_CONFLICT');
    await this.mutate(() => {
      if (previousSessionId) {
        const revision = this.state.revision;
        this.posts.clear(); this.behaviors.clear(); this.ending.clear(); this.compactedIds = [];
        this.install({ ...initialState(API_BASE_URL), revision });
      }
      this.state.start ??= { goalText, idempotencyKey: crypto.randomUUID(), collectionSpecVersion: '2.0', apiBaseUrl: API_BASE_URL };
      this.state.lifecycle = 'START_PENDING';
    });
    this.stopping = false;
    const response = await this.transport.start(goalText, this.committed.start!.idempotencyKey);
    if (!isV2Session(response) || response.status !== 'ACTIVE' || response.goalText !== goalText || response.sessionId === previousSessionId) throw new Error('V2_VERSION_OR_SESSION_MISMATCH');
    await this.mutate(() => { this.state.session = response; this.state.lifecycle = 'ACTIVE'; });
    this.kick();
  }
  async observe(observation: Observation) {
    if (this.stopping || this.held || this.committed.quarantine || this.committed.lifecycle !== 'ACTIVE') return;
    if (this.committed.candidates.length >= 200) await this.compact(observation.stamp);
    if (this.stopping || this.held) return;
    if (!observation.safe || !observation.permitted) return this.quarantine('SENSITIVE_CONTENT', observation.stamp.wall);
    await this.mutate(() => {
      this.collector.observe(observation);
      this.collector.expire(observation.stamp);
      // Backpressure preserves all unresolved data rather than evicting it.
      if (this.state.candidates.length > 200) throw new Error('V2_BACKPRESSURE');
    });
    this.kick();
  }
  async foreground(tab: number | null, stamp: Stamp, switchEvent = false) {
    if (this.stopping || this.committed.lifecycle !== 'ACTIVE' || this.committed.quarantine) return;
    await this.mutate(() => { this.collector.foreground(tab, stamp, switchEvent); this.sync(true); });
    this.kick();
  }
  async leave(tab: number, stamp: Stamp, navigation = false) {
    if (this.stopping || this.committed.lifecycle !== 'ACTIVE' || this.committed.quarantine) return;
    await this.mutate(() => { navigation ? this.collector.invalidateTarget(tab, stamp) : this.collector.pause(tab, stamp); this.sync(true); });
    this.kick();
  }
  async stop(stamp: Stamp) {
    this.stopping = true; // Synchronous intent precedes queued writes and in-flight HTTP replies.
    if (this.committed.lifecycle !== 'ACTIVE') return;
    await this.mutate(() => {
      this.collector.finish(stamp); this.sync(true); this.ending.begin(this.state.session!, stamp.wall);
      this.state.lifecycle = 'END_PENDING';
    });
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
    if (this.retractionRunning || this.failed || !this.committed.quarantine || !this.committed.session || !this.transport.retract) return;
    this.retractionRunning = true;
    try {
      for (const saved of this.committed.retractions ?? []) {
        if (saved.phase === 'acknowledged' || saved.nextAttemptAt > Date.now()) continue;
        const id = saved.request.retractionId;
        await this.mutate(() => { const e = this.state.retractions!.find(e => e.request.retractionId === id)!; e.phase = 'sending'; e.attempts++; });
        try {
          const ack = await this.transport.retract(this.committed.session.sessionId, structuredClone(saved.request));
          if (!validRetractionAck(ack, saved.request)) throw new Error('DELIVERY_UNCONFIRMED');
          await this.mutate(() => { const e = this.state.retractions!.find(e => e.request.retractionId === id)!; e.ack = ack; e.phase = 'acknowledged'; delete e.errorCode; });
        } catch {
          if (this.failed) return;
          await this.mutate(() => { const e = this.state.retractions!.find(e => e.request.retractionId === id)!;
            e.phase = 'pending'; e.errorCode = 'DELIVERY_UNCONFIRMED'; e.nextAttemptAt = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(e.attempts, 6)); });
        }
      }
    } finally { this.retractionRunning = false; }
  }
  async quarantine(reason: NonNullable<V2State['quarantine']>['reason'], wall: number) {
    this.held = true; // Also blocks a late ACK from releasing the next request before commit.
    await this.mutate(() => this.quarantineNow(reason, wall));
    this.kick();
  }
  async retry() {
    if (this.failed) return;
    if (this.committed.quarantine) {
      await this.mutate(() => { for (const e of this.state.retractions ?? []) e.nextAttemptAt = 0; });
      this.kick(); return;
    }
    await this.mutate(() => { this.posts.retry(); this.behaviors.retry(); this.ending.retry(); });
    this.kick();
  }
  async compact(stamp: Stamp) {
    const receipts: CompactReceipt[] = [];
    await this.mutate(() => {
      this.collector.expire(stamp); this.sync(true);
      if (!this.state.quarantine) {
        const removed = this.state.candidates.filter(c => c.closed && !c.post && (c.excluded || c.behavior.activeDurationMs < 5000));
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
  async idle() { await this.enqueue(async () => {}); }
}
export const v2HttpTransport: V2Transport = {
  start: (goalText, key) => postJson('/api/sessions', { goalText, collectionSpecVersion: '2.0' }, key),
  retract: sendRetraction,
  post: savePageVisit, patch: updateVisitBehavior, end: endSession, query: getSession,
};
