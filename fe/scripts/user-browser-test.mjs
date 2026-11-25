import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { ALICE, BOB, setAnalysis, startMock } from './user-mock.mjs';
import { FIXTURE_ORIGIN } from '../synthetic/catalog.ts';
import { MOCK_ORIGIN, USER_DB, USER_POPUP } from '../user/mock-config.ts';

const extension = resolve('dist-user');
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.match(manifest.name, /합성 테스트/);
assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'webNavigation', 'notifications']);
assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*']);
assert.deepEqual(manifest.content_scripts, [{ matches: ['http://127.0.0.1/__focus_synthetic__/*'], js: ['content.js'], run_at: 'document_idle' }]);
assert.equal(manifest.action.default_popup, USER_POPUP);
assert.match(manifest.content_security_policy.extension_pages, new RegExp('connect-src ' + MOCK_ORIGIN));
for (const file of [manifest.background.service_worker, USER_POPUP, 'content.js', 'popup.js']) {
  const contents = await readFile(join(extension, file), 'utf8');
  assert.ok(contents.length);
  assert.ok(!contents.includes(ALICE) && !contents.includes(BOB));
}

let mock = await startMock();
const temp = await mkdtemp(join(tmpdir(), 'focus-user-133-'));
const evidence = process.env.USER_TEST_EVIDENCE ? resolve(process.env.USER_TEST_EVIDENCE) : undefined;
if (evidence) await mkdir(evidence, { recursive: true });
const viewport = { width: 380, height: 560 };
let context, worker, id, popup, page, version;
const fixture = letter => `${FIXTURE_ORIGIN}/__focus_synthetic__/${letter}`;

async function launch(profile = 'profile', directory = extension) {
  context = await chromium.launchPersistentContext(join(temp, profile), {
    channel: 'chromium', executablePath: process.env.CHROMIUM_PATH, headless: !process.env.HEADED, viewport,
    args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`],
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
const sendFrom = (view, data) => view.evaluate(data => chrome.runtime.sendMessage(data), data);
const command = data => sendFrom(popup, data);
const state = async () => (await command({ type: 'status' })).snapshot;
const fromViewStatus = async view => (await sendFrom(view, { type: 'status' })).snapshot;
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
function holdResponse(key, accepts = () => true) {
  let hit, unblock;
  let active = false;
  const received = new Promise(resolve => { hit = resolve; });
  const held = new Promise(resolve => { unblock = resolve; });
  mock.faults[key] = (...args) => { if (accepts(...args)) { active = true; hit(); return held; } };
  return {
    get active() { return active; },
    async received() {
      let timer;
      try {
        await Promise.race([received, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`No HTTP request reached ${key}`)), 20000);
        })]);
      } finally { clearTimeout(timer); }
    },
    release() { delete mock.faults[key]; unblock(); },
  };
}
async function secondPopup() {
  const view = await context.newPage();
  await view.goto(`chrome-extension://${id}/${USER_POPUP}`);
  return view;
}
async function saved(key = 'current', store = 'v2') {
  return popup.evaluate(async ({ name, key, store }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise(resolve => {
      const tx = db.transaction(store), request = tx.objectStore(store).get(key);
      tx.oncomplete = () => { db.close(); resolve(request.result); };
    });
  }, { name: USER_DB, key, store });
}
const disk = () => saved();
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

async function verifyAnalysisAndAlerts() {
  await context.close(); context = undefined;
  await mock.close();
  mock = await startMock();
  const instrumented = join(temp, 'notifications-test');
  await cp(extension, instrumented, { recursive: true });
  const background = join(instrumented, manifest.background.service_worker);
  // Headless Chrome cannot click an OS banner. Capture the registered listener in this temporary copy.
  await writeFile(background, `
    const bridge = globalThis.notificationTest = { submitted: [] };
    const api = chrome.notifications;
    const create = api.create.bind(api);
    api.create = (id, options, callback) => create(id, options, result => {
      if (!chrome.runtime.lastError) bridge.submitted.push({ id, options });
      callback(result);
    });
    const getPermission = api.getPermissionLevel.bind(api);
    api.getPermissionLevel = callback => bridge.denied ? callback('denied') : getPermission(callback);
    for (const [event, key] of [[api.onClicked, 'click'], [api.onPermissionLevelChanged, 'permission'],
      [chrome.alarms.onAlarm, 'alarm']]) {
      const add = event.addListener.bind(event);
      event.addListener = listener => {
        const previous = bridge[key];
        bridge[key] = value => { previous?.(value); listener(value); };
        add(value => {
          if (key === 'alarm' && value.name === 'user-analysis') bridge.alarmFired = true;
          listener(value);
        });
      };
    }
  ` + await readFile(background, 'utf8'));
  id = undefined;
  await launch('alerts', instrumented);
  await openPopup();
  await login();
  await popup.getByRole('checkbox').check();
  await button('합성 동의 저장').click();
  await start('합성 Chrome 알림에서 최초 작업 목표 확인하기');
  const [first] = mock.sessions.values();
  const submitted = () => worker.evaluate(() => globalThis.notificationTest.submitted);
  const listed = () => worker.evaluate(() => chrome.notifications.getAll());
  const requests = () => mock.requests.filter(r => r.url.endsWith('/analysis-status'));
  const alarm = () => worker.evaluate(() => globalThis.notificationTest.alarm({ name: 'user-analysis' }));
  const holdAnalysis = async (label, accepts) => {
    const held = holdResponse('holdAnalysis', accepts);
    try {
      await waitFor(async () => {
        if (held.active) return true;
        await alarm();
        return false;
      }, label);
      return held;
    } catch (error) {
      held.release();
      throw error;
    }
  };
  const refresh = async (analysis, finalState) => {
    await waitFor(async () => {
      const s = await state();
      if (s.analysis === analysis && s.finalState === finalState) return true;
      await alarm();
      return false;
    }, `analysis ${analysis} ${finalState ?? ''}`);
  };
  await refresh('empty');
  for (const [state, analysis, windowIndex] of [
    ['NORMAL', 'completed', 1], ['TRANSITION', 'completed', 2], ['PENDING', 'pending', 3],
    ['FAILED', 'failed', 3], ['INVALIDATED', 'invalidated', 3], ['DRIFT', 'completed', 4],
  ]) {
    setAnalysis(first, { windowIndex, state });
    await refresh(analysis, analysis === 'completed' ? state : undefined);
    assert.equal((await submitted()).length, 0);
  }
  mock.faults.offlineAnalysis = true;
  await refresh('delayed');
  assert.equal((await state()).connection, 'unreachable');
  delete mock.faults.offlineAnalysis;
  mock.faults.analysisResponse = payload => ({ ...payload, sessionId: 'wrong' });
  await refresh('unavailable');
  delete mock.faults.analysisResponse;
  await refresh('completed', 'DRIFT');

  const oldVersion = first.currentDecision;
  setAnalysis(first, { windowIndex: 4, version: 2, state: 'DRIFT' });
  await waitFor(async () => {
    if ((await disk()).userAnalysis?.cursor.current.stateVersion === 2) return true;
    await alarm();
    return false;
  }, 'updated version committed for the same window');
  mock.faults.analysisResponse = payload => ({ ...payload, currentDecision: oldVersion, lastSuccessfulState: oldVersion });
  await refresh('unavailable');
  delete mock.faults.analysisResponse;
  await refresh('completed', 'DRIFT');

  const older = [...first.decisions.values()].find(d => d.windowIndex === 1);
  mock.faults.analysisResponse = payload => ({ ...payload, currentDecision: older, lastSuccessfulState: older });
  await restartWorker();
  await waitFor(async () => (await state()).analysis === 'unavailable', 'older window rejected after Worker restart');
  worker = context.serviceWorkers().find(value => new URL(value.url()).hostname === id) ?? worker;
  delete mock.faults.analysisResponse;
  await refresh('completed', 'DRIFT');

  const candidate = setAnalysis(first, { windowIndex: 4, version: 2, state: 'DRIFT', candidate: true });
  await worker.evaluate(() => { globalThis.notificationTest.denied = true; });
  const deniedRead = requests().length;
  await alarm();
  await waitFor(() => requests().length > deniedRead, 'status still read while notifications denied');
  assert.deepEqual(await listed(), {});
  assert.equal((await submitted()).length, 0);
  await worker.evaluate(() => { globalThis.notificationTest.denied = false; });
  await popup.close();
  page = await context.newPage();
  await context.route('https://alerts-outside.invalid/**', route => route.fulfill({ body: 'Synthetic outside page' }));
  await page.goto('https://alerts-outside.invalid/page'); await page.bringToFront();
  await worker.evaluate(() => chrome.alarms.create('user-analysis', { when: Date.now() + 200 }));
  await waitFor(() => worker.evaluate(() => globalThis.notificationTest.alarmFired), 'actual Chrome alarm event', 40000);
  await waitFor(async () => (await submitted()).length === 1, 'real Chrome notification with popup closed');
  const [{ id: notificationId, options }] = await submitted();
  assert.equal(notificationId, 'focus-drift:' + candidate.alertId);
  assert.ok((await listed())[notificationId], 'Chrome has the submitted notification');
  assert.ok(!JSON.stringify(options).includes(first.session.goalText) && !JSON.stringify(options).includes(first.session.sessionId));
  assert.equal(candidate.shownAt, null);
  const before = requests().length;
  await alarm();
  await waitFor(() => requests().length > before, 'repeated candidate polled');
  assert.equal((await submitted()).length, 1);

  await openPopup();
  mock.faults.analysisResponse = payload => ({ ...payload, currentDecision: oldVersion, lastSuccessfulState: oldVersion, alert: null });
  await refresh('unavailable');
  assert.ok((await listed())[notificationId], 'an older result does not invalidate a submitted current alert');
  delete mock.faults.analysisResponse;
  await refresh('completed', 'DRIFT');
  await restartWorker();
  await waitFor(async () => (await state()).analysis === 'completed', 'analysis restored with worker restart');
  worker = context.serviceWorkers().find(value => new URL(value.url()).hostname === id) ?? worker;
  assert.deepEqual(await submitted(), []);
  await popup.close();
  const open = context.waitForEvent('page');
  await worker.evaluate(value => globalThis.notificationTest.click(value), notificationId);
  const detail = await open;
  await detail.getByText(first.session.goalText, { exact: true }).waitFor();
  await waitFor(() => candidate.shownAt, 'visible detail records shownAt');
  assert.equal(page.url(), 'https://alerts-outside.invalid/page');
  mock.faults.dropSelection = 'always';
  await detail.getByRole('button', { name: '목표로 돌아가기' }).click();
  await detail.getByText(/서버 확인을 기다리고 있어요/).waitFor();
  await waitFor(() => candidate.selection, 'first response committed mock-side');
  assert.equal(candidate.selection.action, 'RETURN_TO_GOAL');
  const viewId = new URL(detail.url()).searchParams.get('alert');
  const selection = { type: 'alert-select', viewId, action: 'CONTINUE_BROWSING' };
  const duplicate = await sendFrom(detail, selection);
  assert.equal(duplicate.detail, undefined);
  const writes = mock.requests.filter(r => r.url.endsWith(candidate.alertId + '/responses'));
  for (const { body } of writes) assert.deepEqual(body, {
    action: 'RETURN_TO_GOAL', selectedAt: candidate.selection.selectedAt, shownAt: candidate.shownAt,
  });

  await openPopup();
  assert.deepEqual(await command(selection), { error: 'invalid' });
  const held = await holdAnalysis('session A analysis response held before END', status => status.sessionId === first.session.sessionId);
  try {
    await end();
    await start('다음 세션의 첫 분석과 알림 확인하기');
    const second = [...mock.sessions.values()].at(-1);
    const other = setAnalysis(second, { state: 'DRIFT', candidate: true });
    await refresh('completed', 'DRIFT');
    await waitFor(async () => (await submitted()).some(a => a.id.endsWith(other.alertId)), 'new session window 1 submitted');
    held.release();
    await detail.getByText('현재 확인할 수 있는 알림이 없어요.').waitFor();
    const archived = (await saved('session/' + first.session.sessionId)).notifications;
    assert.equal(archived[0].selection.action, 'RETURN_TO_GOAL');
    assert.equal(archived[0].selectionAck, undefined);
    assert.deepEqual((await disk()).notifications, []);
    delete mock.faults.dropSelection;

    const click = context.waitForEvent('page');
    mock.faults.dropShown = 'always';
    await worker.evaluate(alertId => globalThis.notificationTest.click('focus-drift:' + alertId), other.alertId);
    const secondDetail = await click;
    await secondDetail.getByText(second.session.goalText, { exact: true }).waitFor();
    await secondDetail.getByRole('button', { name: '탐색 계속하기' }).click();
    await secondDetail.getByText(/서버에 기록했어요/).waitFor();
    assert.equal(other.selection.action, 'CONTINUE_BROWSING');
    const [receipt] = (await disk()).notifications;
    assert.equal(receipt.shownAt, other.shownAt);
    assert.ok(receipt.shownAck && receipt.selectionAck);
    delete mock.faults.dropShown;
    setAnalysis(second, { windowIndex: 1, state: 'INVALIDATED' });
    await refresh('invalidated');
    await secondDetail.getByText('현재 확인할 수 있는 알림이 없어요.').waitFor();
    assert.deepEqual(await listed(), {});
    await secondDetail.close();

    const afterLogout = setAnalysis(second, { windowIndex: 2, state: 'DRIFT', candidate: true });
    const late = await holdAnalysis('analysis response held before logout');
    try {
      const count = requests().length;
      await Promise.all([alarm(), alarm(), command({ type: 'analysis-refresh' })]);
      assert.equal(requests().length, count, 'one HTTP lookup while concurrent events are pending');
      assert.equal((await command({ type: 'logout' })).snapshot.access, 'auth');
      late.release();
      await alarm();
      assert.ok(!(await submitted()).some(a => a.id.endsWith(afterLogout.alertId)));
    } finally { late.release(); }
    await login(ALICE, '작업 진행 중');
    await waitFor(async () => (await listed())['focus-drift:' + afterLogout.alertId], 'new authorization revalidates candidate');
    const account = mock.accounts.get('Bearer ' + ALICE);
    account.expiresAt = '2000-01-01T00:00:00.000Z';
    await alarm();
    await waitFor(async () => (await state()).access === 'auth' && !Object.keys(await listed()).length, 'expired authorization clears alert');
    account.expiresAt = '2099-01-01T00:00:00.000Z';
    await login(ALICE, '작업 진행 중');
    const beforeWithdrawal = setAnalysis(second, { windowIndex: 3, state: 'DRIFT', candidate: true });
    await alarm();
    await waitFor(async () => (await listed())['focus-drift:' + beforeWithdrawal.alertId], 'pending native notification before withdrawal');
    const afterWithdrawal = setAnalysis(second, { windowIndex: 4, state: 'DRIFT', candidate: true });
    const lateWithdrawal = await holdAnalysis('analysis response held before withdrawal');
    try {
      assert.equal((await command({ type: 'withdraw' })).snapshot.access, 'withdrawn');
      lateWithdrawal.release();
      await waitFor(async () => !Object.keys(await listed()).length, 'withdrawal clears active notification');
      assert.ok(!(await submitted()).some(a => a.id.endsWith(afterWithdrawal.alertId)));
    } finally { lateWithdrawal.release(); }
  } finally { held.release(); }
  await detail.close();
  console.log('PASS K: Chrome background submission, latest result, restart dedup, both choices, ACK loss and cross-session receipt isolation');
}
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
  mock.faults.startedAt = new Date(Date.now() - 10000).toISOString();
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
  const firstHandle = (await state()).sessionHandle;
  assert.match(firstHandle, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(await state()).includes((await disk()).start.idempotencyKey));
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
  assert.equal((await state()).sessionHandle, firstHandle);
  const serverReadCount = mock.accessReads;
  const checkedAt = (await state()).serverCheckedAt;
  await mock.offline();
  await popup.close(); await openPopup();
  await waitFor(async () => (await state()).connection === 'unreachable', 'reopen refresh observes offline Mock');
  for (let i = 0; i < 4; i++) assert.equal((await state()).serverCheckedAt, checkedAt);
  assert.equal(mock.accessReads, serverReadCount, 'status never probes HTTP');
  assert.equal((await command({ type: 'access' })).error, 'network');
  await popup.getByText('서버 응답 실패', { exact: true }).waitFor();
  assert.equal((await state()).lifecycle, 'ACTIVE');
  assert.equal((await state()).collecting, false);
  await screen('05-server-unreachable');
  await mock.online();
  mock.faults.accessStatus = 503;
  assert.equal((await command({ type: 'access' })).snapshot.connection, 'unreachable');
  mock.faults.accessStatus = 403;
  assert.equal((await command({ type: 'access' })).snapshot.connection, 'denied');
  delete mock.faults.accessStatus;
  assert.equal((await command({ type: 'access' })).snapshot.connection, 'verified');
  assert.equal((await state()).collecting, true);

  const logoutView = await secondPopup();
  const accessDelay = holdResponse('holdAccess');
  const logoutDelay = holdResponse('holdLogout');
  const heldAccess = command({ type: 'access' });
  await accessDelay.received();
  await popup.getByText('연결 및 동의 설정', { exact: true }).click();
  await button('접근 상태 확인').click();
  assert.equal(await button('접근 상태 확인').isDisabled(), true);
  const logoutRequests = () => mock.requests.filter(r => r.url === '/api/auth/logout').length;
  const priorLogouts = logoutRequests();
  try {
    await button('로그아웃').click();
    await logoutDelay.received();
    const duplicate = sendFrom(logoutView, { type: 'logout' });
    await waitFor(async () => (await state()).privacyPending, 'logout intent while both replies are held');
    assert.equal((await state()).collecting, false);
    assert.equal((await fromViewStatus(logoutView)).collecting, false);
    assert.equal(logoutRequests(), priorLogouts + 1);
    const lastSeq = (await disk()).nextSequence, before = writes().length;
    await popup.bringToFront();
    assert.equal((await disk()).nextSequence, lastSeq);
    assert.equal(writes().length, before);
    logoutDelay.release();
    assert.equal((await duplicate).snapshot.access, 'auth');
    accessDelay.release();
    assert.equal((await heldAccess).snapshot.collecting, false);
  } finally { logoutDelay.release(); accessDelay.release(); }
  await logoutView.close();
  await heading('합성 계정으로 시작');
  await login(ALICE, '작업 진행 중');
  await waitFor(async () => (await state()).collecting, 'same owned session after logout and reauthentication');
  const interruptedLogout = holdResponse('holdLogout');
  const interrupted = command({ type: 'logout' }).catch(() => undefined);
  try {
    await interruptedLogout.received();
    await restartWorker();
    await waitFor(async () => (await state()).access === 'auth' && !(await state()).privacyPending, 'interrupted logout recovered');
    assert.deepEqual(await popup.evaluate(() => chrome.storage.session.get()), {});
  } finally { interruptedLogout.release(); }
  await interrupted;
  await login(ALICE, '작업 진행 중');
  console.log('PASS H: server endpoint stopped, 503 and 403, verified recovery, concurrent logout and late access reply');

  await end();
  assert.equal(first.session.status, 'ENDED');
  assert.ok([...first.visits.values()].every(v => v.applied >= 1));
  console.log('PASS A/F: 3 Visit POSTs, Behavior PATCH, Popup/Worker/Chrome re-entry and verified END');

  await start(('한글 목표를 길게 입력해 표시 확인하기 ').repeat(8).slice(0, 150).trim());
  const second = lastSession();
  assert.notEqual(second.session.sessionId, first.session.sessionId);
  assert.notEqual(second.session.goalText, first.session.goalText);
  assert.equal(second.session.startedAt, first.session.startedAt);
  const oldView = await secondPopup();
  const staleStop = { type: 'stop', sessionHandle: firstHandle };
  assert.equal((await sendFrom(oldView, staleStop)).error, 'blocked');
  assert.deepEqual(await sendFrom(oldView, { type: 'stop' }), { error: 'invalid' });
  assert.deepEqual(await sendFrom(oldView, { type: 'stop', sessionHandle: 'malformed' }), { error: 'invalid' });
  assert.equal((await sendFrom(oldView, { type: 'stop', sessionHandle: '0'.repeat(64) })).error, 'blocked');
  assert.equal(second.session.status, 'ACTIVE');
  const secondHandle = (await state()).sessionHandle;
  assert.notEqual(secondHandle, firstHandle);
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
  await waitFor(async () => (await disk()).posts.entries.some(e => e.visitId === storedPost.visitId && e.phase === 'acked')
    || (await saved(second.session.sessionId + '/' + storedPost.visitId, 'v2-receipts'))?.sequence === storedPost.sequence,
  'same Visit acknowledged after Worker restart');
  assert.ok(writes().slice(beforeRetry).some(r => r.body.visitId === storedPost.visitId));
  assert.equal((await state()).sessionHandle, secondHandle);
  assert.equal((await sendFrom(oldView, staleStop)).error, 'blocked');
  const stop = { type: 'stop', sessionHandle: secondHandle };
  const endDelay = holdResponse('holdEnd');
  try {
    const results = await Promise.all([command(stop), sendFrom(oldView, stop)]);
    assert.deepEqual(results.map(r => r.error).sort(), ['blocked', undefined]);
    await endDelay.received();
    assert.equal(mock.requests.filter(r => r.url === `/api/sessions/${second.session.sessionId}/end`).length, 1);
  } finally { endDelay.release(); }
  await heading('작업 종료 완료');
  assert.equal((await sendFrom(oldView, stop)).error, 'blocked');
  await oldView.close();
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
  const pendingOwnerView = await secondPopup();
  let releaseStart;
  mock.faults.holdStart = new Promise(resolve => { releaseStart = resolve; });
  const beforePending = startRequests().length;
  const oldStart = command({ type: 'retry-start' });
  try {
    await waitFor(() => startRequests().length > beforePending, 'delayed START with existing key');
    const loggedOut = await sendFrom(pendingOwnerView, { type: 'logout' });
    assert.equal(loggedOut.snapshot.access, 'auth');
    assert.equal((await disk()).lifecycle, 'START_PENDING');
  } finally { delete mock.faults.holdStart; releaseStart(); }
  assert.equal((await oldStart).snapshot.collecting, false);
  assert.equal((await disk()).start.idempotencyKey, thirdKey);
  await pendingOwnerView.close();
  await heading('합성 계정으로 시작');
  await login(ALICE, '작업 시작 확인 중');
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
  const fourthHandle = (await state()).sessionHandle;
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
    contextId: contentWorld, expression: `Promise.all([
      chrome.runtime.sendMessage({ type: "withdraw" }),
      chrome.runtime.sendMessage({ type: "alert-select", viewId: "50000000-0000-4000-8000-000000000001", action: "RETURN_TO_GOAL" })
    ])`, awaitPromise: true, returnByValue: true,
  });
  assert.deepEqual(result.value, [{ collecting: false }, { collecting: false }]);
  assert.equal(alice.withdrawn, false);
  await target.detach();
  await popup.bringToFront();

  alice.expiresAt = new Date(0).toISOString();
  await popup.getByText('연결 및 동의 설정', { exact: true }).click();
  await button('접근 상태 확인').click();
  await heading('합성 계정으로 시작');
  assert.equal((await state()).collecting, false);
  assert.equal((await state()).connection, 'auth-required');
  await login(BOB, '합성 계정으로 시작');
  await popup.getByRole('alert').waitFor();
  assert.equal((await state()).goal, undefined);
  assert.equal((await state()).access, 'account');
  assert.equal((await state()).sessionHandle, undefined);
  assert.equal((await command({ type: 'stop', sessionHandle: fourthHandle })).error, 'blocked');
  assert.equal((await disk()).session.sessionId, fourth.session.sessionId);
  alice.expiresAt = '2099-01-01T00:00:00.000Z';
  alice.enabled = false;
  await login(ALICE, '수집 권한 확인');
  assert.equal((await state()).collecting, false);
  alice.enabled = true;
  await button('접근 상태 확인').click();
  await heading('작업 진행 중');
  await waitFor(async () => (await state()).collecting, 'same owner, same consent reconnect');
  const patchDelay = holdResponse('holdPatch');
  const queryDelay = holdResponse('holdQuery');
  const privacyView = await secondPopup();
  await page.goto(fixture('b')); await page.bringToFront();
  await waitFor(() => fourth.visits.size === 1, 'Visit sent before withdrawal');
  await popup.bringToFront();
  await patchDelay.received();
  const beforeWithdrawal = writes().length;
  const reconnect = command({ type: 'reconnect' });
  await queryDelay.received();
  try {
    mock.faults.dropWithdrawal = true;
    const withdrawal = sendFrom(privacyView, { type: 'withdraw' });
    await waitFor(async () => (await disk()).withdrawal, 'durable withdrawal while previous HTTP replies are held');
    const duplicate = sendFrom(privacyView, { type: 'withdraw' });
    assert.equal((await state()).collecting, false);
    assert.equal((await command({ type: 'stop', sessionHandle: fourthHandle })).error, 'blocked');
    await Promise.all([withdrawal, duplicate]);
    const pending = await disk();
    assert.equal(pending.withdrawal.phase, 'pending');
    assert.ok(pending.posts.entries[0]?.visit, 'withdrawal preserves the original Visit');
    assert.equal((await state()).lifecycle, 'ACTIVE');
    assert.equal(writes().length, beforeWithdrawal);
    queryDelay.release();
    patchDelay.release();
    assert.equal((await reconnect).snapshot.collecting, false);
    mock.faults.dropWithdrawal = false;
    await restartWorker();
    await waitFor(async () => (await disk()).withdrawal?.phase === 'acknowledged', 'withdrawal recovery after Worker restart');
    const withdrawals = mock.requests.filter(r => r.url === '/api/consent/withdrawals');
    assert.ok(withdrawals.length >= 2 && withdrawals.every(r => r.body.requestId === pending.withdrawal.requestId));
  } finally { queryDelay.release(); patchDelay.release(); }
  await privacyView.close();
  await heading('수집 동의 철회됨');
  assert.equal((await state()).collecting, false);
  await page.goto(fixture('c')); await page.bringToFront();
  await new Promise(resolve => setTimeout(resolve, 5500));
  assert.equal(writes().length, beforeWithdrawal);
  assert.equal((await disk()).session.sessionId, fourth.session.sessionId);
  console.log('PASS G: denied external/forged scope, expired authentication, wrong owner, server denial and withdrawal');
  console.log('PASS I: held PATCH and reconnect crossed by withdrawal; late responses, duplicate and stop fenced; withdrawal restored');

  await context.close(); context = undefined;
  await launch('withdraw-start'); await openPopup();
  await login(BOB);
  await popup.getByRole('checkbox').check();
  await button('합성 동의 저장').click();
  await heading('오늘의 작업 목표');
  let releaseNew;
  mock.faults.holdStart = new Promise(resolve => { releaseNew = resolve; });
  const lastCount = startRequests().length;
  const pendingStart = command({ type: 'start', goal: '시작 응답 지연 중 동의 철회 검증' });
  try {
    await waitFor(() => startRequests().length > lastCount, 'server accepted the new start before withdrawal');
    const pending = await disk();
    assert.equal(pending.lifecycle, 'START_PENDING');
    assert.equal((await command({ type: 'withdraw' })).snapshot.access, 'withdrawn');
    assert.equal((await disk()).start.idempotencyKey, pending.start.idempotencyKey);
  } finally { delete mock.faults.holdStart; releaseNew(); }
  await pendingStart;
  assert.equal((await disk()).lifecycle, 'START_PENDING');
  assert.equal((await disk()).session, undefined);
  assert.equal((await state()).collecting, false);
  console.log('PASS J: start response arriving after withdrawal cannot activate a session');
  const posts = writes().filter(r => r.method === 'POST').length;
  const patches = writes().filter(r => r.method === 'PATCH').length;
  await verifyAnalysisAndAlerts();
  console.log(JSON.stringify({ result: 'PASS', chrome: version, scenarios: 11, firstSessionVisits: first.visits.size, posts, patches }));
} finally {
  await context?.close();
  await mock.close();
  await rm(temp, { recursive: true, force: true });
}
