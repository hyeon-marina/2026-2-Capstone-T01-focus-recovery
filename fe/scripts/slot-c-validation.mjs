// Opt-in NEW slot C source only. Automated consent is never a human research session.
import { chromium } from 'playwright';
import { build } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, X509Certificate } from 'node:crypto';
import assert from 'node:assert/strict';
const directory=process.env.FOCUS_SLOT_C_DIRECTORY;
assert.ok(directory);
assert.equal(await readFile(join(directory,'AUTOMATED_TEST_ONLY'),'utf8'),'NO_HUMAN_PARTICIPANT_CONSENT');
const config=JSON.parse(await readFile(join(directory,'config.json'),'utf8'));
assert.equal(config.slot,'C');
const policyFile=join(directory,'site-policy.json');
const policyBytes=await readFile(policyFile), policy=JSON.parse(policyBytes);
assert.equal(policy.policyVersion,'6');assert.equal(policy.mode,'RAW_ONLY');
const digest=createHash('sha256').update(policyBytes).digest('hex');
assert.equal(digest,(await readFile('../docs/data-collection/TEAM_POLICY.sha256','utf8')).split(/\s/)[0]);
const credential=JSON.parse(await readFile(join(directory,'participant.json'),'utf8')).credential;
const server='https://localhost:'+config.tlsPort;
process.env.VITE_API_BASE_URL=server;process.env.COLLECTION_SITE_POLICY_FILE=policyFile;
const extension=join(directory,'extension');
await build({configFile:resolve('vite.real.config.ts'),mode:'real-collection',build:{outDir:extension}});
await build({configFile:resolve('vite.real.content.config.ts'),build:{outDir:extension}});
const cert=new X509Certificate(await readFile(join(directory,'tls/localhost.pem')));
const spki=createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64');
const profile=join(directory,'slot-c-chrome-profile');
await mkdir(profile); // Refuse to open any existing participant profile.
const evidence=join(directory,'evidence');await mkdir(evidence);
const captures=[];
const context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',executablePath:process.env.CHROMIUM_PATH,viewport:{width:1440,height:1100},args:['--ignore-certificate-errors-spki-list='+spki,`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
let harness;
const send=(action)=>harness.evaluate(action=>chrome.runtime.sendMessage({type:'v2-'+action}),action);
async function wait(predicate,label) {
  for(let i=0;i<200;i++) {
    const s=await send('status');assert.equal(s.storageFailed,false);assert.equal(s.quarantined,false);
    if(predicate(s))return s;await new Promise(r=>setTimeout(r,200));
  }
  throw new Error('Timeout '+label);
}
async function capture(page,file,description) {
  await page.screenshot({path:join(evidence,file),fullPage:true});
  captures.push({file,capturedAt:new Date().toISOString(),description});
}
async function apiScreen(path,file,description) {
  const p=await context.newPage();
  await p.route(server+'/api/**',route=>route.continue({headers:{...route.request().headers(),Authorization:'Bearer '+credential}}));
  const response=await p.goto(server+path);assert.equal(response.status(),200);
  const data=await response.json();await capture(p,file,description);await p.close();return data;
}
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  harness=await context.newPage();await harness.goto('chrome-extension://'+worker.url().split('/')[2]+'/participant/index.html');
  await harness.getByLabel('로컬 Credential 파일 불러오기').setInputFiles(join(directory,'participant.json'));
  await harness.getByText('로컬 슬롯 C',{exact:false}).waitFor();
  const before=await send('progress');assert.equal(before.attempts.length,0);
  const access=await send('access');assert.equal(access.access.consentValid,false);
  // Explicitly authorized automated TEST source, never consent on behalf of team member C.
  await harness.getByRole('checkbox').check();await harness.getByRole('button',{name:'수집 동의 기록 저장',exact:true}).click();
  await harness.getByText(/서버 동의 유효/).first().waitFor();
  const state=await apiScreen('/api/collection/local-status','01-slot-c-status.png','Actual backend local-status JSON: C, policy SHA, ready');
  assert.equal(state.slot,'C');assert.equal(state.policyDigest,digest);assert.equal(state.ready,true);
  const assignments=await send('assignments');assert.equal(assignments.length,53);
  const assignment=assignments.find(a=>a.goalId==='GOAL-003');assert.ok(assignment);
  await harness.getByLabel('배정 목표').selectOption(assignment.plannedSessionId);
  await capture(harness,'02-extension-ready.png','Actual extension: assigned plan, v6, slot C, valid test consent');
  await harness.getByRole('button',{name:'세션 시작',exact:true}).click();await wait(s=>s.lifecycle==='ACTIVE','start');
  await capture(harness,'03-session-active.png','Actual extension ACTIVE before public visits');
  const page=await context.newPage(),observedPages=[];
  for(const [i,url] of ['https://docs.python.org/3/','https://docs.python.org/3/howto/','https://docs.python.org/3/tutorial/','https://docs.python.org/3/library/'].entries()) {
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});assert.equal(response.status(),200);
    await page.bringToFront();await wait(s=>s.validVisits===i+1,'visit '+(i+1));
    observedPages.push({url,status:response.status(),observedAt:new Date().toISOString()});
    if(i===0)await capture(page,'04-public-page-visit.png','Actual unmodified public Python documentation after active dwell');
  }
  await harness.bringToFront();await harness.getByRole('button',{name:'진행 상태 새로고침',exact:true}).click();
  await capture(harness,'05-visit-progress.png','Actual extension ACTIVE with four server-received valid Visits');
  await harness.getByRole('button',{name:'세션 종료 · 수집 중지',exact:true}).click();
  const ended=await wait(s=>s.lifecycle==='ENDED'&&s.endPhase==='acked','END ACK');
  await harness.getByRole('button',{name:'진행 상태 새로고침',exact:true}).click();
  await harness.getByText(/종료 ACK를 받았습니다/).waitFor();
  await capture(harness,'06-session-ended.png','Actual extension ENDED, acked, pending zero');
  let progress;
  for(let i=0;i<100;i++) {
    progress=await send('progress');if(progress.attempts[0]?.deliveryConfirmed)break;await new Promise(r=>setTimeout(r,200));
  }
  assert.equal(progress.attempts.length,1);const attempt=progress.attempts[0];
  assert.equal(attempt.plannedSessionId,assignment.plannedSessionId);assert.equal(attempt.sessionStatus,'ENDED');
  assert.equal(attempt.privacyStatus,'CLEAR');assert.equal(attempt.rawStatus,'RECOLLECT_REQUIRED');
  assert.equal(attempt.analysisState,'NOT_RUN');assert.equal(attempt.rawQuality.validVisits,4);
  assert.ok(attempt.rawQuality.reasons.includes('VISITS_BELOW_10'));assert.equal(attempt.deliveryConfirmed,true);
  assert.equal(progress.raw.completed,0);assert.equal(ended.pending,0);
  await harness.getByRole('button',{name:'진행 상태 새로고침',exact:true}).click();
  await harness.getByText(/원본 RECOLLECT_REQUIRED/).waitFor();
  await capture(harness,'07-collection-progress.png','Actual extension: Visit 4, delivery confirmed, RECOLLECT_REQUIRED, NOT_RUN');
  await apiScreen('/api/collection/progress','08-server-validation.png','Actual authenticated backend progress JSON, no raw page text');
  await writeFile(join(directory,'slot-c-summary.json'),JSON.stringify({result:'PASS',kind:'AUTOMATED_TECHNICAL_TEST_NOT_HUMAN_CONSENT',humanResearchSessions:0,chromeVersion:context.browser().version(),slot:'C',policyVersion:'6',policyDigest:digest,plan:assignment.plannedSessionId,observedPages,attempt,ended:{lifecycle:ended.lifecycle,endPhase:ended.endPhase,pending:ended.pending},captures},null,2),{flag:'wx'});
  console.log('PASS: slot C, four real public pages, END ACK, RECOLLECT_REQUIRED, AI NOT_RUN; research actuals 0');
} catch(error) {
  if(harness)await capture(harness,'error-extension.png','Actual extension at failure').catch(()=>{});
  throw error;
} finally {await context.close();}
