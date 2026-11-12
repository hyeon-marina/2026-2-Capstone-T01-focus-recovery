// Read-only final evidence on the retained automated C profile; never starts a new session.
import { chromium } from 'playwright';
import { readFile,writeFile,mkdir,access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash,X509Certificate } from 'node:crypto';
import assert from 'node:assert/strict';
const directory=process.env.FOCUS_SLOT_C_DIRECTORY,out=process.env.FOCUS_FINAL_EVIDENCE_DIRECTORY;
assert.ok(directory&&out);
assert.equal(await readFile(join(directory,'AUTOMATED_TEST_ONLY'),'utf8'),'NO_HUMAN_PARTICIPANT_CONSENT');
const config=JSON.parse(await readFile(join(directory,'config.json'),'utf8'));assert.equal(config.slot,'C');
const original=JSON.parse(await readFile(join(directory,'recollect-10/browser-summary.json'),'utf8'));
assert.equal(original.kind,'AUTOMATED_TECHNICAL_TEST_NOT_HUMAN_CONSENT');
const profile=join(directory,'slot-c-chrome-profile'),extension=join(directory,'extension');await access(profile);await access(extension);await mkdir(out);
const server='https://localhost:'+config.tlsPort;
const cert=new X509Certificate(await readFile(join(directory,'tls/localhost.pem')));
const spki=createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64');
const credential=JSON.parse(await readFile(join(directory,'participant.json'),'utf8')).credential;
const context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',executablePath:process.env.CHROMIUM_PATH,viewport:{width:1440,height:1100},args:['--ignore-certificate-errors-spki-list='+spki,`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const captures=[];
async function capture(target,file,purpose){const path=join(out,file);await target.screenshot({path});captures.push({file,purpose,capturedAt:new Date().toISOString(),sha256:createHash('sha256').update(await readFile(path)).digest('hex')});}
try {
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage();await page.goto('chrome-extension://'+worker.url().split('/')[2]+'/participant/index.html');
 await page.getByLabel('로컬 Credential 파일 불러오기').setInputFiles(join(directory,'participant.json'));
 await page.getByText(/서버 동의 유효/).first().waitFor();
 for(const p of context.pages())if(p!==page)await p.close();
 const send=action=>page.evaluate(action=>chrome.runtime.sendMessage({type:'v2-'+action}),action);
 const state=await send('status'),progress=await send('progress'),authority=await send('access');
 assert.equal(authority.access.local.slot,'C');assert.equal(authority.access.local.policyDigest,original.policyDigest);
 assert.equal(state.lifecycle,'ENDED');assert.equal(state.endPhase,'acked');assert.equal(state.pending,0);assert.equal(state.validVisits,10);
 assert.equal(progress.attempts.length,2);assert.equal(progress.raw.completed,1);assert.equal(progress.planned,53);assert.equal(progress.raw.theoreticalWindows,8);
 for(const old of [original.oldAttempt,original.newAttempt]){
  const a=progress.attempts.find(x=>x.attemptId===old.attemptId);assert.ok(a);assert.equal(a.sessionId,old.sessionId);assert.equal(a.rawStatus,old.rawStatus);assert.equal(a.rawQuality.validVisits,old.rawQuality.validVisits);assert.equal(a.deliveryConfirmed,true);assert.equal(a.analysisState,'NOT_RUN');
 }
 await page.getByLabel('배정 목표').selectOption('PLAN-018');await page.getByRole('button',{name:'진행 상태 새로고침',exact:true}).click();
 await page.getByText(/원본 RAW_COLLECTED/).waitFor();
 await capture(page.locator('.metrics'),'17-current-session-ended.png','Current retained session: ENDED, ten Visits, acked, pending zero; actual metrics element');
 await capture(page.locator('section.work'),'18-current-progress.png','Current work section: C assignment count 53, completion 1, both retained Attempts 4/10, RAW_COLLECTED');
 const api=await context.newPage();await api.route(server+'/api/**',route=>route.continue({headers:{...route.request().headers(),Authorization:'Bearer '+credential}}));
 const response=await api.goto(server+'/api/collection/progress');assert.equal(response.status(),200);
 await capture(api,'19-current-backend-progress.png','Actual authenticated Backend JSON after restart, two Attempts and latest raw completion');
 await writeFile(join(out,'capture-summary.json'),JSON.stringify({result:'PASS',kind:'READ_ONLY_CURRENT_STATE_NOT_HISTORICAL_REENACTMENT',humanResearchSessions:0,chromeVersion:context.browser().version(),captures,raw:progress.raw},null,2)+'\n',{flag:'wx'});
 console.log('PASS: three actual current-state captures; retained 2 Attempts/14 Visits, no new session/visit or consent.');
}finally{await context.close();}
