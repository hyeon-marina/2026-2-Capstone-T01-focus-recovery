import { validRetraction } from './retractions';
import { validNotification } from './notifications';
import { DB_NAME, DB_VERSION, StorageFailure, canonical } from '../background/durable-state';
import { VisitDelivery } from '../background/visit-delivery';
import { BehaviorDelivery } from '../background/behavior-delivery';
import { validBehavior, coversBehavior } from '../api/behavior';
import { matchesEndedSession } from '../api/session-end';
import { validTime } from '../api/visit';
import { validGoal, normalizeGoal } from '../shared/goal';
import { isV2Session, UUID4, validPost, validSnapshot } from './contract';
import { initialState, type V2State, type CompactReceipt } from './state';

export function validateV2(s: V2State, api: string) {
  const fail = () => { throw new StorageFailure('corrupt'); };
  if (!s || s.format !== 2 || s.collectionSpecVersion !== '2.0' || !Number.isSafeInteger(s.revision) || s.revision < 0
    || !Number.isInteger(s.nextSequence) || s.nextSequence < 1 || s.nextSequence > 2147483648
    || !['IDLE', 'START_PENDING', 'ACTIVE', 'END_PENDING', 'ENDED'].includes(s.lifecycle)
    || !Array.isArray(s.notifications) || s.notifications.some(r => !validNotification(r))
    || new Set(s.notifications.map(r => r.alertId)).size !== s.notifications.length
    || !Array.isArray(s.candidates) || !s.tabs || !s.tabKeys || Object.values(s.tabKeys).some(k => !UUID4.test(k))
    || !Number.isSafeInteger(s.discardedCandidates) || s.discardedCandidates < 0 || !s.posts || !s.behaviors
    || !Number.isSafeInteger(s.compactedCount) || s.compactedCount < 0 || !Number.isInteger(s.compactedThrough)
    || s.compactedThrough < 0 || s.compactedThrough >= s.nextSequence) fail();
  if (s.posts.apiBaseUrl !== api || s.behaviors.apiBaseUrl !== api || s.start && s.start.apiBaseUrl !== api) throw new StorageFailure('server-changed');
  if (s.start && (!UUID4.test(s.start.idempotencyKey) || s.start.collectionSpecVersion !== '2.0'
    || !validGoal(s.start.goalText) || normalizeGoal(s.start.goalText) !== s.start.goalText)) fail();
  if (s.lifecycle !== 'IDLE' && !s.start || ['ACTIVE', 'END_PENDING', 'ENDED'].includes(s.lifecycle)
    && (!isV2Session(s.session) || s.session?.goalText !== s.start?.goalText || s.session.status !== 'ACTIVE')) fail();
  const ids = new Set<string>(), sequences = new Set<number>();
  for (const c of s.candidates) {
    if (!c || !UUID4.test(c.id) || ids.has(c.id) || !UUID4.test(c.tabKey) || !Number.isSafeInteger(c.tabId) || c.tabId < 0
      || !/^[a-f0-9]{64}$/.test(c.target) || !c.document || !c.generation || !validTime(c.visitedAt)
      || !validBehavior(c.behavior) || !Number.isFinite(c.remainder) || c.remainder < 0 || c.remainder >= 1
      || typeof c.closed !== 'boolean' || typeof c.crossed !== 'boolean'
      || [c.left, c.returned, c.cursor].some(t => t !== undefined && (!t.epoch || !Number.isFinite(t.mono) || !Number.isFinite(t.wall)))
      || c.snapshot && !validSnapshot(c.snapshot, s.session!.sessionId)) fail();
    ids.add(c.id);
    if (c.post) {
      if (!validPost(c.post) || c.post.visitId !== c.id || c.post.sessionId !== s.session?.sessionId
        || c.post.browserTabKey !== c.tabKey || c.post.visitedAt !== c.visitedAt || !coversBehavior(c.behavior, c.post)
        || sequences.has(c.post.sequence) || c.post.sequence <= s.compactedThrough || c.post.sequence >= s.nextSequence
        || !c.snapshot || Object.entries(c.snapshot).some(([k, v]) => !['identity', 'organicResultCount'].includes(k) && c.post![k as keyof typeof c.post] !== v)) fail();
      sequences.add(c.post.sequence);
    }
  }
  if (s.posts.entries.length !== sequences.size || s.compactedCount + sequences.size > s.nextSequence - 1) fail();
  const posts = new VisitDelivery(async op => op(), () => false);
  posts.restore(structuredClone(s.posts), s.session?.sessionId);
  if (posts.blocked) fail();
  for (const e of s.posts.entries) if (e.phase === 'acked' && !e.serverBehavior || !validPost(e.visit) || canonical(e.visit) !== canonical(s.candidates.find(c => c.id === e.visitId)?.post)) fail();
  const behaviors = new BehaviorDelivery(async op => op(), () => false);
  behaviors.restore(structuredClone(s.behaviors), s.posts.entries);
  if (behaviors.blocked || s.behaviors.entries.length !== sequences.size) fail();
  for (const e of s.behaviors.entries) if (!coversBehavior(s.candidates.find(c => c.id === e.visitId)!.behavior, e.latest)) fail();
  for (const [id, visit] of Object.entries(s.tabs)) if (!s.candidates.some(c => c.id === visit && c.tabId === Number(id) && !c.closed)) fail();
  if (s.foreground !== null && !Number.isSafeInteger(s.foreground) || s.lastTab !== null && !Number.isSafeInteger(s.lastTab)) fail();
  if (s.retractions && (!s.quarantine || !Array.isArray(s.retractions) || s.retractions.some(e => !validRetraction(e))
    || new Set(s.retractions.map(e => e.request.visitId)).size !== s.retractions.length
    || new Set(s.retractions.map(e => e.request.retractionId)).size !== s.retractions.length)) fail();
  if (s.quarantine && (s.quarantine.status !== 'RETRACTION_REQUIRED' || !validTime(s.quarantine.observedAt)
    || !['SENSITIVE_CONTENT', 'CONSENT_WITHDRAWN', 'PRIVACY_RETRACTED'].includes(s.quarantine.reason)
    || !Array.isArray(s.quarantine.visitIds) || s.quarantine.visitIds.some(id => !UUID4.test(id)))) fail();
  if (['END_PENDING', 'ENDED'].includes(s.lifecycle) !== Boolean(s.end)) fail();
  if (s.end && (canonical(s.end.session) !== canonical(s.session) || s.end.apiBaseUrl !== api || !validTime(s.end.requestedAt)
    || !['draining', 'queued', 'sending', 'retry-wait', 'failed', 'acked'].includes(s.end.phase)
    || !Number.isSafeInteger(s.end.attempts) || s.end.attempts < 0 || s.end.attempts > 3
    || s.end.request && (Object.keys(s.end.request).length !== 0 || !drained(s))
    || s.end.phase === 'acked' && (!matchesEndedSession(s.end.ack, s.session!)
      || canonical(s.end.lastServer) !== canonical(s.end.ack) || !drained(s))
    || s.end.phase !== 'acked' && s.end.ack !== undefined
    || ['sending', 'retry-wait', 'acked'].includes(s.end.phase) && s.end.attempts === 0
    || s.end.phase === 'retry-wait' && (!s.end.retryable || !Number.isFinite(s.end.nextRetryAt))
    || s.lifecycle === 'ENDED' && s.end.phase !== 'acked')) fail();
}
export function drained(s: V2State) {
  return s.candidates.every(c => c.closed) && s.posts.entries.every(e => e.phase === 'acked')
    && s.candidates.every(c => !c.post || s.behaviors.entries.some(e => e.visitId === c.id && e.phase === 'acked' && e.ack && coversBehavior(e.ack, c.behavior)));
}
function complete(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new StorageFailure('storage'));
    tx.onerror = () => {};
  });
}
export class V2Repository {
  private db?: IDBDatabase;
  constructor(readonly apiBaseUrl: string) {}
  private async open() {
    if (this.db) return this.db;
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        for (const name of ['state', 'v2', 'v2-receipts']) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
      };
      let failed = false;
      r.onerror = r.onblocked = () => { failed = true; reject(new StorageFailure('storage')); };
      r.onsuccess = () => {
        if (failed) { r.result.close(); return; }
        r.result.onversionchange = () => { r.result.close(); this.db = undefined; };
        resolve(r.result);
      };
    });
    return this.db;
  }
  async load(): Promise<V2State> {
    const db = await this.open(), tx = db.transaction(['v2', 'v2-receipts'], 'readonly'), done = complete(tx);
    const r = tx.objectStore('v2').get('current');
    let receipts: CompactReceipt[] = [];
    r.onsuccess = () => {
      const sessionId = r.result?.session?.sessionId;
      if (typeof sessionId !== 'string') return;
      const query = tx.objectStore('v2-receipts').getAll(IDBKeyRange.bound(`${sessionId}/`, `${sessionId}/\uffff`));
      query.onsuccess = () => { receipts = query.result; };
    };
    await done;
    const s = r.result ?? initialState(this.apiBaseUrl);
    validateV2(s, this.apiBaseUrl);
    if (receipts.length !== s.compactedCount || receipts.some(receipt => !UUID4.test(receipt.visitId)
      || !Number.isInteger(receipt.sequence) || receipt.sequence < 1 || receipt.sequence > s.compactedThrough
      || !/^[a-f0-9]{64}$/.test(receipt.originalHash) || !validBehavior(receipt.postAck) || !validBehavior(receipt.behaviorAck)
      || !coversBehavior(receipt.behaviorAck, receipt.postAck))
      || new Set(receipts.map(r => r.sequence)).size !== receipts.length
      || receipts.reduce((max, r) => Math.max(max, r.sequence), 0) !== s.compactedThrough) throw new StorageFailure('corrupt');
    return s;
  }
  async save(next: V2State, expectedRevision: number, receipts: CompactReceipt[] = []): Promise<void> {
    validateV2(next, this.apiBaseUrl);
    const saved = structuredClone(next);
    saved.revision = expectedRevision + 1;
    const db = await this.open(), tx = db.transaction(['v2', 'v2-receipts'], 'readwrite', { durability: 'strict' });
    const done = complete(tx), store = tx.objectStore('v2'), r = store.get('current');
    r.onsuccess = () => {
      const previous = r.result as V2State | undefined;
      if ((previous?.revision ?? 0) !== expectedRevision) { tx.abort(); return; }
      const newSession = previous?.lifecycle === 'ENDED' && saved.lifecycle === 'START_PENDING' && !previous.quarantine;
      // CAS also guards immutable originals and irreversible sequence/lifecycle progress.
      if (previous && !newSession && (saved.nextSequence < previous.nextSequence
        || previous.session && canonical(saved.session) !== canonical(previous.session)
        || ['END_PENDING', 'ENDED'].includes(previous.lifecycle) && !['END_PENDING', 'ENDED'].includes(saved.lifecycle)
        || previous.quarantine && canonical(saved.quarantine) !== canonical(previous.quarantine)
        || previous.retractions?.some(old => {
          const current = saved.retractions?.find(e => e.request.retractionId === old.request.retractionId);
          return !current || canonical(current.request) !== canonical(old.request)
            || old.ack && canonical(current.ack) !== canonical(old.ack);
        })
        || previous.posts.entries.some(old => {
          const current = saved.posts.entries.find(e => e.visitId === old.visitId);
          return current ? canonical(current.visit) !== canonical(old.visit)
            : !receipts.some(receipt => receipt.visitId === old.visitId && receipt.sequence === old.sequence);
        }))) { tx.abort(); return; }
      try {
        if (newSession) store.add(previous, `session/${previous!.session!.sessionId}`);
        for (const receipt of receipts) tx.objectStore('v2-receipts').add(receipt, `${next.session!.sessionId}/${receipt.visitId}`);
        store.put(saved, 'current');
      } catch { tx.abort(); }
    };
    await done;
    next.revision = saved.revision;
  }
  async compactedVisitIds(sessionId: string): Promise<string[]> {
    const db = await this.open(), tx = db.transaction('v2-receipts'), done = complete(tx);
    const request = tx.objectStore('v2-receipts').getAll(IDBKeyRange.bound(`${sessionId}/`, `${sessionId}/\uffff`));
    await done; return (request.result as CompactReceipt[]).map(r => r.visitId);
  }
  close() { this.db?.close(); this.db = undefined; }
}
