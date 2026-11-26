import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { catalog, FIXTURE_ORIGIN, fixtureId } from '../synthetic/catalog.ts';
import { FIXED_INTERVAL_MS, MOCK_ORIGIN, syntheticAlertMode } from '../user/mock-config.ts';
import { normalizeGoal, validGoal } from '../src/shared/goal.ts';

export const ALICE = 'synthetic-user-133-alice-for-local-tests-0123456789';
export const BOB = 'synthetic-user-133-bob-for-local-tests-012345678901';
const policy = {
  policyId: 'SYNTHETIC-USER-133', policyVersion: '1', scope: 'SESSION_COLLECTION', status: 'SYNTHETIC',
  purpose: '합성 탐색 검증', collectionItems: '합성 문서와 행동', useScope: '로컬 테스트',
  retentionPolicyRef: null, approvalRef: null, effectiveAt: '2026-01-01T00:00:00.000Z',
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const counters = ['activeDurationMs', 'tabSwitchCount', 'behaviorVersion'];
const behavior = body => Object.fromEntries(counters.map(key => [key, body[key]]));
const validBehavior = body => body && counters.every(key => Number.isSafeInteger(body[key]) && body[key] >= 0);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const millis = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function setAnalysis(record, { windowIndex = 1, state = 'PENDING', version = 1, candidate = false } = {}) {
  const window = record.windows.get(windowIndex) ?? { windowId: randomUUID(), analysisId: randomUUID(), windowIndex };
  record.windows.set(windowIndex, window);
  const completed = ['NORMAL', 'TRANSITION', 'DRIFT'].includes(state);
  const key = window.windowId + ':' + version;
  const now = new Date(record.now()).toISOString();
  let decision = completed ? record.decisions.get(key) : undefined;
  if (!decision) {
    decision = {
      ...window, decisionStatus: completed ? 'COMPLETED' : state, stateVersion: completed ? version : null,
      finalState: completed ? state : null, judgedAt: completed ? now : null,
      errorCode: state === 'FAILED' ? 'AI_UNAVAILABLE' : state === 'INVALIDATED' ? 'PRIVACY_RETRACTED' : null,
    };
    if (completed) record.decisions.set(key, decision);
  }
  candidate &&= record.mode === 'AI';
  let alert = candidate && decision.finalState === 'DRIFT'
    ? [...record.alerts.values()].find(a => a.windowId === window.windowId && a.stateVersion === version && !a.invalidatedAt) : undefined;
  if (!alert && candidate && decision.finalState === 'DRIFT') {
    alert = {
      ...window, alertType: 'AI', stateVersion: version, alertId: randomUUID(), sessionId: record.session.sessionId,
      goalText: record.session.goalText, message: 'Synthetic drift', createdAt: now, shownAt: null,
    };
    record.alerts.set(alert.alertId, alert);
  }
  for (const a of record.alerts.values()) if (a.alertType === 'AI' && a !== alert && !a.shownAt) a.invalidatedAt ??= now;
  record.currentDecision = decision;
  if (completed) record.lastSuccessfulState = decision;
  return alert;
}

function alertResponse({ alertId, sessionId, alertType, analysisId, windowId, windowIndex, stateVersion, goalText, message, createdAt, shownAt }, v2 = false) {
  return { alertId, sessionId, alertType, analysisId, windowIndex, goalText, message, createdAt, shownAt,
    ...(v2 || windowId !== null ? { windowId } : {}), ...(v2 || stateVersion !== null ? { stateVersion } : {}) };
}

const latestFixedSlot = record => Math.floor((record.now() - Date.parse(record.session.startedAt)) / FIXED_INTERVAL_MS);
const currentFixed = record => record.fixedSlots.get(latestFixedSlot(record));

function analysisStatus(record) {
  const d = record.currentDecision;
  const candidate = record.mode === 'FIXED_INTERVAL' ? currentFixed(record)
    : d?.finalState === 'DRIFT'
      ? [...record.alerts.values()].find(a => !a.shownAt && !a.invalidatedAt && a.windowId === d.windowId && a.stateVersion === d.stateVersion) : undefined;
  return { apiContractVersion: 2, sessionId: record.session.sessionId, sessionStatus: record.session.status,
    currentDecision: d, lastSuccessfulState: record.lastSuccessfulState,
    alert: record.session.status === 'ACTIVE' && candidate && !candidate.shownAt ? alertResponse(candidate, true) : null,
    latestAnalysis: null, latestCompletedAnalysis: null };
}

async function json(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16000) throw new Error('Invalid request size');
  }
  return raw ? JSON.parse(raw) : undefined;
}
function listen(server, origin) {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(port), hostname, resolve);
  });
}
function close(server) {
  return new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  });
}

export async function startMock({ automaticAnalysis = false, onReceipt, alertMode } = {}) {
  const mode = syntheticAlertMode(alertMode);
  const accounts = new Map([ALICE, BOB].map(token => [`Bearer ${token}`, {
    participantId: randomUUID(), expiresAt: '2099-01-01T00:00:00.000Z', enabled: true, consentId: null, withdrawn: false,
  }]));
  const sessions = new Map(), starts = new Map(), requests = [];
  let accessReads = 0;
  const faults = {};
  const now = () => faults.now ?? Date.now();
  const fixture = createServer((req, res) => {
    const id = fixtureId(FIXTURE_ORIGIN + req.url);
    if (!id || req.url !== `/__focus_synthetic__/${id}`) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html data-focus-synthetic="catalog-v1"><head><title>Synthetic fixture ${id}</title></head><body><main><article>${catalog[id]}</article><nav>${
      ['a', 'b', 'c', 'd'].map(key => `<a href="/__focus_synthetic__/${key}">Fixture ${key}</a>`).join(' · ')
    }</nav></main></body></html>`);
  });
  const api = createServer(async (req, res) => {
    const send = (status, value) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
    const fail = (status, code = 'INVALID_REQUEST') => send(status, { code });
    const account = accounts.get(req.headers.authorization);
    const { method } = req;
    const { pathname: url, searchParams: query } = new URL(req.url, MOCK_ORIGIN);
    if (!account || Date.parse(account.expiresAt) <= now()) return fail(401);
    let body;
    try { body = await json(req); } catch { return fail(400); }
    const owner = account.participantId;
    if (method === 'GET' && url === '/api/auth/me') {
      accessReads++;
      const identity = { participantId: owner, expiresAt: account.expiresAt };
      if (faults.holdAccess) await faults.holdAccess();
      if (faults.accessStatus) return fail(faults.accessStatus);
      return send(200, identity);
    }
    if (method === 'POST' && url === '/api/auth/logout') {
      requests.push({ method, url, owner });
      if (faults.holdLogout) await faults.holdLogout();
      return res.writeHead(204).end();
    }
    if (url === '/api/consent' && ['GET', 'POST'].includes(method)) {
      if (method === 'POST') {
        if (account.withdrawn || !uuid.test(body?.requestId) || body.policyId !== policy.policyId || body.policyVersion !== policy.policyVersion || body.accepted !== true) return fail(403);
        account.consentId ??= randomUUID();
      }
      return send(200, {
        participantId: owner, policy, consentId: account.withdrawn ? null : account.consentId,
        consentValid: !!account.consentId && !account.withdrawn, collectionEnabled: !!account.consentId && account.enabled && !account.withdrawn,
        withdrawn: account.withdrawn,
      });
    }
    if (method === 'POST' && url === '/api/consent/withdrawals') {
      if (!uuid.test(body?.requestId)) return fail(400);
      if (account.withdrawal && account.withdrawal.requestId !== body.requestId) return fail(409);
      account.withdrawn = true;
      const affected = [...sessions.values()].filter(s => s.owner === owner);
      affected.forEach(s => { s.quarantined = true; });
      account.withdrawal ??= {
        requestId: body.requestId, withdrawalId: randomUUID(), status: 'QUARANTINED',
        sessions: affected.map(s => ({ sessionId: s.session.sessionId, status: 'INVENTORIED' })), targets: [], unmet: ['EXTERNAL_EVIDENCE_MISSING'],
      };
      requests.push({ method, url, body, owner });
      if (faults.dropWithdrawal) return req.socket.destroy();
      return send(202, account.withdrawal);
    }

    const key = req.headers['idempotency-key'];
    const entry = { method, url, body, key, owner };
    requests.push(entry);
    if (method === 'POST' && url === '/api/sessions') {
      if (!account.enabled || !account.consentId || account.withdrawn) return fail(403);
      if (!uuid.test(key) || body?.collectionSpecVersion !== '2.0' || typeof body.goalText !== 'string'
        || !validGoal(body.goalText) || normalizeGoal(body.goalText) !== body.goalText) return fail(400);
      const scopedKey = owner + ':' + key;
      let record = starts.get(scopedKey);
      if (record && record.session.goalText !== body.goalText) return fail(422);
      if (!record) {
        if ([...sessions.values()].some(s => s.owner === owner && s.session.status === 'ACTIVE')) return fail(409);
        const session = { ...body, sessionId: randomUUID(), startedAt: faults.startedAt ?? new Date(now()).toISOString(), endedAt: null, status: 'ACTIVE' };
        record = { owner, consentId: account.consentId, session, visits: new Map(), retractions: new Map(), quarantined: false,
          windows: new Map(), decisions: new Map(), alerts: new Map(), fixedSlots: new Map(), currentDecision: null, lastSuccessfulState: null, mode, now };
        sessions.set(session.sessionId, record);
        starts.set(scopedKey, record);
      }
      if (faults.holdStart) await faults.holdStart;
      if (faults.dropStart) return req.socket.destroy();
      return send(201, faults.startResponse ? faults.startResponse(record.session) : record.session);
    }

    const route = /^\/api\/sessions\/([a-f0-9-]+)(\/.*)?$/.exec(url);
    const record = route && sessions.get(route[1]);
    if (!record || record.owner !== owner) return fail(404, 'SESSION_NOT_FOUND');
    const suffix = route[2];
    const { session, visits } = record;
    if (method === 'POST' && suffix === '/visit-retractions/quarantine') {
      record.quarantined = true;
      return send(200, { sessionId: session.sessionId, privacyStatus: 'QUARANTINED' });
    }
    if (method === 'POST' && suffix === '/visit-retractions') {
      const previous = record.retractions.get(body?.retractionId);
      if (!uuid.test(body?.retractionId) || !uuid.test(body.visitId) || previous && !equal(previous, body)) return fail(400);
      record.quarantined = true;
      record.retractions.set(body.retractionId, body);
      return send(previous ? 200 : 202, { retractionId: body.retractionId, visitId: body.visitId, status: 'QUARANTINED', invalidatedWindowIds: [] });
    }
    if (method === 'POST' && suffix === '/visit-retractions/close' && record.quarantined && !account.withdrawn) {
      session.status = 'ENDED'; session.endedAt ??= new Date(now()).toISOString();
      return send(200, { sessionId: session.sessionId, status: 'ENDED', privacyStatus: 'QUARANTINED' });
    }
    if (account.withdrawn || record.quarantined) return fail(409, 'PRIVACY_RETRACTED');
    if (!account.enabled || record.consentId !== account.consentId) return fail(403);
    if (method === 'GET' && suffix === '/analysis-status') {
      const payload = analysisStatus(record);
      if (faults.holdAnalysis) await faults.holdAnalysis(payload);
      if (faults.offlineAnalysis) return fail(503);
      if (faults.dropAnalysis) { faults.dropAnalysis = false; return req.socket.destroy(); }
      return send(200, faults.analysisResponse ? faults.analysisResponse(payload) : payload);
    }
    if (method === 'POST' && suffix === '/alerts/fixed-interval') {
      if (mode !== 'FIXED_INTERVAL' || faults.disableFixed) return fail(409, 'FIXED_INTERVAL_DISABLED');
      if (session.status !== 'ACTIVE') return fail(409, 'SESSION_ENDED');
      const slot = latestFixedSlot(record);
      const existing = record.fixedSlots.get(slot);
      if (slot < 1 || existing?.shownAt) return fail(409, 'ALERT_INTERVAL_NOT_REACHED');
      const alert = existing ?? {
        alertId: randomUUID(), sessionId: session.sessionId, alertType: mode, analysisId: null, windowIndex: null,
        windowId: null, stateVersion: null, goalText: session.goalText, message: '작업 목표를 다시 확인해 보세요.',
        createdAt: new Date(now()).toISOString(), shownAt: null,
      };
      record.fixedSlots.set(slot, alert);
      record.alerts.set(alert.alertId, alert);
      if (faults.holdFixed) await faults.holdFixed({ slot, alert });
      if (faults.dropFixed) {
        if (faults.dropFixed !== 'always') faults.dropFixed = false;
        return req.socket.destroy();
      }
      const response = alertResponse(alert);
      return send(existing ? 200 : 201, faults.fixedResponse ? faults.fixedResponse(response) : response);
    }
    if (method === 'GET' && suffix === '/alerts') {
      const page = Number(query.get('page') ?? 0), size = Number(query.get('size') ?? 20);
      if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > 100) return fail(400);
      const all = [...record.alerts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.alertId.localeCompare(a.alertId));
      const items = all.slice(page * size, (page + 1) * size).map(alert => ({
        ...alertResponse(alert), ...(alert.invalidatedAt ? { invalidatedAt: alert.invalidatedAt } : {}), response: alert.selection ?? null,
      }));
      const payload = { items, page, size, totalElements: all.length, hasNext: (page + 1) * size < all.length };
      return send(200, faults.historyResponse ? faults.historyResponse(payload, session) : payload);
    }
    const alertRoute = suffix && /^\/alerts\/([a-f0-9-]+)\/(shown|responses)$/.exec(suffix);
    if (alertRoute && (alertRoute[2] === 'shown' && method === 'PATCH' || alertRoute[2] === 'responses' && method === 'POST')) {
      const alert = record.alerts.get(alertRoute[1]);
      if (!alert) return fail(404, 'ALERT_NOT_FOUND');
      const selecting = method === 'POST';
      const faultContext = { session, alert, kind: alertRoute[2], body };
      const beforeWrite = await faults.receiptRequest?.(faultContext);
      if (beforeWrite?.drop) return req.socket.destroy();
      if (beforeWrite?.status) {
        if (beforeWrite.retryAfter) res.setHeader('Retry-After', beforeWrite.retryAfter);
        return fail(beforeWrite.status, beforeWrite.code);
      }
      if (account.withdrawn || record.quarantined) return fail(409, 'PRIVACY_RETRACTED');
      if (!account.enabled || record.consentId !== account.consentId) return fail(403);
      const shownAt = body?.shownAt, selectedAt = body?.selectedAt;
      if (!millis(shownAt) || Object.keys(body).length !== (selecting ? 3 : 1)
        || selecting && (!millis(selectedAt) || selectedAt < shownAt || Date.parse(selectedAt) > now() + 5000
          || !['RETURN_TO_GOAL', 'CONTINUE_BROWSING'].includes(body.action))) return fail(400);
      if (alert.shownAt && alert.shownAt !== shownAt) return fail(409, 'ALERT_SHOWN_AT_CONFLICT');
      if (!alert.shownAt && (Date.parse(shownAt) < Date.parse(alert.createdAt) - 5000 || Date.parse(shownAt) > now() + 5000
        || alert.invalidatedAt && shownAt >= alert.invalidatedAt || session.endedAt && shownAt > session.endedAt)) return fail(409, 'ALERT_NOT_DISPLAYABLE');
      const existing = alert.selection;
      if (selecting && existing && (existing.action !== body.action || existing.selectedAt !== selectedAt)) return fail(409, 'RESPONSE_ALREADY_RECORDED');
      alert.shownAt = shownAt;
      if (selecting) alert.selection ??= { feedbackId: randomUUID(), alertId: alert.alertId, action: body.action, selectedAt };
      const fault = selecting ? 'Selection' : 'Shown';
      if (faults['hold' + fault]) await faults['hold' + fault](faultContext);
      if (faults['drop' + fault]) {
        if (faults['drop' + fault] !== 'always') faults['drop' + fault] = false;
        return req.socket.destroy();
      }
      const ack = selecting ? alert.selection : alertResponse(alert);
      const httpStatus = selecting && !existing ? 201 : 200;
      onReceipt?.({ method, kind: alertRoute[2], httpStatus, action: selecting ? body.action : undefined });
      return send(httpStatus, faults.notificationResponse ? faults.notificationResponse(ack, faultContext) : ack);
    }
    if (method === 'GET' && !suffix) {
      if (faults.holdQuery) await faults.holdQuery();
      if (faults.offlineQuery) return fail(503);
      return send(200, faults.queryResponse ? faults.queryResponse(session) : session);
    }
    if (method === 'POST' && suffix === '/end') {
      if (!body || Object.keys(body).length) return fail(400);
      session.status = 'ENDED'; session.endedAt ??= new Date(now()).toISOString();
      if (faults.holdEnd) await faults.holdEnd();
      if (faults.dropEnd) return req.socket.destroy();
      return send(200, session);
    }
    if (method === 'POST' && suffix === '/visits') {
      const id = fixtureId(body?.normalizedUrl);
      if (!id || body.normalizedUrl !== `${FIXTURE_ORIGIN}/__focus_synthetic__/${id}`
        || body.domain !== '127.0.0.1' || body.searchQuery !== null || body.isSearchResultPage !== false
        || body.content !== catalog[id] || body.title !== `Synthetic fixture ${id}` || body.extractionStatus !== 'SUCCESS'
        || !uuid.test(body.visitId) || !uuid.test(body.browserTabKey) || !validBehavior(body) || body.activeDurationMs < 5000
        || !Number.isSafeInteger(body.sequence) || body.sequence < 1) return fail(400);
      const previous = visits.get(body.visitId);
      if (previous && !equal(previous.original, body)) return fail(409, 'VISIT_ID_CONFLICT');
      if (!previous && session.status === 'ENDED') return fail(409, 'SESSION_ENDED');
      if (!previous && [...visits.values()].some(v => v.original.sequence >= body.sequence)) return fail(409, 'VISIT_SEQUENCE_OUT_OF_ORDER');
      const visit = previous ?? { original: body, behavior: behavior(body), updatedAt: null, applied: 0 };
      visits.set(body.visitId, visit);
      const state = ['PENDING', 'NORMAL', 'TRANSITION', 'DRIFT'][visits.size - 1];
      if (automaticAnalysis && !previous && state) setAnalysis(record, { windowIndex: visits.size, state, candidate: state === 'DRIFT' });
      if (faults.offlinePost) return fail(503);
      if (faults.dropPost) { faults.dropPost = false; return req.socket.destroy(); }
      return send(previous ? 200 : 201, { ...visit.original, ...visit.behavior, sessionId: session.sessionId, updatedAt: visit.updatedAt });
    }
    const patch = suffix && /^\/visits\/([a-f0-9-]+)\/behavior$/.exec(suffix);
    if (method === 'PATCH' && patch) {
      const visitId = patch[1], visit = visits.get(visitId);
      if (!visit) return fail(404, 'VISIT_NOT_FOUND');
      if (!validBehavior(body)) return fail(400);
      if (body.behaviorVersion === visit.behavior.behaviorVersion && !equal(behavior(body), visit.behavior)) return fail(409, 'BEHAVIOR_VERSION_CONFLICT');
      const applied = body.behaviorVersion > visit.behavior.behaviorVersion;
      if (applied) {
        if (session.status === 'ENDED') return fail(409, 'SESSION_ENDED');
        if (body.activeDurationMs < visit.behavior.activeDurationMs || body.tabSwitchCount < visit.behavior.tabSwitchCount) return fail(409, 'BEHAVIOR_COUNTER_DECREASED');
        visit.behavior = behavior(body); visit.updatedAt = new Date().toISOString(); visit.applied++;
      }
      if (faults.holdPatch) await faults.holdPatch();
      if (faults.dropPatch) { faults.dropPatch = false; return req.socket.destroy(); }
      return send(200, { ...visit.behavior, visitId, applied, updatedAt: visit.updatedAt });
    }
    return fail(404);
  });
  try {
    await listen(fixture, FIXTURE_ORIGIN);
    await listen(api, MOCK_ORIGIN);
  } catch (error) { await Promise.all([close(fixture), close(api)]); throw error; }
  return { accounts, sessions, requests, faults, get accessReads() { return accessReads; }, offline: () => close(api), online: () => listen(api, MOCK_ORIGIN), close: () => Promise.all([close(fixture), close(api)]) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mock = await startMock({
    automaticAnalysis: true,
    alertMode: process.env.USER_ALERT_MODE,
    onReceipt: ({ method, kind, httpStatus, action }) =>
      console.log(`${method} /${kind} ${httpStatus}${action ? ' ' + action : ''}`),
  });
  console.log(`합성 API ${MOCK_ORIGIN}\n합성 문서 ${FIXTURE_ORIGIN}/__focus_synthetic__/a`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void mock.close(); });
}
