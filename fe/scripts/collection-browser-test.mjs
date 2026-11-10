import { chromium } from 'playwright';
import { build } from 'vite';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const server = process.env.FE97_SERVER;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(server ?? '')) throw new Error('Actual isolated Spring loopback server required');
const root = await mkdtemp(join(tmpdir(), 'focus97-chrome-'));
const evidence = '/private/tmp/focus97-chrome-evidence';await mkdir(evidence, { recursive: true });
const operator = process.env.FE97_OPERATOR_TOKEN;
async function api(token, path, method = 'GET', body, expected = 200) {
  const r = await fetch(server + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(r.status, expected, `${method} ${path}`);
  const raw = await r.text();return raw ? JSON.parse(raw) : undefined;
}
await api(operator, '/api/collection/admin/plan/initialize', 'POST', {});
const participants = [];
for (const slot of ['A','B','C']) {
  const p = await api(operator, '/api/collection/admin/participants', 'POST', { identityReferenceHash: createHash('sha256').update(randomUUID()).digest('hex'), evidenceRef: `synthetic-roster-${slot}` });
  const c = await api(operator, `/api/collection/admin/participants/${p.participantId}/credentials`, 'POST', { expiresAt: new Date(Date.now() + 1800000).toISOString(), evidenceRef: `synthetic-issuance-${slot}` });
  participants.push({ slotId: slot, participantId: p.participantId, token: c.credential });
}
let plan = await api(operator, '/api/collection/admin/plan');
plan.slots = participants.map(({ slotId, participantId }) => ({ slotId, participantId }));
// A synthetic fixture goal is confirmed only in this isolated test; the checked-in 20 slots remain DRAFT.
plan.goals[0] = { goalId: 'GOAL-001', description: 'Synthetic TypeScript transaction research', status: 'CONFIRMED', evidenceRef: 'synthetic-fixture-97' };
await api(operator, '/api/collection/admin/plan', 'PUT', plan);
const [alice,bob] = participants;
await api(bob.token, '/api/collection/admin/progress', 'GET', undefined, 403);
const fixture = createServer((req,res) => {
  const id = req.url.split('/').at(-1);
  if (!['a','b','c','d'].includes(id)) { res.writeHead(404);res.end();return; }
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html data-focus-synthetic="catalog-v1"><title>Synthetic fixture ${id}</title><body><article>Synthetic fixture ${id}. This public example describes TypeScript transactions and durable page observations. No participant information is present.</article></body></html>`);
});
await new Promise((r,j) => { fixture.once('error',j);fixture.listen(8911,'127.0.0.1',r); });
process.env.VITE_API_BASE_URL = server;
const extension = join(root,'extension');
await build({ configFile: resolve('vite.participant.config.ts'), mode: 'collection-pilot', build: { outDir: extension } });
await build({ configFile: resolve('vite.synthetic.content.config.ts'), build: { outDir: extension } });
let context, harness;
async function launch() { return chromium.launchPersistentContext(join(root,'profile'), { channel: 'chromium', headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: [`--disable-extensions-except=${extension}`,`--load-extension=${extension}`] }); }
const send = (action, extra = {}) => harness.evaluate(({ action, extra }) => chrome.runtime.sendMessage({ type: `v2-${action}`, ...extra }), { action, extra });
async function wait(test, label, timeout = 30000) {
  const start = Date.now();while (Date.now()-start < timeout) { const s = await send('status');if(test(s)) return s;assert.equal(s.storageFailed,false,label);await new Promise(r=>setTimeout(r,200)); }
  throw new Error(`Timeout: ${label}`);
}
async function login(token) { await harness.getByLabel('합성 테스트 자격정보').fill(token);await harness.getByRole('button',{name:'인증 / 계정 전환',exact:true}).click();await harness.getByText(/인증됨/).waitFor(); }
let sessionId;
try {
  context = await launch();let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');const id = worker.url().split('/')[2];
  harness = await context.newPage();await harness.goto(`chrome-extension://${id}/participant/index.html`);
  await harness.screenshot({path:join(evidence,'before-login.png'),fullPage:true});
  assert.ok((await send('start',{plannedSessionId:'PLAN-001'})).error);
  await login(alice.token);assert.ok((await send('start',{plannedSessionId:'PLAN-001'})).error);
  await harness.getByRole('checkbox').check();await harness.getByRole('button',{name:'합성 동의 기록 저장',exact:true}).click();
  await harness.getByText(/서버 동의 유효/).waitFor();
  await harness.getByLabel('배정 목표').selectOption('PLAN-001');
  await harness.getByRole('button',{name:'세션 시작',exact:true}).click();await wait(s=>s.lifecycle==='ACTIVE','start');
  const ordinary = await context.newPage();await ordinary.goto('http://127.0.0.1:8911/not-allowed/a');await ordinary.bringToFront();
  await new Promise(r=>setTimeout(r,6000));assert.equal((await send('status')).validVisits,0,'non-catalog route must never collect');
  let page = await context.newPage();
  for(let n=1;n<=10;n++) {
    await page.goto(`http://127.0.0.1:8911/__focus_synthetic__/${['a','b','c','d'][(n-1)%4]}`);await page.bringToFront();
    await wait(s=>s.validVisits>=n,`real measured Visit ${n}`);console.log(`Measured synthetic visit ${n}/10`);
    if(n===3 && process.env.FE97_EXPECT_DRIFT_ALERT === '1') {
      await harness.bringToFront();await harness.getByRole('alert').filter({has: harness.getByText('처음의 목표를 확인하세요')}).waitFor({timeout:20000});
      await harness.getByRole('button',{name:'목표로 돌아가기',exact:true}).click();
      for(let retry=0;retry<20;retry++) { if((await send('status')).notificationAcknowledged>=1)break;await send('retry');await new Promise(r=>setTimeout(r,200)); }
      assert.ok((await send('status')).notificationAcknowledged>=1,'actual shown and selection ACK persisted before stopping worker');
      console.log('Actual BE DRIFT alert rendered, selected and ACK persisted');
    }
    if(n===3) { const cdp=await context.newCDPSession(harness);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await cdp.detach();await wait(s=>s.validVisits>=3,'worker restore'); }
    if(n===5) {
      await context.close();context=await launch();worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
      harness=await context.newPage();await harness.goto(`chrome-extension://${id}/participant/index.html`);assert.equal((await send('status')).collectionAllowed,false);
      await login(alice.token);await wait(s=>s.collectionAllowed,'browser reauthentication');page=await context.newPage();
    }
  }
  await send('stop');await wait(s=>s.lifecycle==='ENDED' && s.endPhase==='acked','end drain');
  let progress;
  for(let n=0;n<150;n++) { progress=await send('progress');if(progress.syntheticQualityPassed===1)break;await new Promise(r=>setTimeout(r,200)); }
  assert.equal(progress.syntheticQualityPassed,1,'ten visits, eight successful windows and delivered receipt');
  assert.equal(progress.completed,0);assert.equal(progress.actualSessions,0);assert.equal(progress.attempts[0].quality.validVisits,10);assert.equal(progress.attempts[0].quality.validWindows,8);
  sessionId=progress.attempts[0].sessionId;
  await api(bob.token,`/api/sessions/${sessionId}`,'GET',undefined,404);
  await api(bob.token,`/api/sessions/${sessionId}/visits`,'POST',{},404);
  await harness.bringToFront();await harness.getByRole('button',{name:'진행 상태 새로고침',exact:true}).click();
  await harness.getByText(/PLAN-001 · SYNTHETIC · QUALITY_PASSED/).waitFor();
  await harness.screenshot({path:join(evidence,'ten-visits.png'),fullPage:true});
  await writeFile(join(evidence,'progress-before-withdrawal.json'),JSON.stringify(progress,null,2));
  await harness.getByRole('button',{name:'전체 동의 철회 · 수집 즉시 중지',exact:true}).click();await wait(s=>s.withdrawalPhase==='acknowledged','withdrawal');
  assert.equal((await send('access')).access.withdrawn,true);assert.ok((await send('start',{plannedSessionId:'PLAN-004'})).error);
  await wait(s=>!s.collectionAllowed,'withdrawal gate');
  await harness.screenshot({path:join(evidence,'withdrawal.png'),fullPage:true});
  const final=await api(operator,'/api/collection/admin/progress');assert.equal(final.completed,0);assert.equal(final.attempts.find(a=>a.sessionId===sessionId).status,'QUARANTINED');
  await writeFile(join(evidence,'progress-after-withdrawal.json'),JSON.stringify(final,null,2));
  console.log(JSON.stringify({result:'PASS',chrome:await context.browser()?.version(),actualSpring:true,actualMySQL:!!process.env.FOCUS97_MYSQL_URL,actualFastAPI:true,models:'MOCK',visits:10,windows:8,workerRestart:true,browserRestart:true,syntheticOnly:true,actualBeAlertUI:process.env.FE97_EXPECT_DRIFT_ALERT === '1'}));
} finally { await context?.close();await new Promise(r=>fixture.close(r)); }
// Keep the newly created temporary profile as failure/restart evidence; never reuse a participant profile.
