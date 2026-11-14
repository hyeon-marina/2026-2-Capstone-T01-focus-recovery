import { validMetadataTitle, METADATA_CONTENT, OMITTED_QUERY } from '../shared/metadata';
import { describeMetadataUrl } from '../../real/url';
import { UUID4 } from './contract';
import { setCredential, AccessError } from '../api/auth-fetch';
import { readCollectionAccess, accessRequest } from './access';
import { V2StatusClient } from './status';
import { ApiError, postJson, API_BASE_URL } from '../api/client';
import { V2Runtime, v2HttpTransport } from './runtime';
import { V2Repository } from './repository';
import { describeUrl } from '../shared/url';
import { serialExecutor } from '../background/serial';
import { catalog, fixtureId } from '../../synthetic/catalog';
import type { Stamp } from './state';
import { allowedSite, validPolicy, publicText, publicSearchQuery, type SitePolicy } from '../../real/policy';
import { validSnapshot } from './contract';
import type { PageSnapshot } from '../shared/types';
import { MAX_OBSERVATION_GAP_MS } from './collector';
declare const __COLLECTION_BUILD__: { buildId: string; policyDigest: string; sites: { origin: string; pathPrefix: string }[]; mode: string; metadataOnly?: boolean; pageContent?: boolean; maskContacts?: boolean; publicWeb?: boolean };

export function installV2Browser(options: { uiPath: string; pilot: boolean; participant: boolean; real?: boolean }) {
if (options.pilot && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(API_BASE_URL)) throw new Error('V2_SYNTHETIC_ONLY');
let sitePolicy: SitePolicy | undefined;
const real = options.real === true;
const build = real ? __COLLECTION_BUILD__ : undefined;
// Random local key is never exported or sent to content scripts. Keep it across worker/browser restarts.
const metadataKey = real && build?.metadataOnly ? (async () => {
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const stored = (await chrome.storage.local.get('metadataIdentityKey')).metadataIdentityKey;
  if (typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored)) return Uint8Array.from(stored.match(/../g)!, b => parseInt(b,16));
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  await chrome.storage.local.set({metadataIdentityKey:[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('')});
  return bytes;
})() : undefined;
async function descriptionFor(raw: string) {
  return build?.metadataOnly ? describeMetadataUrl(raw, sitePolicy?.sites ?? [], await metadataKey!, runtime.snapshot().session!.sessionId, build?.publicWeb, build?.pageContent, build?.maskContacts) : describeUrl(raw);
}
const permits = (raw: string) => real ? !!sitePolicy && Date.parse(sitePolicy.expiresAt) > Date.now() && allowedSite(raw, sitePolicy.sites, build?.metadataOnly === true, build?.publicWeb) : !!fixtureId(raw);
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
// Ephemeral, fixed codes only: never retain a URL, document text, input value or credential.
let diagnostic = { code: 'WAITING_OBSERVATION', observedAt: Date.now() };
const diagnose = (code: string) => { diagnostic = { code, observedAt: Date.now() }; };
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
    failureId: c.id, reasonCode: c.extractionFailureReason ?? c.excluded, observedAt: c.visitedAt,
  }); reportedFailures.add(c.id); }
  if (s.lifecycle === 'ENDED' && s.end?.phase === 'acked' && s.notifications.every(r => r.shownAck && (!r.selection || r.selectionAck))) await accessRequest(`/api/collection/attempts/${attemptId}/delivered`, {
    visitCount: s.compactedCount + s.posts.entries.filter(e => e.phase === 'acked').length, lastSequence: s.nextSequence - 1,
  });
}
function snapshot() {
  const s = runtime.snapshot();
  const diagnostics = { diagnostic, collecting: runtime.collecting(),
    localVisits: s.collectionAllowed ? s.compactedCount + s.posts.entries.length : 0,
    activeDurationMs: s.collectionAllowed ? s.candidates.find(c => c.id === s.tabs[s.foreground ?? -1])?.behavior.activeDurationMs ?? 0 : 0 };
  if (!options.participant) return { ...s, ...diagnostics };
  return { lifecycle: s.accessError === 'account' ? 'ACCOUNT_BLOCKED' : s.lifecycle, collectionAllowed: s.collectionAllowed, accessError: s.accessError, storageFailed: s.storageFailed,
    ...diagnostics,
    validVisits: s.collectionAllowed ? s.compactedCount + s.posts.entries.filter(e => e.phase === 'acked').length : 0,
    pending: s.collectionAllowed ? [...s.posts.entries, ...s.behaviors.entries].filter(e => e.phase !== 'acked').length : 0,
    notificationPending: s.collectionAllowed ? s.notifications.filter(r => !r.shownAck || r.selection && !r.selectionAck).length : 0,
    notificationAcknowledged: s.collectionAllowed ? s.notifications.filter(r => r.selectionAck).length : 0,
    pendingAssignment: s.lifecycle === 'START_PENDING' ? s.start?.plannedSessionId : undefined, quarantineClose: s.quarantineClose?.phase, endPhase: s.end?.phase, quarantined: !!s.quarantine, withdrawalPhase: s.withdrawal?.phase,
  };
}
const ready = runtime.initialize();
const statusClient = new V2StatusClient(() => runtime.snapshot());
const serial = serialExecutor();
async function captureAllowedTabs() {
  if (!options.pilot && !real) return;
  const tab = await focus(stamp());
  if (!runtime.collecting()) return;
  if (tab?.id === undefined) { diagnose('NO_FOREGROUND_TAB'); return; }
  if (!tab.url || !permits(tab.url)) { diagnose('POLICY'); return; }
  if (real && !await chrome.permissions.contains({ origins: [new URL(tab.url).origin + '/*'] })) { diagnose('SITE_PERMISSION_REQUIRED'); return; }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'v2-capture' });
    diagnose('WAITING_OBSERVATION');
  } catch { diagnose('CONTENT_SCRIPT_UNAVAILABLE'); }
}
const boundaries = new Map<number, Stamp>();
const documents = new Map<number, string>();
const navigationRevision = new Map<number, number>();
const contentGenerations = new Map<number, { raw: string; content: string }>();
type ContentSource = {url:string;frameId:number;documentId:string};
const contentFrames = new Map<number, ContentSource>();
const frameDiagnostics = new Set(['FRAME_UNAVAILABLE','FRAME_UNSUPPORTED','FRAME_AMBIGUOUS','FRAME_POLICY_BLOCKED','FRAME_SOURCE_STALE']);
async function validSource(tabId: number, topRaw: string, source: unknown): Promise<ContentSource | null> {
  const value = source as ContentSource | null;
  if (!value || typeof value.url !== 'string' || !Number.isSafeInteger(value.frameId) || value.frameId <= 0 || typeof value.documentId !== 'string' || !permits(value.url)) return null;
  try { if (new URL(value.url).origin !== new URL(topRaw).origin) return null; } catch { return null; }
  const frame = await chrome.webNavigation.getFrame({tabId,frameId:value.frameId}).catch(() => null);
  return frame && frame.parentFrameId === 0 && frame.documentId === value.documentId && frame.url === value.url && frame.documentLifecycle === 'active' ? value : null;
}

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
  if (focused !== next || runtime.foregroundTab !== next) {
    if (next !== null) boundaries.set(next, t);
    focused = next;
    await runtime.foreground(next, t, switched);
  }
  return tab;
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const t = stamp();
  const arrivedRevision = sender.tab?.id === undefined ? undefined : navigationRevision.get(sender.tab.id);
  if (sender.url === chrome.runtime.getURL(options.uiPath) && ['v2-login','v2-logout','v2-withdraw'].includes(m?.type)) runtime.suspendAccess();
  // Termination/privacy intents enter the runtime synchronously, before waiting on browser queries.
  if (sender.url === chrome.runtime.getURL(options.uiPath) && m?.type === 'v2-stop') {
    void ready.then(() => runtime.stop(t)).then(() => reply({ ok: true })).catch(() => reply({ error: 'DELIVERY_UNCONFIRMED' }));
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
          if (runtime.snapshot().end?.phase === 'acked') await syncReport();
          selectedAssignment = assigned.plannedSessionId;
          await runtime.start(assigned.goalText, assigned.plannedSessionId);
        } else await runtime.start('Synthetic TypeScript transaction research');
        boundaries.clear(); documents.clear(); contentGenerations.clear();
        await focus(t);
        await captureAllowedTabs();
      }
      if (m?.type === 'v2-retry') { await runtime.retry(); await runtime.flushNotifications(); await captureAllowedTabs(); }
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
    if (m?.type === 'v2-context' && real) {
      await runtime.verifyAccess();
      // Chrome's sender.url can retain the document's initial URL after pushState.
      const frame = await chrome.webNavigation.getFrame({tabId,frameId:0});
      await focus(t);
      const collecting = tabId === focused && typeof m.raw === 'string' && frame?.documentId === sender.documentId && frame.url === m.raw && permits(m.raw) && runtime.collecting();
      let source: ContentSource | undefined;
      if (collecting && m.contentRaw !== undefined) {
        if (!build?.pageContent || typeof m.contentRaw !== 'string' || !permits(m.contentRaw)) return {collecting:false};
        try { if (new URL(m.contentRaw).origin !== new URL(m.raw).origin) return {collecting:false}; } catch { return {collecting:false}; }
        const frames = await chrome.webNavigation.getAllFrames({tabId}).catch(() => null);
        const matches = frames?.filter(f => f.frameId > 0 && f.parentFrameId === 0 && f.url === m.contentRaw && f.documentLifecycle === 'active');
        if (matches?.length !== 1 || !matches[0].documentId) return {collecting:false};
        source = {url:m.contentRaw,frameId:matches[0].frameId,documentId:matches[0].documentId};
        if (!await validSource(tabId,m.raw,source)) return {collecting:false};
        contentFrames.set(tabId,source);
      }
      await focus(t);
      if (tabId !== focused || arrivedRevision !== navigationRevision.get(tabId)) return {collecting:false};
      return {collecting,maskContacts:build?.maskContacts === true,pageContent:build?.pageContent === true,publicWeb:build?.publicWeb === true,metadataOnly:build?.metadataOnly === true,
        ...(source?{source}:{}),description:collecting && build?.metadataOnly ? await descriptionFor(source?.url ?? m.raw) : undefined};
    }
    if (m?.type === 'v2-context') return { collecting: !!sender.url && permits(sender.url) && runtime.collecting() };
    if (m?.type === 'v2-leave') { await runtime.leave(tabId, t); return; }
    if (real && m?.type === 'v2-observation') {
      if (typeof m.raw !== 'string' || !runtime.collecting()) return { collecting: false };
      if (!permits(m.raw)) { diagnose('POLICY'); await runtime.leave(tabId,t,true); return {collecting:runtime.collecting()}; }
      // Refresh server consent/release before accepting any ordinary document content.
      await runtime.verifyAccess();
      if (!permits(m.raw)) return { collecting: false };
      const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
      if (!frame || frame.documentId !== sender.documentId || frame.url !== m.raw) return;
      const source = m.source === undefined ? undefined : await validSource(tabId,m.raw,m.source);
      if (m.source !== undefined && !source) { diagnose('FRAME_SOURCE_STALE'); return {collecting:runtime.collecting()}; }
      const permitted = await chrome.permissions.contains({origins:[new URL(m.raw).origin + '/*']});
      const description = permitted && m.safe === true ? await descriptionFor(source?.url ?? m.raw) : undefined;
      // Recheck after asynchronous validation, before any privacy decision or accepted Visit.
      await focus(t);
      if (tabId !== focused || m.visible === false || arrivedRevision !== navigationRevision.get(tabId) || source && !await validSource(tabId,m.raw,source)) {
        if (tabId === focused) diagnose('NOT_FOCUSED_OR_STALE');
        await runtime.leave(tabId, t);
        return { collecting: runtime.collecting() };
      }
      if ((build?.publicWeb || build?.pageContent) && (!permitted || m.safe !== true && m.sensitive !== true)) {
        diagnose(frameDiagnostics.has(m.diagnosticCode) ? m.diagnosticCode : !permitted ? 'SITE_PERMISSION_REQUIRED' : m.failureReason === 'INPUT_FOCUSED' ? 'INPUT_FOCUSED' : 'POLICY');
        await runtime.leave(tabId,t,true); return {collecting:runtime.collecting()};
      }
      if (!permitted || m.safe !== true) { diagnose('SENSITIVE_CONTENT'); await runtime.quarantine('SENSITIVE_CONTENT', t.wall); return { collecting: false }; }
      if (!m.visible) { await runtime.leave(tabId, t); return { collecting: runtime.collecting() }; }
      if (documents.get(tabId) !== sender.documentId) { documents.set(tabId, sender.documentId);boundaries.set(tabId,t); }
      if (!description) return;
      const s = m.snapshot as PageSnapshot | null;
      if (s && (!validSnapshot(s, runtime.snapshot().session!.sessionId) || s.normalizedUrl !== description.normalizedUrl || s.identity !== description.identity
        || build?.pageContent && (!s.title.trim() || validMetadataTitle(s.title) || s.content === METADATA_CONTENT || s.searchQuery === OMITTED_QUERY)
        || build?.metadataOnly && !build?.pageContent && (!validMetadataTitle(s.title) || s.content !== ('content' in description ? description.content : ''))
        || build?.pageContent && s.isSearchResultPage && !publicSearchQuery(s.searchQuery ?? '')
        || s.searchQuery !== description.searchQuery || s.isSearchResultPage !== description.isSearchResultPage || !publicText(s.title,s.content,s.searchQuery ?? ''))) {
        await runtime.quarantine('SENSITIVE_CONTENT', t.wall);return { collecting: false };
      }
      const generation = build?.pageContent ? description.identity : s ? [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s.title+'\n'+s.content)))].map(b=>b.toString(16).padStart(2,'0')).join('') : 'extracting';
      const previous=contentGenerations.get(tabId);
      if (previous && (previous.raw !== m.raw || previous.content !== generation)) boundaries.set(tabId,t);
      contentGenerations.set(tabId,{raw:m.raw,content:generation});
      if (arrivedRevision !== navigationRevision.get(tabId)) return { collecting: runtime.collecting() };
      const state = runtime.snapshot();
      const current = state.candidates.find(c => c.id === state.tabs[tabId]);
      const gap = current?.cursor && current.cursor.epoch === t.epoch && t.mono - current.cursor.mono > MAX_OBSERVATION_GAP_MS;
      if (!source) contentFrames.delete(tabId);
      await runtime.observe({tabId,document:source ? sender.documentId+':'+source.documentId : sender.documentId,target:description.identity,generation,stamp:t,enteredAt:boundaries.get(tabId) ?? t,
        permitted,safe:true,snapshot:s,extractionFailed:m.extractionFailed === true,failureReason:['POLICY','EXTRACTION_NO_CONTENT','EXTRACTION_DOM_ERROR','EXTRACTION_RENDER_TIMEOUT','EXTRACTION_ACCESS_DENIED'].includes(m.failureReason) ? m.failureReason : undefined});
      diagnose(frameDiagnostics.has(m.diagnosticCode) ? m.diagnosticCode : gap ? 'OBSERVATION_GAP' : s ? 'OBSERVING' : ['POLICY','EXTRACTION_NO_CONTENT','EXTRACTION_DOM_ERROR','EXTRACTION_RENDER_TIMEOUT','EXTRACTION_ACCESS_DENIED'].includes(m.failureReason) ? m.failureReason : 'WAITING_CONTENT');
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
  }).then(reply).catch(error => {
    const code = error instanceof AccessError ? error.kind : error instanceof ApiError ? 'API_'+(error.status ?? error.kind) : error instanceof Error && /^(?:V2_[A-Z_]+|GOAL_UNCONFIRMED|PARTICIPANT_COLLECTION_BLOCKED)$/.test(error.message) ? error.message : 'V2_BLOCKED';
    reply(real ? { error: 'V2_BLOCKED', reason: code } : { error: 'V2_BLOCKED' });
  });
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
      await captureAllowedTabs();
    }
  });
});
chrome.windows.onFocusChanged.addListener(windowId => {
  const tab = windowTabs.get(windowId);
  event(async t => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      focused = null; focusedWindow = null; await runtime.foreground(null, t);
    } else {
      if (tab !== undefined) {
        focused = tab; focusedWindow = windowId; boundaries.set(tab, t); await runtime.foreground(tab, t);
      }
      await captureAllowedTabs();
    }
  });
});
chrome.windows.onBoundsChanged.addListener(() => event(async t => { await focus(t); }));
chrome.tabs.onRemoved.addListener(tab => event(async t => { await runtime.leave(tab, t, true); documents.delete(tab); }));
chrome.webNavigation.onCommitted.addListener(d => {
  if (d.frameId !== 0 && contentFrames.get(d.tabId)?.frameId !== d.frameId) return;
  if (d.frameId === 0) contentFrames.delete(d.tabId);
  navigationRevision.set(d.tabId, (navigationRevision.get(d.tabId) ?? 0) + 1);
  event(async t => { boundaries.set(d.tabId, t); if (d.frameId === 0) documents.set(d.tabId, d.documentId); await runtime.leave(d.tabId, t, true); });
});
const routeChanged = (d: {frameId:number;tabId:number}) => {
  if (d.frameId !== 0 && contentFrames.get(d.tabId)?.frameId !== d.frameId) return;
  if (d.frameId === 0) contentFrames.delete(d.tabId);
  navigationRevision.set(d.tabId, (navigationRevision.get(d.tabId) ?? 0) + 1);
  event(async t => {
    boundaries.set(d.tabId, t); await runtime.leave(d.tabId, t, true);
    await chrome.tabs.sendMessage(d.tabId, { type: 'v2-capture' }).catch(() => {});
  });
};
chrome.webNavigation.onHistoryStateUpdated.addListener(routeChanged);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(routeChanged);
chrome.permissions.onRemoved.addListener(() => event(t => runtime.quarantine('CONSENT_WITHDRAWN', t.wall)));
chrome.alarms.onAlarm.addListener(() => event(async () => { runtime.wake(); }));
}
void ready.then(async () => { await chrome.alarms.create('v2-recovery', { periodInMinutes: 1 }); await captureAllowedTabs(); }).catch(() => {});
}
