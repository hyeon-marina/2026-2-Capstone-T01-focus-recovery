import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { build } from 'vite';
import { readDurable } from './durable-test-utils.mjs';

const bodyA = 'JWT 문서에서 토큰 검증 방법과 Spring Security 인증 처리 절차를 설명합니다. 안전한 공개 기술 문서의 의미 있는 본문입니다.';
const bodyB = '우주 탐사선은 먼 행성의 대기와 암석을 연구합니다. 천문학자들이 수집한 관측 자료로 태양계 형성 과정을 분석하는 과학 기사입니다.';
const sessions = new Map();
const apiRequests = [];
const savedVisits = new Map();
const visitRequests = [];
let loseVisitResponse = true;
let loseResponse = true;
const server = createServer(async (req, res) => {
  const endPath = req.url.match(/^\/api\/sessions\/([a-f0-9-]+)\/end$/);
  if (endPath && req.method === 'POST') {
    const session = [...sessions.values()].find(s => s.sessionId === endPath[1]);
    assert.ok(session);
    session.status = 'ENDED'; session.endedAt ??= new Date().toISOString();
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(session)); return;
  }
  const behaviorPath = req.url.match(/^\/api\/sessions\/([a-f0-9-]+)\/visits\/([a-f0-9-]+)\/behavior$/);
  if (behaviorPath && req.method === 'PATCH') {
    let body = ''; for await (const chunk of req) body += chunk;
    const behavior = JSON.parse(body), visit = savedVisits.get(behaviorPath[2]); assert.ok(visit);
    Object.assign(visit, behavior, { updatedAt: new Date().toISOString() });
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ...behavior, visitId: visit.visitId, updatedAt: visit.updatedAt, applied: true })); return;
  }
  const visitPath = req.url.match(/^\/api\/sessions\/([a-f0-9-]+)\/visits$/);
  if (visitPath && req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk;
    const visit = { ...JSON.parse(body), sessionId: visitPath[1], updatedAt: null };
    assert.equal(req.headers['idempotency-key'], undefined);
    visitRequests.push({ sessionId: visit.sessionId, visitId: visit.visitId, sequence: visit.sequence });
    const saved = savedVisits.get(visit.visitId);
    if (saved) {
      for (const key of ['sessionId', 'sequence', 'browserTabKey', 'normalizedUrl', 'domain', 'title', 'content', 'searchQuery', 'isSearchResultPage', 'visitedAt']) assert.deepEqual(visit[key], saved[key]);
    } else savedVisits.set(visit.visitId, visit);
    if (loseVisitResponse) { loseVisitResponse = false; req.socket.destroy(); return; }
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(saved ? 200 : 201); res.end(JSON.stringify(saved ?? visit)); return;
  }
  if (req.url === '/api/sessions' && req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk;
    const { goalText } = JSON.parse(body);
    const key = req.headers['idempotency-key'];
    assert.match(key, /^[a-f0-9-]{36}$/);
    apiRequests.push({ key, goalText });
    let session = sessions.get(key);
    res.setHeader('Content-Type', 'application/json');
    if (session && session.goalText !== goalText) { res.writeHead(422); res.end('{}'); return; }
    if (!session) {
      session = { sessionId: randomUUID(), goalText, startedAt: new Date().toISOString(), status: 'ACTIVE', endedAt: null };
      sessions.set(key, session);
    }
    if (loseResponse) { loseResponse = false; req.socket.destroy(); return; }
    await new Promise(resolve => setTimeout(resolve, 300));
    res.writeHead(201); res.end(JSON.stringify(session)); return;
  }
  const path = new URL(req.url, 'http://localhost').pathname;
  const body = path === '/b' ? bodyB : path === '/short' ? '짧은 본문' : bodyA;
  const sensitive = path === '/sensitive' ? '<form><input type="password" value="PRIVATE_PASSWORD"><textarea>PRIVATE_INPUT</textarea></form>' : '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="ko"><head><title>공개 테스트 문서</title></head><body><article><h1>문서 제목</h1><p>${body}</p></article>${sensitive}<nav>OMITTED_NAV</nav></body></html>`);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
const root = await mkdtemp(join(tmpdir(), 'focus-recovery-browser-'));
let context;
try {
  const extension = join(root, 'extension');
  // Build against the random local API fixture without modifying dist/.
  process.env.VITE_API_BASE_URL = `http://localhost:${server.address().port}`;
  await build({ configFile: resolve('vite.config.ts'), build: { outDir: extension } });
  await build({ configFile: resolve('vite.content.config.ts'), build: { outDir: extension } });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  // The unattended test profile pre-grants only its synthetic fixture host.
  // The shipped manifest still uses optional per-site permissions.
  assert.deepEqual(manifest.host_permissions, ['http://localhost/*'], 'build grants only the API host');
  manifest.host_permissions.push('http://127.0.0.1/*', 'https://www.google.com/*', 'https://search.naver.com/*');
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(root, 'profile'), {
    channel: 'chromium', headless: !process.env.HEADED,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  // All search test responses are intercepted fixtures, never live-service evidence.
  await context.route(/^https:\/\/(?:www\.google\.com|search\.naver\.com)\//, async route => {
    const url = new URL(route.request().url());
    const google = url.hostname === 'www.google.com';
    const parameter = google ? 'q' : 'query';
    if (!google && url.searchParams.get(parameter) === 'OBSERVED_NAVER_LAYOUT') {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: await readFile(resolve('tests/fixtures/naver-20261019.html'), 'utf8') });
      return;
    }
    const empty = url.searchParams.get(parameter) === 'NO_RESULTS';
    const card = google
      ? '<div class="MjjYud"><a href="https://example.com/docs"><h3>인증</h3></a></div>'
      : '<div class="fds-web-root"><div class="fds-web-list-root"><div class="fds-web-doc-root fds-web-normal-doc-root"><a href="https://example.com/docs"><span class="sds-comps-text-type-headline1">인증</span></a><a href="https://example.com/docs"><span class="sds-comps-text-type-body1">JWT 검증 방법</span></a></div></div></div>';
    const ad = google ? '<div id="tads" class="MjjYud"><span>Sponsored</span><a href="https://example.com/ad"><h3>PRIVATE_AD</h3></a></div>' : '<div data-ad data-block-id="web/example"><span>광고</span><a href="https://example.com/ad"><span class="sds-comps-text-type-headline1">PRIVATE_AD</span></a></div>';
    const root = google ? '<div id="search"><div id="rso"></div></div>' : '<div id="main_pack"></div>';
    const selector = google ? '#rso' : '#main_pack';
    const action = google ? '/search' : '/search.naver';
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><title>공개 검색 fixture</title><form role="search" action="${action}"><input name="${parameter}" value="PRIVATE_INPUT"></form>${root}${empty ? '' : `<script>setTimeout(() => document.querySelector('${selector}').innerHTML = ${JSON.stringify(card + ad)}, 500)</script>`}` });
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker', { timeout: 10000 });
  const id = worker.url().split('/')[2];
  const popup = await context.newPage();
  popup.on('dialog', dialog => dialog.accept());
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const status = () => popup.evaluate(() => chrome.runtime.sendMessage({ type: 'status' })).then(reply => { assert.equal(reply.ok, true); return reply.status; });
  const page = await context.newPage();
  await page.goto(`${origin}/a`);
  assert.equal((await status()).candidates.length, 0, 'no collection before session');
  await popup.bringToFront();
  await popup.getByLabel(/최초 작업 목표/).fill('공개 문서 조사하기');
  await popup.getByRole('button', { name: '작업 세션 시작', exact: true }).click();
  await popup.getByRole('button', { name: '같은 요청 재시도', exact: true }).waitFor();
  assert.equal((await status()).session, null, 'lost API response never starts local collection');
  assert.equal((await status()).candidates.length, 0);
  assert.equal(sessions.size, 1, 'server committed before losing response');
  const pendingCdp = await context.newCDPSession(page);
  await pendingCdp.send('ServiceWorker.enable'); await pendingCdp.send('ServiceWorker.stopAllWorkers');
  await pendingCdp.detach();
  await popup.reload();
  await popup.getByRole('button', { name: '같은 요청 재시도', exact: true }).click();
  const duplicate = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'start', goalText: '공개 문서 조사하기' }));
  assert.equal(duplicate.ok, false, 'in-flight start is blocked');
  await popup.getByText('서버 세션으로 수집 중', { exact: false }).waitFor();
  assert.equal(apiRequests.length, 2); assert.equal(sessions.size, 1);
  assert.equal(apiRequests[0].key, apiRequests[1].key, 'worker restart replays the same durable key');
  assert.equal((await status()).session.sessionId, sessions.values().next().value.sessionId);
  assert.equal(await popup.getByText(/마지막 방문·행동 정보의 서버 저장을 확인한 뒤/).isVisible(), true);
  console.log('PASS: HTTP session creation, lost response, same-key retry after worker restart, duplicate guard, server session ID, server-end ordering notice');
  await page.bringToFront();
  async function until(check, label) {
    for (let i = 0; i < 50; i++) {
      const result = await status();
      if (check(result)) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${label}`);
  }
  let result = await until(state => state.visits.length === 1, 'active document becomes valid');
  const first = result.visits[0];
  assert.equal(first.tabSwitchCount, 0, 'initial foreground is not a tab switch');
  assert.equal(Number.isSafeInteger(first.behaviorVersion) && first.behaviorVersion > 0, true, 'measured behavior has a version');
  assert.equal(first.content.includes('OMITTED_NAV'), false);
  assert.match(first.visitId, /^[a-f0-9-]{36}$/);
  await page.reload();
  await page.waitForLoadState();
  result = await until(state => state.visits[0]?.activeDurationMs > first.activeDurationMs, 'reload resumes');
  assert.equal(result.visits[0].visitId, first.visitId);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.visits[0].tabSwitchCount, 0, 'reload is not a tab switch');
  await page.goto(`${origin}/b`);
  result = await until(state => state.visits.length === 2, 'new document');
  assert.notEqual(result.visits[1].visitId, first.visitId);
  await page.goBack();
  result = await until(state => state.visits.length === 3, 'back navigation');
  assert.notEqual(result.visits[2].visitId, first.visitId);
  await page.goForward();
  result = await until(state => state.visits.length === 4, 'forward navigation');
  await page.goBack();
  result = await until(state => state.visits.length === 5, 'second back navigation');
  const beforeSpa = result.candidates.length;
  await page.evaluate(() => history.pushState({}, '', '?id=100'));
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal((await status()).candidates.length, beforeSpa, 'URL-only SPA change is not a visit');
  await page.evaluate(body => { history.pushState({}, '', '?id=200'); document.querySelector('article p').textContent = body; }, bodyB);
  result = await until(state => state.visits.length === 6, 'SPA changes URL and content');
  assert.equal(result.visits.at(-1).normalizedUrl, `${origin}/a`);
  await page.evaluate(() => { document.querySelector('article').insertAdjacentHTML('beforeend', '<p>댓글 펼치기</p>'); });
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal((await status()).visits.length, 6, 'UI mutation does not duplicate');
  const beforeSecond = (await status()).visits.at(-1);
  assert.equal(beforeSecond.tabSwitchCount, 0, 'full navigation/history/SPA are not tab switches');
  const second = await context.newPage();
  await second.goto(`${origin}/b`); await second.bringToFront();
  result = await until(state => state.visits.length === 7, 'second tab');
  const departing = result.visits.find(v => v.visitId === beforeSecond.visitId);
  assert.equal(departing.tabSwitchCount, 1, 'A → B increments A');
  assert.equal(departing.behaviorVersion > beforeSecond.behaviorVersion, true);
  const secondVisit = result.visits.at(-1);
  const sequence = result.readyVisits.map(visit => visit.sequence);
  assert.equal(new Set(sequence).size, sequence.length);
  assert.deepEqual(sequence, sequence.map((_, i) => i + 1));
  await page.bringToFront();
  await new Promise(resolve => setTimeout(resolve, 400));
  result = await status();
  assert.equal(result.visits.length, 7, 'returning to existing tab reuses visit');
  assert.equal(result.visits.find(v => v.visitId === secondVisit.visitId).tabSwitchCount, 1, 'B → A increments B');
  assert.equal(secondVisit.tabSwitchCount, 0, 'old behavior snapshot is unchanged');
  assert.equal(result.visits.find(v => v.visitId === beforeSecond.visitId).tabSwitchCount, 1, 'return does not increment A again');
  const beforeFailure = await status();
  const protectedVisits = beforeFailure.visits.map(({ visitId, content }) => ({ visitId, content }));
  const protectedReady = beforeFailure.readyVisits;
  // Abort only a synthetic request: exercise real onErrorOccurred without external URLs.
  await page.route(`${origin}/failed`, route => route.abort('failed'));
  let navigationFailed = false;
  try { await page.goto(`${origin}/failed`); } catch { navigationFailed = true; }
  assert.equal(navigationFailed, true, 'navigation failure was actually exercised');
  result = await until(state => state.session?.sessionId === beforeFailure.session.sessionId && state.visits.length === 7, 'failed navigation preserves the session');
  assert.deepEqual(result.visits.map(({ visitId, content }) => ({ visitId, content })), protectedVisits, 'failed navigation preserves prior visits');
  assert.deepEqual(result.readyVisits.slice(0, protectedReady.length), protectedReady, 'published sequences and payloads remain fixed');
  await second.bringToFront();
  await new Promise(resolve => setTimeout(resolve, 1200));
  result = await status();
  assert.equal(result.visits.length, 7, 'failed navigation never becomes a valid visit');
  assert.equal(result.session.sessionId, beforeFailure.session.sessionId);
  const closing = await context.newPage();
  let releaseRequest;
  const requestEntered = new Promise(resolve => { releaseRequest = resolve; });
  await closing.route(`${origin}/closing`, async route => {
    releaseRequest();
    await route.abort('failed').catch(() => undefined);
  });
  const interrupted = closing.goto(`${origin}/closing`).catch(() => undefined);
  await requestEntered;
  await closing.close();
  await interrupted;
  result = await status();
  assert.equal(result.session.sessionId, beforeFailure.session.sessionId, 'closing a navigating tab preserves other tabs');
  assert.deepEqual(result.visits.map(({ visitId, content }) => ({ visitId, content })), protectedVisits);
  const beforeRestart = await status();
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  const afterRestart = await status();
  assert.equal(afterRestart.session.sessionId, beforeRestart.session.sessionId, 'worker recovers session');
  assert.deepEqual(afterRestart.visits.map(visit => [visit.visitId, visit.sequence]), beforeRestart.visits.map(visit => [visit.visitId, visit.sequence]), 'worker recovers visits');
  await cdp.detach();
  await page.goto(`${origin}/sensitive`);
  result = await until(state => state.candidates.at(-1)?.reason === 'dom-policy', 'sensitive page exclusion');
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
  await page.goto(`${origin}/short`);
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal((await status()).visits.length, 7, 'short content excluded');
  const initialSearchCount = (await status()).visits.length;
  await page.goto('https://www.google.com/search?q=JWT&extra=OMITTED#OMITTED'); await page.bringToFront();
  result = await until(state => state.visits.length === initialSearchCount + 1, 'synthetic Google delayed organic result');
  const searchVisit = result.visits.at(-1);
  assert.equal(searchVisit.searchQuery, 'JWT'); assert.equal(searchVisit.isSearchResultPage, true);
  assert.equal(searchVisit.normalizedUrl, 'https://www.google.com/search');
  assert.equal([...searchVisit.content].length < 50, true, 'short organic result bypasses ordinary HTML threshold');
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
  assert.equal(JSON.stringify(result).includes('OMITTED'), false);
  await page.reload();
  result = await until(state => state.visits.at(-1)?.activeDurationMs > searchVisit.activeDurationMs, 'search reload resumes');
  assert.equal(result.visits.at(-1).visitId, searchVisit.visitId);
  const searchCandidates = result.candidates.length;
  await page.evaluate(() => history.pushState({}, '', '?q=우주'));
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal((await status()).candidates.length, searchCandidates, 'query-only search change does not duplicate');
  await page.evaluate(() => { document.querySelector('#rso h3').textContent = '행성'; });
  result = await until(state => state.visits.length === initialSearchCount + 2, 'search SPA query and results change');
  assert.equal(result.visits.at(-1).searchQuery, '우주');
  await page.goto('https://search.naver.com/search.naver?query=한글+인증');
  result = await until(state => state.visits.length === initialSearchCount + 3, 'synthetic Naver Korean results');
  assert.equal(result.visits.at(-1).searchQuery, '한글 인증');
  assert.ok(result.visits.at(-1).content.includes('제목: 인증\n설명: JWT 검증 방법'), 'modern Naver card keeps its paired snippet');
  assert.ok(!result.visits.at(-1).content.includes('PRIVATE_'), 'modern Naver extraction omits the synthetic advertisement and input');
  await page.goBack();
  result = await until(state => state.visits.length === initialSearchCount + 4, 'search back creates a visit');
  assert.notEqual(result.visits.at(-1).visitId, searchVisit.visitId);
  await page.goForward();
  result = await until(state => state.visits.length === initialSearchCount + 5, 'search forward creates a visit');
  const naverVisit = result.visits.at(-1);
  await second.goto('https://www.google.com/search?q=Spring+Boot+JWT'); await second.bringToFront();
  result = await until(state => state.visits.length === initialSearchCount + 6, 'second search tab');
  assert.equal(new Set(result.candidates.map(c => c.visitId)).size, result.candidates.length);
  await page.bringToFront(); await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal((await status()).visits.at(-2).visitId, naverVisit.visitId, 'search tab return reuses ID');
  const searchBeforeRestart = await status();
  const searchCdp = await context.newCDPSession(page); await searchCdp.send('ServiceWorker.enable'); await searchCdp.send('ServiceWorker.stopAllWorkers');
  result = await status();
  assert.deepEqual(result.visits.map(v => [v.visitId, v.sequence, v.searchQuery]), searchBeforeRestart.visits.map(v => [v.visitId, v.sequence, v.searchQuery]), 'worker restores search visits');
  await searchCdp.detach();
  const preserved = result.visits.map(v => [v.visitId, v.content]);
  const searchReady = result.readyVisits;
  await page.goto('https://www.google.com/search?q=NO_RESULTS');
  await new Promise(resolve => setTimeout(resolve, 8500));
  result = await status();
  assert.equal(result.candidates.at(-1).reason, 'unavailable-content', 'zero search results exhaust bounded wait');
  assert.deepEqual(result.visits.map(v => [v.visitId, v.content]), preserved, 'empty search preserves valid visits');
  assert.deepEqual(result.readyVisits.slice(0, searchReady.length), searchReady, 'exclusions do not renumber published visits');
  await page.goto('https://search.naver.com/search.naver?query=NO_RESULTS'); await page.bringToFront();
  await new Promise(resolve => setTimeout(resolve, 8500));
  result = await status();
  assert.equal(result.candidates.at(-1).reason, 'unavailable-content', 'empty Naver results retain the bounded exclusion policy');
  assert.deepEqual(result.visits.map(v => [v.visitId, v.content]), preserved);
  // #60 now supports this observed structure; retain #59's fixture as a positive regression.
  await page.goto('https://search.naver.com/search.naver?query=OBSERVED_NAVER_LAYOUT'); await page.bringToFront();
  result = await until(state => state.visits.length === preserved.length + 1, 'observed Naver structure creates one valid visit after #60');
  const observedVisit = result.visits.at(-1);
  assert.equal(observedVisit.searchQuery, 'OBSERVED_NAVER_LAYOUT');
  assert.equal(observedVisit.content, '검색어: OBSERVED_NAVER_LAYOUT\n\n검색 결과 1\n제목: 공개 인증 문서\n설명: 공개 검색 설명입니다.');
  assert.deepEqual(result.visits.slice(0, -1).map(v => [v.visitId, v.content]), preserved);
  const observed = (await readDurable(popup, 'collection')).candidates.find(c => c.visitId === observedVisit.visitId);
  assert.equal(observed.state, 'valid');
  assert.equal(observed.snapshot.organicResultCount, 1);
  console.log('PASS: synthetic observed Naver fixture creates one visit with exact title/snippet and committed IDB evidence after #60');
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'stop' }));
  const stopped = await status();
  await until(state => state.visitDelivery.visits.length === stopped.readyVisits.length && state.visitDelivery.visits.every(visit => visit.phase === 'acked'), 'all finalized visits receive validated server ACK');
  assert.equal(savedVisits.size, stopped.readyVisits.length, 'one stored record per valid visit despite lost-response retry');
  assert.equal(visitRequests[0].visitId, visitRequests[1].visitId, 'lost visit response retries the same ID');
  assert.deepEqual(visitRequests.filter((request, index) => index === 0 || request.visitId !== visitRequests[index - 1].visitId).map(request => request.sequence), stopped.readyVisits.map(visit => visit.sequence));
  console.log('PASS: MV3 visit HTTP delivery, lost response, duplicate 200 replay, sequence order, ACK and worker checkpoint recovery (synthetic API)');
  assert.equal([...sessions.values()].every(session => session.status === 'ACTIVE'), true, 'local stop does not claim server termination');
  assert.equal(stopped.readyVisits.length, stopped.visits.length, `stop finalizes every valid visit: ${JSON.stringify(result.candidates.map(c => ({state:c.state,reason:c.reason,finalized:c.finalized,sequence:c.sequence,recoveryRequired:c.recoveryRequired})))}`);
  assert.deepEqual(stopped.readyVisits.map(v => v.sequence), stopped.readyVisits.map((_, i) => i + 1), 'excluded candidates never consume server sequences');
  assert.equal(stopped.candidates.some(c => c.state === 'excluded'), true, 'exclusion cases were actually exercised');
  const windows = stopped.readyVisits.slice(4).map((_, i) => stopped.readyVisits.slice(i, i + 5).map(v => v.visitId));
  assert.equal(windows.length, stopped.visits.length - 4, 'contiguous inputs support size 5 stride 1');
  assert.deepEqual(windows, stopped.visits.slice(4).map((_, i) => stopped.visits.slice(i, i + 5).map(v => v.visitId)));
  await page.goto(`${origin}/a`);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal((await status()).candidates.length, stopped.candidates.length, 'no collection after stop');
  assert.deepEqual((await status()).readyVisits, stopped.readyVisits, 'resend source remains stable after stop');
  // A real background tab validates after a later tab has already closed.
  await second.close();
  await page.goto(`${origin}/short`); await page.bringToFront();
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'start', goalText: '비동기 방문 순서 검증하기' }));
  result = await until(state => state.candidates.length === 1, 'earlier pending tab');
  const earlierId = result.candidates[0].visitId;
  const later = await context.newPage(); await later.goto(`${origin}/b`); await later.bringToFront();
  result = await until(state => state.visits.length === 1, 'later tab validates first');
  const laterId = result.visits[0].visitId;
  assert.notEqual(laterId, earlierId);
  await later.close();
  result = await until(state => state.candidates[1]?.finalized, 'later tab finalized');
  assert.equal(result.readyVisits.length, 0, 'earlier unresolved tab blocks later sequence allocation');
  await page.bringToFront();
  await page.evaluate(body => { document.querySelector('article p').textContent = body; }, bodyA);
  await until(state => state.visits.length === 2, 'earlier tab receives late content');
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'stop' }));
  result = await status();
  assert.deepEqual(result.readyVisits.map(v => [v.visitId, v.sequence]), [[earlierId, 1], [laterId, 2]], 'creation order wins over validation and finalization order');
  // Headless Chrome can report every window as focused; native focus needs visible windows.
  if (process.env.HEADED) {
    // Exercise native Chrome window events as well as the mocked adapter order tests.
    await page.goto(`${origin}/a`); await page.bringToFront();
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'start', goalText: '다중 창 활성시간 검증하기' }));
    result = await until(state => state.visits.length === 1, 'first window visit');
    const windowAVisit = result.visits[0];
    const windowA = await popup.evaluate(() => chrome.windows.getCurrent().then(window => window.id));
    const windowB = await popup.evaluate(url => chrome.windows.create({ url, focused: true, type: 'normal' }), `${origin}/b`);
    result = await until(state => state.visits.length === 2, 'second window visit');
    const windowBVisit = result.visits[1];
    assert.equal(result.visits[0].tabSwitchCount, 1, 'switching Chrome windows counts A once');
    await popup.evaluate(windowId => chrome.windows.update(windowId, { focused: true }), windowA);
    result = await until(state => state.visits[1].tabSwitchCount === 1, 'window B departure');
    assert.equal(result.visits[0].visitId, windowAVisit.visitId);
    assert.equal(result.visits[1].visitId, windowBVisit.visitId);
    assert.equal(result.visits[0].tabSwitchCount, 1, 'focus and tab events do not double count A');
    await popup.evaluate(windowId => chrome.windows.remove(windowId), windowB.id);
    await popup.evaluate(windowId => chrome.windows.update(windowId, { state: 'minimized' }), windowA);
    await new Promise(resolve => setTimeout(resolve, 200));
    const minimized = await status();
    await new Promise(resolve => setTimeout(resolve, 300));
    result = await status();
    assert.equal(result.visits[0].activeDurationMs, minimized.visits[0].activeDurationMs, 'native window minimization pauses active time');
    assert.equal(result.visits[0].tabSwitchCount, 1, 'minimization without a replacement window is not a tab switch');
    await popup.evaluate(windowId => chrome.windows.update(windowId, { state: 'normal', focused: true }), windowA);
    result = await until(state => state.visits[0].activeDurationMs > minimized.visits[0].activeDurationMs, 'native window restoration resumes');
    assert.equal(result.visits[0].tabSwitchCount, 1, 'restoration does not add a switch');
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'stop' }));
    console.log('PASS: native multi-window focus/minimize/restore');
  } else console.log('SKIP: native multi-window focus/minimize/restore requires HEADED=1');
  console.log(`PASS: real MV3 load, popup, messaging, session gate, extraction, reload, back/forward, SPA, tabs, sequence, navigation failure/tab-close race, worker restart, sensitive/short exclusion, synthetic Google/Naver organic results, search SPA/reload/history/tabs/recovery/zero results, stop (${context.browser()?.version() ?? 'Chromium'})`);
  await popup.reload();
  await popup.getByLabel(/최초 작업 목표/).fill('세션 오류 복구 검증하기');
  await popup.getByRole('button', { name: '작업 세션 시작', exact: true }).click();
  await popup.getByText('서버 세션으로 수집 중', { exact: false }).waitFor();
  await page.goto(`${origin}/a`); await page.bringToFront();
  const beforeCheckpointFailure = await until(state => state.visits.length > 0, 'recovery test visit');
  const activeWorker = context.serviceWorkers().find(candidate => candidate.url().includes(id));
  assert.ok(activeWorker, 'active extension worker exists');
  // Inject one storage failure in the real worker; HTTP still uses the fixture above.
  await activeWorker.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      IDBObjectStore.prototype.put = original;
      const request = original.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    };
  });
  // A queued observation can consume the injected abort before this diagnostic status request.
  let failed;
  for (let attempt = 0; attempt < 50; attempt++) {
    failed = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'status' }));
    if (failed.status?.storage.phase === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(failed.status.storage.phase, 'failed', 'storage failure reaches the fail-closed handler');
  assert.equal(failed.status.session, null);
  assert.equal(failed.status.sessionStartRecovery.kind, 'pending');
  const requestCount = apiRequests.length;
  async function restartWorker() {
    const cdp = await context.newCDPSession(page);
    await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers');
    await cdp.detach(); await popup.reload();
  }
  await restartWorker();
  await popup.getByRole('button', { name: '같은 요청 재시도', exact: true }).click();
  await popup.getByText('서버 세션으로 수집 중', { exact: false }).waitFor();
  result = await status();
  assert.equal(result.session.sessionId, beforeCheckpointFailure.session.sessionId);
  for (const visit of beforeCheckpointFailure.visits) {
    const restored = result.visits.find(candidate => candidate.visitId === visit.visitId);
    assert.ok(restored, 'visit ID survives failure and restart');
    assert.equal(restored.sequence, visit.sequence);
    assert.ok(restored.activeDurationMs >= visit.activeDurationMs);
  }
  assert.equal(apiRequests.length, requestCount, 'durable successful response is reused without POST');
  await popup.getByRole('button', { name: '작업 세션 종료', exact: true }).click();
  await until(state => state.sessionEnd?.state === 'ENDED', 'Popup server end persists validated ENDED ACK');
  const corrupt = { idempotencyKey: 'broken', goalText: 'PRIVATE_CORRUPTED_RECORD', apiBaseUrl: 'http://localhost:8080' };
  await popup.evaluate(record => chrome.storage.local.set({ pendingSessionStart: record }), corrupt);
  for (let restart = 0; restart < 2; restart++) {
    await restartWorker();
    await popup.getByText('상태: 시작 요청 복구 필요', { exact: true }).waitFor();
    assert.equal(await popup.getByRole('button', { name: '작업 세션 시작', exact: true }).isDisabled(), true);
    assert.equal(await popup.getByLabel(/최초 작업 목표/).isDisabled(), true);
    assert.equal((await popup.locator('body').innerText()).includes('PRIVATE_CORRUPTED_RECORD'), false);
    const blocked = await status();
    assert.equal(blocked.session, null); assert.equal(blocked.sessionStartRecovery.kind, 'invalid');
    await popup.getByRole('button', { name: '로컬 기록 삭제', exact: true }).click();
    await until(state => state.candidates.length === 0, 'explicit clear removes visits');
    assert.deepEqual(await popup.evaluate(() => chrome.storage.local.get('pendingSessionStart').then(saved => saved.pendingSessionStart)), corrupt);
  }
  assert.equal(apiRequests.length, requestCount, 'corruption never creates another server session');
  console.log('PASS: MV3 checkpoint failure, cached-response recovery after restart, stable visits, corrupt-record Popup lock, readable status, explicit visit clear preserves raw request across restarts');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
