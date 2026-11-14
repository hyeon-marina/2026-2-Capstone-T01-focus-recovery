import { beforeEach, expect, it, vi } from 'vitest';
import { initialState } from '../src/v2/state';
import { API_BASE_URL } from '../src/api/client';
const f = vi.hoisted(() => ({ active: 1 as number | null, windowFocused: true, permission: vi.fn(), frame: vi.fn(), request: vi.fn(), listener: undefined as any, events: {} as Record<string, any>, runtime: undefined as any, capture: vi.fn(), frames: vi.fn() }));
vi.mock('../src/v2/access', async original => ({ ...await original<object>(), readCollectionAccess: async () => ({ collectionEnabled: true }), accessRequest: f.request }));
vi.mock('../src/v2/runtime', async original => ({ ...await original<object>(), V2Runtime: class {
  foregroundTab: number | null = null;
  state = { ...initialState(API_BASE_URL), lifecycle: 'ACTIVE', collectionAllowed: true, session: { sessionId: '10000000-0000-4000-8000-000000000001' } };
  constructor() { f.runtime = this; }
  initialize = async () => {}; verifyAccess = async () => {}; collecting = () => true; snapshot = () => this.state;
  foreground = vi.fn(async (id: number | null) => { this.foregroundTab = id; });
  leave = vi.fn(async () => {}); quarantine = vi.fn(async () => {}); observe = vi.fn(async () => {}); compact = async () => {}; start = async () => {};
} }));
import { installV2Browser } from '../src/v2/browser';

const raw = 'https://example.org/public';
const sender = (id: number) => ({ id: 'extension', tab: { id, windowId: 1 }, frameId: 0, documentId: `doc-${id}`, documentLifecycle: 'active', url: raw });
const send = (type: string, data = {}, from: any = { id: 'extension', url: 'chrome-extension://extension/participant/index.html' }) => new Promise<any>(resolve => f.listener({ type: 'v2-' + type, ...data }, from, resolve));
beforeEach(async () => {
  vi.clearAllMocks(); f.active = 1; f.windowFocused = true; f.events = {};
  const event = (name: string) => ({ addListener: (cb: any) => { f.events[name] = cb; } });
  f.permission.mockResolvedValue(true);
  f.capture.mockResolvedValue(undefined);
  f.frames.mockResolvedValue([]);
  f.frame.mockImplementation(async ({ tabId }: { tabId: number }) => ({ documentId: `doc-${tabId}`, url: raw }));
  const policy = { digest: 'a'.repeat(64), buildId: 'synthetic-test', expiresAt: '2099-01-01T00:00:00Z', sites: [], status: 'APPROVED', publicWeb: true };
  f.request.mockResolvedValue(policy);
  vi.stubGlobal('__COLLECTION_BUILD__', { policyDigest: policy.digest, buildId: policy.buildId, sites: [], publicWeb: true, pageContent: true, mode: 'real-collection' });
  vi.stubGlobal('chrome', {
    runtime: { id: 'extension', getURL: (p: string) => 'chrome-extension://extension/' + p, onMessage: { addListener: (cb: any) => { f.listener = cb; } } },
    tabs: { query: vi.fn(async (q: any) => q.active ? f.active === null ? [] : [{ id: f.active, windowId: 1, url: raw }] : [{ id: 1, url: raw }, { id: 2, url: raw }]), sendMessage: f.capture, onActivated: event('activate'), onRemoved: event('remove') },
    windows: { getAll: async () => [{ id: 1, focused: f.windowFocused, state: 'normal' }], onFocusChanged: event('focus'), onBoundsChanged: event('bounds'), WINDOW_ID_NONE: -1 },
    webNavigation: { getFrame: f.frame, getAllFrames: f.frames, onCommitted: event('commit'), onHistoryStateUpdated: event('route'), onReferenceFragmentUpdated: event('fragment') },
    permissions: { contains: f.permission, onRemoved: event('permissionRemoved') }, alarms: { create: vi.fn(), onAlarm: event('alarm') },
  });
  installV2Browser({ uiPath: 'participant/index.html', pilot: false, participant: false, real: true });
  await send('access'); f.capture.mockClear();
});

it('initial capture targets only the active tab of the focused window', async () => {
  expect((await send('start')).error).toBeUndefined();
  expect(f.capture.mock.calls.map(c => c[0])).toEqual([1]);
});
it('reports a missing Content Script instead of silently leaving ACTIVE with zero Visits', async () => {
  f.capture.mockRejectedValueOnce(new Error('Could not establish connection'));
  await send('start');
  expect((await send('status')).diagnostic.code).toBe('CONTENT_SCRIPT_UNAVAILABLE');
  await send('start');
  expect((await send('status')).diagnostic.code).toBe('WAITING_OBSERVATION');
});
it('reports restricted site permission without quarantining', async () => {
  f.permission.mockResolvedValue(false);
  await send('start');
  expect((await send('status')).diagnostic.code).toBe('SITE_PERMISSION_REQUIRED');
  expect(f.runtime.quarantine).not.toHaveBeenCalled();
});
it('does not quarantine ordinary focused-input exclusions', async () => {
  await send('observation', { raw, safe: false, sensitive: false, visible: true, failureReason: 'INPUT_FOCUSED' }, sender(1));
  expect(f.runtime.leave).toHaveBeenCalled();
  expect(f.runtime.quarantine).not.toHaveBeenCalled();
});
it('reactivates a previously stopped content timer on the native tab activation event', async () => {
  await send('start'); f.capture.mockClear();
  f.active = 2; f.events.activate({ tabId: 2, windowId: 1 });
  await send('status');
  expect(f.capture.mock.calls.map(c => c[0])).toEqual([2]);
});
it('reactivates only the focused tab when its browser window regains focus', async () => {
  await send('start'); f.capture.mockClear();
  f.windowFocused = false; f.events.focus(-1); await send('status');
  expect(f.capture).not.toHaveBeenCalled();
  f.windowFocused = true; f.events.focus(1); await send('status');
  expect(f.capture.mock.calls.map(c => c[0])).toEqual([1]);
});
it.each(['background', 'unfocused', 'no-tab'])('denies extraction context in a %s document', async mode => {
  if (mode === 'unfocused') f.windowFocused = false;
  if (mode === 'no-tab') f.active = null;
  const result = await send('context', { raw }, sender(mode === 'background' ? 2 : 1));
  expect(result.collecting).toBe(false);
});
it.each([{ id: 2, visible: true }, { id: 1, visible: false }])('ignores non-foreground sensitive messages before quarantine', async ({ id, visible }) => {
  await send('observation', { raw, safe: false, sensitive: true, visible }, sender(id));
  expect(f.runtime.quarantine).not.toHaveBeenCalled(); expect(f.runtime.observe).not.toHaveBeenCalled();
});
it('still quarantines an active sensitive document before any Visit is accepted', async () => {
  await send('observation', { raw, safe: false, sensitive: true, visible: true }, sender(1));
  expect(f.runtime.quarantine).toHaveBeenCalledWith('SENSITIVE_CONTENT', expect.any(Number));
  expect(f.runtime.observe).not.toHaveBeenCalled();
});
it('rechecks the foreground after asynchronous permission validation', async () => {
  f.permission.mockImplementationOnce(async () => { f.active = 2; return true; });
  await send('observation', { raw, safe: false, sensitive: true, visible: true }, sender(1));
  expect(f.runtime.quarantine).not.toHaveBeenCalled();
});
it('discards an old-document signal when navigation changes during validation', async () => {
  f.permission.mockImplementationOnce(async () => { f.events.route({ frameId: 0, tabId: 1 }); return true; });
  await send('observation', { raw, safe: false, sensitive: true, visible: true }, sender(1));
  expect(f.runtime.quarantine).not.toHaveBeenCalled();
});


const childRaw='https://example.org/blog/article';
const child={frameId:7,parentFrameId:0,documentId:'article-doc',documentLifecycle:'active',url:childRaw};
const childSource={url:childRaw,frameId:7,documentId:'article-doc'};
function articleFrames() {
 f.frames.mockResolvedValue([child]);
 f.frame.mockImplementation(async ({tabId,frameId}:any)=>frameId===7?{...child}:{documentId:`doc-${tabId}`,url:raw});
}
it('authorizes a single actual same-origin child document without granting arbitrary frame messages',async()=>{
 articleFrames();
 const result=await send('context',{raw,contentRaw:childRaw},sender(1));
 expect(result.collecting).toBe(true);expect(result.source).toEqual(childSource);
 await send('observation',{raw,source:childSource,safe:true,visible:true,snapshot:null},sender(1));
 expect(f.runtime.observe).toHaveBeenCalledWith(expect.objectContaining({document:'doc-1:article-doc'}));
 f.runtime.observe.mockClear();
 await send('observation',{raw,safe:true,visible:true,snapshot:null},{...sender(1),frameId:7,documentId:'article-doc'});
 expect(f.runtime.observe).not.toHaveBeenCalled();
});
it.each(['https://elsewhere.org/article','https://example.org/account/private'])('does not authorize a blocked frame URL %s',async contentRaw=>{
 articleFrames();expect((await send('context',{raw,contentRaw},sender(1))).collecting).toBe(false);
});
it('rejects ambiguous or nested child-frame bindings',async()=>{
 for(const frames of [[child,{...child,frameId:8}], [{...child,parentFrameId:3}]]){
  articleFrames();f.frames.mockResolvedValue(frames);
  expect((await send('context',{raw,contentRaw:childRaw},sender(1))).collecting).toBe(false);
 }
});
it('ignores stale frame privacy responses rather than quarantining a different document',async()=>{
 articleFrames();await send('context',{raw,contentRaw:childRaw},sender(1));
 f.frame.mockImplementation(async ({tabId,frameId}:any)=>frameId===7?{...child,documentId:'new-article'}:{documentId:`doc-${tabId}`,url:raw});
 await send('observation',{raw,source:childSource,safe:false,sensitive:true,visible:true},sender(1));
 expect(f.runtime.quarantine).not.toHaveBeenCalled();expect(f.runtime.observe).not.toHaveBeenCalled();
 expect((await send('status')).diagnostic.code).toBe('FRAME_SOURCE_STALE');
});
it('invalidates a selected article-frame navigation but ignores unrelated advertising frames',async()=>{
 articleFrames();await send('context',{raw,contentRaw:childRaw},sender(1));
 f.runtime.leave.mockClear();f.events.commit({...child,tabId:1,frameId:9});await send('status');expect(f.runtime.leave).not.toHaveBeenCalled();
 f.events.commit({...child,tabId:1});await send('status');expect(f.runtime.leave).toHaveBeenCalledWith(1,expect.anything(),true);
});
it('rechecks the source after permission awaits before any privacy quarantine',async()=>{
 articleFrames();await send('context',{raw,contentRaw:childRaw},sender(1));
 f.permission.mockImplementationOnce(async()=>{f.events.route({frameId:7,tabId:1});return true;});
 await send('observation',{raw,source:childSource,safe:false,sensitive:true,visible:true},sender(1));
 expect(f.runtime.quarantine).not.toHaveBeenCalled();
});
