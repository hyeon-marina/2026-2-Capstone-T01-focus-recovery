import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  return new Promise(resolve => chromeApi.runtime.onMessage.listeners[0](value, content ? { ...sender, url: frame.url, tab: { id: 1 }, frameId: 0, documentId: frame.documentId, documentLifecycle: 'active' } : sender, resolve));
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
async function deniedNavigation() {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
  chromeApi.permissions.contains.mockResolvedValue(false);
  chromeApi.permissions.getAll.mockResolvedValue({ origins: [] });
  expect((await message({ type: 'start', goalText: '공개 문서의 신규 사이트 권한 검증하기' })).ok).toBe(true);
  chromeApi.webNavigation.onCommitted.listeners[0]({ tabId: 1, frameId: 0, documentId: frame.documentId, url: frame.url, transitionType: 'link' });
  await message({ type: 'status' });
  return clock;
}
async function grantSite() {
  chromeApi.permissions.contains.mockResolvedValue(true);
  chromeApi.permissions.getAll.mockResolvedValue({ origins: [`${new URL(frame.url).origin}/*`] });
  chromeApi.permissions.onAdded.listeners[0]();
  await message({ type: 'status' });
}
async function publicSnapshot() {
  const url = (await describeUrl(frame.url))!;
  return message({ type: 'snapshot', sessionId: SERVER_SESSION_ID, snapshot: { ...url, title: '공개 문서', content: '개인정보 없는 공개 합성 본문 '.repeat(20), ...(url.isSearchResultPage ? { organicResultCount: 1 } : {}) } }, true);
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
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(url.endsWith('/api/sessions')
    ? { ...serverSession(JSON.parse(init.body as string).goalText), sessionId: SERVER_SESSION_ID }
    : { ...JSON.parse(init.body as string), sessionId: SERVER_SESSION_ID, updatedAt: null }), { status: 201 })));
  await import('../src/background/index');
});

describe('real Background with IndexedDB', () => {
  it.each(['ordinary', 'naver'] as const)('starts one %s candidate at grant time without pre-permission data or duplicate sequences', async kind => {
    if (kind === 'naver') frame.url = 'https://search.naver.com/search.naver?query=Spring%20Boot%20JWT#public';
    const clock = await deniedNavigation(), before = (await raw()).value.collection;
    expect(before.tabs[1].awaitingPermission).toBe(true);
    await publicSnapshot(); expect((await raw()).value.collection.candidates[0].snapshot).toBeUndefined();
    clock.mockReturnValue(90000); await grantSite(); await message({ type: 'context' }, true);
    const fresh = (await raw()).value.collection.candidates.at(-1);
    expect(fresh).toMatchObject({ visitedAt: new Date(90000).toISOString(), activeDurationMs: 0, browserTabKey: before.tabs[1].browserTabKey });
    expect(fresh.visitId).not.toBe(before.candidates[0].visitId);
    clock.mockReturnValue(90500); await publicSnapshot();
    expect((await message({ type: 'status' })).status!.visits).toEqual([]);
    clock.mockReturnValue(91500); await publicSnapshot();
    for (let i = 0; i < 2; i++) { await grantSite(); await message({ type: 'context' }, true); await publicSnapshot(); }
    const state = (await raw()).value.collection;
    expect(state.candidates).toHaveLength(2);
    expect(state.candidates[0]).toMatchObject({ state: 'excluded', activeDurationMs: 0, sequence: null });
    expect(state.candidates[0].snapshot).toBeUndefined();
    expect(state.candidates[1]).toMatchObject({ visitId: fresh.visitId, state: 'valid', activeDurationMs: 1500 });
    expect(state.candidates[1].snapshot.searchQuery).toBe(kind === 'naver' ? 'Spring Boot JWT' : null);
    chromeApi.tabs.onRemoved.listeners[0](1);
    await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0]).toMatchObject({ phase: 'acked', sequence: 1 }));
    await vi.waitFor(async () => expect((await raw()).value.behaviorDelivery.entries[0].phase).toBe('acked'));
    expect((await raw()).value.visitDelivery.entries).toHaveLength(1);
    await message({ type: 'stop' }); await message({ type: 'clear' });
  });
  it('does not revive a truly sensitive URL even after the same document changes to a safe path', async () => {
    frame.url = 'https://example.com/login'; const clock = await deniedNavigation();
    expect((await raw()).value.collection.tabs[1].awaitingPermission).toBeUndefined();
    await grantSite(); await message({ type: 'context' }, true);
    frame.url = 'https://example.com/docs'; clock.mockReturnValue(90000);
    await message({ type: 'context' }, true); await publicSnapshot();
    expect((await message({ type: 'status' })).status!.visits).toEqual([]);
    expect((await raw()).value.collection.candidates).toHaveLength(1);
  });
  it('consumes the permission marker when the current URL fails policy validation', async () => {
    const clock = await deniedNavigation();
    frame.url = 'https://example.com/account'; await grantSite(); await message({ type: 'context' }, true);
    expect((await raw()).value.collection.tabs[1].awaitingPermission).toBeUndefined();
    frame.url = 'https://example.com/docs'; clock.mockReturnValue(90000);
    await message({ type: 'context' }, true); await publicSnapshot();
    expect((await raw()).value.collection.candidates).toHaveLength(1);
    expect((await message({ type: 'status' })).status!.visits).toEqual([]);
  });
  it('retains DOM exclusion after grant and never revives it through repeated context', async () => {
    const clock = await deniedNavigation(); await grantSite(); await message({ type: 'context' }, true);
    await message({ type: 'snapshot', sessionId: SERVER_SESSION_ID, snapshot: null, reason: 'dom-policy' }, true);
    clock.mockReturnValue(90000); await message({ type: 'context' }, true); await publicSnapshot();
    const state = (await raw()).value.collection;
    expect(state.candidates).toHaveLength(2);
    expect(state.candidates[1]).toMatchObject({ state: 'excluded', reason: 'dom-policy' });
    expect(state.candidates[1].snapshot).toBeUndefined();
    expect((await message({ type: 'status' })).status!.visits).toEqual([]);
  });
  it('does not create a permission recovery marker for the mandatory API host', async () => {
    frame.url = (await import('../src/api/client')).API_BASE_URL + '/docs';
    await deniedNavigation(); await grantSite();
    expect((await raw()).value.collection.tabs[1].awaitingPermission).toBeUndefined();
    expect(await message({ type: 'context' }, true)).toMatchObject({ sessionId: null });
    expect((await message({ type: 'status' })).status!.visits).toEqual([]);
  });
  it('rechecks document and permission before consuming the recovery marker', async () => {
    await deniedNavigation(); await grantSite();
    chromeApi.webNavigation.getFrame.mockResolvedValue({ ...frame, documentId: 'replacement' });
    expect(await message({ type: 'context' }, true)).toMatchObject({ sessionId: null });
    expect((await raw()).value.collection.tabs[1].awaitingPermission).toBe(true);
    chromeApi.webNavigation.getFrame.mockResolvedValue(frame); chromeApi.permissions.contains.mockResolvedValue(false);
    expect(await message({ type: 'context' }, true)).toMatchObject({ sessionId: null });
    expect((await raw()).value.collection.candidates).toHaveLength(1);
  });
  it('starts only a fresh post-grant candidate after Worker restart', async () => {
    const clock = await deniedNavigation(); await restart(); await message({ type: 'status' });
    clock.mockReturnValue(90000); await grantSite(); await message({ type: 'context' }, true);
    clock.mockReturnValue(91500); await publicSnapshot();
    expect((await message({ type: 'status' })).status!.visits[0]).toMatchObject({ activeDurationMs: 1500, visitedAt: new Date(90000).toISOString() });
    expect((await raw()).value.collection.candidates).toHaveLength(2);
  });
  it('collects the same active document after granting permission to a page opened during the session', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
    chromeApi.permissions.contains.mockResolvedValue(false);
    chromeApi.permissions.getAll.mockResolvedValue({ origins: [] });
    expect((await message({ type: 'start', goalText: '공개 문서의 신규 사이트 권한 검증하기' })).ok).toBe(true);
    chromeApi.webNavigation.onCommitted.listeners[0]({ tabId: 1, frameId: 0, documentId: frame.documentId, url: frame.url, transitionType: 'link' });
    await message({ type: 'status' });
    expect((await raw()).value.collection.candidates[0]).toMatchObject({ state: 'excluded', reason: 'url-policy' });
    chromeApi.permissions.contains.mockResolvedValue(true);
    chromeApi.permissions.getAll.mockResolvedValue({ origins: ['https://example.com/*'] });
    chromeApi.permissions.onAdded.listeners[0]({ origins: ['https://example.com/*'] });
    await message({ type: 'status' });
    await message({ type: 'context' }, true);
    clock.mockReturnValue(11500);
    await message({ type: 'snapshot', sessionId: SERVER_SESSION_ID, snapshot: { ...(await describeUrl(frame.url))!, title: '권한 허용된 공개 문서', content: '개인정보 없는 공개 합성 본문 '.repeat(20) } }, true);
    expect((await message({ type: 'status' })).status!.candidates.at(-1)?.state).toBe('valid');
  });
  it.each(['acked', 'unconfirmed', 'in-flight'] as const)('never reuses a %s sequence after repeated revocation, clear and Worker restart', async phase => {
    const clock = await visit(), normalFetch = vi.mocked(fetch).getMockImplementation()!;
    let release: (() => void) | undefined;
    if (phase === 'unconfirmed') vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }));
    if (phase === 'in-flight') vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      await new Promise<void>(resolve => { release = resolve; });
      return new Response(JSON.stringify({ ...JSON.parse(init!.body as string), sessionId: SERVER_SESSION_ID, updatedAt: null }), { status: 201 });
    });
    chromeApi.tabs.onRemoved.listeners[0](1);
    await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0].phase).toBe(phase === 'unconfirmed' ? 'retry-wait' : phase === 'in-flight' ? 'sending' : 'acked'));
    const original = (await raw()).value.visitDelivery.entries[0].visit;
    for (let i = 0; i < 2; i++) {
      chromeApi.permissions.contains.mockResolvedValue(false);
      chromeApi.permissions.getAll.mockResolvedValue({ origins: [] });
      chromeApi.permissions.onRemoved.listeners[0]({ origins: ['https://example.com/*'] });
      await message({ type: 'status' });
    }
    expect((await message({ type: 'clear' })).ok).toBe(true);
    release?.(); vi.mocked(fetch).mockImplementation(normalFetch);
    await restart();
    const erased = (await raw()).value;
    expect(erased.collection).toMatchObject({ session: null, nextSequence: 2, sequenceStart: 2, candidates: [], tabs: {} });
    expect(erased.visitDelivery.entries).toEqual([]); expect(erased.behaviorDelivery.entries).toEqual([]);
    expect(JSON.stringify(erased)).not.toContain(original.visitId);
    expect(JSON.stringify(erased)).not.toContain(original.content);
    chromeApi.permissions.contains.mockResolvedValue(true);
    chromeApi.permissions.getAll.mockResolvedValue({ origins: ['https://example.com/*'] });
    chromeApi.permissions.onAdded.listeners[0]({ origins: ['https://example.com/*'] });
    expect((await message({ type: 'status' })).status!.session).toBeNull();
    expect((await message({ type: 'start', goalText: '공개 합성 문서 조사하기' })).ok).toBe(true);
    frame = { documentId: 'resumed-document', url: 'https://example.com/resumed' };
    clock.mockReturnValue(20000); await message({ type: 'context' }, true); clock.mockReturnValue(21500);
    await message({ type: 'snapshot', sessionId: SERVER_SESSION_ID, snapshot: { ...(await describeUrl(frame.url))!, title: '재개 문서', content: '재개 후의 새 공개 합성 본문 '.repeat(20) } }, true);
    chromeApi.tabs.onRemoved.listeners[0](1);
    await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0]).toMatchObject({ phase: 'acked', sequence: 2 }));
    await vi.waitFor(async () => expect((await raw()).value.behaviorDelivery.entries[0].phase).toBe('acked'));
    await restart();
    expect((await message({ type: 'status' })).status!.storage!.phase).toBe('ready');
    expect((await raw()).value.collection.nextSequence).toBe(3);
    await message({ type: 'stop' }); await message({ type: 'clear' });
    expect((await message({ type: 'start', goalText: '별도의 새 공개 작업 시작하기' })).ok).toBe(true);
    expect((await raw()).value.collection.nextSequence).toBe(1);
    expect((await raw()).value.collection.sequenceStart).toBeUndefined();
  });
  it('keeps the next server sequence when explicitly resuming after site permission revocation', async () => {
    // #59: actual Chrome + BE reproduced VISIT_SEQUENCE_CONFLICT after regrant.
    const clock = await visit();
    chromeApi.tabs.onRemoved.listeners[0](1);
    await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0].phase).toBe('acked'));
    const first = (await raw()).value.visitDelivery.entries[0].visit;
    expect(first.sequence).toBe(1);
    chromeApi.permissions.contains.mockResolvedValue(false);
    chromeApi.permissions.getAll.mockResolvedValue({ origins: [] });
    chromeApi.permissions.onRemoved.listeners[0]({ origins: ['https://example.com/*'] });
    await message({ type: 'status' });
    expect((await raw()).value.collection.candidates).toEqual([]);
    chromeApi.permissions.contains.mockResolvedValue(true);
    chromeApi.permissions.getAll.mockResolvedValue({ origins: ['https://example.com/*'] });
    chromeApi.permissions.onAdded.listeners[0]({ origins: ['https://example.com/*'] });
    await message({ type: 'status' });
    expect((await message({ type: 'start', goalText: '공개 합성 문서 조사하기' })).ok).toBe(true);
    frame = { documentId: 'after-regrant', url: 'https://example.com/after-regrant' };
    clock.mockReturnValue(20000);
    await message({ type: 'context' }, true);
    clock.mockReturnValue(21500);
    await message({ type: 'snapshot', sessionId: SERVER_SESSION_ID, snapshot: { ...(await describeUrl(frame.url))!, title: '재허용 공개 문서', content: '공개 합성 본문 '.repeat(20) } }, true);
    chromeApi.tabs.onRemoved.listeners[0](1);
    await message({ type: 'status' });
    const next = (await raw()).value.collection.candidates[0];
    expect(next.visitId).not.toBe(first.visitId);
    expect(next.sessionId).toBe(first.sessionId);
    expect(next.sequence).toBe(2);
    await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0].phase).toBe('acked'));
    await vi.waitFor(async () => expect((await raw()).value.behaviorDelivery.entries[0].phase).toBe('acked'));
    await message({ type: 'stop' }); await message({ type: 'clear' });
  });
  it('erases a failed POST queue on revocation and never restores samples on regrant or Worker restart', async () => {
    await visit();
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }));
    chromeApi.tabs.onRemoved.listeners[0](1);
    await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0]).toMatchObject({ attempts: 1, phase: 'retry-wait' }));
    const original = (await raw()).value.visitDelivery.entries[0].visit;
    const snapshot = (await raw()).value.collection.candidates[0].snapshot;
    expect(original.content.length).toBeGreaterThan(0);
    chromeApi.permissions.contains.mockResolvedValue(false);
    chromeApi.permissions.getAll.mockResolvedValue({ origins: [] });
    chromeApi.permissions.onRemoved.listeners[0]({ origins: ['https://example.com/*'] });
    await message({ type: 'status' });
    const postCount = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/visits')).length;
    const sent = postCount();
    const erased = (await raw()).value;
    expect(erased.collection.candidates).toEqual([]);
    expect(erased.visitDelivery.entries).toEqual([]);
    expect(erased.behaviorDelivery.entries).toEqual([]);
    expect(erased.collection.session).toBeNull();
    chromeApi.permissions.contains.mockResolvedValue(true);
    chromeApi.permissions.getAll.mockResolvedValue({ origins: ['https://example.com/*'] });
    chromeApi.permissions.onAdded.listeners[0]({ origins: ['https://example.com/*'] });
    await message({ type: 'status' });
    expect(await message({ type: 'context' }, true)).toMatchObject({ sessionId: null });
    await message({ type: 'snapshot', sessionId: SERVER_SESSION_ID, snapshot }, true);
    await restart();
    const status = (await message({ type: 'status' })).status!;
    expect(status.session).toBeNull();
    expect(status.visits).toEqual([]);
    expect((await raw()).value.visitDelivery.entries).toEqual([]);
    expect(postCount()).toBe(sent);
  });
  it('restores after session storage disappears, retains identifiers and excludes the shutdown gap', async () => {
    const clock = await visit(), before = (await raw()).value.collection;
    legacy = {}; chromeApi.storage.session = area(legacy); clock.mockReturnValue(999999);
    await restart(); const reply = await message({ type: 'status' });
    expect(reply.status!.storage).toMatchObject({ phase: 'ready', recovered: true });
    expect(reply.status!.candidates[0]).toMatchObject({ visitId: before.candidates[0].visitId, sequence: null, activeDurationMs: 1500, behaviorVersion: 1 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1); expect(Object.keys(legacy)).toEqual([]);
  });
  it.each(['document', 'tab', 'permission'])('preserves an unverifiable %s candidate as unresolved without allocating sequence', async kind => {
    await visit(0); const before = (await raw()).value.collection.candidates[0];
    if (kind === 'document') frame.documentId = 'replacement';
    if (kind === 'tab') chromeApi.webNavigation.getFrame.mockResolvedValue(null);
    if (kind === 'permission') chromeApi.permissions.contains.mockResolvedValue(false);
    await restart(); const reply = await message({ type: 'status' });
    expect(reply.status!.candidates[0]).toMatchObject({ visitId: before.visitId, recoveryRequired: true, sequence: null, finalized: false, activeDurationMs: before.activeDurationMs });
    expect(reply.status!.recoveryCandidates).toBe(1); await message({ type: 'stop' });
    expect((await message({ type: 'start', goalText: '새로운 문서 조사하기' })).ok).toBe(false);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
  it('never sends HTTP when the sending transaction aborts', async () => {
    await visit(); const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const r = put.apply(this, args); const value = args[0] as any;
      if (value.value.visitDelivery?.entries[0]?.phase === 'sending') r.addEventListener('success', () => this.transaction.abort()); return r;
    });
    await message({ type: 'stop' });
    await vi.waitFor(async () => expect((await message({ type: 'status' })).status!.storage!.phase).toBe('failed'));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect((await raw()).value.visitDelivery.entries[0].phase).toBe('queued');
  });
  it('rolls back an uncommitted POST ACK, blocks PATCH and resumes the original request', async () => {
    await visit(); const put = IDBObjectStore.prototype.put;
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const r = put.apply(this, args); const value = args[0] as any;
      if (value.value.visitDelivery?.entries[0]?.phase === 'acked') r.addEventListener('success', () => this.transaction.abort()); return r;
    });
    await message({ type: 'stop' });
    await vi.waitFor(async () => expect((await message({ type: 'status' })).status!.storage!.phase).toBe('failed'));
    const saved = (await raw()).value, snapshot = saved.visitDelivery.entries[0].visit;
    expect(saved.visitDelivery.entries[0]).toMatchObject({ phase: 'sending', attempts: 1 });
    expect((await message({ type: 'status' })).status!.visitDelivery!.visits[0].phase).toBe('sending');
    expect(saved.behaviorDelivery.entries[0].ack).toBeUndefined(); fault.mockRestore(); await restart();
    await vi.waitFor(async () => expect((await message({ type: 'status' })).status!.visitDelivery!.visits[0].phase).toBe('acked'));
    expect((await raw()).value.visitDelivery.entries[0].visit).toEqual(snapshot);
    expect((await raw()).value.visitDelivery.entries[0].attempts).toBe(2);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/visits'))).toHaveLength(2);
  });
  it.each(['clear', 'revoke'])('never recreates persistent data after %s with an HTTP response still in flight', async action => {
    await visit(); let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(fetch).mockImplementation(async (_url, init) => { await held; return new Response(JSON.stringify({ ...JSON.parse(init!.body as string), sessionId: SERVER_SESSION_ID, updatedAt: null }), { status: 201 }); });
    await message({ type: 'stop' });
    await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0].phase).toBe('sending'));
    if (action === 'clear') await message({ type: 'clear' });
    else { chromeApi.permissions.onRemoved.listeners[0](); await message({ type: 'status' }); }
    release(); await message({ type: 'status' }); await restart(); await message({ type: 'status' });
    const saved = (await raw()).value; expect(saved.collection.candidates).toEqual([]); expect(saved.visitDelivery.entries).toEqual([]); expect(saved.behaviorDelivery.entries).toEqual([]);
  });
  it('blocks all actions after initialization failure and does not expose private errors', async () => {
    chromeApi.storage.session.get.mockRejectedValue(Error('PRIVATE_ERROR_URL')); await restart();
    const reply = await message({ type: 'start', goalText: '공개 문서 조사하기' }); expect(reply.ok).toBe(false);
    expect(reply.status!.storage!.phase).toBe('failed'); expect(JSON.stringify(reply)).not.toContain('PRIVATE_ERROR_URL'); expect(fetch).not.toHaveBeenCalled();
  });
  it('gates simultaneous popup, content and tab events until initialization completes', async () => {
    await message({ type: 'status' });
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    chromeApi.storage.local.get.mockImplementationOnce(async () => { await held; return {}; }); await restart();
    const started = message({ type: 'start', goalText: '공개 문서 조사하기' }), content = message({ type: 'context' }, true);
    chromeApi.tabs.onActivated.listeners[0]({ tabId: 1, windowId: 1 });
    await Promise.resolve(); expect(fetch).not.toHaveBeenCalled(); release();
    expect((await started).ok).toBe(true); expect((await content).sessionId).toBe(SERVER_SESSION_ID);
    expect((await raw()).value.collection.candidates).toHaveLength(1);
  });
  it('commits a PATCH snapshot before HTTP, rolls back its failed ACK commit and replays the same version', async () => {
    await visit(); let releasePost!: () => void, releasePatch!: () => void;
    const postGate = new Promise<void>(resolve => { releasePost = resolve; });
    const patchGate = new Promise<void>(resolve => { releasePatch = resolve; });
    const requests: { method: string; body: any }[] = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const body = JSON.parse(init!.body as string); requests.push({ method: init!.method!, body });
      if (String(url).endsWith('/visits')) { await postGate; return new Response(JSON.stringify({ ...body, sessionId: SERVER_SESSION_ID, updatedAt: null }), { status: 201 }); }
      const saved = (await raw()).value;
      expect(saved.visitDelivery.entries[0].phase).toBe('acked');
      expect(saved.behaviorDelivery.entries[0]).toMatchObject({ phase: 'sending', request: body });
      await patchGate;
      return new Response(JSON.stringify({ ...body, visitId: saved.visitDelivery.entries[0].visitId, applied: true, updatedAt: '2026-10-18T01:23:45.678Z' }));
    });
    chromeApi.tabs.onRemoved.listeners[0](1); await message({ type: 'status' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    chromeApi.tabs.onActivated.listeners[0]({ tabId: 2, windowId: 1 }); await message({ type: 'status' });
    expect((await raw()).value.behaviorDelivery.entries[0].phase).toBe('waiting-post');
    releasePost(); await vi.waitFor(() => expect(requests).toHaveLength(2));
    const snapshot = structuredClone(requests[1].body), put = IDBObjectStore.prototype.put;
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const r = put.apply(this, args), entry = (args[0] as any).value.behaviorDelivery?.entries[0];
      if (entry?.phase === 'acked' && entry.ack.behaviorVersion === snapshot.behaviorVersion) r.addEventListener('success', () => this.transaction.abort()); return r;
    });
    releasePatch(); await vi.waitFor(async () => expect((await message({ type: 'status' })).status!.storage!.phase).toBe('failed'));
    const original = (await raw()).value.behaviorDelivery.entries[0];
    expect(original).toMatchObject({ phase: 'sending', attempts: 1, request: snapshot }); expect(original.ack.behaviorVersion).toBeLessThan(snapshot.behaviorVersion);
    fault.mockRestore(); await restart();
    await vi.waitFor(async () => expect((await message({ type: 'status' })).status!.behaviorDelivery!.visits[0].phase).toBe('acked'));
    expect(requests.map(r => r.method)).toEqual(['POST', 'PATCH', 'PATCH']); expect(requests[2].body).toEqual(snapshot);
    expect((await raw()).value.behaviorDelivery.entries[0].ack).toEqual(snapshot);
  });
  it('uses persisted retry time and an alarm event to resume after a Worker restart', async () => {
    const clock = await visit();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await message({ type: 'stop' });
    await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0].phase).toBe('retry-wait'));
    const before = (await raw()).value.visitDelivery.entries[0];
    const count = vi.mocked(fetch).mock.calls.length; await restart(); await message({ type: 'status' });
    expect(fetch).toHaveBeenCalledTimes(count);
    expect((await raw()).value.visitDelivery.entries[0].nextRetryAt).toBe(before.nextRetryAt);
    clock.mockReturnValue(before.nextRetryAt + 1);
    chromeApi.alarms.onAlarm.listeners[0]({ name: 'durable-delivery' });
    await vi.waitFor(async () => expect((await message({ type: 'status' })).status!.visitDelivery!.visits[0].phase).toBe('acked'));
    expect((await raw()).value.visitDelivery.entries[0].attempts).toBe(2);
  });

  it('only finalizes a valid detached candidate on explicit stop and keeps its committed duration and ID', async () => {
    const clock = await visit(); const original = (await raw()).value.collection.candidates[0];
    frame.documentId = 'replacement'; clock.mockReturnValue(500000); await restart();
    const restored = (await message({ type: 'status' })).status!.candidates[0];
    expect(restored).toMatchObject({ visitId: original.visitId, sequence: null, recoveryRequired: true, finalized: false, activeDurationMs: 1500 });
    const stopped = (await message({ type: 'stop' })).status!;
    expect(stopped.readyVisits[0]).toMatchObject({ visitId: original.visitId, sequence: 1, activeDurationMs: 1500, behaviorVersion: original.behaviorVersion });
    expect(stopped.recoveryCandidates).toBe(0);
    await vi.waitFor(async () => expect((await message({ type: 'status' })).status!.visitDelivery!.visits[0].phase).toBe('acked'));
  });
  it('preserves the disk aggregate on a conflicting local receipt, including after repeated status requests', async () => {
    await visit(); const before = await raw();
    local.pendingSessionStart = { ...structuredClone(local.activeSession.startRequest), idempotencyKey: crypto.randomUUID() };
    await restart();
    for (let n = 0; n < 2; n++) expect((await message({ type: 'status' })).status!.sessionStartRecovery).toMatchObject({ kind: 'invalid', reason: 'conflicting-records' });
    expect(await raw()).toEqual(before); expect(fetch).toHaveBeenCalledTimes(1);
    const receipt = structuredClone(local.pendingSessionStart); await message({ type: 'clear' });
    expect((await raw()).value.collection.candidates).toEqual([]); expect(local.pendingSessionStart).toEqual(receipt);
  });

  it('reinjects permitted content scripts on extension reload without replacing the existing candidate', async () => {
    await visit(); const id = (await raw()).value.collection.candidates[0].visitId;
    chromeApi.scripting.executeScript.mockClear(); await restart();
    chromeApi.runtime.onInstalled.listeners[0]({ reason: 'update' }); await message({ type: 'status' });
    expect(chromeApi.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 1 }, files: ['content.js'] });
    expect((await raw()).value.collection.candidates.map((c: any) => c.visitId)).toEqual([id]);
  });

  it('A-2 keeps a committed local stop when removing the local metadata fails', async () => {
    await visit();
    const original = (await raw()).value.collection.candidates[0];
    const receipt = structuredClone(local.activeSession.startRequest);
    chromeApi.storage.local.remove.mockImplementation(async (keys: string | string[]) => {
      if ([keys].flat().includes('activeSession')) throw Error('synthetic mirror remove failure');
      for (const key of [keys].flat()) delete local[key];
    });
    await message({ type: 'stop' });
    const stopped = await raw();
    expect(stopped.value.collection.session).toBeNull();
    expect(stopped.value.activeSession).toBeUndefined();
    expect(stopped.value.collection.candidates[0]).toMatchObject({ visitId: original.visitId, sequence: 1, activeDurationMs: original.activeDurationMs });
    expect(local.activeSession.startRequest).toEqual(receipt);
    chromeApi.storage.local.remove.mockImplementation(area(local).remove);
    await restart();
    await vi.waitFor(async () => expect((await message({ type: 'status' })).status!.visitDelivery!.visits[0].phase).toBe('acked'));
    const recovered = (await message({ type: 'status' })).status!;
    expect(recovered.session).toBeNull(); expect(recovered.sessionStartRecovery).toEqual({ kind: 'none' });
    expect(local.activeSession).toBeUndefined();
    expect((await message({ type: 'start', goalText: '종료 복구 후 새로운 세션' })).ok).toBe(true);
  });
  it('A-3 distinguishes an older interrupted mirror from a committed resume before local set', async () => {
    await visit(); const original = (await raw()).value.collection.candidates[0];
    local.activeSession.interrupted = true;
    await restart(); expect((await message({ type: 'status' })).status!.sessionStartRecovery!.kind).toBe('pending');
    const receipt = structuredClone(local.activeSession.startRequest);
    let reached!: () => void; const saved = new Promise<void>(resolve => { reached = resolve; });
    chromeApi.storage.local.set.mockImplementation(async (value: any) => {
      if (value.activeSession) { reached(); await new Promise(() => undefined); }
      else Object.assign(local, structuredClone(value));
    });
    void message({ type: 'start', goalText: receipt.goalText }); await saved;
    expect((await raw()).value.collection.session.sessionId).toBe(SERVER_SESSION_ID);
    expect(local.activeSession.interrupted).toBe(true);
    chromeApi.storage.local.set.mockImplementation(area(local).set);
    await restart(); const recovered = (await message({ type: 'status' })).status!;
    expect(recovered.session?.sessionId).toBe(SERVER_SESSION_ID);
    expect(recovered.sessionStartRecovery).toEqual({ kind: 'none' });
    expect(recovered.candidates[0].visitId).toBe(original.visitId);
    expect(local.activeSession.startRequest.idempotencyKey).toBe(receipt.idempotencyKey);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('A-3 preserves a different local session instead of deleting it beside a stopped aggregate', async () => {
    await visit(); await message({ type: 'stop' });
    await vi.waitFor(async () => expect((await message({ type: 'status' })).status!.visitDelivery!.visits[0].phase).toBe('acked'));
    const before = await raw(); const response = serverSession('별도 서버 세션 확인하기');
    local.activeSession = { ...response, source: 'server', startRequest: { idempotencyKey: crypto.randomUUID(), goalText: response.goalText, apiBaseUrl: 'http://localhost:8080', response } };
    const other = structuredClone(local.activeSession); await restart();
    const reply = await message({ type: 'status' });
    expect(reply.status!.storage!.phase).toBe('failed');
    expect(local.activeSession).toEqual(other); expect(await raw()).toEqual(before);
  });

  it('A-1 restores a committed active session and receipt after local set rejects', async () => {
    await visit(); const original = await raw(), receipt = structuredClone(local.activeSession.startRequest);
    chromeApi.storage.local.set.mockRejectedValueOnce(Error('synthetic local failure'));
    const failed = await message({ type: 'status' });
    expect(failed.ok).toBe(false); expect(failed.status!.storage).toMatchObject({ phase: 'ready', metadataSyncPending: true });
    const saved = await raw(); expect(saved.revision).toBe(original.revision + 1);
    expect(saved.value.collection.session.sessionId).toBe(SERVER_SESSION_ID);
    expect(saved.value.collection.candidates[0].visitId).toBe(original.value.collection.candidates[0].visitId);
    expect(saved.value.activeSession.startRequest).toEqual(receipt);
    await restart(); const restored = (await message({ type: 'status' })).status!;
    expect(restored.session?.sessionId).toBe(SERVER_SESSION_ID); expect(restored.sessionStartRecovery).toEqual({ kind: 'none' });
    expect(local.activeSession.startRequest).toEqual(receipt); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('A-3 restores a stop committed before local removal starts, preserving its finalized visit and budget', async () => {
    await visit(); const receipt = structuredClone(local.activeSession);
    let reached!: () => void; const gate = new Promise<void>(resolve => { reached = resolve; });
    chromeApi.storage.local.remove.mockImplementation(async (key: string) => {
      if (key === 'activeSession') { reached(); await new Promise(() => undefined); } else delete local[key];
    });
    void message({ type: 'stop' }); await gate;
    const committedStop = await raw(); expect(committedStop.value.activeSession).toBeUndefined();
    expect(local.activeSession).toEqual(receipt);
    chromeApi.storage.local.remove.mockImplementation(area(local).remove); await restart();
    await vi.waitFor(async () => expect((await message({ type: 'status' })).status!.visitDelivery!.visits[0].phase).toBe('acked'));
    const saved = await raw(); expect(saved.revision).toBeGreaterThan(committedStop.revision);
    expect(saved.value.visitDelivery.entries[0]).toMatchObject({ visitId: committedStop.value.collection.candidates[0].visitId, sequence: 1, attempts: 1, phase: 'acked' });
    expect(saved.value.visitDelivery.entries[0].visit.activeDurationMs).toBe(committedStop.value.collection.candidates[0].activeDurationMs);
    expect(saved.value.collection.session).toBeNull(); expect(local.activeSession).toBeUndefined();
  });
  it('A-4 reuses the pre-HTTP key when saving the server response receipt fails', async () => {
    const set = area(local).set; let failed = false;
    chromeApi.storage.local.set.mockImplementation(async (value: any) => {
      if (value.pendingSessionStart?.response && !failed) { failed = true; throw Error('synthetic receipt failure'); }
      await set(value);
    });
    expect((await message({ type: 'start', goalText: '영수증 쓰기 중단 검증하기' })).ok).toBe(false);
    const original = structuredClone(local.pendingSessionStart);
    expect(original.response).toBeUndefined(); expect(original.idempotencyKey).toBeTruthy();
    await restart(); expect((await message({ type: 'start', goalText: original.goalText })).ok).toBe(true);
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => new Headers(init!.headers).get('Idempotency-Key'))).toEqual([original.idempotencyKey, original.idempotencyKey]);
    expect((await raw()).value.activeSession.startRequest.response.sessionId).toBe(SERVER_SESSION_ID);
    expect(local.pendingSessionStart).toBeUndefined();
  });
  it('keeps a durable POST ACK usable when only its local mirror fails', async () => {
    const clock = await visit(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      await gate; const body = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ ...body, sessionId: SERVER_SESSION_ID, updatedAt: null }), { status: 201 });
    });
    chromeApi.tabs.onRemoved.listeners[0](1); await message({ type: 'status' });
    await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0].phase).toBe('sending'));
    chromeApi.storage.local.set.mockRejectedValue(Error('synthetic mirror failure')); release();
    await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0].phase).toBe('acked'));
    expect((await raw()).value.behaviorDelivery.entries[0].ack).toBeDefined();
    chromeApi.storage.local.set.mockImplementation(area(local).set); clock.mockReturnValue(500000);
    await restart(); await message({ type: 'status' });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/visits'))).toHaveLength(1);
  });
  it.each(['valid', 'pending', 'unavailable-content', 'finalized'] as const)('C preserves the %s prefix policy with a subsequent valid visit', async kind => {
    let clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
    if (kind === 'valid' || kind === 'finalized') clock = await visit();
    else {
      await message({ type: 'start', goalText: '공개 합성 문서 조사하기' }); await message({ type: 'context' }, true);
      if (kind === 'unavailable-content') await message({ type: 'snapshot', sessionId: SERVER_SESSION_ID, snapshot: null, reason: kind }, true);
    }
    if (kind === 'finalized') {
      chromeApi.tabs.onRemoved.listeners[0](1); await message({ type: 'status' });
      await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0].phase).toBe('acked'));
    }
    const original = (await raw()).value.collection.candidates[0];
    frame = { documentId: 'new-document', url: 'https://example.com/next' }; clock.mockReturnValue(500000); await restart();
    await message({ type: 'context' }, true); clock.mockReturnValue(501500);
    await message({ type: 'snapshot', sessionId: SERVER_SESSION_ID, snapshot: { ...(await describeUrl(frame.url))!, title: '다음 공개 문서', content: '다른 공개 합성 본문 '.repeat(20) } }, true);
    chromeApi.tabs.onRemoved.listeners[0](1); const beforeStop = (await message({ type: 'status' })).status!;
    expect(beforeStop.candidates[0]).toMatchObject({ visitId: original.visitId, activeDurationMs: original.activeDurationMs, behaviorVersion: original.behaviorVersion });
    expect(beforeStop.candidates[1]).toMatchObject({ finalized: true, state: 'valid', sequence: kind === 'finalized' ? 2 : null });
    if (kind !== 'finalized') { expect(beforeStop.recoveryCandidates).toBe(1); expect(beforeStop.visitDelivery!.visits).toEqual([]); }
    const stopped = (await message({ type: 'stop' })).status!;
    expect(stopped.candidates[0].visitId).toBe(original.visitId);
    if (kind === 'valid' || kind === 'finalized') {
      expect(stopped.readyVisits.map(v => v.sequence)).toEqual([1, 2]);
      await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries.filter((e: any) => e.phase === 'acked')).toHaveLength(2));
      const bodies = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/visits')).map(([, init]) => JSON.parse(init!.body as string));
      expect(bodies.map(body => body.visitId)).toEqual(stopped.readyVisits.map(v => v.visitId));
    } else {
      expect(stopped.readyVisits).toEqual([]); expect(stopped.recoveryCandidates).toBe(1);
      expect(stopped.candidates[0]).toMatchObject({ finalized: false, sequence: null, recoveryRequired: true });
      expect((await message({ type: 'start', goalText: '새로운 세션 차단 확인' })).ok).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('B keeps a committed migration available when removing legacy keys partially fails', async () => {
    await visit(); const saved = (await raw()).value;
    Object.assign(legacy, { collection: saved.collection, visitDelivery: saved.visitDelivery, behaviorDelivery: saved.behaviorDelivery });
    chromeApi.storage.session.remove.mockImplementation(async () => { delete legacy.visitDelivery; throw Error('synthetic partial cleanup'); });
    await restart(); const restored = (await message({ type: 'status' })).status!;
    expect(restored.storage!.phase).toBe('ready'); expect(restored.session?.sessionId).toBe(SERVER_SESSION_ID);
    expect(restored.candidates[0].visitId).toBe(saved.collection.candidates[0].visitId);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(restored.storage!.legacyCleanupPending).toBe(true);
    await restart(); expect((await message({ type: 'status' })).status!.storage!.phase).toBe('ready');
    chromeApi.storage.session.remove.mockImplementation(area(legacy).remove); await restart();
    expect((await message({ type: 'status' })).status!.storage!.phase).toBe('ready'); expect(Object.keys(legacy)).toEqual([]);
  });
  it('A-1 retains POST ACK and an in-flight PATCH snapshot when local metadata set fails', async () => {
    await visit(); let releasePost!: () => void;
    const postGate = new Promise<void>(resolve => { releasePost = resolve; });
    const patches: any[] = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const body = JSON.parse(init!.body as string);
      if (String(url).endsWith('/visits')) { await postGate; return new Response(JSON.stringify({ ...body, sessionId: SERVER_SESSION_ID, updatedAt: null }), { status: 201 }); }
      patches.push(body);
      if (patches.length === 1) await new Promise(() => undefined);
      return new Response(JSON.stringify({ ...body, visitId: (await raw()).value.visitDelivery.entries[0].visitId, applied: false, updatedAt: '2026-10-18T01:23:45.678Z' }));
    });
    chromeApi.tabs.onRemoved.listeners[0](1); await message({ type: 'status' });
    await vi.waitFor(async () => expect((await raw()).value.visitDelivery.entries[0].phase).toBe('sending'));
    chromeApi.tabs.onActivated.listeners[0]({ tabId: 2, windowId: 1 }); await message({ type: 'status' }); releasePost();
    await vi.waitFor(() => expect(patches).toHaveLength(1)); await message({ type: 'status' });
    const before = await raw(); chromeApi.storage.local.set.mockRejectedValueOnce(Error('synthetic mirror failure'));
    expect((await message({ type: 'status' })).ok).toBe(false);
    const committed = await raw(); expect(committed.value.visitDelivery).toEqual(before.value.visitDelivery);
    expect(committed.value.behaviorDelivery).toEqual(before.value.behaviorDelivery);
    await restart();
    await vi.waitFor(async () => expect((await message({ type: 'status' })).status!.behaviorDelivery!.visits[0].phase).toBe('acked'));
    expect(patches).toHaveLength(2); expect(patches[1]).toEqual(patches[0]);
    expect((await raw()).value.visitDelivery.entries[0].phase).toBe('acked');
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/visits'))).toHaveLength(1);
  });

});
