import { setCredential, AccessError } from '../src/api/auth-fetch';
import { readCollectionAccess, accessRequest } from '../src/v2/access';
import { V2StatusClient } from '../src/v2/status';
import { API_BASE_URL } from '../src/api/client';
import { V2Runtime, v2HttpTransport } from '../src/v2/runtime';
import { V2Repository } from '../src/v2/repository';
import { describeUrl } from '../src/shared/url';
import { serialExecutor } from '../src/background/serial';
import { catalog, fixtureId } from './catalog';
import type { Stamp } from '../src/v2/state';

declare const __SYNTHETIC_V2__: boolean;
if (!__SYNTHETIC_V2__ || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(API_BASE_URL)) throw new Error('V2_SYNTHETIC_ONLY');
const epoch = crypto.randomUUID();
const stamp = (): Stamp => ({ epoch, mono: performance.now(), wall: Date.now() });
const runtime = new V2Runtime(new V2Repository(API_BASE_URL), v2HttpTransport);
const ready = runtime.initialize();
const statusClient = new V2StatusClient(() => runtime.snapshot());
const serial = serialExecutor();
async function captureAllowedTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(t => t.id !== undefined && t.url && fixtureId(t.url)).map(t => chrome.tabs.sendMessage(t.id!, { type: 'v2-capture' }).catch(() => {})));
}
const boundaries = new Map<number, Stamp>();
const documents = new Map<number, string>();
const navigationRevision = new Map<number, number>();
const contentGenerations = new Map<number, { raw: string; content: string }>();
const windowTabs = new Map<number, number>();
let focusedWindow: number | null = null;
let focused: number | null = null;
async function focus(t: Stamp, switched = false) {
  const windows = await chrome.windows.getAll();
  const w = windows.find(w => w.focused && w.state !== 'minimized');
  const [tab] = w?.id === undefined ? [] : await chrome.tabs.query({ active: true, windowId: w.id });
  focusedWindow = w?.id ?? null;
  const next = tab?.id ?? null;
  if (w?.id !== undefined && next !== null) windowTabs.set(w.id, next);
  if (focused !== next) {
    if (next !== null) boundaries.set(next, t);
    focused = next;
    await runtime.foreground(next, t, switched);
  }
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const t = stamp();
  const arrivedRevision = sender.tab?.id === undefined ? undefined : navigationRevision.get(sender.tab.id);
  if (sender.url === chrome.runtime.getURL('synthetic/harness.html') && ['v2-login','v2-logout','v2-withdraw'].includes(m?.type)) runtime.suspendAccess();
  // Termination/privacy intents enter the runtime synchronously, before waiting on browser queries.
  if (sender.url === chrome.runtime.getURL('synthetic/harness.html') && m?.type === 'v2-stop') {
    void ready.then(() => runtime.stop(t)).then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
    return true;
  }
  void serial(async () => {
    await ready;
    if (sender.url === chrome.runtime.getURL('synthetic/harness.html')) {
      if (['v2-access','v2-login','v2-logout','v2-agree','v2-withdraw'].includes(m?.type)) {
        try {
          if (m.type === 'v2-login') await setCredential(m.token);
          if (m.type === 'v2-logout') { try { await accessRequest('/api/auth/logout', {}); } finally { await setCredential(); } return {}; }
          if (m.type === 'v2-agree') await accessRequest('/api/consent', { requestId: crypto.randomUUID(), policyId: m.policyId, policyVersion: m.policyVersion, accepted: true });
          if (m.type === 'v2-withdraw') await runtime.withdrawAll(t.wall);
          const access = await readCollectionAccess();
          await runtime.verifyAccess(false, true).catch(() => {});
          if (m.type === 'v2-login') { await runtime.retry().catch(() => {}); await captureAllowedTabs(); }
          const id = runtime.snapshot().withdrawal?.ack?.withdrawalId;
          const withdrawal = id ? await accessRequest(`/api/consent/withdrawals/${id}`) : undefined;
          return { access, withdrawal };
        } catch (e) { return { error: e instanceof AccessError ? e.kind : 'network' }; }
      }
      if (m?.type === 'v2-start') { await runtime.start('Synthetic TypeScript transaction research'); await captureAllowedTabs(); }
      if (m?.type === 'v2-retry') { await runtime.retry(); await runtime.flushNotifications(); }
      if (m?.type === 'v2-alert') return statusClient.candidate();
      if (m?.type === 'v2-shown') {
        const candidate = await statusClient.candidate();
        if (candidate && candidate.alertId === m.alertId) await runtime.recordShown(candidate, m.shownAt);
      }
      if (m?.type === 'v2-selection') await runtime.selectAlert(m.alertId, { action: m.action, selectedAt: m.selectedAt });
      if (m?.type === 'v2-quarantine') await runtime.quarantine('CONSENT_WITHDRAWN', t.wall);
      // Test harness receives only catalog data, and never an ordinary Chrome document.
      return runtime.snapshot();
    }
    const tabId = sender.tab?.id;
    if (tabId === undefined || sender.frameId !== 0 || !sender.documentId || sender.documentLifecycle !== 'active') return;
    if (m?.type === 'v2-context') return { collecting: !!sender.url && !!fixtureId(sender.url) && runtime.collecting() };
    if (m?.type === 'v2-leave') { await runtime.leave(tabId, t); return; }
    if (m?.type !== 'v2-observation' || typeof m.raw !== 'string' || !fixtureId(m.raw) || fixtureId(m.raw) !== m.id) return;
    const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
    if (!frame || frame.documentId !== sender.documentId || frame.url !== m.raw) return;
    const permitted = await chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] });
    if (!m.safe || !permitted) { await runtime.quarantine('SENSITIVE_CONTENT', t.wall); return; }
    await focus(t);
    if (!m.visible) await runtime.leave(tabId, t);
    const url = await describeUrl(m.raw);
    if (!url) return;
    if (documents.get(tabId) !== sender.documentId) {
      documents.set(tabId, sender.documentId); boundaries.set(tabId, t);
    }
    if (m.ready !== true || typeof m.contentId !== 'string' || !catalog[m.contentId] || typeof m.titleId !== 'string' || !catalog[m.titleId]) return { collecting: runtime.collecting() };
    const generation = m.contentId;
    const previousContent = contentGenerations.get(tabId);
    if (previousContent && previousContent.raw === m.raw && previousContent.content !== generation) boundaries.set(tabId, t);
    contentGenerations.set(tabId, { raw: m.raw, content: generation });
    const target = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m.raw)))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (arrivedRevision !== navigationRevision.get(tabId)) return { collecting: runtime.collecting() };
    await runtime.observe({ tabId, document: sender.documentId, target, generation,
      stamp: t, enteredAt: boundaries.get(tabId) ?? t, permitted, safe: true,
      snapshot: { ...url, searchQuery: null, title: `Synthetic fixture ${m.titleId}`, content: catalog[m.contentId] } });
    await runtime.compact(t);
    return { collecting: runtime.collecting() };
  }).then(reply).catch(() => reply({ error: 'V2_BLOCKED' }));
  return true;
});
function event(operation: (t: Stamp) => Promise<void>) {
  const t = stamp();
  void serial(async () => { await ready; await operation(t); }).catch(() => {});
}
chrome.tabs.onActivated.addListener(info => {
  windowTabs.set(info.windowId, info.tabId);
  event(async t => {
    if (info.windowId === focusedWindow) {
      boundaries.set(info.tabId, t); focused = info.tabId;
      await runtime.foreground(info.tabId, t, true);
    }
  });
});
chrome.windows.onFocusChanged.addListener(windowId => {
  const tab = windowTabs.get(windowId);
  event(async t => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      focused = null; focusedWindow = null; await runtime.foreground(null, t);
    } else if (tab !== undefined) {
      focused = tab; focusedWindow = windowId; boundaries.set(tab, t); await runtime.foreground(tab, t);
    } else await focus(t);
  });
});
chrome.windows.onBoundsChanged.addListener(() => event(t => focus(t)));
chrome.tabs.onRemoved.addListener(tab => event(async t => { await runtime.leave(tab, t, true); documents.delete(tab); }));
chrome.webNavigation.onCommitted.addListener(d => {
  if (d.frameId !== 0) return;
  navigationRevision.set(d.tabId, (navigationRevision.get(d.tabId) ?? 0) + 1);
  event(async t => { boundaries.set(d.tabId, t); documents.set(d.tabId, d.documentId); await runtime.leave(d.tabId, t, true); });
});
chrome.webNavigation.onHistoryStateUpdated.addListener(d => {
  if (d.frameId !== 0) return;
  navigationRevision.set(d.tabId, (navigationRevision.get(d.tabId) ?? 0) + 1);
  event(async t => {
    boundaries.set(d.tabId, t); await runtime.leave(d.tabId, t, true);
    await chrome.tabs.sendMessage(d.tabId, { type: 'v2-capture' }).catch(() => {});
  });
});
chrome.permissions.onRemoved.addListener(() => event(t => runtime.quarantine('CONSENT_WITHDRAWN', t.wall)));
chrome.alarms.onAlarm.addListener(() => event(async () => { runtime.wake(); }));
void ready.then(async () => { await chrome.alarms.create('v2-recovery', { periodInMinutes: 1 }); await captureAllowedTabs(); }).catch(() => {});
