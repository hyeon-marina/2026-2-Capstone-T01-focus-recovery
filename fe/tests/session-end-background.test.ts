import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describeUrl } from '../src/shared/url';
import { serverSession, SERVER_SESSION_ID } from './session-fixture';
import type { Reply } from '../src/shared/types';
const event = () => ({ listeners: [] as ((...args: any[]) => void)[], addListener(fn: (...args: any[]) => void) { this.listeners.push(fn); } });
let chromeApi: any, local: Record<string, any>, legacy: Record<string, any>;
let frame: { documentId: string; url: string };
const sender = { id: 'test', url: 'chrome-extension://test/popup.html' };
function area(data: Record<string, any>) {
  return { setAccessLevel: vi.fn(async () => undefined), get: vi.fn(async (key: string) => ({ [key]: structuredClone(data[key]) })),
    set: vi.fn(async (values: any) => { Object.assign(data, structuredClone(values)); }), remove: vi.fn(async (keys: string | string[]) => { for (const key of [keys].flat()) delete data[key]; }) };
}
async function message(value: unknown, content = false): Promise<Reply> {
  return new Promise(resolve => { if (!chromeApi.runtime.onMessage.listeners[0](value, content ? { ...sender, url: frame.url, tab: { id: 1 }, frameId: 0, documentId: frame.documentId, documentLifecycle: 'active' } : sender, resolve)) resolve({ ok: false }); });
}
async function restart() {
  vi.resetModules();
  for (const group of Object.values(chromeApi) as any[]) for (const value of Object.values(group) as any[]) if (value?.listeners) value.listeners.length = 0;
  await import('../src/background/index');
}
async function raw() {
  const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('focus-recovery'); r.onsuccess = () => resolve(r.result); });
  try { return await new Promise<any>(resolve => { const tx = db.transaction('state'), r = tx.objectStore('state').get('current'); tx.oncomplete = () => resolve(r.result); }); } finally { db.close(); }
}
async function visit(duration = 1500) {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
  expect((await message({ type: 'start', goalText: '공개 합성 문서 조사하기' })).ok).toBe(true);
  await message({ type: 'context' }, true); clock.mockReturnValue(10000 + duration);
  await message({ type: 'snapshot', sessionId: SERVER_SESSION_ID, snapshot: { ...(await describeUrl(frame.url))!, title: '공개 문서', content: '공개 합성 본문 '.repeat(20) } }, true);
  return clock;
}
beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); local = {}; legacy = {};
  frame = { documentId: 'original-document', url: 'https://example.com/docs' };
  chromeApi = {
    runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test/${path}`, onMessage: event(), onStartup: event(), onInstalled: event() },
    storage: { local: area(local), session: area(legacy) }, alarms: { create: vi.fn(async () => undefined), onAlarm: event() },
    windows: { getAll: vi.fn(async () => [{ id: 1, focused: true }]), onFocusChanged: event(), onBoundsChanged: event() },
    tabs: { query: vi.fn(async () => [{ id: 1 }]), sendMessage: vi.fn(async () => undefined), onActivated: event(), onRemoved: event() },
    permissions: { contains: vi.fn(async () => true), getAll: vi.fn(async () => ({ origins: ['https://example.com/*'] })), onAdded: event(), onRemoved: event() },
    scripting: { getRegisteredContentScripts: vi.fn(async () => []), registerContentScripts: vi.fn(async () => undefined), unregisterContentScripts: vi.fn(async () => undefined), executeScript: vi.fn(async () => undefined) },
    webNavigation: { getFrame: vi.fn(async () => frame), onCommitted: event(), onHistoryStateUpdated: event(), onErrorOccurred: event() },
  };
  vi.stubGlobal('chrome', chromeApi);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/api/sessions')) return new Response(JSON.stringify({ ...serverSession(JSON.parse(init.body as string).goalText), sessionId: SERVER_SESSION_ID }), { status: 201 });
    if (url.endsWith('/end') || init.method === 'GET') return new Response(JSON.stringify({ ...serverSession('공개 합성 문서 조사하기'), sessionId: SERVER_SESSION_ID, status: 'ENDED', endedAt: '2026-10-19T00:00:00.000Z' }));
    return new Response(JSON.stringify({ ...JSON.parse(init.body as string), sessionId: SERVER_SESSION_ID, updatedAt: null }), { status: 201 });
  }));
  await import('../src/background/index');
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const endCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/end'));
const ended = () => ({ ...serverSession('공개 합성 문서 조사하기'), sessionId: SERVER_SESSION_ID, status: 'ENDED', endedAt: '2026-10-19T00:00:00.000Z' });
async function completed() { await vi.waitFor(async () => expect((await raw()).value.sessionEnd?.phase).toBe('acked')); }
function faultWhen(predicate: (value: any) => boolean) {
  const put = IDBObjectStore.prototype.put;
  return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    const r = put.apply(this, args); if (predicate((args[0] as any).value)) r.addEventListener('success', () => this.transaction.abort()); return r;
  });
}
describe('durable server end lifecycle', () => {
  it('commits final collector + intent + POST/PATCH before HTTP and keeps the start receipt', async () => {
    await visit(); const original = structuredClone(local.activeSession);
    const send = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const state = (await raw()).value;
      expect(state.collection.session).toBeNull(); expect(state.sessionEnd).toBeDefined();
      if (String(url).endsWith('/end')) {
        expect(state.visitDelivery.entries.every((e: any) => e.phase === 'acked')).toBe(true);
        expect(state.behaviorDelivery.entries.every((e: any) => e.phase === 'acked')).toBe(true);
        expect(state.sessionEnd).toMatchObject({ phase: 'sending', attempts: 1, request: {} });
      }
      return send(url, init);
    });
    expect((await message({ type: 'end-session' })).ok).toBe(true); await completed();
    const state = (await raw()).value;
    expect(state.sessionEnd.ack).toEqual(ended()); expect(endCalls()).toHaveLength(1);
    expect(state.activeSession.startRequest).toEqual(original.startRequest);
    expect((await message({ type: 'status' })).status!.sessionEnd!.state).toBe('ENDED');
    await restart(); await message({ type: 'status' }); expect(endCalls()).toHaveLength(1);
  });
  it('waits for both POST and a later final PATCH ACK; HTTP does not lock popup or tab events', async () => {
    await visit(); let post!: () => void, patch!: () => void;
    const postGate = new Promise<void>(r => { post = r; }), patchGate = new Promise<void>(r => { patch = r; });
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/end')) return new Response(JSON.stringify(ended()));
      const body = JSON.parse(init!.body as string);
      if (init!.method === 'PATCH') { await patchGate; return new Response(JSON.stringify({ ...body, visitId: (await raw()).value.visitDelivery.entries[0].visitId, applied: true, updatedAt: '2026-10-19T00:00:00.000Z' })); }
      await postGate; return new Response(JSON.stringify({ ...body, sessionId: SERVER_SESSION_ID, updatedAt: null }), { status: 201 });
    });
    chromeApi.tabs.onRemoved.listeners[0](1); await message({ type: 'status' });
    await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0].phase).toBe('sending'));
    chromeApi.tabs.onActivated.listeners[0]({ tabId: 2, windowId: 1 }); await message({ type: 'status' });
    await message({ type: 'end-session' }); expect(endCalls()).toHaveLength(0);
    expect((await message({ type: 'start', goalText: '다른 목표 작업하기' })).ok).toBe(false);
    post(); await vi.waitFor(async () => expect((await raw()).value.behaviorDelivery.entries[0].phase).toBe('sending'));
    await message({ type: 'status' }); expect(endCalls()).toHaveLength(0);
    patch(); await completed(); expect(endCalls()).toHaveLength(1);
  });
  it('does not promote an old v1 local stop to server-end intent', async () => {
    await visit(); await message({ type: 'stop' });
    await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0].phase).toBe('acked'));
    await restart(); await message({ type: 'status' }); expect((await raw()).value.sessionEnd).toBeUndefined(); expect(endCalls()).toHaveLength(0);
    expect((await message({ type: 'end-session' })).ok).toBe(false);
  });
  it.each(['intent', 'sending', 'ack'])('preserves the last committed aggregate on %s transaction failure', async phase => {
    await visit(); const fault = faultWhen(v => phase === 'intent' ? v.sessionEnd?.phase === 'draining'
      : phase === 'sending' ? v.sessionEnd?.phase === 'sending' : v.sessionEnd?.phase === 'acked');
    await message({ type: 'end-session' });
    await vi.waitFor(async () => expect((await message({ type: 'status' })).status!.storage!.phase).toBe('failed'));
    const state = (await raw()).value;
    expect(state.sessionEnd?.phase).not.toBe('acked'); expect(endCalls()).toHaveLength(phase === 'ack' ? 1 : 0);
    if (phase !== 'intent') {
      const snapshot = structuredClone(state.sessionEnd); fault.mockRestore(); await restart(); await completed();
      expect((await raw()).value.sessionEnd.request).toEqual(snapshot.request ?? {});
      expect((await raw()).value.sessionEnd.ack.endedAt).toBe(ended().endedAt);
    }
  });
  it('keeps END_PENDING through local mirror failure, restart and stale ACTIVE metadata', async () => {
    await visit(); const fault = chromeApi.storage.local.set.mockRejectedValue(Error('PRIVATE_MIRROR'));
    await message({ type: 'end-session' }); await completed();
    expect((await raw()).value.sessionEnd.phase).toBe('acked');
    fault.mockImplementation(async (values: any) => { Object.assign(local, structuredClone(values)); });
    await restart(); const reply = await message({ type: 'status' }); expect(reply.status!.storage!.phase).toBe('ready');
    expect(reply.status!.session).toBeNull(); expect(reply.status!.sessionEnd!.state).toBe('ENDED'); expect(endCalls()).toHaveLength(1);
  });
  it('recovers a server commit with lost response by replaying exactly {} and retaining endedAt', async () => {
    const clock = await visit(); let lost = true;
    const send = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/end') && lost) { lost = false; throw Error('PRIVATE_CONNECTION_LOST'); }
      return send(url, init);
    });
    await message({ type: 'end-session' }); await vi.waitFor(async () => expect((await raw()).value.sessionEnd.phase).toBe('retry-wait'));
    const before = (await raw()).value.sessionEnd; await restart(); await message({ type: 'status' }); expect(endCalls()).toHaveLength(1);
    clock.mockReturnValue(before.nextRetryAt + 1); chromeApi.alarms.onAlarm.listeners[0]({ name: 'durable-delivery' }); await completed();
    expect(endCalls().map(([, init]) => init!.body)).toEqual(['{}', '{}']);
    expect((await raw()).value.sessionEnd).toMatchObject({ attempts: 2, ack: { endedAt: ended().endedAt } });
  });
  it('persists the 3-attempt budget over repeated restarts and renews it only on manual retry', async () => {
    const clock = await visit();
    const send = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => String(url).endsWith('/end') ? new Response('{}', { status: 503 }) : send(url, init));
    await message({ type: 'end-session' });
    for (let n = 1; n <= 3; n++) {
      await vi.waitFor(async () => expect((await raw()).value.sessionEnd).toMatchObject({ attempts: n, phase: n === 3 ? 'failed' : 'retry-wait' }));
      const saved = (await raw()).value.sessionEnd; await restart(); await message({ type: 'status' }); expect(endCalls()).toHaveLength(n);
      if (n < 3) { clock.mockReturnValue(saved.nextRetryAt + 1); chromeApi.alarms.onAlarm.listeners[0]({ name: 'durable-delivery' }); }
    }
    await restart(); await message({ type: 'status' }); expect(endCalls()).toHaveLength(3);
    vi.mocked(fetch).mockImplementation(send); await message({ type: 'retry-end' }); await completed();
    expect((await raw()).value.sessionEnd.attempts).toBe(1); expect(endCalls()).toHaveLength(4);
  });
  it.each(['POST', 'PATCH'])('preserves server ENDED with unconfirmed %s as a conflict, never calls END', async method => {
    await visit();
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method === 'GET') return new Response(JSON.stringify(ended()));
      if (method === 'POST' || init?.method === 'PATCH') return new Response(JSON.stringify({ code: 'SESSION_ENDED', message: 'PRIVATE' }), { status: 409 });
      const body = JSON.parse(init!.body as string); return new Response(JSON.stringify({ ...body, sessionId: SERVER_SESSION_ID, updatedAt: null }), { status: 201 });
    });
    if (method === 'PATCH') {
      chromeApi.tabs.onRemoved.listeners[0](1); await message({ type: 'status' });
      await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0].phase).toBe('acked'));
      chromeApi.tabs.onActivated.listeners[0]({ tabId: 2, windowId: 1 }); await message({ type: 'status' });
    }
    await message({ type: 'end-session' });
    await vi.waitFor(async () => expect((await raw()).value.sessionEnd).toMatchObject({ phase: 'failed', code: 'SERVER_ENDED_UNCONFIRMED', lastServer: { status: 'ENDED' } }));
    expect(endCalls()).toHaveLength(0); const state = (await raw()).value;
    expect(state.collection.candidates).toHaveLength(1); expect(state.sessionEnd.ack).toBeUndefined();
    await restart(); await message({ type: 'status' }); expect((await raw()).value.collection.candidates).toHaveLength(1);
  });
  it.each(['clear', 'revoke', 'events'])('handles %s while END is in flight without resurrecting data or collecting', async action => {
    await visit(); let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const send = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => { if (String(url).endsWith('/end')) await gate; return send(url, init); });
    await message({ type: 'end-session' }); await vi.waitFor(() => expect(endCalls()).toHaveLength(1));
    const before = (await raw()).value.collection;
    expect((await message({ type: 'end-session' })).ok).toBe(true);
    if (action === 'clear') await message({ type: 'clear' });
    if (action === 'revoke') { chromeApi.permissions.onRemoved.listeners[0](); await message({ type: 'status' }); }
    chromeApi.tabs.onActivated.listeners[0]({ tabId: 2, windowId: 1 });
    chromeApi.tabs.onRemoved.listeners[0](1); await message({ type: 'context' }, true); await message({ type: 'status' });
    release();
    if (action === 'clear') { await new Promise(r => setTimeout(r, 20)); expect((await raw()).value.sessionEnd).toBeUndefined(); expect((await raw()).value.collection.candidates).toEqual([]); }
    else { await completed(); expect((await raw()).value.collection).toEqual(before); }
    expect(endCalls()).toHaveLength(1);
  });
  it('blocks repeated clicks before the intent commit and does not charge shutdown time', async () => {
    const clock = await visit(); const first = message({ type: 'end-session' }), second = await message({ type: 'end-session' });
    expect(second.ok).toBe(false); await first; await completed(); clock.mockReturnValue(9999999); await restart();
    await message({ type: 'status' }); expect((await raw()).value.collection.candidates[0].activeDurationMs).toBe(1500);
    expect(endCalls()).toHaveLength(1);
  });
  it.each(['pending', 'excluded', 'valid'])('uses the existing explicit stop policy for a detached %s candidate', async kind => {
    await visit(kind === 'valid' ? 1500 : 0);
    if (kind === 'excluded') await message({ type: 'snapshot', sessionId: SERVER_SESSION_ID, snapshot: null, reason: 'unavailable-content' }, true);
    frame.documentId = 'replacement'; await restart(); await message({ type: 'status' });
    await message({ type: 'end-session' });
    if (kind === 'valid') await completed();
    else { expect((await raw()).value.sessionEnd.phase).toBe('draining'); expect(endCalls()).toHaveLength(0); expect((await raw()).value.collection.candidates[0].recoveryRequired).toBe(true); }
  });
  it.each([404, 409, 400])('keeps HTTP %s for manual investigation and refuses automatic retry', async status => {
    await visit(); const send = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => String(url).endsWith('/end') ? new Response('{"message":"PRIVATE"}', { status }) : send(url, init));
    await message({ type: 'end-session' }); await vi.waitFor(async () => expect((await raw()).value.sessionEnd.phase).toBe('failed'));
    await message({ type: 'retry-end' }); await restart(); await message({ type: 'status' }); expect(endCalls()).toHaveLength(1);
    expect((await raw()).value.sessionEnd.retryable).toBe(false);
  });
  it('starts an independent session after durable END ACK without reusing historical candidates', async () => {
    await visit(); await message({ type: 'end-session' }); await completed();
    const nextId = crypto.randomUUID(); vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...serverSession('새 작업의 별도 세션 시작'), sessionId: nextId }), { status: 201 }));
    expect((await message({ type: 'start', goalText: '새 작업의 별도 세션 시작' })).ok).toBe(true);
    const state = (await raw()).value; expect(state.sessionEnd).toBeUndefined(); expect(state.collection.session.sessionId).toBe(nextId); expect(state.collection.candidates).toHaveLength(0);
    await restart(); expect((await message({ type: 'status' })).status!.session!.sessionId).toBe(nextId);
  });
  it('recovers a new pending start after prior END ACK without confusing the two creation receipts', async () => {
    await visit(); await message({ type: 'end-session' }); await completed();
    vi.mocked(fetch).mockRejectedValue(Error('PRIVATE_CONNECTION'));
    expect((await message({ type: 'start', goalText: '새 작업의 별도 세션 시작' })).ok).toBe(false);
    const key = local.pendingSessionStart.idempotencyKey; await restart();
    expect((await message({ type: 'status' })).status!.sessionStartRecovery!.kind).toBe('pending');
    const nextId = crypto.randomUUID(); vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...serverSession('새 작업의 별도 세션 시작'), sessionId: nextId }), { status: 201 }));
    expect((await message({ type: 'start', goalText: '새 작업의 별도 세션 시작' })).ok).toBe(true);
    expect(local.activeSession.startRequest.idempotencyKey).toBe(key); expect(local.activeSession.sessionId).toBe(nextId);
  });

  it('stops a content capture that was awaiting Chrome state when the user selected END', async () => {
    await visit(); const before = (await raw()).value.collection.candidates.length;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
    chromeApi.webNavigation.getFrame.mockImplementationOnce(async () => { entered(); await gate; return { ...frame, documentId: 'next-document' }; });
    const content = message({ type: 'context' }, true); await started;
    const ending = message({ type: 'end-session' }); release();
    expect((await content).sessionId).toBeNull(); await ending; await completed();
    expect((await raw()).value.collection.candidates).toHaveLength(before);
  });

  it('never resumes a historical ACTIVE creation receipt after its durable END ACK', async () => {
    await visit(); await message({ type: 'end-session' }); await completed();
    const receipt = structuredClone(local.activeSession.startRequest);
    local.pendingSessionStart = receipt; await restart();
    const state = (await message({ type: 'status' })).status!;
    expect(state.session).toBeNull(); expect(state.sessionStartRecovery!.kind).toBe('invalid');
    expect((await message({ type: 'start', goalText: receipt.goalText })).ok).toBe(false);
    expect(local.pendingSessionStart).toEqual(receipt); expect((await raw()).value.sessionEnd.phase).toBe('acked');
  });

  it('holds END and later valid sequences behind an unresolved detached prefix', async () => {
    const clock = await visit(0); const firstId = (await raw()).value.collection.candidates[0].visitId;
    frame.documentId = 'replacement'; await restart(); await message({ type: 'status' });
    await message({ type: 'context' }, true); clock.mockReturnValue(12000);
    await message({ type: 'snapshot', sessionId: SERVER_SESSION_ID, snapshot: { ...(await describeUrl(frame.url))!, title: '다음 합성 문서', content: '개인정보 없는 공개 본문 '.repeat(20) } }, true);
    await message({ type: 'end-session' });
    const state = (await raw()).value;
    expect(state.collection.candidates[0]).toMatchObject({ visitId: firstId, recoveryRequired: true, finalized: false });
    expect(state.collection.candidates[1]).toMatchObject({ state: 'valid', finalized: true, sequence: null });
    expect(state.visitDelivery.entries).toHaveLength(0); expect(state.sessionEnd.phase).toBe('draining'); expect(endCalls()).toHaveLength(0);
  });
  it.each(['pending', 'excluded'])('finishes an attached %s last candidate by the existing exclusion policy without a visit POST', async kind => {
    await visit(0);
    if (kind === 'excluded') await message({ type: 'snapshot', sessionId: SERVER_SESSION_ID, snapshot: null, reason: 'dom-policy' }, true);
    await message({ type: 'end-session' }); await completed();
    expect((await raw()).value.collection.candidates[0]).toMatchObject({ state: 'excluded', finalized: true, sequence: null });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/visits'))).toHaveLength(0); expect(endCalls()).toHaveLength(1);
  });

});

describe('review A: END ACK commit boundaries in the same Worker', () => {
  it.each(['abort', 'quota', 'revision'])('never exposes or reuses an uncommitted END ACK after %s', async kind => {
    await visit(); const receipt = structuredClone(local.activeSession.startRequest);
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const send = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => { if (String(url).endsWith('/end')) await gate; return send(url, init); });
    await message({ type: 'end-session' }); await vi.waitFor(() => expect(endCalls()).toHaveLength(1));
    const original = await raw();
    expect(original.value.visitDelivery.entries.every((e: any) => e.phase === 'acked')).toBe(true);
    expect(original.value.behaviorDelivery.entries.every((e: any) => e.phase === 'acked')).toBe(true);
    let fault: { mockRestore(): void } | undefined;
    if (kind === 'abort') fault = faultWhen(v => v.sessionEnd?.phase === 'acked');
    if (kind === 'quota') {
      const put = IDBObjectStore.prototype.put;
      fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
        if ((args[0] as any).value.sessionEnd?.phase === 'acked') throw new DOMException('PRIVATE_QUOTA', 'QuotaExceededError');
        return put.apply(this, args);
      });
    }
    if (kind === 'revision') {
      const { DurableRepository } = await import('../src/background/durable-state');
      const competing = new DurableRepository(); await competing.initialize({}); await competing.save(original.value); await competing.close();
    }
    const beforeResponse = await raw(), httpCount = vi.mocked(fetch).mock.calls.length; release();
    await vi.waitFor(async () => expect((await message({ type: 'status' })).status!.storage!.phase).toBe('failed'));
    const afterFailure = await raw();
    expect(afterFailure.value).toEqual(beforeResponse.value);
    expect(afterFailure.revision).toBeGreaterThanOrEqual(beforeResponse.revision);
    for (let n = 0; n < 3; n++) {
      const reply = await message({ type: 'status' });
      expect(reply.status!.sessionEnd).toMatchObject({ state: 'END_PENDING', sessionId: SERVER_SESSION_ID, attempts: 1 });
      expect(reply.status!.sessionEnd!.ack).toBeUndefined(); expect(reply.status!.sessionEnd!.lastServer).toBeUndefined();
      expect(reply.status!.session).toBeNull();
      expect((await message({ type: 'retry-end' })).ok).toBe(false);
      expect((await message({ type: 'start', goalText: '새 세션을 만들면 안 됩니다' })).ok).toBe(false);
      chromeApi.alarms.onAlarm.listeners[0]({ name: 'durable-delivery' });
      await message({ type: 'context' }, true);
    }
    expect(endCalls()).toHaveLength(1); expect(fetch).toHaveBeenCalledTimes(httpCount); expect((await raw())).toEqual(afterFailure);
    expect(local.activeSession.startRequest).toEqual(receipt);
    fault?.mockRestore(); await restart(); await completed();
    const restored = (await raw()).value;
    expect(endCalls().map(([url, init]) => [String(url), init!.body])).toEqual([
      [`http://localhost:8080/api/sessions/${SERVER_SESSION_ID}/end`, '{}'],
      [`http://localhost:8080/api/sessions/${SERVER_SESSION_ID}/end`, '{}'],
    ]);
    expect(restored.sessionEnd).toMatchObject({ phase: 'acked', attempts: 2, ack: { endedAt: ended().endedAt } });
    expect(restored.collection.candidates).toEqual(original.value.collection.candidates);
    expect(restored.visitDelivery).toEqual(original.value.visitDelivery); expect(restored.behaviorDelivery).toEqual(original.value.behaviorDelivery);
    expect(restored.activeSession.startRequest).toEqual(receipt);
  });
  it('never resurrects END after another Worker commits deletion while its response is in flight', async () => {
    await visit(); let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const send = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => { if (String(url).endsWith('/end')) await gate; return send(url, init); });
    await message({ type: 'end-session' }); await vi.waitFor(() => expect(endCalls()).toHaveLength(1));
    const { DurableRepository } = await import('../src/background/durable-state');
    const { emptyState } = await import('../src/background/collector');
    const other = new DurableRepository(); await other.initialize({});
    await other.save({ collection: emptyState(), localMirror: { previous: structuredClone(local.activeSession) } }); await other.close();
    const deleted = await raw(); release();
    await vi.waitFor(async () => expect((await message({ type: 'status' })).status!.storage!.phase).toBe('failed'));
    expect((await raw())).toEqual(deleted); await restart();
    const status = (await message({ type: 'status' })).status!;
    expect(status.storage!.phase).toBe('ready'); expect(status.sessionEnd).toBeUndefined(); expect(status.candidates).toEqual([]);
    expect(local.activeSession).toBeUndefined(); expect(endCalls()).toHaveLength(1);
  });
});

describe('review B: historical END and a new creation receipt', () => {
  it('keeps a committed END ACK when only its local mirror set fails', async () => {
    await visit(); const receipt = structuredClone(local.activeSession);
    chromeApi.storage.local.remove.mockClear();
    const set = chromeApi.storage.local.set.getMockImplementation()!;
    chromeApi.storage.local.set.mockImplementation(async (value: any) => {
      if ((await raw()).value.sessionEnd?.phase === 'acked') throw Error('PRIVATE_MIRROR_FAILURE');
      return set(value);
    });
    await message({ type: 'end-session' }); await completed();
    const status = (await message({ type: 'status' })).status!;
    expect(status.sessionEnd!.state).toBe('ENDED'); expect(status.storage).toMatchObject({ phase: 'ready', metadataSyncPending: true });
    expect(local.activeSession).toEqual(receipt); expect((await raw()).value.activeSession).toEqual(receipt);
    expect(chromeApi.storage.local.remove.mock.calls.flat()).not.toContain('activeSession');
    chromeApi.storage.local.set.mockImplementation(set); await restart();
    expect((await message({ type: 'status' })).status!.sessionEnd!.state).toBe('ENDED'); expect(endCalls()).toHaveLength(1);
  });
  it.each(['pending', 'response', 'active-abort', 'active-mirror'])('recovers the same new key/session across the %s boundary', async boundary => {
    await visit(); await message({ type: 'end-session' }); await completed();
    const historical = await raw(), nextId = crypto.randomUUID(), goalText = '새로운 별도 세션의 영수증 검증';
    const nextResponse = { ...serverSession(goalText), sessionId: nextId };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(nextResponse), { status: 201 }));
    const set = chromeApi.storage.local.set.getMockImplementation()!;
    chromeApi.storage.local.set.mockImplementation(async (value: any) => {
      await set(value);
      if (boundary === 'pending' && value.pendingSessionStart && !value.pendingSessionStart.response
        || boundary === 'response' && value.pendingSessionStart?.response) throw Error('synthetic interruption after durable receipt');
      if (boundary === 'active-mirror' && value.activeSession?.sessionId === nextId) {
        // Simulate a failed local write, not a committed write with a lost callback.
        local.activeSession = structuredClone(historical.value.activeSession); throw Error('synthetic new active mirror failure');
      }
    });
    const fault = boundary === 'active-abort' ? faultWhen(v => v.collection.session?.sessionId === nextId) : undefined;
    expect((await message({ type: 'start', goalText })).ok).toBe(false);
    const pending = structuredClone(local.pendingSessionStart); expect(pending.idempotencyKey).not.toBe(historical.value.activeSession.startRequest.idempotencyKey);
    if (boundary !== 'active-mirror') expect((await raw()).value).toEqual(historical.value);
    else { expect((await raw()).value.collection.session.sessionId).toBe(nextId); expect((await raw()).value.sessionEnd).toBeUndefined(); }
    chromeApi.storage.local.set.mockImplementation(set); fault?.mockRestore(); await restart();
    const recovered = (await message({ type: 'status' })).status!;
    expect(recovered.storage!.phase).toBe('ready'); expect(recovered.session?.sessionId).not.toBe(SERVER_SESSION_ID);
    if (boundary !== 'active-mirror') {
      expect(recovered.sessionEnd!.state).toBe('ENDED'); expect(recovered.session).toBeNull();
      expect(recovered.sessionStartRecovery!.kind).toBe('pending');
      const calls = vi.mocked(fetch).mock.calls.length;
      expect((await message({ type: 'start', goalText })).ok).toBe(true);
      expect(vi.mocked(fetch).mock.calls.length).toBe(calls + (boundary === 'pending' ? 1 : 0));
    }
    const state = (await raw()).value;
    expect(state.collection.session.sessionId).toBe(nextId); expect(state.sessionEnd).toBeUndefined(); expect(state.collection.candidates).toEqual([]);
    expect(state.activeSession.startRequest.idempotencyKey).toBe(pending.idempotencyKey);
    expect(state.activeSession.startRequest.response).toEqual(nextResponse); expect(local.pendingSessionStart).toBeUndefined();
  });
  it.each(['sessionId', 'goalText', 'idempotencyKey'])('preserves a real conflicting %s mirror without overwriting either source', async kind => {
    await visit(); await message({ type: 'end-session' }); await completed();
    const saved = await raw();
    if (kind === 'sessionId') { local.activeSession.sessionId = crypto.randomUUID(); local.activeSession.startRequest.response.sessionId = local.activeSession.sessionId; }
    if (kind === 'goalText') { local.activeSession.goalText = '다른 기록에 속한 목표'; local.activeSession.startRequest.goalText = local.activeSession.goalText; local.activeSession.startRequest.response.goalText = local.activeSession.goalText; }
    if (kind === 'idempotencyKey') local.activeSession.startRequest.idempotencyKey = crypto.randomUUID();
    const conflict = structuredClone(local); await restart();
    const status = (await message({ type: 'status' })).status!;
    expect(status.storage!.phase).toBe('failed'); expect(status.session).toBeNull();
    expect((await message({ type: 'start', goalText: '기록 덮어쓰기는 금지합니다' })).ok).toBe(false);
    expect((await message({ type: 'clear' })).ok).toBe(false);
    expect(local).toEqual(conflict); expect(await raw()).toEqual(saved); expect(endCalls()).toHaveLength(1);
  });
});
