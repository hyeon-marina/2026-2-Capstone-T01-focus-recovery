import { UUID4 } from './contract';
import { setCredential, AccessError } from '../api/auth-fetch';
import { readCollectionAccess, accessRequest } from './access';
import { V2StatusClient } from './status';
import { postJson, API_BASE_URL } from '../api/client';
import { V2Runtime, v2HttpTransport } from './runtime';
import { V2Repository } from './repository';
import { describeUrl } from '../shared/url';
import { serialExecutor } from '../background/serial';
import { catalog, fixtureId } from '../../synthetic/catalog';
import type { Stamp } from './state';
import { allowedSite, validPolicy, publicText, type SitePolicy } from '../../real/policy';
import { validSnapshot } from './contract';
import type { PageSnapshot } from '../shared/types';
declare const __COLLECTION_BUILD__: { buildId: string; policyDigest: string; sites: { origin: string; pathPrefix: string }[]; mode: string };

export function installV2Browser(options: { uiPath: string; pilot: boolean; participant: boolean; real?: boolean }) {
if (options.pilot && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(API_BASE_URL)) throw new Error('V2_SYNTHETIC_ONLY');
let sitePolicy: SitePolicy | undefined;
const real = options.real === true;
const build = real ? __COLLECTION_BUILD__ : undefined;
const permits = (raw: string) => real ? !!sitePolicy && Date.parse(sitePolicy.expiresAt) > Date.now() && allowedSite(raw, sitePolicy.sites) : !!fixtureId(raw);
async function collectionAccess() {
  const a = await readCollectionAccess();
  if (real) {
    sitePolicy = undefined;
    const p = await accessRequest('/api/collection/site-policy').catch(() => undefined);
    // A closed collection policy must not hide authenticated consent/withdrawal controls.
    if (p && validPolicy(p, build!, build!.mode === 'controlled-web')) sitePolicy = p;
  }
  return { ...a, collectionEnabled: (options.pilot || real && !!sitePolicy) && a.collectionEnabled };
}
const epoch = crypto.randomUUID();
const stamp = (): Stamp => ({ epoch, mono: performance.now(), wall: Date.now() });
let selectedAssignment: string | undefined;
const runtime = new V2Runtime(new V2Repository(API_BASE_URL), { ...v2HttpTransport,
  access: collectionAccess,
  start: async (goal, key) => {
    if (!options.pilot && !real) throw new Error('PARTICIPANT_COLLECTION_BLOCKED');
    return options.participant
      ? postJson(`/api/collection/assignments/${selectedAssignment}/start`, {}, key)
      : v2HttpTransport.start(goal, key);
  },
});
const reportAttempts = new Map<string, string>();
const reportedFailures = new Set<string>();
async function syncReport() {
  if (!options.participant) return;
  const s = runtime.snapshot();
  if (!s.session || !s.collectionAllowed || s.quarantine) return;
  const sessionId = s.session.sessionId;
  let attemptId = reportAttempts.get(sessionId);
  if (!attemptId) {
    const a = await accessRequest(`/api/collection/attempts/current?workSession=${sessionId}`);
    attemptId = a.attemptId;
    if (typeof attemptId !== 'string') throw new Error('ATTEMPT_NOT_FOUND');
    reportAttempts.set(sessionId, attemptId);
  }
  for (const c of s.candidates) if (c.excluded && !reportedFailures.has(c.id)) { await accessRequest(`/api/collection/attempts/${attemptId}/failures`, {
    failureId: c.id, reasonCode: c.excluded, observedAt: c.visitedAt,
  }); reportedFailures.add(c.id); }
  if (s.lifecycle === 'ENDED' && s.end?.phase === 'acked' && s.notifications.every(r => r.shownAck && (!r.selection || r.selectionAck))) await accessRequest(`/api/collection/attempts/${attemptId}/delivered`, {
    visitCount: s.compactedCount + s.posts.entries.filter(e => e.phase === 'acked').length, lastSequence: s.nextSequence - 1,
  });
}
function snapshot() {
  const s = runtime.snapshot();
  if (!options.participant) return s;
  return { lifecycle: s.accessError === 'account' ? 'ACCOUNT_BLOCKED' : s.lifecycle, collectionAllowed: s.collectionAllowed, accessError: s.accessError, storageFailed: s.storageFailed,
    validVisits: s.collectionAllowed ? s.compactedCount + s.posts.entries.filter(e => e.phase === 'acked').length : 0,
    pending: s.collectionAllowed ? [...s.posts.entries, ...s.behaviors.entries].filter(e => e.phase !== 'acked').length : 0,
    notificationPending: s.collectionAllowed ? s.notifications.filter(r => !r.shownAck || r.selection && !r.selectionAck).length : 0,
    notificationAcknowledged: s.collectionAllowed ? s.notifications.filter(r => r.selectionAck).length : 0,
    endPhase: s.end?.phase, quarantined: !!s.quarantine, withdrawalPhase: s.withdrawal?.phase,
  };
}
const ready = runtime.initialize();
const statusClient = new V2StatusClient(() => runtime.snapshot());
const serial = serialExecutor();
async function captureAllowedTabs() {
  if (!options.pilot && !real) return;
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(t => t.id !== undefined && t.url && permits(t.url)).map(t => chrome.tabs.sendMessage(t.id!, { type: 'v2-capture' }).catch(() => {})));
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
  if (sender.url === chrome.runtime.getURL(options.uiPath) && ['v2-login','v2-logout','v2-withdraw'].includes(m?.type)) runtime.suspendAccess();
  // Termination/privacy intents enter the runtime synchronously, before waiting on browser queries.
  if (sender.url === chrome.runtime.getURL(options.uiPath) && m?.type === 'v2-stop') {
    void ready.then(() => runtime.stop(t)).then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
    return true;
  }
  void serial(async () => {
    await ready;
    if (sender.url === chrome.runtime.getURL(options.uiPath)) {
      if (['v2-access','v2-login','v2-logout','v2-agree','v2-withdraw'].includes(m?.type)) {
        try {
          if (m.type === 'v2-login') await setCredential(m.token);
          if (m.type === 'v2-logout') { try { await accessRequest('/api/auth/logout', {}); } finally { await setCredential(); } return {}; }
          if (m.type === 'v2-agree') await accessRequest('/api/consent', { requestId: crypto.randomUUID(), policyId: m.policyId, policyVersion: m.policyVersion, accepted: true });
          if (m.type === 'v2-withdraw') await runtime.withdrawAll(t.wall);
          const access = await collectionAccess();
          await runtime.verifyAccess(false, true).catch(() => {});
          if (m.type === 'v2-login') { await runtime.retry().catch(() => {}); await captureAllowedTabs(); }
          const id = runtime.snapshot().withdrawal?.ack?.withdrawalId;
          const withdrawal = id ? await accessRequest(`/api/consent/withdrawals/${id}`) : undefined;
          return { access, withdrawal };
        } catch (e) { return { error: e instanceof AccessError ? e.kind : 'network' }; }
      }
      if (m?.type === 'v2-recollect' && typeof m.attemptId === 'string' && UUID4.test(m.attemptId)) return accessRequest(`/api/collection/attempts/${m.attemptId}/recollect`, { reasonCode: m.reasonCode });
      if (m?.type === 'v2-assignments') return accessRequest('/api/collection/assignments');
      if (m?.type === 'v2-progress') { await syncReport(); return accessRequest('/api/collection/progress'); }
      if (m?.type === 'v2-start') {
        if (!options.pilot && !real) throw new Error('PARTICIPANT_COLLECTION_BLOCKED');
        if (options.participant) {
          const assignments = await accessRequest('/api/collection/assignments');
          const assigned = assignments.find((a: { plannedSessionId: string }) => a.plannedSessionId === m.plannedSessionId);
          if (!assigned || assigned.goalStatus !== 'CONFIRMED') throw new Error('GOAL_UNCONFIRMED');
          selectedAssignment = assigned.plannedSessionId;
          await runtime.start(assigned.goalText);
        } else await runtime.start('Synthetic TypeScript transaction research');
        await captureAllowedTabs();
      }
      if (m?.type === 'v2-retry') { await runtime.retry(); await runtime.flushNotifications(); }
      if (m?.type === 'v2-alert') return statusClient.candidate();
      if (m?.type === 'v2-shown') {
        const candidate = await statusClient.candidate();
        if (candidate && candidate.alertId === m.alertId) await runtime.recordShown(candidate, m.shownAt);
      }
      if (m?.type === 'v2-selection') await runtime.selectAlert(m.alertId, { action: m.action, selectedAt: m.selectedAt });
      if (m?.type === 'v2-quarantine') await runtime.quarantine('CONSENT_WITHDRAWN', t.wall);
      // Test harness receives only catalog data, and never an ordinary Chrome document.
      return snapshot();
    }
    const tabId = sender.tab?.id;
    if (tabId === undefined || sender.frameId !== 0 || !sender.documentId || sender.documentLifecycle !== 'active') return;
    if (m?.type === 'v2-context' && real) { await runtime.verifyAccess(); return { collecting: !!sender.url && permits(sender.url) && runtime.collecting() }; }
    if (m?.type === 'v2-context') return { collecting: !!sender.url && permits(sender.url) && runtime.collecting() };
    if (m?.type === 'v2-leave') { await runtime.leave(tabId, t); return; }
    if (real && m?.type === 'v2-observation') {
      if (typeof m.raw !== 'string' || !permits(m.raw) || !runtime.collecting()) return { collecting: false };
      // Refresh server consent/release before accepting any ordinary document content.
      await runtime.verifyAccess();
      if (!permits(m.raw)) return { collecting: false };
      const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
      if (!frame || frame.documentId !== sender.documentId || frame.url !== m.raw) return;
      const permitted = await chrome.permissions.contains({origins:[new URL(m.raw).origin + '/*']});
      if (!permitted || m.safe !== true) { await runtime.quarantine('SENSITIVE_CONTENT', t.wall); return { collecting: false }; }
      await focus(t);
      if (!m.visible) { await runtime.leave(tabId, t); return { collecting: runtime.collecting() }; }
      if (documents.get(tabId) !== sender.documentId) { documents.set(tabId, sender.documentId);boundaries.set(tabId,t); }
      const description = await describeUrl(m.raw);
      if (!description) return;
      const s = m.snapshot as PageSnapshot | null;
      if (s && (!validSnapshot(s, runtime.snapshot().session!.sessionId) || s.normalizedUrl !== description.normalizedUrl || s.identity !== description.identity
        || s.searchQuery !== description.searchQuery || s.isSearchResultPage !== description.isSearchResultPage || !publicText(s.title,s.content,s.searchQuery ?? ''))) {
        await runtime.quarantine('SENSITIVE_CONTENT', t.wall);return { collecting: false };
      }
      const generation = s ? [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s.title+'\n'+s.content)))].map(b=>b.toString(16).padStart(2,'0')).join('') : 'extracting';
      const previous=contentGenerations.get(tabId);
      if (previous && (previous.raw !== m.raw || previous.content !== generation)) boundaries.set(tabId,t);
      contentGenerations.set(tabId,{raw:m.raw,content:generation});
      if (arrivedRevision !== navigationRevision.get(tabId)) return { collecting: runtime.collecting() };
      await runtime.observe({tabId,document:sender.documentId,target:description.identity,generation,stamp:t,enteredAt:boundaries.get(tabId) ?? t,
        permitted,safe:true,snapshot:s,extractionFailed:m.extractionFailed === true});
      await syncReport();await runtime.compact(t);return { collecting:runtime.collecting() };
    }
    if (m?.type !== 'v2-observation'  || typeof m.raw !== 'string' || !fixtureId(m.raw) || fixtureId(m.raw) !== m.id) return;
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
    await syncReport();
    await runtime.compact(t);
    return { collecting: runtime.collecting() };
  }).then(reply).catch(() => reply({ error: 'V2_BLOCKED' }));
  return true;
});
if (options.pilot || real) {
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
}
void ready.then(async () => { await chrome.alarms.create('v2-recovery', { periodInMinutes: 1 }); await captureAllowedTabs(); }).catch(() => {});
}
