import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { DB_NAME, DB_VERSION, STORE, DurableRepository, validateState, type DurableState } from '../src/background/durable-state';
import { Collector, emptyState } from '../src/background/collector';
import { VisitDelivery } from '../src/background/visit-delivery';
import { BehaviorDelivery } from '../src/background/behavior-delivery';
import { serialExecutor } from '../src/background/serial';
import { serverSession, SERVER_SESSION_ID } from './session-fixture';
import { describeUrl } from '../src/shared/url';

let repository: DurableRepository;
const repos: DurableRepository[] = [];
function repo() { const r = new DurableRepository(); repos.push(r); return r; }
async function read() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(DB_NAME); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try { return await new Promise<any>((resolve, reject) => { const t = db.transaction(STORE); const r = t.objectStore(STORE).get('current'); t.oncomplete = () => resolve(r.result); t.onabort = () => reject(t.error); }); }
  finally { db.close(); }
}
async function seed(value: unknown) {
  const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open(DB_NAME); r.onsuccess = () => resolve(r.result); });
  try { await new Promise<void>((resolve, reject) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(value, 'current'); t.oncomplete = () => resolve(); t.onabort = () => reject(t.error); }); }
  finally { db.close(); }
}
async function fixture(open = false): Promise<DurableState> {
  const c = new Collector();
  c.start({ ...serverSession(), sessionId: SERVER_SESSION_ID });
  c.foreground(1, 1000);
  c.navigate(1, 'document1', (await describeUrl('https://example.com/docs'))!.identity, 'new', 1000);
  c.observe(1, 'document1', SERVER_SESSION_ID, { ...(await describeUrl('https://example.com/docs'))!, title: '합성 문서', content: '공개 합성 문서 '.repeat(20) }, undefined, 2500);
  if (!open) c.stop(2500);
  const p = new VisitDelivery(async f => f(), () => false);
  p.collect(c.status(2500, false).readyVisits);
  const b = new BehaviorDelivery(async f => f(), () => false);
  b.collect(c.status(2500, false).readyVisits, p.checkpoint.entries);
  return { collection: c.state, visitDelivery: p.checkpoint, behaviorDelivery: b.checkpoint };
}
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); repository = repo(); });
afterEach(async () => { vi.restoreAllMocks(); for (const r of repos.splice(0)) await r.close(); vi.useRealTimers(); });

describe('IndexedDB aggregate transactions', () => {
  it('creates v1 and atomically stores, reads, updates and erases all queues', async () => {
    const state = await fixture(); await repository.initialize({}); await repository.save(state);
    expect((await read()).value).toEqual(state);
    expect((await repo().initialize({})).value).toEqual(state);
    await repository.save({ collection: emptyState() });
    const saved = await read(); expect(saved.value.collection.candidates).toEqual([]); expect(saved.value.visitDelivery).toBeUndefined(); expect(saved.sessionId).toBeNull();
    expect(saved.revision).toBe(3); expect(DB_VERSION).toBe(2);
  });
  it('resolves after transaction complete, never at put success', async () => {
    await repository.initialize({}); let committed = false;
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = put.apply(this, args); this.transaction.addEventListener('complete', () => { committed = true; }); return request;
    });
    await repository.save(await fixture()); expect(committed).toBe(true);
  });
  it.each(['abort', 'quota'])('preserves the prior aggregate on %s after a successful put', async fault => {
    await repository.initialize({}); const original = await read();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (fault === 'quota') throw new DOMException('synthetic quota exhaustion', 'QuotaExceededError');
      const r = put.apply(this, args); r.addEventListener('success', () => this.transaction.abort()); return r;
    });
    await expect(repository.save(await fixture())).rejects.toBeDefined(); expect(await read()).toEqual(original);
  });
  it('rejects stale Worker writes after deletion instead of resurrecting data', async () => {
    const state = await fixture(); await repository.initialize(state); const oldWorker = repo(); await oldWorker.initialize({});
    await repository.save({ collection: emptyState() });
    await expect(oldWorker.save(state)).rejects.toBeDefined(); expect((await read()).value.collection.candidates).toEqual([]);
  });
  it('rejects unsupported database versions without replacing the database', async () => {
    await repository.initialize({}); await repository.close();
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open(DB_NAME, DB_VERSION + 1); r.onsuccess = () => resolve(r.result); }); db.close();
    await expect(repo().initialize({})).rejects.toBeDefined(); expect((await read()).format).toBe(1);
  });
  it('initialization races cannot overwrite a winner', async () => {
    const results = await Promise.allSettled([repository.initialize(await fixture()), repo().initialize({})]);
    expect(results.some(r => r.status === 'fulfilled')).toBe(true); expect((await read()).revision).toBe(1);
  });
  it('fails closed when IndexedDB cannot be opened', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new DOMException('private', 'SecurityError'); } });
    await expect(repository.initialize({})).rejects.toBeDefined();
  });
});

describe('migration and corruption', () => {
  it('persists only a consistent permission wait marker without any sampled content', async () => {
    const c = new Collector(); c.start({ ...serverSession(), sessionId: SERVER_SESSION_ID });
    c.navigate(1, 'unpermitted-document', null, 'new', 1000); c.state.tabs[1].awaitingPermission = true;
    const state = { collection: c.state }; await repository.initialize(state);
    expect((await repo().initialize({})).value).toEqual(state);
    for (const change of [
      (s: any) => { s.collection.tabs[1].awaitingPermission = false; },
      (s: any) => { s.collection.tabs[1].awaitingPermission = 'true'; },
      (s: any) => { s.collection.tabs[1].awaitingPermission = null; },
      (s: any) => { s.collection.tabs[1].identity = 'a'.repeat(64); },
      (s: any) => { s.collection.candidates[0].reason = 'dom-policy'; },
      (s: any) => { s.collection.candidates[0].activeDurationMs = 1; },
    ]) {
      const corrupt = structuredClone(state); change(corrupt); expect(() => validateState(corrupt)).toThrow();
    }
  });
  it('persists an erased prefix without weakening candidate or POST sequence validation', async () => {
    const state = await fixture();
    state.collection.sequenceStart = 7; state.collection.nextSequence = 8;
    state.collection.candidates[0].sequence = 7;
    state.visitDelivery!.entries[0].sequence = 7; state.visitDelivery!.entries[0].visit.sequence = 7;
    state.behaviorDelivery!.entries[0].sequence = 7;
    await repository.initialize(state);
    expect((await repo().initialize({})).value).toEqual(state);
    for (const change of [
      (s: DurableState) => { delete s.collection.sequenceStart; },
      (s: DurableState) => { s.collection.nextSequence++; },
      (s: DurableState) => { s.collection.candidates[0].sequence = 8; },
      (s: DurableState) => { s.visitDelivery!.entries[0].sequence = 8; s.visitDelivery!.entries[0].visit.sequence = 8; },
    ]) {
      const corrupt = structuredClone(state); change(corrupt);
      expect(() => validateState(corrupt)).toThrow();
    }
  });
  it.each([0, -1, 1.5, null, '2', Number.MAX_SAFE_INTEGER + 1])('rejects invalid erased-prefix sequence %s', async base => {
    const state = await fixture(); Object.assign(state.collection, { sequenceStart: base });
    expect(() => validateState(state)).toThrow();
  });
  it('shares duplicate initialization calls within one Worker', async () => {
    const state = await fixture(); const first = repository.initialize(state), second = repository.initialize(state);
    expect(first).toBe(second); await first; expect((await read()).revision).toBe(1);
  });
  it('imports once and replays the receipt even after a later committed update', async () => {
    const legacy = await fixture(); await repository.initialize(legacy); const first = await read();
    const next = structuredClone(legacy); next.visitDelivery!.entries[0].attempts = 1;
    await repository.save(next);
    const again = await repo().initialize(legacy); expect(again.value).toEqual(next);
    expect((await read()).revision).toBe(first.revision + 1);
  });
  it('accepts identical data without a receipt but refuses ambiguous newer legacy data', async () => {
    const legacy = await fixture(); await repository.initialize({}); await repository.save(legacy);
    expect((await repo().initialize(legacy)).value).toEqual(legacy);
    legacy.visitDelivery!.entries[0].attempts++;
    await expect(repo().initialize(legacy)).rejects.toMatchObject({ code: 'conflict' });
    expect((await read()).value.visitDelivery.entries[0].attempts).toBe(0);
  });
  it('refuses different sessions without choosing a latest timestamp', async () => {
    const a = await fixture(); await repository.initialize(a); const b = await fixture();
    b.collection.candidates[0].sessionId = crypto.randomUUID();
    await expect(repo().initialize(b)).rejects.toMatchObject({ code: 'conflict' }); expect((await read()).value).toEqual(a);
  });
  it('retries an aborted import without a duplicate or completion marker', async () => {
    const legacy = await fixture(), put = IDBObjectStore.prototype.put;
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, ...args) {
      const r = put.apply(this, args); r.addEventListener('success', () => this.transaction.abort()); return r;
    });
    await expect(repository.initialize(legacy)).rejects.toBeDefined(); expect(await read()).toBeUndefined(); fault.mockRestore();
    await repo().initialize(legacy); expect((await read()).value.collection.candidates).toHaveLength(1);
  });
  it.each(['format', 'session', 'sequence', 'candidate', 'post', 'patch', 'baseline', 'api', 'missing-post', 'missing-patch', 'missing-patch-entry'])('preserves corrupt %s originals and blocks restore', async kind => {
    const state = await fixture(); await repository.initialize(state); const raw = await read();
    if (kind === 'format') raw.format = 9;
    if (kind === 'session') raw.sessionId = crypto.randomUUID();
    if (kind === 'sequence') raw.value.collection.nextSequence++;
    if (kind === 'candidate') raw.value.collection.candidates.push(raw.value.collection.candidates[0]);
    if (kind === 'post') raw.value.visitDelivery.entries[0].visit.content = 'corrupt';
    if (kind === 'patch') raw.value.behaviorDelivery.entries[0].sessionId = crypto.randomUUID();
    if (kind === 'baseline') raw.value.visitDelivery.entries[0].serverBehavior = { activeDurationMs: 0, tabSwitchCount: 0, behaviorVersion: 0 };
    if (kind === 'api') raw.value.visitDelivery.apiBaseUrl = 'https://other.example';
    if (kind === 'missing-post') delete raw.value.visitDelivery;
    if (kind === 'missing-patch') delete raw.value.behaviorDelivery;
    if (kind === 'missing-patch-entry') raw.value.behaviorDelivery.entries = [];
    await seed(raw); await expect(repo().initialize({})).rejects.toBeDefined(); expect(await read()).toEqual(raw);
  });
  it('does not persist malformed legacy input as empty success', async () => {
    await expect(repository.initialize({ collection: { candidates: null } as any })).rejects.toBeDefined(); expect(await read()).toBeUndefined();
  });
  it('restores open, excluded and sequence-blocked candidates without allocating new IDs', async () => {
    const state = await fixture(true); const c = new Collector(state.collection);
    c.navigate(2, 'excluded-doc', null, 'new', 3000);
    c.navigate(3, 'later-doc', (await describeUrl('https://example.com/later'))!.identity, 'new', 3000);
    c.foreground(3, 3000);
    c.observe(3, 'later-doc', SERVER_SESSION_ID, { ...(await describeUrl('https://example.com/later'))!, title: '문서', content: '공개 본문 '.repeat(20) }, undefined, 4500);
    c.removeTab(3, 4500); await repository.initialize(state);
    const restored = (await repo().initialize({})).value.collection;
    expect(restored).toEqual(state.collection); expect(restored.candidates.map(c => c.sequence)).toEqual([null, null, null]);
    expect(restored.candidates[1].state).toBe('excluded'); expect(restored.candidates[2].finalized).toBe(true);
  });
  it.each(['collection', 'visitDelivery', 'behaviorDelivery'] as const)('B-3 resumes committed migration after cleanup leaves only %s and the queue has advanced', async remaining => {
    const legacy = await fixture(); await repository.initialize(legacy);
    const next = structuredClone(legacy); next.visitDelivery!.entries[0].attempts = 2;
    await repository.save(next); const before = await read();
    const restored = await repo().initialize({ [remaining]: legacy[remaining] });
    expect(restored.value).toEqual(next); expect(await read()).toEqual(before);
  });
  it('B-3 recognizes an unchanged old aggregate-only migration receipt after partial cleanup', async () => {
    const legacy = await fixture(); await repository.initialize(legacy);
    const old = await read(); delete old.migrationParts; await seed(old);
    expect((await repo().initialize({ collection: legacy.collection })).value).toEqual(legacy);
  });

  it.each(['collection', 'post-api', 'post-ack', 'patch-ack'] as const)('B-4 preserves both sources on a changed %s migration remainder', async kind => {
    const legacy = await fixture(); await repository.initialize(legacy); const before = await read();
    const changed = structuredClone(legacy);
    if (kind === 'collection') changed.collection.candidates[0].visitId = crypto.randomUUID();
    if (kind === 'post-api') changed.visitDelivery!.apiBaseUrl = 'https://other.example';
    if (kind === 'post-ack') changed.visitDelivery!.entries[0].phase = 'acked';
    if (kind === 'patch-ack') changed.behaviorDelivery!.entries[0].ack = changed.behaviorDelivery!.entries[0].initial;
    const key = kind === 'collection' ? 'collection' : kind === 'patch-ack' ? 'behaviorDelivery' : 'visitDelivery';
    const source = structuredClone(changed[key]);
    await expect(repo().initialize({ [key]: source })).rejects.toBeDefined();
    expect(await read()).toEqual(before); expect(changed[key]).toEqual(source);
  });
  it('B-3 blocks an evolved old aggregate-only receipt with unverifiable partial remnants', async () => {
    const legacy = await fixture(); await repository.initialize(legacy);
    const old = await read(); delete old.migrationParts; old.value.visitDelivery.entries[0].attempts++;
    await seed(old); await expect(repo().initialize({ collection: legacy.collection })).rejects.toMatchObject({ code: 'conflict' });
    expect(await read()).toEqual(old);
  });
  it('B validates a full legacy body even if a matching hash receipt was forged', async () => {
    const legacy = await fixture(); await repository.initialize(legacy);
    const corrupt = structuredClone(legacy); corrupt.visitDelivery!.entries[0].visit.content = 'invalid body';
    const raw = await read();
    const canonical = (value: unknown) => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
    raw.migrationParts.visitDelivery = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(corrupt.visitDelivery))))).map(v => v.toString(16).padStart(2, '0')).join('');
    await seed(raw); await expect(repo().initialize(corrupt)).rejects.toBeDefined(); expect(await read()).toEqual(raw);
  });
  it('B-3 blocks incomplete unmigrated checkpoints without committing an empty queue', async () => {
    const legacy = await fixture(); delete legacy.visitDelivery;
    await expect(repository.initialize(legacy)).rejects.toBeDefined(); expect(await read()).toBeUndefined();
  });
  it('B-5 repeats migrated initialization without changing snapshots, ACKs, attempts or revision', async () => {
    const legacy = await fixture(); await repository.initialize(legacy); const before = await read();
    for (let i = 0; i < 3; i++) expect((await repo().initialize(legacy)).value).toEqual(legacy);
    expect(await read()).toEqual(before);
  });

  it.each(['localMirror', 'migrationParts', 'migrated'] as const)('preserves an invalid optional %s recovery receipt', async field => {
    await repository.initialize(await fixture()); const raw = await read();
    if (field === 'localMirror') raw.value.localMirror = { previous: { sessionId: 'broken' } };
    if (field === 'migrationParts') raw.migrationParts = [];
    if (field === 'migrated') raw.migrated = 'not-a-sha256';
    await seed(raw); await expect(repo().initialize({})).rejects.toMatchObject({ code: 'corrupt' });
    expect(await read()).toEqual(raw);
  });

});

describe('durable delivery boundaries', () => {
  it('commits sending before HTTP and replays an ACK lost at commit with the same snapshot and budget', async () => {
    const state = await fixture(); await repository.initialize(state); const enqueue = serialExecutor();
    const send = vi.fn(async (visit: any) => {
      const saved = (await read()).value.visitDelivery.entries[0];
      expect(saved.phase).toBe('sending'); expect(saved.attempts).toBe(1); expect(saved.visit).toEqual(visit);
      return { ...visit, updatedAt: null };
    });
    let failAck = true;
    const p = new VisitDelivery(f => enqueue(async () => {
      const result = f(); state.visitDelivery = p.checkpoint;
      if (failAck && p.checkpoint.entries[0].phase === 'acked') { failAck = false; throw Error('commit failure'); }
      await repository.save(state); return result;
    }), () => true, send);
    p.restore(state.visitDelivery, SERVER_SESSION_ID); p.kick();
    await vi.waitFor(() => expect(p.blocked).toBeTruthy());
    const saved = (await repo().initialize({})).value;
    expect(saved.visitDelivery!.entries[0]).toMatchObject({ phase: 'sending', attempts: 1 });
    expect(saved.behaviorDelivery!.entries[0].ack).toBeUndefined();
    const replay = new VisitDelivery(async f => { const r = f(); saved.visitDelivery = replay.checkpoint; await repository.save(saved); return r; }, () => true,
      async visit => ({ ...visit, updatedAt: null }));
    // Use the original writer revision; a separate read must never reset the retry budget.
    replay.restore(saved.visitDelivery, SERVER_SESSION_ID); replay.kick();
    await vi.waitFor(() => expect(replay.checkpoint.entries[0].phase).toBe('acked'));
    expect(replay.checkpoint.entries[0].attempts).toBe(2);
    expect(replay.checkpoint.entries[0].visit).toEqual(state.visitDelivery!.entries[0].visit);
  });
  it.each(['sending', 'retry-wait', 'failed'] as const)('preserves %s attempts=3 and requires an explicit budget reset', async phase => {
    const state = await fixture(); Object.assign(state.visitDelivery!.entries[0], { phase, attempts: 3, nextRetryAt: 1, retryable: true });
    await repository.initialize(state); const saved = (await repo().initialize({})).value;
    const send = vi.fn(async visit => ({ ...visit, updatedAt: null }));
    const p = new VisitDelivery(async f => { const result = f(); saved.visitDelivery = p.checkpoint; await repository.save(saved); return result; }, () => true, send);
    p.restore(saved.visitDelivery, SERVER_SESSION_ID); p.kick();
    await vi.waitFor(() => expect(p.checkpoint.entries[0].phase).toBe('failed'));
    expect(send).not.toHaveBeenCalled(); expect(p.checkpoint.entries[0].attempts).toBe(3);
    p.retry(); p.kick(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(p.checkpoint.entries[0].attempts).toBe(1);
  });
  it('validates the whole aggregate rather than accepting a PATCH ACK without POST ACK', async () => {
    const state = await fixture(); const b = state.behaviorDelivery!.entries[0]; b.ack = b.initial; b.phase = 'acked';
    expect(() => validateState(state)).toThrow(); await expect(repository.initialize(state)).rejects.toBeDefined();
  });
});
