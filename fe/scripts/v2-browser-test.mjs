import { chromium } from 'playwright';
import { build } from 'vite';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const real = process.env.FE91_REAL_BE_URL;
if (real && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(real)) throw new Error('Loopback synthetic BE only');
const root = await mkdtemp(join(tmpdir(), 'focus91-'));
const evidence = process.env.FE91_EVIDENCE || '/private/tmp/focus91-mock-evidence';
await mkdir(evidence, { recursive: true });
const body = id => `Synthetic fixture ${id}. This public example describes TypeScript transactions and durable page observations. No participant information is present.`;
const fixture = createServer((req, res) => {
  const id = req.url.split('/').at(-1);
  if (!['a', 'b', 'c', 'd'].includes(id)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><html data-focus-synthetic="catalog-v1"><title>Synthetic fixture ${id}</title><body><article>${body(id)}</article></body></html>`);
});
const syntheticToken = process.env.FE95_SYNTHETIC_TOKEN || 'synthetic-only-alice-credential-95-01234567890123456789';
const participantId = '95000000-0000-4000-8000-000000000001', consentId = '95000000-0000-4000-8000-000000000003';
const policy = { policyId: 'SYNTHETIC-CHROME-95', policyVersion: '1', scope: 'SESSION_COLLECTION', purpose: 'Synthetic Chrome catalog tests only', collectionItems: 'Closed catalog pages and behavior fixtures', useScope: 'Synthetic tests; no participant data', retentionPolicyRef: null, approvalRef: null, status: 'SYNTHETIC', effectiveAt: '1970-01-01T00:00:00.000Z' };
let consentValid = false, withdrawn = false, withdrawal;
const records = new Map(), sessions = new Map(), retractions = new Map();
let blockedRetractionId, allowRetractionAck = false;
const alertId = randomUUID(), windowId = randomUUID(), analysisId = randomUUID(); let shownAt = null, allowAlert = false; let calls = 0, dropFirst = true;
const mock = createServer(async (req, res) => {
  calls++;
  let raw = ''; for await (const chunk of req) raw += chunk;
  const request = raw ? JSON.parse(raw) : null;
  const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (real) {
    const response = await fetch(`${real}${req.url}`, { method: req.method, headers: { 'Content-Type': 'application/json', ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}), ...(req.headers['idempotency-key'] ? { 'Idempotency-Key': req.headers['idempotency-key'] } : {}) }, body: raw || undefined });
    const value = await response.json();
    const name = /\/behavior$/.test(req.url) ? 'patch' : /\/visits$/.test(req.url) && req.method === 'POST' ? 'post' : null;
    if (name) {
      await writeFile(join(evidence, `${name}.json`), JSON.stringify(request));
      await writeFile(join(evidence, `${name}-ack.json`), JSON.stringify(value));
    }
    send(response.status, value); return;
  }
  if (req.headers.authorization !== `Bearer ${syntheticToken}`) { send(401, { code: 'INVALID_REQUEST' }); return; }
  if (req.url === '/api/auth/me') { send(200, { participantId, expiresAt: '2099-01-01T00:00:00.000Z' }); return; }
  if (req.url === '/api/consent') {
    if (req.method === 'POST') { assert.equal(request.accepted, true); assert.equal(request.policyId, policy.policyId); assert.ok(!withdrawn); consentValid = true; }
    send(200, { participantId, policy, consentId: consentValid && !withdrawn ? consentId : null, consentValid: consentValid && !withdrawn, collectionEnabled: consentValid && !withdrawn, withdrawn }); return;
  }
  if (req.url === '/api/consent/withdrawals') {
    withdrawn = true; withdrawal ??= { requestId: request.requestId, withdrawalId: request.requestId, status: 'QUARANTINED', sessions: [...sessions.values()].map(s => ({ sessionId: s.sessionId, status: 'INVENTORIED' })), targets: [], unmet: ['EXTERNAL_EVIDENCE_MISSING'] };
    send(202, withdrawal); return;
  }
  if (req.url.startsWith('/api/consent/withdrawals/')) { send(200, withdrawal); return; }
  if (req.url === '/api/auth/logout') { send(204, {}); return; }
  if (req.url === '/api/sessions') {
    assert.ok(consentValid && !withdrawn);
    assert.equal(request.collectionSpecVersion, '2.0'); const key = req.headers['idempotency-key']; assert.ok(key);
    if (!sessions.has(key)) sessions.set(key, { ...request, sessionId: randomUUID(), startedAt: new Date().toISOString(), endedAt: null, status: 'ACTIVE' });
    send(201, sessions.get(key)); return;
  }
  const path = req.url.split('/'), session = [...sessions.values()].find(s => s.sessionId === path[3]); assert.ok(session);
  if (path[4] === 'visit-retractions') {
    const previous = retractions.get(request.retractionId);
    if (previous) assert.deepEqual(request, previous); else retractions.set(request.retractionId, request);
    blockedRetractionId ??= request.retractionId;
    if (!allowRetractionAck && request.retractionId === blockedRetractionId) { send(202, {}); return; }
    send(previous ? 200 : 202, { retractionId: request.retractionId, visitId: request.visitId, status: 'QUARANTINED', invalidatedWindowIds: [] }); return;
  }
  if (path[4] === 'visits' && req.method === 'POST') {
    const previous = records.get(request.visitId), v = { ...request, sessionId: session.sessionId, updatedAt: null };
    await writeFile(join(evidence, 'post.json'), JSON.stringify(request));
    if (previous) {
      for (const k of ['visitId', 'sequence', 'title', 'content', 'visitedAt', 'searchQuery', 'extractionStatus']) assert.deepEqual(request[k], previous[k]);
    } else records.set(request.visitId, v);
    if (dropFirst) { dropFirst = false; req.socket.destroy(); return; }
    await writeFile(join(evidence, 'post-ack.json'), JSON.stringify(previous ?? v)); send(previous ? 200 : 201, previous ?? v); return;
  }
  if (path[6] === 'behavior') {
    const v = records.get(path[5]); assert.ok(v); Object.assign(v, request, { updatedAt: new Date().toISOString() });
    await writeFile(join(evidence, 'patch.json'), JSON.stringify(request));
    const ack = { ...request, visitId: path[5], applied: true, updatedAt: v.updatedAt };
    await writeFile(join(evidence, 'patch-ack.json'), JSON.stringify(ack)); send(200, ack); return;
  }
  if (path[4] === 'analysis-status') {
    const currentDecision = { windowId, windowIndex: 1, stateVersion: 1, analysisId, decisionStatus: 'COMPLETED', finalState: 'DRIFT', judgedAt: new Date().toISOString(), errorCode: null };
    send(200, { apiContractVersion: 2, sessionId: session.sessionId, sessionStatus: session.status, currentDecision, lastSuccessfulState: null,
      alert: shownAt || !allowAlert ? null : { alertId, sessionId: session.sessionId, windowId, stateVersion: 1, analysisId, alertType: 'AI', createdAt: session.startedAt, shownAt: null, goalText: session.goalText, message: 'Synthetic reminder' } }); return;
  }
  if (path[4] === 'alerts') {
    assert.equal(path[5], alertId); shownAt ??= request.shownAt;
    if (path[6] === 'shown') send(200, { alertId, shownAt });
    else send(200, { alertId, feedbackId: randomUUID(), action: request.action, selectedAt: request.selectedAt });
    return;
  }
  if (path[4] === 'end') { session.status = 'ENDED'; session.endedAt ??= new Date().toISOString(); send(200, session); return; }
  send(200, session);
});
let context;
async function launch() {
  return chromium.launchPersistentContext(join(root, 'profile'), { channel: 'chromium', headless: !process.env.HEADED,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [`--disable-extensions-except=${join(root, 'extension')}`, `--load-extension=${join(root, 'extension')}`] });
}
try {
  await new Promise((r, reject) => { fixture.once('error', reject); fixture.listen(8911, '127.0.0.1', r); });
  if (mock) await new Promise(r => mock.listen(0, '127.0.0.1', r));
  process.env.VITE_API_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  await build({ configFile: resolve('vite.synthetic.config.ts'), mode: 'synthetic-test', build: { outDir: join(root, 'extension') } });
  await build({ configFile: resolve('vite.synthetic.content.config.ts'), build: { outDir: join(root, 'extension') } });
  context = await launch();
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2];
  let harness = await context.newPage(); await harness.goto(`chrome-extension://${id}/synthetic/harness.html`);
  const command = type => harness.evaluate(type => chrome.runtime.sendMessage({ type: `v2-${type}` }), type);
  const read = () => command('status');
  async function waitFor(test, label, timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const s = await read(); if (test(s)) return s;
      assert.equal(s?.storageFailed, false, `storage failed: ${label}`); if (s?.error) throw new Error(s.error);
      await new Promise(r => setTimeout(r, 200));
    }
    const s = await read();
    throw new Error(`${label}: ${JSON.stringify({ lifecycle: s.lifecycle, failed: s.storageFailed, candidates: s.candidates?.map(c => ({ duration: c.behavior.activeDurationMs, post: !!c.post, closed: c.closed })), phases: s.posts?.entries.map(e => e.phase), quarantine: s.quarantine, retractions: s.retractions, foreground: s.foreground })}`);
  }
  assert.equal((await command('start')).error, 'V2_BLOCKED', 'authentication and consent must precede start');
  async function login() {
    await harness.getByLabel('합성 테스트 자격정보').fill(syntheticToken);
    await harness.getByRole('button', { name: '인증 / 계정 전환', exact: true }).click();
    await harness.getByText(/인증됨/).waitFor({ timeout: 10000 });
  }
  await login();
  assert.equal((await command('start')).error, 'V2_BLOCKED', 'server consent must precede start');
  await harness.getByRole('checkbox').check();
  await harness.getByRole('button', { name: '합성 동의 기록 저장', exact: true }).click();
  await harness.getByText(/서버 동의 유효/).waitFor({ timeout: 10000 });
  await harness.screenshot({ path: join(evidence, 'consent.png'), fullPage: true });
  await command('start');
  const page = await context.newPage(); await page.goto('http://127.0.0.1:8911/__focus_synthetic__/a'); await page.bringToFront();
  const first = await waitFor(s => s.posts?.entries.some(e => e.phase === 'acked'), '5s POST + retry');
  assert.equal(first.collectionSpecVersion, '2.0'); assert.ok(first.posts.entries[0].visit.activeDurationMs >= 5000);
  const firstId = first.posts.entries[0].visitId;
  const cdp = await context.newCDPSession(harness);
  await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); await cdp.detach();
  await waitFor(s => s.posts?.entries.some(e => e.visitId === firstId && e.phase === 'acked'), 'explicit Service Worker restart');
  await context.close(); context = await launch();
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  harness = await context.newPage(); await harness.goto(`chrome-extension://${id}/synthetic/harness.html`);
  assert.equal((await read()).collectionAllowed, false, 'browser restart requires fresh credential verification');
  await login();
  const recovered = await read();
  if (!recovered.posts.entries.some(e => e.visitId === firstId && e.phase === 'acked')) {
    const receipt = await harness.evaluate(async key => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('focus-recovery'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const tx = db.transaction('v2-receipts'), get = tx.objectStore('v2-receipts').get(key);
      return new Promise(resolve => { tx.oncomplete = () => { db.close(); resolve(get.result); }; });
    }, `${first.session.sessionId}/${firstId}`);
    assert.ok(receipt, 'ACK must survive in hot queue or atomic compaction receipt');
    assert.equal(receipt.sequence, first.posts.entries[0].sequence);
    assert.equal(receipt.originalHash, createHash('sha256').update(JSON.stringify(first.posts.entries[0].visit)).digest('hex'));
    assert.ok(receipt.behaviorAck.behaviorVersion >= receipt.postAck.behaviorVersion);
    assert.ok(recovered.nextSequence > receipt.sequence);
  }
  const second = await context.newPage(); await second.goto('http://127.0.0.1:8911/__focus_synthetic__/b'); await second.bringToFront();
  await waitFor(s => s.nextSequence >= 3, 'new post after restart');
  await second.reload();
  await waitFor(s => s.nextSequence >= 4, 'reload fresh document');
  await second.evaluate(id => { history.pushState({}, '', `/__focus_synthetic__/${id}`); setTimeout(() => { document.querySelector('article').textContent = `Synthetic fixture ${id}. This public example describes TypeScript transactions and durable page observations. No participant information is present.`; }, 1500); }, 'c');
  await waitFor(s => s.nextSequence >= 5 && !s.quarantine, 'SPA delayed content');
  await second.evaluate(() => { document.querySelector('article').textContent = 'Synthetic fixture d. This public example describes TypeScript transactions and durable page observations. No participant information is present.'; });
  await waitFor(s => s.nextSequence >= 6 && !s.quarantine, 'same URL major content generation');
  if (!real) {
    allowAlert = true;
    await harness.bringToFront();
    assert.ok((await command('alert'))?.alertId, 'current DRIFT candidate available before rendering');
    await harness.getByRole('alert').waitFor({ state: 'visible', timeout: 10000 });
    await harness.getByRole('button', { name: 'RETURN_TO_GOAL', exact: true }).click();
    await waitFor(s => s.notifications.some(r => r.shownAck && r.selectionAck), 'actual rendered reminder + shown/selection ACK');
  }
  if (real) {
    const local = await read(), current = local.session.sessionId, expectedWindowIndex = local.nextSequence - 3;
    let completed = false;
    for (let i = 0; i < 100; i++) {
      const r = await fetch(`${real}/api/sessions/${current}/analysis-status`, { headers: { Authorization: `Bearer ${syntheticToken}` } });
      const state = await r.json(); if (state.currentDecision?.windowIndex === expectedWindowIndex && state.currentDecision.decisionStatus === 'COMPLETED') { completed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(completed, 'actual Chrome visits reach completed FastAPI analysis and BE decision');
  }
  assert.equal((await command('stop')).ok, true);
  const ended = await waitFor(s => s.lifecycle === 'ENDED', 'POST/PATCH drain and END'); assert.equal(ended.end.ack.status, 'ENDED');
  const raw = await harness.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('focus-recovery'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction('v2'), r = tx.objectStore('v2').get('current');
    return new Promise(resolve => { tx.oncomplete = () => { db.close(); resolve(r.result); }; });
  });
  assert.equal(raw.lifecycle, 'ENDED'); assert.equal(raw.end.ack.sessionId, ended.session.sessionId);
  if (real) {
    const base = `${real}/api/sessions/${ended.session.sessionId}`;
    for (const [path, name] of [['visits', 'visits'], ['analysis-status', 'status']]) {
      const r = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${syntheticToken}` } }); assert.equal(r.status, 200);
      let value = await r.json();
      if (name === 'status') {
        for (let i = 0; i < 100 && value.currentDecision?.decisionStatus !== 'COMPLETED'; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const fresh = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${syntheticToken}` } });
          assert.equal(fresh.status, 200); value = await fresh.json();
        }
        assert.equal(value.currentDecision?.decisionStatus, 'COMPLETED', 'final behavior decision completes after END');
      }
      await writeFile(join(evidence, `${name}.json`), JSON.stringify(value));
      if (name === 'status') { assert.equal(value.sessionStatus, 'ENDED'); assert.equal(value.alert, null); }
    }
    await writeFile(join(evidence, 'local-ended.json'), JSON.stringify(raw));
  }
  if (!real) {
    await command('quarantine');
    const held = await waitFor(s => s.retractions?.some(e => e.errorCode === 'DELIVERY_UNCONFIRMED'), 'durable retraction ACK loss');
    const frozen = held.retractions.map(e => e.request);
    const stop = await context.newCDPSession(harness); await stop.send('ServiceWorker.enable'); await stop.send('ServiceWorker.stopAllWorkers'); await stop.detach();
    await waitFor(s => s.quarantine?.status === 'RETRACTION_REQUIRED' && s.retractions?.length === frozen.length, 'retraction Service Worker recovery');
    await context.close(); context = await launch();
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    harness = await context.newPage(); await harness.goto(`chrome-extension://${id}/synthetic/harness.html`);
    assert.deepEqual((await read()).retractions.map(e => e.request), frozen);
    await login();
    allowRetractionAck = true; await command('retry');
    const recovered = await waitFor(s => s.retractions.every(e => e.phase === 'acknowledged'), 'retraction browser recovery and same-ID replay');
    assert.equal(recovered.quarantine.status, 'RETRACTION_REQUIRED'); assert.equal(recovered.alertsSuppressed, true);
    await writeFile(join(evidence, 'retractions.json'), JSON.stringify({ frozen, entries: recovered.retractions, quarantine: recovered.quarantine }));
  }
  {
    await harness.getByRole('button', { name: '전체 동의 철회 · 수집 즉시 중지', exact: true }).click();
    const whole = await waitFor(s => s.withdrawal?.phase === 'acknowledged', 'whole consent withdrawal via actual rendered UI');
    assert.equal(whole.withdrawal.ack.status, 'QUARANTINED'); assert.equal(whole.collectionAllowed, false);
    assert.equal((await command('access')).access.withdrawn, true);
    await harness.screenshot({ path: join(evidence, 'withdrawal.png'), fullPage: true });
    await writeFile(join(evidence, 'auth-consent.json'), JSON.stringify({ authenticationRequired: true, explicitConsentUI: true, workerReverified: true, browserReauthentication: true, wholeWithdrawal: whole.withdrawal, owner: whole.owner, noProductionCollection: true }));
  }
  console.log(JSON.stringify({ authenticationAndConsentUI: true, browserReauthentication: true, retractionBrowserRecovery: !real, result: 'PASS', mode: real ? 'actual-BE-HTTP' : 'mock-HTTP', sequence: ended.nextSequence - 1,
    lifecycle: raw.lifecycle, restart: true, reload: true, spaDelayedContent: true, sameUrlContentChange: true, serviceWorkerRestart: true, realIndexedDB: true, httpCalls: calls, notificationUI: !real }));
} finally {
  await context?.close(); await new Promise(r => fixture.close(r)); if (mock) await new Promise(r => mock.close(r)); await rm(root, { recursive: true, force: true });
}
