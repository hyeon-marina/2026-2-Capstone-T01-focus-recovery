// Existing automated C source/profile only; preserves the earlier four-Visit Attempt.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, X509Certificate } from 'node:crypto';
import assert from 'node:assert/strict';
const directory=process.env.FOCUS_SLOT_C_DIRECTORY;assert.ok(directory);
assert.equal(await readFile(join(directory,'AUTOMATED_TEST_ONLY'),'utf8'),'NO_HUMAN_PARTICIPANT_CONSENT');
const config=JSON.parse(await readFile(join(directory,'config.json'),'utf8'));assert.equal(config.slot,'C');
const original=JSON.parse(await readFile(join(directory,'slot-c-summary.json'),'utf8'));
assert.equal(original.kind,'AUTOMATED_TECHNICAL_TEST_NOT_HUMAN_CONSENT');assert.equal(original.plan,'PLAN-018');
const policyBytes=await readFile(join(directory,'site-policy.json')),policy=JSON.parse(policyBytes);
assert.equal(policy.policyVersion,'6');assert.equal(policy.mode,'RAW_ONLY');
const digest=createHash('sha256').update(policyBytes).digest('hex');assert.equal(digest,original.policyDigest);
const extension=join(directory,'extension'),profile=join(directory,'slot-c-chrome-profile');
await access(join(extension,'manifest.json'));await access(profile);
const out=join(directory,'recollect-10'),evidence=join(out,'evidence');await mkdir(evidence);
const credential=JSON.parse(await readFile(join(directory,'participant.json'),'utf8')).credential;
const server='https://localhost:'+config.tlsPort;
const cert=new X509Certificate(await readFile(join(directory,'tls/localhost.pem')));
const spki=createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64');
const context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',executablePath:process.env.CHROMIUM_PATH,viewport:{width:1440,height:1100},args:['--ignore-certificate-errors-spki-list='+spki,`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
let harness;const captures=[],observedPages=[];
const send=(action,extra={})=>harness.evaluate(({action,extra})=>chrome.runtime.sendMessage({type:'v2-'+action,...extra}),{action,extra});
async function wait(action,predicate,label) {
  for(let n=0;n<200;n++) {
    const s=await send(action);assert.ok(!s.error);if(action==='status'){assert.equal(s.storageFailed,false);assert.equal(s.quarantined,false);}
    if(predicate(s))return s;await new Promise(r=>setTimeout(r,200));
  }
  throw new Error('Timeout '+label);
}
async function capture(page,file,description) {
  await page.screenshot({path:join(evidence,file),fullPage:true});
  captures.push({file,capturedAt:new Date().toISOString(),description});
}
const pages=['https://docs.python.org/3/','https://docs.python.org/3/howto/','https://docs.python.org/3/tutorial/','https://docs.python.org/3/library/','https://docs.python.org/3/reference/','https://docs.python.org/3/faq/','https://docs.python.org/3/tutorial/venv.html','https://docs.python.org/3/library/venv.html','https://docs.python.org/3/installing/index.html','https://docs.python.org/3/tutorial/modules.html'];
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  harness=await context.newPage();await harness.goto('chrome-extension://'+worker.url().split('/')[2]+'/participant/index.html');
  await harness.getByLabel('로컬 Credential 파일 불러오기').setInputFiles(join(directory,'participant.json'));
  await harness.getByText(/서버 동의 유효/).first().waitFor();
  const accessState=await send('access');assert.equal(accessState.access.consentValid,true);assert.equal(accessState.access.local.slot,'C');assert.equal(accessState.access.local.policyDigest,digest);
  for(const p of context.pages())if(p!==harness)await p.close();
  const before=await send('progress');assert.equal(before.attempts.length,1);
  const old=before.attempts[0];assert.equal(old.attemptId,original.attempt.attemptId);assert.equal(old.sessionId,original.attempt.sessionId);
  assert.equal(old.rawQuality.validVisits,4);assert.equal(old.sessionStatus,'ENDED');assert.equal(old.privacyStatus,'CLEAR');assert.equal(old.reviewStatus,'PENDING');
  await harness.getByLabel('배정 목표').selectOption('PLAN-018');await harness.getByRole('button',{name:'진행 상태 새로고침',exact:true}).click();
  await capture(harness,'09-before-recollection.png','Same C profile: preserved four-Visit Attempt before recollect');
  await harness.getByLabel('재수집 사유').selectOption('INSUFFICIENT_VISITS');
  await harness.getByRole('button',{name:'사유 기록 후 재수집 허용',exact:true}).click();
  await wait('progress',p=>p.attempts.length===1&&p.attempts[0].reviewStatus==='RECOLLECT_REQUIRED','recollect reason');
  await harness.getByRole('button',{name:'진행 상태 새로고침',exact:true}).click();
  await capture(harness,'10-recollect-authorized.png','Existing Attempt retained with INSUFFICIENT_VISITS; same plan can start again');
  await harness.getByRole('button',{name:'세션 시작',exact:true}).click();await wait('status',s=>s.lifecycle==='ACTIVE','new session');
  const started=await wait('progress',p=>p.attempts.length===2,'second Attempt');const fresh=started.attempts.find(a=>a.attemptId!==old.attemptId);
  assert.equal(fresh.plannedSessionId,'PLAN-018');assert.notEqual(fresh.sessionId,old.sessionId);
  await capture(harness,'11-new-session-active.png','Same PLAN-018 with a distinct new Session and Attempt, ACTIVE');
  const page=await context.newPage();
  for(const [i,url] of pages.entries()) {
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});assert.equal(response.status(),200);
    await page.bringToFront();await wait('status',s=>s.validVisits===i+1,'Visit '+(i+1));
    observedPages.push({url,status:response.status(),observedAt:new Date().toISOString()});
    if(i===0)await capture(page,'12-public-page-visit.png','Actual public Python documentation in recollected session');
    console.log('Actual public recollection Visit '+(i+1)+'/10');
  }
  await harness.bringToFront();await harness.getByRole('button',{name:'진행 상태 새로고침',exact:true}).click();
  await capture(harness,'13-ten-visits-active.png','ACTIVE and ten valid Visits before END');
  await harness.getByRole('button',{name:'세션 종료 · 수집 중지',exact:true}).click();
  const ended=await wait('status',s=>s.lifecycle==='ENDED'&&s.endPhase==='acked'&&s.pending===0,'END ACK');
  const progress=await wait('progress',p=>p.attempts.find(a=>a.attemptId===fresh.attemptId)?.rawStatus==='RAW_COLLECTED','RAW_COLLECTED');
  const current=progress.attempts.find(a=>a.attemptId===fresh.attemptId),preserved=progress.attempts.find(a=>a.attemptId===old.attemptId);
  assert.equal(progress.attempts.length,2);assert.equal(progress.raw.completed,1);assert.equal(progress.raw.validVisits,10);assert.equal(progress.raw.theoreticalWindows,8);assert.equal(progress.raw.participants.C,1);
  assert.equal(current.rawQuality.validVisits,10);assert.deepEqual(current.rawQuality.reasons,[]);assert.equal(current.deliveryConfirmed,true);assert.equal(current.sessionStatus,'ENDED');assert.equal(current.privacyStatus,'CLEAR');assert.equal(current.analysisState,'NOT_RUN');
  assert.equal(preserved.sessionId,old.sessionId);assert.equal(preserved.rawQuality.validVisits,4);assert.equal(preserved.reviewStatus,'RECOLLECT_REQUIRED');assert.equal(preserved.reasonCode,'INSUFFICIENT_VISITS');assert.equal(preserved.rawStatus,'RECOLLECT_REQUIRED');
  await harness.getByRole('button',{name:'진행 상태 새로고침',exact:true}).click();await harness.getByText(/원본 RAW_COLLECTED/).waitFor();
  await capture(harness,'14-raw-collected.png','ENDED/acked, RAW_COLLECTED, both old and new Attempts visible, completion 1/53');
  const api=await context.newPage();await api.route(server+'/api/**',route=>route.continue({headers:{...route.request().headers(),Authorization:'Bearer '+credential}}));
  const response=await api.goto(server+'/api/collection/progress');assert.equal(response.status(),200);
  await capture(api,'15-server-two-attempts.png','Actual Backend JSON: two preserved Attempts, ten valid Visits counted once');
  await writeFile(join(out,'browser-summary.json'),JSON.stringify({result:'PASS',kind:'AUTOMATED_TECHNICAL_TEST_NOT_HUMAN_CONSENT',humanResearchSessions:0,chromeVersion:context.browser().version(),slot:'C',policyDigest:digest,plan:'PLAN-018',observedPages,oldAttempt:preserved,newAttempt:current,raw:progress.raw,ended:{lifecycle:ended.lifecycle,endPhase:ended.endPhase,pending:ended.pending},captures},null,2),{flag:'wx'});
  console.log('PASS: ten actual public Visits, RAW_COLLECTED, old four-Visit Attempt preserved, same C source/profile; research actuals 0');
} catch(error) {
  if(harness)await capture(harness,'error-recollection.png','Actual extension at failure').catch(()=>{});
  throw error;
} finally {await context.close();}
