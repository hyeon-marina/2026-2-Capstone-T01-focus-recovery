import { syntheticAccess } from './v2-fixture';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore, IDBKeyRange } from 'fake-indexeddb';
import { V2Runtime, type V2Transport } from '../src/v2/runtime';
import { V2Repository } from '../src/v2/repository';
import { API_BASE_URL } from '../src/api/client';
import { VisitApiError } from '../src/api/visit';
import { observation, session, time } from './v2-fixture';
import { Collector } from '../src/background/collector';
import { VisitDelivery } from '../src/background/visit-delivery';
import { BehaviorDelivery } from '../src/background/behavior-delivery';
import { DB_NAME, DurableRepository } from '../src/background/durable-state';

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange); });
function transport(): V2Transport {
  return { access: async () => syntheticAccess, start: vi.fn(async () => session),
    post: vi.fn(async v => ({ ...v, updatedAt: null })),
    patch: vi.fn(async (_s, visitId, b) => ({ ...b, visitId, applied: true, updatedAt: '2026-11-10T00:01:00.000Z' })),
    end: vi.fn(async s => ({ ...s, status: 'ENDED', endedAt: '2026-11-10T01:00:00.000Z' })),
    query: vi.fn(async () => session) };
}
async function setup(t = transport()) {
  const repo = new V2Repository(API_BASE_URL), runtime = new V2Runtime(repo, t);
  await runtime.initialize(); await runtime.start(session.goalText); await runtime.foreground(1, time(0));
  return { repo, runtime, t };
}
async function advance(r: V2Runtime, begin = 0, end = 5000, tabId = 1) {
  for (let ms = begin; ms <= end; ms += 1000) await r.observe(observation(ms, { tabId, document: `doc-${tabId}` }));
}
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 1)); }
  expect(check()).toBe(true);
}
describe('v2 durable runtime', () => {
  it('POSTs only a committed immutable snapshot and commits ACK', async () => {
    const { runtime: r, repo, t } = await setup();
    t.post = vi.fn(t.post); // Runtime retains its original transport function.
    await advance(r); await waitFor(() => r.snapshot().posts.entries[0]?.phase === 'acked');
    const disk = await repo.load(); expect(disk.nextSequence).toBe(2);
    expect(disk.posts.entries[0].visit).toEqual(disk.candidates[0].post);
    expect(disk.posts.entries[0].visit.extractionStatus).toBe('SUCCESS');
  });
  it('rolls back transaction abort / quota without exposing sequence or sending', async () => {
    const { runtime: r, repo, t } = await setup(); await advance(r, 0, 4000);
    const save = repo.save.bind(repo);
    vi.spyOn(repo, 'save').mockImplementationOnce(async () => { throw new DOMException('Quota', 'QuotaExceededError'); });
    await expect(r.observe(observation(5000, { document: 'doc-1' }))).rejects.toThrow();
    expect(r.snapshot().nextSequence).toBe(1); expect(t.post).not.toHaveBeenCalled();
    expect((await repo.load()).nextSequence).toBe(1);
    await expect(r.foreground(2, time(6000), true)).rejects.toThrow('V2_STORAGE_BLOCKED');
    repo.save = save; repo.close();
    const restarted = new V2Runtime(new V2Repository(API_BASE_URL), transport()); await restarted.initialize();
    expect(restarted.snapshot().nextSequence).toBe(1); expect(restarted.snapshot().candidates[0].closed).toBe(true);
  });
  it('resumes POST response loss with the same original ID/sequence after restart', async () => {
    const t = transport(); let resolve!: (v: never) => void;
    t.post = vi.fn(() => new Promise<never>(r => { resolve = r; }));
    const { runtime: r, repo } = await setup(t); await advance(r);
    await waitFor(() => vi.mocked(t.post).mock.calls.length === 1);
    const original = r.snapshot().posts.entries[0].visit; expect((await repo.load()).posts.entries[0].phase).toBe('sending');
    repo.close();
    const next = transport(), restarted = new V2Runtime(new V2Repository(API_BASE_URL), next);
    await restarted.initialize(); await restarted.retry();
    await waitFor(() => restarted.snapshot().posts.entries[0]?.phase === 'acked');
    expect(next.post).toHaveBeenCalledWith(original);
    resolve({ ...original, updatedAt: null } as never);
    await waitFor(() => r.snapshot().storageFailed);
    expect(restarted.snapshot().posts.entries[0].phase).toBe('acked');
  });
  it('blocks a second writer at stale revision without overwriting data', async () => {
    const { runtime: r } = await setup();
    const other = new V2Runtime(new V2Repository(API_BASE_URL), transport()); await other.initialize();
    await expect(r.observe(observation(0))).rejects.toThrow(); expect(r.snapshot().storageFailed).toBe(true);
    expect(other.snapshot().lifecycle).toBe('ACTIVE');
  });
  it('keeps PATCH waiting for durable POST ACK and freezes retries', async () => {
    const t = transport(); let ack!: (v: never) => void;
    t.post = vi.fn(() => new Promise<never>(r => { ack = r; }));
    const { runtime: r } = await setup(t); await advance(r);
    await r.foreground(2, time(5500), true); expect(t.patch).not.toHaveBeenCalled();
    await waitFor(() => vi.mocked(t.post).mock.calls.length === 1);
    const v = r.snapshot().posts.entries[0].visit;
    ack({ ...v, updatedAt: null } as never);
    await waitFor(() => vi.mocked(t.patch).mock.calls.length === 1);
    expect(vi.mocked(t.patch).mock.calls[0][2].tabSwitchCount).toBe(1);
    await waitFor(() => r.snapshot().behaviors.entries[0].phase === 'acked');
  });
  it('END_PENDING drains final behavior and survives response loss', async () => {
    const { runtime: r, repo, t } = await setup(); await advance(r);
    await waitFor(() => r.snapshot().posts.entries[0]?.phase === 'acked');
    await r.stop(time(5500)); await r.observe(observation(6000));
    await waitFor(() => r.snapshot().lifecycle === 'ENDED');
    expect(t.patch).toHaveBeenCalled(); expect(t.end).toHaveBeenCalledWith(session, {});
    expect(r.snapshot().candidates[0].behavior.activeDurationMs).toBe(5500);
    repo.close(); const next = new V2Runtime(new V2Repository(API_BASE_URL), transport()); await next.initialize();
    expect(next.snapshot().lifecycle).toBe('ENDED');
  });
  it('quarantines sent/uncertain originals and stops replay/PATCH/END even after restart', async () => {
    const t = transport(); t.post = vi.fn(async () => { throw new VisitApiError('http', 'privacy', false, 409, 'PRIVACY_RETRACTED'); });
    const { runtime: r, repo } = await setup(t); await advance(r);
    await waitFor(() => Boolean(r.snapshot().quarantine));
    await r.stop(time(6000)); await r.retry(); expect(t.patch).not.toHaveBeenCalled(); expect(t.end).not.toHaveBeenCalled();
    expect(r.snapshot().quarantine?.status).toBe('RETRACTION_REQUIRED');
    const original = r.snapshot().posts.entries[0].visit; repo.close();
    const next = transport(), restarted = new V2Runtime(new V2Repository(API_BASE_URL), next); await restarted.initialize(); await restarted.retry();
    expect(next.post).not.toHaveBeenCalled(); expect(restarted.snapshot().posts.entries[0].visit).toEqual(original);
  });
  it('compacts only complete expired prefix, keeps receipts and watermark on restart', async () => {
    const { runtime: r, repo } = await setup(); await advance(r);
    await waitFor(() => r.snapshot().posts.entries[0]?.phase === 'acked');
    await r.foreground(null, time(5000));
    await waitFor(() => r.snapshot().behaviors.entries[0]?.phase === 'acked');
    await r.compact(time(10000));
    expect(r.snapshot().candidates).toHaveLength(0); expect(r.snapshot().compactedCount).toBe(1);
    expect(r.snapshot().nextSequence).toBe(2); repo.close();
    const next = new V2Runtime(new V2Repository(API_BASE_URL), transport()); await next.initialize(); expect(next.snapshot().compactedThrough).toBe(1);
    await next.stop(time(11000)); await waitFor(() => next.snapshot().lifecycle === 'ENDED');
  });
  it('retains old DB v1 bytes during additive migration', async () => {
    const collector = new Collector();
    collector.start({ ...session, collectionSpecVersion: '1.0' });
    collector.foreground(1, 0); collector.navigate(1, 'legacy-doc', observation(0).target, 'new', 0);
    collector.observe(1, 'legacy-doc', session.sessionId, observation(0).snapshot, undefined, 1500); collector.stop(1500);
    const posts = new VisitDelivery(async op => op(), () => false); posts.collect(collector.status(1500, false).readyVisits);
    const behaviors = new BehaviorDelivery(async op => op(), () => false); behaviors.collect(collector.status(1500, false).readyVisits, posts.checkpoint.entries);
    const legacy = { format: 1, revision: 7, sessionId: session.sessionId,
      value: { collection: collector.state, visitDelivery: posts.checkpoint, behaviorDelivery: behaviors.checkpoint } };
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1); r.onupgradeneeded = () => r.result.createObjectStore('state');
      r.onerror = () => reject(r.error); r.onsuccess = () => {
        const db = r.result, tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(legacy, 'current');
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
    const repo = new V2Repository(API_BASE_URL); await repo.load();
    const value = await new Promise(resolve => {
      const r = indexedDB.open(DB_NAME, 2); r.onsuccess = () => {
        const db = r.result, tx = db.transaction('state', 'readonly'), get = tx.objectStore('state').get('current');
        tx.oncomplete = () => { db.close(); resolve(get.result); };
      };
    });
    expect(value).toEqual(legacy); repo.close();
    const v1 = new DurableRepository(), recovered = await v1.initialize({});
    expect(recovered.value).toEqual(legacy.value);
    expect(recovered.value.collection.candidates[0].activeDurationMs).toBe(1500);
    expect(recovered.value.visitDelivery!.entries[0].phase).toBe('queued'); await v1.close();
  });
  it('retains start key across uncertain responses and rejects version fallback', async () => {
    const t = transport(); vi.mocked(t.start).mockResolvedValueOnce({ ...session, collectionSpecVersion: '1.0' });
    const repo = new V2Repository(API_BASE_URL), r = new V2Runtime(repo, t); await r.initialize();
    await expect(r.start(session.goalText)).rejects.toThrow('V2_VERSION_OR_SESSION_MISMATCH');
    const key = r.snapshot().start!.idempotencyKey;
    await expect(r.start('Different synthetic goal')).rejects.toThrow('V2_START_CONFLICT');
    await r.start(session.goalText); expect(t.start).toHaveBeenNthCalledWith(2, session.goalText, key);
  });
  it('does not interpret SESSION_ENDED as a POST ACK', async () => {
    const t = transport(); t.post = vi.fn(async () => { throw new VisitApiError('http', 'ended', false, 409, 'SESSION_ENDED'); });
    const { runtime: r } = await setup(t); await advance(r); await r.stop(time(5500));
    await waitFor(() => r.snapshot().posts.entries[0]?.phase === 'failed');
    expect(r.snapshot().lifecycle).toBe('END_PENDING'); expect(t.end).not.toHaveBeenCalled();
  });
});

it('serializes concurrent validation commits and exposes only successful sequence order', async () => {
  const { runtime: r, t } = await setup();
  await advance(r, 0, 4000);
  await Promise.all([r.observe(observation(5000, { document: 'doc-1' })), r.observe(observation(5000, { document: 'doc-1' }))]);
  await waitFor(() => r.snapshot().posts.entries[0]?.phase === 'acked');
  expect(r.snapshot().nextSequence).toBe(2); expect(t.post).toHaveBeenCalledTimes(1);
});
it('does not transmit unresolved data during compaction or change the original', async () => {
  const t = transport(); t.post = vi.fn(() => new Promise<never>(() => {}));
  const { runtime: r, repo } = await setup(t); await advance(r); await r.foreground(null, time(5500));
  const original = structuredClone(r.snapshot().posts.entries[0].visit);
  await r.compact(time(10000)); expect(r.snapshot().posts.entries[0].visit).toEqual(original);
  expect(r.snapshot().compactedCount).toBe(0);
  const forged = await repo.load(); forged.posts.entries[0].visit.title = 'Forged immutable original'; forged.candidates[0].post!.title = 'Forged immutable original'; forged.candidates[0].snapshot!.title = 'Forged immutable original';
  await expect(repo.save(forged, forged.revision)).rejects.toThrow();
  expect((await repo.load()).posts.entries[0].visit).toEqual(original);
});
it('rejects damaged storage without overwriting the damaged bytes', async () => {
  const { repo } = await setup(); const before = await repo.load(); repo.close();
  const damaged = { ...before, nextSequence: 0 };
  await new Promise<void>(resolve => {
    const open = indexedDB.open(DB_NAME); open.onsuccess = () => {
      const db = open.result, tx = db.transaction('v2', 'readwrite'); tx.objectStore('v2').put(damaged, 'current');
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  });
  const r = new V2Runtime(new V2Repository(API_BASE_URL), transport());
  await expect(r.initialize()).rejects.toThrow('corrupt'); expect(r.snapshot().storageFailed).toBe(true);
});
it('preserves END_PENDING and same end request after worker loss mid HTTP', async () => {
  const t = transport(); t.end = vi.fn(() => new Promise<never>(() => {}));
  const { runtime: r, repo } = await setup(t); await advance(r); await r.stop(time(5500));
  await waitFor(() => vi.mocked(t.end).mock.calls.length === 1); const original = r.snapshot().end!.request;
  repo.close(); const next = transport(), restarted = new V2Runtime(new V2Repository(API_BASE_URL), next);
  await restarted.initialize(); await restarted.retry(); await waitFor(() => restarted.snapshot().lifecycle === 'ENDED');
  expect(next.end).toHaveBeenCalledWith(session, original);
});
it('quarantines immediately while a POST is in flight and never drains END', async () => {
  const t = transport(); let ack!: (v: never) => void;
  t.post = vi.fn(() => new Promise<never>(resolve => { ack = resolve; }));
  const { runtime: r } = await setup(t); await advance(r); await waitFor(() => vi.mocked(t.post).mock.calls.length === 1);
  const original = r.snapshot().posts.entries[0].visit;
  await r.quarantine('SENSITIVE_CONTENT', time(5500).wall); await r.stop(time(5500));
  ack({ ...original, updatedAt: null } as never); await r.idle();
  expect(t.patch).not.toHaveBeenCalled(); expect(t.end).not.toHaveBeenCalled();
  expect(r.snapshot().quarantine?.status).toBe('RETRACTION_REQUIRED');
});
it('collects more than 200 visits by compacting confirmed prefixes with stable tab keys', async () => {
  const { runtime: r } = await setup(); let tabKey: string | undefined;
  for (let i = 0; i < 205; i++) {
    const start = i * 11000;
    await r.foreground(1, time(start)); await advance(r, start, start + 5000);
    await waitFor(() => r.snapshot().posts.entries.at(-1)?.phase === 'acked');
    tabKey ??= r.snapshot().posts.entries.at(-1)!.visit.browserTabKey;
    expect(r.snapshot().posts.entries.at(-1)!.visit.browserTabKey).toBe(tabKey);
    await r.foreground(null, time(start + 5000));
    await r.compact(time(start + 10000));
  }
  expect(r.snapshot().nextSequence).toBe(206); expect(r.snapshot().compactedCount).toBe(205);
  expect(r.snapshot().candidates).toHaveLength(0);
});

it('actual IDB request success followed by transaction abort does not publish sequence', async () => {
  const { runtime: r, repo, t } = await setup(); await advance(r, 0, 4000);
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    const request = put.call(this, value, key);
    if (this.name === 'v2' && value.nextSequence === 2) request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  try {
    await expect(r.observe(observation(5000, { document: 'doc-1' }))).rejects.toThrow();
    expect((await repo.load()).nextSequence).toBe(1); expect(r.snapshot().nextSequence).toBe(1); expect(t.post).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});
it('ACK put then abort retains sending original and blocks all further HTTP', async () => {
  const { runtime: r, repo, t } = await setup();
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    const request = put.call(this, value, key);
    if (this.name === 'v2' && value.posts.entries[0]?.phase === 'acked') request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  try {
    await advance(r); await waitFor(() => r.snapshot().storageFailed);
    expect((await repo.load()).posts.entries[0].phase).toBe('sending');
    expect(r.snapshot().posts.entries[0].phase).toBe('sending'); expect(t.post).toHaveBeenCalledTimes(1); expect(t.patch).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});
it('starts a new versioned session after END without destroying the previous END receipt', async () => {
  const { runtime: r, t, repo } = await setup(); await advance(r); await r.stop(time(5500));
  await waitFor(() => r.snapshot().lifecycle === 'ENDED'); const oldKey = r.snapshot().start!.idempotencyKey;
  vi.mocked(t.start).mockResolvedValueOnce({ ...session, sessionId: '60000000-0000-4000-8000-000000000001' });
  await r.start(session.goalText);
  expect(r.snapshot().lifecycle).toBe('ACTIVE'); expect(r.snapshot().nextSequence).toBe(1);
  expect(r.snapshot().start!.idempotencyKey).not.toBe(oldKey); repo.close();
  const old = await new Promise<unknown>(resolve => {
    const open = indexedDB.open(DB_NAME); open.onsuccess = () => {
      const db = open.result, tx = db.transaction('v2'), get = tx.objectStore('v2').get(`session/${session.sessionId}`);
      tx.oncomplete = () => { db.close(); resolve(get.result); };
    };
  });
  expect((old as { lifecycle: string }).lifecycle).toBe('ENDED');
});
it('fails closed if a compacted receipt is missing instead of inventing an ACK', async () => {
  const { runtime: r, repo } = await setup(); await advance(r); await waitFor(() => r.snapshot().posts.entries[0]?.phase === 'acked');
  await r.foreground(null, time(5000)); await r.compact(time(10000)); repo.close();
  await new Promise<void>(resolve => {
    const open = indexedDB.open(DB_NAME); open.onsuccess = () => {
      const db = open.result, tx = db.transaction('v2-receipts', 'readwrite'); tx.objectStore('v2-receipts').clear();
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  });
  await expect(new V2Repository(API_BASE_URL).load()).rejects.toThrow('corrupt');
});
it('commits B before delayed inactive A, retaining A original identity after return-cache expiry', async () => {
  const { runtime: r } = await setup();
  for (let ms = 0; ms <= 5000; ms += 1000) await r.observe(observation(ms, { document: 'doc-1', snapshot: null }));
  const firstId = r.snapshot().candidates[0].id, firstTime = r.snapshot().candidates[0].visitedAt;
  await r.foreground(2, time(5000), true); await advance(r, 5000, 10000, 2);
  await waitFor(() => r.snapshot().posts.entries[0]?.phase === 'acked');
  expect(r.snapshot().posts.entries[0].visit.browserTabKey).not.toBe(r.snapshot().candidates[0].tabKey);
  await r.compact(time(10000));
  expect(r.snapshot().candidates.some(c => c.id === firstId && !c.post)).toBe(true);
  await r.observe(observation(10500, { document: 'doc-1' }));
  await waitFor(() => r.snapshot().posts.entries.length === 2 && r.snapshot().posts.entries[1].phase === 'acked');
  const a = r.snapshot().posts.entries[1].visit;
  expect(a.visitId).toBe(firstId); expect(a.visitedAt).toBe(firstTime); expect(a.sequence).toBe(2);
  expect(a.activeDurationMs).toBe(5000); expect(r.snapshot().candidates.find(c => c.id === firstId)?.closed).toBe(true);
});

it.each(['before-post', 'post-in-flight', 'patch-pending', 'end-pending'] as const)('persists priority retraction during %s and replays the same request after lost ACK', async stage => {
  const t = transport();
  t.retract = vi.fn(async () => { throw new Error('lost response'); });
  if (stage !== 'before-post') t.post = vi.fn(() => new Promise<never>(() => {}));
  const { runtime: r, repo } = await setup(t);
  await advance(r, 0, stage === 'before-post' ? 4000 : 5000);
  if (stage === 'patch-pending') await r.foreground(2, time(5500), true);
  if (stage === 'end-pending') await r.stop(time(5500));
  const original = structuredClone(r.snapshot().candidates);
  await r.quarantine('CONSENT_WITHDRAWN', time(6000).wall);
  await waitFor(() => r.snapshot().retractions?.[0]?.errorCode === 'DELIVERY_UNCONFIRMED');
  const frozen = r.snapshot().retractions![0].request;
  expect(frozen.visitId).toBe(original[0].id);
  expect(t.retract).toHaveBeenCalledWith(session.sessionId, frozen);
  expect(t.patch).not.toHaveBeenCalled(); expect(t.end).not.toHaveBeenCalled();
  const disk = await repo.load(); expect(disk.candidates.map(c => c.post)).toEqual(original.map(c => c.post));
  repo.close();
  const next = transport();
  next.retract = vi.fn(async (_s, request) => ({ retractionId: request.retractionId, visitId: request.visitId, status: 'QUARANTINED', invalidatedWindowIds: [] }));
  const restarted = new V2Runtime(new V2Repository(API_BASE_URL), next); await restarted.initialize(); await restarted.retry();
  await waitFor(() => restarted.snapshot().retractions?.[0]?.phase === 'acknowledged');
  expect(next.retract).toHaveBeenCalledWith(session.sessionId, frozen);
  expect(next.post).not.toHaveBeenCalled(); expect(next.patch).not.toHaveBeenCalled(); expect(next.end).not.toHaveBeenCalled();
  expect(restarted.collecting()).toBe(false); expect(restarted.snapshot().alertsSuppressed).toBe(true);
  expect(restarted.snapshot().quarantine?.status).toBe('RETRACTION_REQUIRED');
});
it('retracts compacted visits using receipts without recreating their originals', async () => {
  const { runtime: r, t } = await setup(); await advance(r); await waitFor(() => r.snapshot().posts.entries[0]?.phase === 'acked');
  const id = r.snapshot().posts.entries[0].visitId;
  await r.foreground(null, time(5000)); await waitFor(() => r.snapshot().behaviors.entries[0]?.phase === 'acked'); await r.compact(time(10000));
  expect(r.snapshot().candidates).toHaveLength(0);
  t.retract = vi.fn(async (_s, request) => ({ ...request, status: 'QUARANTINED', invalidatedWindowIds: [] }));
  await r.quarantine('CONSENT_WITHDRAWN', time(11000).wall);
  expect(r.snapshot().retractions!.map(e => e.request.visitId)).toEqual([id]);
  await waitFor(() => r.snapshot().retractions?.[0]?.errorCode === 'DELIVERY_UNCONFIRMED'); // Extra wire fields are rejected.
  expect(r.snapshot().candidates).toHaveLength(0);
});
it('rejects forged durable retraction identity and does not clear quarantine after a PURGED ACK', async () => {
  const t = transport(); t.retract = vi.fn(async (_s, request) => ({ retractionId: request.retractionId, visitId: request.visitId, status: 'PURGED', invalidatedWindowIds: [] }));
  const { runtime: r, repo } = await setup(t); await advance(r, 0, 4000); await r.quarantine('SENSITIVE_CONTENT', time(5000).wall);
  await waitFor(() => r.snapshot().retractions?.[0]?.phase === 'acknowledged');
  expect(r.collecting()).toBe(false);
  const disk = await repo.load(); disk.retractions![0].request.observedAt = '2026-11-10T02:00:00.000Z';
  await expect(repo.save(disk, disk.revision)).rejects.toThrow();
});
it('fails closed on the retraction sending commit abort before making HTTP', async () => {
  const { runtime: r, t } = await setup(); await advance(r, 0, 4000);
  t.retract = vi.fn(async () => ({}));
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    const request = put.call(this, value, key);
    if (this.name === 'v2' && value.retractions?.[0]?.phase === 'sending') request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  try {
    await r.quarantine('SENSITIVE_CONTENT', time(5000).wall); await waitFor(() => r.snapshot().storageFailed);
    expect(t.retract).not.toHaveBeenCalled(); expect(r.collecting()).toBe(false);
  } finally { spy.mockRestore(); }
});
it('does not carry compacted visit IDs across a new session into its retraction queue', async () => {
  const { runtime: r, repo, t } = await setup(); await advance(r); await waitFor(() => r.snapshot().posts.entries[0]?.phase === 'acked');
  const old = r.snapshot().posts.entries[0].visitId;
  await r.foreground(null, time(5000)); await waitFor(() => r.snapshot().behaviors.entries[0]?.phase === 'acked'); await r.compact(time(10000));
  await r.stop(time(11000)); await waitFor(() => r.snapshot().lifecycle === 'ENDED');
  vi.mocked(t.start).mockResolvedValueOnce({ ...session, sessionId: '60000000-0000-4000-8000-000000000001' });
  await r.start(session.goalText); await r.quarantine('SENSITIVE_CONTENT', time(12000).wall);
  expect(r.snapshot().retractions).toEqual([]); expect(r.snapshot().quarantine!.visitIds).not.toContain(old); repo.close();
});

it('archives a zero-visit quarantine after server close and starts a new session', async () => {
  const t = { ...transport(), closeQuarantine: async (sessionId: string) => ({ sessionId, privacyStatus: 'QUARANTINED', status: 'ENDED' }) };
  const { runtime, repo } = await setup(t);
  await runtime.quarantine('SENSITIVE_CONTENT', Date.now());
  await runtime.stop(time(1000));
  await waitFor(() => runtime.snapshot().lifecycle === 'ENDED');
  expect((await repo.load()).quarantine).toBeDefined();
  const next = { ...session, sessionId: crypto.randomUUID() };
  t.start = async () => next;
  await runtime.start(next.goalText);
  expect(runtime.collecting()).toBe(true);
  expect(runtime.snapshot().session?.sessionId).toBe(next.sessionId);
});

it('keeps the pending assignment across restart when two repetitions share the same goal', async () => {
  const t = transport();
  vi.mocked(t.start).mockRejectedValueOnce(new Error('lost start reply'));
  const first = new V2Runtime(new V2Repository(API_BASE_URL), t);
  await first.initialize();
  await expect(first.start(session.goalText, 'PLAN-001')).rejects.toThrow('lost start reply');
  const key = first.snapshot().start!.idempotencyKey;
  const second = new V2Runtime(new V2Repository(API_BASE_URL), t);
  await second.initialize();
  await expect(second.start(session.goalText, 'PLAN-004')).rejects.toThrow('V2_START_CONFLICT');
  await second.start(session.goalText, 'PLAN-001');
  expect(t.start).toHaveBeenCalledTimes(2);
  expect(t.start).toHaveBeenLastCalledWith(session.goalText, key);
});

it('keeps a late POST acknowledgement out of the next assignment after quarantine closure', async () => {
  const t = transport();
  let reply!: (value: never) => void;
  t.post = vi.fn(() => new Promise<never>(resolve => { reply = resolve; }));
  t.retract = async (_id, request) => ({status:'QUARANTINED', invalidatedWindowIds:[],
    retractionId:request.retractionId, visitId:request.visitId});
  t.closeQuarantine = async sessionId => ({sessionId, status:'ENDED', privacyStatus:'QUARANTINED'});
  const { runtime: r } = await setup(t);
  await advance(r);
  await waitFor(() => vi.mocked(t.post).mock.calls.length === 1);
  const original = r.snapshot().posts.entries[0].visit;
  await r.quarantine('SENSITIVE_CONTENT', time(5100).wall);
  await waitFor(() => r.snapshot().retractions?.[0].phase === 'acknowledged');
  await r.stop(time(5200));
  const nextId = crypto.randomUUID();
  t.start = async () => ({...session,sessionId:nextId});
  await r.start(session.goalText);
  reply({...original,updatedAt:null} as never);
  await r.idle();
  expect(r.snapshot().session?.sessionId).toBe(nextId);
  expect(r.snapshot().posts.entries).toEqual([]);
  expect(r.collecting()).toBe(true);
});

it('recovers a lost quarantine close reply from IndexedDB before allowing another assignment', async () => {
  const t = transport();
  t.closeQuarantine = vi.fn(async () => { throw new Error('lost close reply'); });
  const { repo, runtime } = await setup(t);
  await runtime.quarantine('SENSITIVE_CONTENT', time(0).wall);
  await expect(runtime.stop(time(1000))).rejects.toThrow('lost close reply');
  expect((await repo.load()).quarantineClose).toEqual({sessionId:session.sessionId,phase:'pending'});
  await expect(runtime.start(session.goalText)).rejects.toThrow('V2_START_BLOCKED');
  repo.close();
  t.closeQuarantine = vi.fn(async sessionId => ({sessionId,status:'ENDED',privacyStatus:'QUARANTINED'}));
  const restored = new V2Runtime(new V2Repository(API_BASE_URL), t);
  await restored.initialize();
  await waitFor(() => restored.snapshot().quarantineClose?.phase === 'acknowledged');
  expect(t.closeQuarantine).toHaveBeenCalledWith(session.sessionId);
  expect(restored.collecting()).toBe(false);
});
