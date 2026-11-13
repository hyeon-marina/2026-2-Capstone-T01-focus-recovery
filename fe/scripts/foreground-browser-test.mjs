// Isolated synthetic Spring/MySQL fixture only. Never run against an operational profile.
import { chromium } from 'playwright';
import { build } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

process.umask(0o077);
const evidence = resolve(process.env.FOREGROUND_FIXTURE_DIR || '');
assert.ok(evidence.startsWith('/private/tmp/'));
assert.match(await readFile(join(evidence, 'SYNTHETIC_TEST_ONLY'), 'utf8'), /^NO_OPERATIONAL/);
const config = JSON.parse(await readFile(join(evidence, 'fixture.json'), 'utf8'));
assert.equal(config.kind, 'SYNTHETIC-101');
assert.equal(config.database, 'focus101_synthetic');
assert.match(config.container, /^focus101-foreground-/);
assert.ok([33111, 33112, 33113].includes(config.dbPort));
assert.ok([18101, 18102, 18103].includes(config.serverPort));
const server = `http://127.0.0.1:${config.serverPort}`;
const policy = JSON.parse(await readFile(config.policyFile, 'utf8'));
assert.equal(policy.status, 'SYNTHETIC');
assert.equal(policy.policyId, 'SYNTHETIC-101');
assert.ok(policy.pageContent && policy.maskContacts && policy.metadataOnly);
const operator = JSON.parse(await readFile(join(evidence, 'operator.json'), 'utf8')).credential;
async function api(token, path, method = 'GET', body) {
  assert.ok(!path.includes('export'));
  const r = await fetch(server + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(r.status, 200, `Synthetic API status: ${method} ${path.split('?')[0]}`);
  return r.status === 204 ? undefined : r.json();
}
let owner;
try { owner = JSON.parse(await readFile(join(evidence, 'foreground-participant.json'), 'utf8')); }
catch (e) {
  if (e.code !== 'ENOENT') throw e;
  await api(operator, '/api/collection/admin/plan/initialize', 'POST', {});
  const participant = await api(operator, '/api/collection/admin/participants', 'POST', { identityReferenceHash: createHash('sha256').update(randomUUID()).digest('hex'), evidenceRef: 'synthetic-foreground-only' });
  const issued = await api(operator, `/api/collection/admin/participants/${participant.participantId}/credentials`, 'POST', { expiresAt: new Date(Date.now() + 3600000).toISOString(), evidenceRef: 'synthetic-foreground-only' });
  owner = { participantId: participant.participantId, credential: issued.credential };
  await writeFile(join(evidence, 'foreground-participant.json'), JSON.stringify(owner), { mode: 0o600 });
  const plan = await api(operator, '/api/collection/admin/plan');
  plan.slots = plan.slots.map(s => s.slotId === 'A' ? { slotId: 'A', participantId: owner.participantId } : s);
  plan.goals = plan.goals.map(g => ({ goalId: g.goalId, description: 'Synthetic public software documentation research', status: 'CONFIRMED', evidenceRef: 'synthetic-foreground-only' }));
  await api(operator, '/api/collection/admin/plan', 'PUT', plan);
}
const run = join(evidence, 'browser-' + randomUUID().slice(0, 8));
await mkdir(run, { mode: 0o700 });
const extension = join(run, 'extension');
process.env.VITE_API_BASE_URL = server;
process.env.COLLECTION_SITE_POLICY_FILE = config.policyFile;
await build({ configFile: resolve('vite.real.config.ts'), mode: 'controlled-web', build: { outDir: extension } });
await build({ configFile: resolve('vite.real.content.config.ts'), build: { outDir: extension } });
const executablePath = process.env.CHROMIUM_PATH;
assert.ok(executablePath?.includes('Google Chrome for Testing'));
let context, harness;
const checks = [];
const pass = name => { checks.push(name); console.log('PASS SYNTHETIC: ' + name); };
const send = (action, extra = {}) => harness.evaluate(({ action, extra }) => chrome.runtime.sendMessage({ type: 'v2-' + action, ...extra }), { action, extra });
const delay = ms => new Promise(r => setTimeout(r, ms));
async function wait(check, name, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const s = await send('status');
    assert.equal(s.storageFailed, false, 'Synthetic storage error');
    if (check(s)) return s;
    await delay(200);
  }
  const status = await send('status');
  console.log('SYNTHETIC timeout state: ' + JSON.stringify(status));
  console.log('SYNTHETIC focus: ' + JSON.stringify(await harness.evaluate(async () => ({ windows: (await chrome.windows.getAll()).map(w => ({ focused: w.focused, state: w.state })), tabs: (await chrome.tabs.query({})).map(t => ({ id: t.id, active: t.active })) }))));
  console.log('SYNTHETIC observations: ' + JSON.stringify(await harness.evaluate(() => globalThis.__foregroundCounts)));
  console.log('SYNTHETIC document flags: ' + JSON.stringify(await Promise.all(context.pages().filter(p => p.url().startsWith('https://fixture.example.org/')).map(p => p.evaluate(() => ({ visible: document.visibilityState, focused: document.hasFocus(), articleLength: document.querySelector('main,article')?.textContent.length }))))));
  throw new Error('Synthetic check timed out: ' + name);
}
const text = 'SYNTHETIC ONLY. Public documentation about deployment, domain configuration and secure transport. '.repeat(3);
function html(kind) {
  const body = kind === 'focus' ? `<form role="search"><input type="search" value="UNSUBMITTED_SEARCH" autofocus></form><article>${text}</article>`
    : kind === 'unsafe' ? '<article>Bearer synthetic-fixture-only</article>'
    : kind === 'password' ? '<input type="password"><article>' + text + '</article>'
    : kind === 'payment' ? '<input autocomplete="cc-number"><article>' + text + '</article>'
    : kind === 'loading' ? '<main></main>'
    : `<form role="search"><input type="search" value="UNSUBMITTED_SEARCH"></form><article>${text}desk@example.org 010-0000-0000</article>`;
  return `<!doctype html><title>Synthetic public documentation</title><body>${body}</body>`;
}
const fixture = (kind, n = 1) => `https://fixture.example.org/public/${kind}/${n}`;
async function open(kind, n = 1) {
  const page = await context.newPage();
  await page.goto(fixture(kind, n));
  return page;
}
try {
  context = await chromium.launchPersistentContext(join(run, 'chrome-profile'), { executablePath, channel: 'chromium', headless: true, viewport: { width: 1200, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin === server) return route.continue();
    if (u.origin === 'https://fixture.example.org') return route.fulfill({ contentType: 'text/html', body: html(u.pathname.split('/')[2]) });
    return route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2];
  harness = await context.newPage();
  await harness.goto(`chrome-extension://${id}/participant/index.html`);
  await harness.evaluate(() => {
    globalThis.__foregroundCounts = {};
    chrome.runtime.onMessage.addListener((m, sender) => {
      if (!sender.tab || !['v2-context', 'v2-observation', 'v2-leave'].includes(m.type)) return;
      const key = sender.tab.id + ':' + m.type;
      const counts = globalThis.__foregroundCounts;
      counts[key] = { count: (counts[key]?.count || 0) + 1, safe: m.safe, visible: m.visible, snapshot: !!m.snapshot, failureReason: m.failureReason };
    });
  });
  const login = await send('login', { token: owner.credential });
  assert.ok(!login.error, 'Synthetic login failed');
  const consent = await send('agree', { policyId: 'SYNTHETIC-101', policyVersion: '1' });
  assert.ok(!consent.error, 'Synthetic-only consent failed');
  const assignments = await send('assignments');
  const previous = await send('progress');
  const unused = assignments.filter(a => !previous.attempts.some(t => t.plannedSessionId === a.plannedSessionId));
  assert.ok(unused.length >= 4);
  // This tab retains an editable focus, but must never affect a foreground session.
  const background = await open('focus');
  await background.locator('input').focus();
  let page = await open('safe');
  await page.bringToFront();
  const started = await send('start', { plannedSessionId: unused[0].plannedSessionId });
  assert.ok(!started.error, `Synthetic start: ${started.error || 'none'} / ${started.reason || 'none'}`);
  await wait(s => s.lifecycle === 'ACTIVE' && !s.quarantined, 'foreground startup');
  await delay(1500);
  assert.equal((await send('status')).quarantined, false);
  pass('startup ignores background editable focus');
  await wait(s => s.validVisits >= 1, 'first measured foreground Visit');
  // Content scripts loaded before authorization must resume on tab activation.
  const cold = await open('safe', 2);
  await page.bringToFront();
  await delay(500);
  await cold.bringToFront();
  await wait(s => s.validVisits >= 2, 'activation resumes recurring pulses');
  pass('activation and return collect measured foreground Visits');
  // Loading in a background tab contributes neither a Visit nor a quarantine.
  const loading = await open('loading');
  await cold.bringToFront();
  await loading.evaluate(t => { document.querySelector('main').textContent = t; }, text);
  const count = (await send('status')).validVisits;
  await delay(6000);
  assert.equal((await send('status')).validVisits, count);
  await loading.bringToFront();
  await wait(s => s.validVisits >= 3, 'loaded document return');
  pass('background loading waits for foreground dwell');
  // Real history API event, not a fabricated observation or Visit.
  await loading.evaluate(() => history.pushState({}, '', '/public/spa/2'));
  await wait(s => s.validVisits >= 4, 'SPA identity');
  pass('SPA navigation starts a new measured identity');
  for (let n = 5; n <= 10; n++) {
    await loading.goto(fixture('safe', n));
    await loading.bringToFront();
    await wait(s => s.validVisits >= n, 'measured Visit ' + n);
  }
  await send('stop');
  await wait(s => s.lifecycle === 'ENDED' && s.endPhase === 'acked' && s.pending === 0, 'normal END ACK');
  let progress;
  for (let n = 0; n < 50; n++) {
    progress = await send('progress');
    if (progress.attempts.some(a => a.rawStatus === 'RAW_COLLECTED')) break;
    await send('retry'); await delay(200);
  }
  const collected = progress.attempts.find(a => a.rawStatus === 'RAW_COLLECTED');
  assert.ok(collected && collected.quality.validVisits >= 10);
  assert.equal(collected.source, 'SYNTHETIC');
  assert.equal(collected.analysisState, 'NOT_RUN');
  assert.equal(progress.completed, 0);
  assert.equal(progress.raw.syntheticCompleted, 1);
  pass('ten real-dwell synthetic Visits / END ACK / RAW_COLLECTED / no participant completion');
  // Nonempty quarantine verifies actual HTTP retraction, not only local state.
  await harness.bringToFront();
  assert.ok(!(await send('start', { plannedSessionId: unused[1].plannedSessionId })).error);
  await loading.goto(fixture('safe', 11)); await loading.bringToFront();
  await wait(s => s.validVisits >= 1, 'pre-quarantine safe Visit');
  await loading.goto(fixture('unsafe')); await loading.bringToFront();
  await wait(s => s.quarantined, 'actual high-risk text');
  await loading.goto(fixture('safe', 12));
  await delay(6000);
  assert.equal((await send('status')).quarantined, true);
  await send('stop');
  await wait(s => s.lifecycle === 'ENDED' && s.quarantineClose === 'acknowledged' && s.pending === 0, 'quarantine close ACK');
  pass('sensitive text quarantines / stops collection / retracts / closes safely');
  // Focus without typing remains deliberately blocked. Do not weaken this guard.
  await harness.bringToFront();
  assert.ok(!(await send('start', { plannedSessionId: unused[2].plannedSessionId })).error);
  await background.bringToFront(); await background.locator('input').focus();
  await wait(s => s.quarantined, 'editable focus without typing');
  await send('stop');
  await wait(s => s.lifecycle === 'ENDED' && s.quarantineClose === 'acknowledged', 'zero Visit quarantine close');
  pass('focused search without typing retains quarantine and zero-Visit close');
  const stored = await harness.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const q = indexedDB.open('focus-recovery'); q.onsuccess = () => resolve(q.result); q.onerror = reject; });
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('v2'); const q = tx.objectStore('v2').getAll();
      tx.oncomplete = () => { const values = q.result; db.close(); resolve({ records: values.length, ended: values.filter(v => v.lifecycle === 'ENDED').length, quarantined: values.filter(v => !!v.quarantine).length, version: db.version }); };
      tx.onerror = reject;
    });
  });
  assert.ok(stored.records >= 3 && stored.ended >= 3 && stored.quarantined >= 2);
  assert.equal(stored.version, 2);
  const final = await send('progress');
  assert.equal(final.actualSessions, 0);
  assert.equal(final.attempts.length, 3 + previous.attempts.length);
  assert.ok(final.attempts.every(a => a.source === 'SYNTHETIC'));
  pass('IndexedDB v2 archives and attempts preserved / all synthetic');
  await writeFile(join(evidence, 'browser-result.json'), JSON.stringify({ result: 'PASS', checks, stored, syntheticOnly: true, collectedVisits: collected.quality.validVisits, actualSessions: final.actualSessions, exportCalled: false }, null, 2), { mode: 0o600 });
} finally {
  if (harness && !harness.isClosed()) {
    await send('stop').catch(() => {});
    await wait(s => ['IDLE', 'ENDED'].includes(s.lifecycle) && s.pending === 0, 'synthetic cleanup').catch(() => {});
  }
  await context?.close();
}
