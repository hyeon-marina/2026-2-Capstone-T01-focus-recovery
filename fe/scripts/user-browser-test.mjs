import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { ALICE, BOB, startMock } from './user-mock.mjs';
import { FIXTURE_ORIGIN } from '../synthetic/catalog.ts';
import { MOCK_ORIGIN, USER_DB, USER_POPUP } from '../user/mock-config.ts';

const extension = resolve('dist-user');
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.match(manifest.name, /합성 테스트/);
assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'webNavigation']);
assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*']);
assert.deepEqual(manifest.content_scripts, [{ matches: ['http://127.0.0.1/__focus_synthetic__/*'], js: ['content.js'], run_at: 'document_idle' }]);
assert.equal(manifest.action.default_popup, USER_POPUP);
assert.match(manifest.content_security_policy.extension_pages, new RegExp('connect-src ' + MOCK_ORIGIN));
for (const file of [manifest.background.service_worker, USER_POPUP, 'content.js', 'popup.js']) {
  const contents = await readFile(join(extension, file), 'utf8');
  assert.ok(contents.length);
  assert.ok(!contents.includes(ALICE) && !contents.includes(BOB));
}

const mock = await startMock();
const temp = await mkdtemp(join(tmpdir(), 'focus-user-133-'));
const evidence = process.env.USER_TEST_EVIDENCE ? resolve(process.env.USER_TEST_EVIDENCE) : undefined;
if (evidence) await mkdir(evidence, { recursive: true });
const viewport = { width: 380, height: 560 };
let context, worker, id, popup, page, version;
const fixture = letter => `${FIXTURE_ORIGIN}/__focus_synthetic__/${letter}`;

async function launch() {
  context = await chromium.launchPersistentContext(join(temp, 'profile'), {
    channel: 'chromium', executablePath: process.env.CHROMIUM_PATH, headless: !process.env.HEADED, viewport,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  if (id) assert.equal(extensionId, id);
  id = extensionId;
  version = await worker.evaluate(() => navigator.userAgent);
}
async function openPopup() {
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/${USER_POPUP}`);
}
const button = name => popup.getByRole('button', { name, exact: true });
const heading = name => popup.getByRole('heading', { name, exact: true }).waitFor();
const command = data => popup.evaluate(data => chrome.runtime.sendMessage(data), data);
const state = async () => (await command({ type: 'status' })).snapshot;
async function waitFor(check, reason, timeout = 22000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`${reason}: ${JSON.stringify(await state().catch(() => null))}`);
}
async function screen(name) {
  await popup.bringToFront();
  assert.ok(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'popup horizontal overflow');
  if (evidence) await popup.locator('main').screenshot({ path: join(evidence, name + '.png') });
}
async function login(token = ALICE, expectHeading = '합성 수집 동의') {
  await popup.getByLabel('합성 테스트 자격정보').fill(token);
  await button('인증하기').click();
  await heading(expectHeading);
}
async function restartWorker() {
  const cdp = await context.newCDPSession(popup);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
}
async function disk() {
  return popup.evaluate(async name => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise(resolve => {
      const tx = db.transaction('v2'), request = tx.objectStore('v2').get('current');
      tx.oncomplete = () => { db.close(); resolve(request.result); };
    });
  }, USER_DB);
}
async function end() {
  await button('작업 종료').click();
  await heading('작업 종료 완료');
}
async function start(goal) {
  if (await button('새 작업 준비').isVisible()) await button('새 작업 준비').click();
  await popup.getByLabel('최초 작업 목표').fill(goal);
  await button('작업 시작').click();
  await heading('작업 진행 중');
  return mock.sessions.size;
}
const startRequests = () => mock.requests.filter(r => r.url === '/api/sessions');
const writes = () => mock.requests.filter(r => /\/visits/.test(r.url));
const lastSession = () => [...mock.sessions.values()].at(-1);
const alice = mock.accounts.get('Bearer ' + ALICE);

try {
  await launch();
  await openPopup();
  await heading('합성 계정으로 시작');
  await screen('01-access');
  assert.equal((await command({ type: 'start', goal: 'Blocked unauthenticated goal' })).error, 'auth');
  assert.deepEqual(await command({ type: 'start', goal: 123 }), { error: 'invalid' });
  await login();
  assert.equal((await command({ type: 'start', goal: 'Blocked incomplete consent' })).error, 'consent');
  await popup.getByRole('checkbox').check();
  await button('합성 동의 저장').click();
  await heading('오늘의 작업 목표');
  assert.equal(await button('작업 시작').isDisabled(), true);
  const goal = 'React 상태 관리 방식에 대한 자료 조사하기';
  await popup.getByLabel('최초 작업 목표').fill('  ' + goal + '  ');
  await popup.getByLabel('최초 작업 목표').focus();
  await popup.keyboard.press('Tab');
  assert.equal(await button('작업 시작').evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle !== 'none'), true);
  await screen('02-goal');
  let release;
  mock.faults.holdStart = new Promise(resolve => { release = resolve; });
  await button('작업 시작').click();
  try {
    await heading('작업 시작 확인 중');
    assert.equal((await state()).lifecycle, 'START_PENDING');
    assert.equal((await disk()).start.goalText, goal);
    assert.equal(await button('시작 요청 확인 중…').isDisabled(), true);
    await screen('03-starting');
  } finally { release(); delete mock.faults.holdStart; }
  await heading('작업 진행 중');
  const first = lastSession();
  assert.equal(first.session.goalText, goal);
  assert.equal(first.session.collectionSpecVersion, '2.0');
  assert.equal(startRequests().length, 1);
  await screen('04-active');
  await popup.close();

  page = await context.newPage();
  for (const [i, letter] of ['a', 'b', 'c'].entries()) {
    await page.goto(fixture(letter)); await page.bringToFront();
    await waitFor(() => first.visits.size === i + 1, `real fixture visit ${letter}`);
  }
  await openPopup();
  await heading('작업 진행 중');
  assert.equal((await state()).goal, goal);
  assert.equal((await disk()).session.sessionId, first.session.sessionId);
  assert.deepEqual([...first.visits.values()].map(v => v.original.sequence), [1, 2, 3]);
  assert.ok([...first.visits.values()].every(v => v.original.activeDurationMs >= 5000));
  assert.ok(!JSON.stringify(await state()).includes('Synthetic fixture'));
  assert.ok(!JSON.stringify(await state()).includes(first.session.sessionId));
  assert.deepEqual(await popup.evaluate(async () => (await indexedDB.databases()).map(db => db.name)), [USER_DB]);
  assert.ok(!JSON.stringify(await disk()).includes(ALICE));
  assert.ok(!JSON.stringify(await popup.evaluate(async () => [await chrome.storage.local.get(), await chrome.storage.sync.get()])).includes(ALICE));

  await restartWorker();
  await waitFor(async () => (await state()).collecting, 'Worker active restore');
  assert.equal((await disk()).session.sessionId, first.session.sessionId);
  assert.ok(mock.requests.some(r => r.method === 'GET' && r.url === `/api/sessions/${first.session.sessionId}`));
  await context.close(); context = undefined;
  await launch(); await openPopup();
  await heading('합성 계정으로 시작');
  assert.equal((await state()).goal, undefined);
  assert.deepEqual(await popup.evaluate(() => chrome.storage.session.get()), {});
  await login(ALICE, '작업 진행 중');
  await waitFor(async () => (await state()).collecting, 'Chrome active restore');
  assert.equal((await disk()).session.sessionId, first.session.sessionId);
  await end();
  assert.equal(first.session.status, 'ENDED');
  assert.ok([...first.visits.values()].every(v => v.applied >= 1));
  console.log('PASS A/F: 3 Visit POSTs, Behavior PATCH, Popup/Worker/Chrome re-entry and verified END');

  await start(('한글 목표를 길게 입력해 표시 확인하기 ').repeat(8).slice(0, 150).trim());
  const second = lastSession();
  assert.notEqual(second.session.sessionId, first.session.sessionId);
  assert.notEqual(second.session.goalText, first.session.goalText);
  await screen('04-active-long-goal');
  assert.equal(second.visits.size, 0);
  mock.faults.dropPost = true;
  mock.faults.offlinePost = true;
  page = await context.newPage();
  await page.goto(fixture('d')); await page.bringToFront();
  await waitFor(() => second.visits.size === 1, 'stored but unconfirmed POST');
  await popup.bringToFront();
  await waitFor(async () => (await disk()).posts.entries.some(e => e.phase === 'retry-wait' || e.phase === 'failed'), 'disk retains incomplete POST');
  await button('미전송 기록 다시 보내기').waitFor();
  await screen('05-recovery');
  const storedPost = (await disk()).posts.entries[0];
  mock.faults.offlinePost = false;
  mock.faults.dropPost = true;
  mock.faults.dropPatch = true;
  const beforeRetry = writes().length;
  await restartWorker();
  await waitFor(async () => (await disk()).posts.entries[0]?.phase === 'acked', 'same Visit acknowledged after Worker restart');
  assert.ok(writes().slice(beforeRetry).some(r => r.body.visitId === storedPost.visitId));
  await end();
  assert.equal(second.visits.size, 1);
  const [sole] = second.visits.values();
  const patchCalls = writes().filter(r => r.method === 'PATCH' && r.url.includes(storedPost.visitId));
  assert.ok(patchCalls.length >= 2);
  assert.deepEqual(patchCalls.at(-1).body, patchCalls.at(-2).body);
  assert.equal(sole.applied, 1);
  console.log('PASS B/D: distinct sessions, persisted POST and PATCH replay without duplicate writes');

  await button('새 작업 준비').click();
  const thirdGoal = '서비스 워커 재시작 뒤 시작 요청 검증';
  await popup.getByLabel('최초 작업 목표').fill(thirdGoal);
  mock.faults.dropStart = true;
  await button('작업 시작').click();
  await popup.getByRole('alert').waitFor();
  await heading('작업 시작 확인 중');
  mock.faults.dropStart = false;
  const third = lastSession();
  const thirdKey = startRequests().at(-1).key;
  const count = mock.sessions.size;
  await restartWorker();
  await popup.close();
  await openPopup();
  await heading('작업 시작 확인 중');
  assert.equal((await command({ type: 'start', goal: ' a different new goal ' })).error, 'blocked');
  mock.faults.startResponse = session => ({ ...session, collectionSpecVersion: '1.0' });
  assert.equal((await command({ type: 'retry-start' })).error, 'response');
  mock.faults.startResponse = session => ({ ...session, goalText: 'Mismatched session goal' });
  assert.equal((await command({ type: 'retry-start' })).error, 'response');
  delete mock.faults.startResponse;
  await button('같은 시작 요청 다시 확인').click();
  await heading('작업 진행 중');
  assert.equal(mock.sessions.size, count);
  assert.ok(startRequests().slice(-4).every(r => r.key === thirdKey && r.body.goalText === thirdGoal));
  assert.equal((await disk()).session.sessionId, third.session.sessionId);
  console.log('PASS C: START_PENDING after response loss, rejects invalid ACKs, same idempotency key after restart');

  mock.faults.dropEnd = true;
  mock.faults.offlineQuery = true;
  await button('작업 종료').click();
  await heading('작업 종료 확인 중');
  await waitFor(() => third.session.status === 'ENDED', 'server applied END before client ACK');
  await screen('06-ending');
  assert.equal((await command({ type: 'start', goal: 'Do not replace pending data' })).error, 'blocked');
  const priorEnds = mock.requests.filter(r => r.url.endsWith('/end')).length;
  await restartWorker();
  await waitFor(async () => (await state()).lifecycle === 'END_PENDING', 'persisted END_PENDING');
  mock.faults.offlineQuery = false;
  mock.faults.dropEnd = false;
  await button('전송 및 종료 다시 확인').click();
  await heading('작업 종료 완료');
  assert.equal(mock.requests.filter(r => r.url.endsWith('/end')).length, priorEnds);
  assert.ok(mock.requests.some(r => r.method === 'GET' && r.url === `/api/sessions/${third.session.sessionId}`));
  await screen('07-ended');
  await start('인증 만료와 권한 차단 검증하기');
  const fourth = lastSession();
  console.log('PASS E: server committed END without response, Worker queried existing session and allowed next goal');

  const beforePrivacy = writes().length;
  const manager = await context.newPage();
  await manager.goto('chrome://extensions/');
  const siteAccess = access => manager.evaluate(({ id, access }) => chrome.developerPrivate.updateExtensionConfiguration({
    extensionId: id, hostAccess: chrome.developerPrivate.HostAccess[access],
  }), { id, access });
  await siteAccess('ON_CLICK');
  await waitFor(async () => !(await state()).permission && !(await state()).collecting, 'Chrome host permission withheld');
  await page.goto(fixture('a')); await page.bringToFront();
  await new Promise(resolve => setTimeout(resolve, 5500));
  assert.equal(writes().length, beforePrivacy);
  await siteAccess('ON_ALL_SITES');
  await manager.close();
  assert.equal((await command({ type: 'access' })).error, undefined);
  await waitFor(async () => (await state()).collecting, 'Chrome host permission restored');
  const untrusted = await context.newPage();
  await context.route('https://synthetic-outside.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<article>Outside synthetic fixture</article>' }));
  await untrusted.goto('https://synthetic-outside.invalid/page');
  assert.equal(await untrusted.evaluate(() => typeof globalThis.chrome?.runtime?.sendMessage), 'undefined');
  assert.equal(await worker.evaluate(() => chrome.permissions.contains({ origins: ['https://synthetic-outside.invalid/*'] })), false);
  await assert.rejects(worker.evaluate(() => fetch('https://synthetic-outside.invalid/api/auth/me')));
  await untrusted.close();
  await page.goto(fixture('a') + '#outside-runtime-boundary'); await page.bringToFront();
  await new Promise(resolve => setTimeout(resolve, 5500));
  assert.equal(writes().length, beforePrivacy);
  // Isolated-world script uses the exact MessageSender that a registered content script receives.
  await page.goto(fixture('a'));
  const target = await context.newCDPSession(page);
  const { frameTree } = await target.send('Page.getFrameTree');
  const contentWorld = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No content script JavaScript context')), 5000);
    target.on('Runtime.executionContextCreated', ({ context: ctx }) => {
      if (ctx.auxData?.frameId === frameTree.frame.id && ctx.origin === `chrome-extension://${id}`) {
        clearTimeout(timer); resolve(ctx.id);
      }
    });
    void target.send('Runtime.enable');
  });
  const { result } = await target.send('Runtime.evaluate', {
    contextId: contentWorld, expression: 'chrome.runtime.sendMessage({ type: "withdraw" })', awaitPromise: true, returnByValue: true,
  });
  assert.deepEqual(result.value, { collecting: false });
  assert.equal(alice.withdrawn, false);
  await target.detach();
  await popup.bringToFront();

  alice.expiresAt = new Date(0).toISOString();
  await popup.getByText('연결 및 동의 설정', { exact: true }).click();
  await button('접근 상태 확인').click();
  await heading('합성 계정으로 시작');
  assert.equal((await state()).collecting, false);
  await login(BOB, '합성 계정으로 시작');
  await popup.getByRole('alert').waitFor();
  assert.equal((await state()).goal, undefined);
  assert.equal((await state()).access, 'account');
  assert.equal((await disk()).session.sessionId, fourth.session.sessionId);
  alice.expiresAt = '2099-01-01T00:00:00.000Z';
  alice.enabled = false;
  await login(ALICE, '수집 권한 확인');
  assert.equal((await state()).collecting, false);
  alice.enabled = true;
  await button('접근 상태 확인').click();
  await heading('작업 진행 중');
  await waitFor(async () => (await state()).collecting, 'same owner, same consent reconnect');
  popup.once('dialog', dialog => void dialog.accept());
  await button('합성 동의 철회').click();
  await heading('수집 동의 철회됨');
  assert.equal((await state()).collecting, false);
  assert.equal((await disk()).withdrawal.phase, 'acknowledged');
  await page.goto(fixture('b')); await page.bringToFront();
  await new Promise(resolve => setTimeout(resolve, 5500));
  assert.equal(writes().length, beforePrivacy);
  assert.equal((await disk()).session.sessionId, fourth.session.sessionId);
  console.log('PASS G: denied external/forged scope, expired authentication, wrong owner, server denial and withdrawal');
  console.log(JSON.stringify({ result: 'PASS', chrome: version, scenarios: 7, firstSessionVisits: first.visits.size,
    posts: writes().filter(r => r.method === 'POST').length, patches: writes().filter(r => r.method === 'PATCH').length }));
} finally {
  await context?.close();
  await mock.close();
  await rm(temp, { recursive: true, force: true });
}
