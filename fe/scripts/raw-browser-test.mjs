// Actual MV3 extension + controlled HTML + isolated Spring/MySQL. No AI process or real participants.
import { chromium } from 'playwright';
import { build } from 'vite';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const server=process.env.FOCUS101_SERVER,slot=process.env.FOCUS101_SLOT,evidence=process.env.FOCUS101_EVIDENCE;
assert.match(server??'',/^http:\/\/127\.0\.0\.1:1810[123]$/);assert.match(slot??'',/^[ABC]$/);assert.ok(evidence);
const metadataOnly = JSON.parse(await readFile(process.env.COLLECTION_SITE_POLICY_FILE,'utf8')).metadataOnly === true;
const operator=JSON.parse(await readFile(join(evidence,'operator.json'),'utf8')).credential;
async function api(token,path,method='GET',body,expected=200) {
  const r=await fetch(server+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal(r.status,expected,`${method} ${path}`);const raw=await r.text();return raw?JSON.parse(raw):undefined;
}
let owner;
if(process.env.FOCUS101_WITHDRAW_ONLY==='1')owner=JSON.parse(await readFile(join(evidence,'participant.json'),'utf8'));
else {
  await api(operator,'/api/collection/admin/plan/initialize','POST',{});
  owner=await api(operator,'/api/collection/admin/participants','POST',{identityReferenceHash:createHash('sha256').update(randomUUID()).digest('hex'),evidenceRef:'synthetic-101-roster-'+slot});
  const issued=await api(operator,`/api/collection/admin/participants/${owner.participantId}/credentials`,'POST',{expiresAt:new Date(Date.now()+3600000).toISOString(),evidenceRef:'synthetic-101-issue-'+slot});
  owner={participantId:owner.participantId,credential:issued.credential};await writeFile(join(evidence,'participant.json'),JSON.stringify(owner),{mode:0o600});
  let plan=await api(operator,'/api/collection/admin/plan');
  plan.slots=plan.slots.map(s=>s.slotId===slot?{slotId:slot,participantId:owner.participantId}:s);
  plan.goals[0]={goalId:'GOAL-001',description:'Synthetic TypeScript transaction research',status:'CONFIRMED',evidenceRef:'synthetic-101-fixture'};
  await api(operator,'/api/collection/admin/plan','PUT',plan);
}
const extension=join(evidence,'extension');
process.env.VITE_API_BASE_URL=server;
await build({configFile:resolve('vite.real.config.ts'),mode:'controlled-web',build:{outDir:extension}});
await build({configFile:resolve('vite.real.content.config.ts'),build:{outDir:extension}});
const fixture=createServer((req,res)=>{
  if(!/^\/public\/page-[0-9]+(?:\?page=[0-9]+)?$/.test(req.url)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><title>SYNTHETIC public page ${req.url.split('-').at(-1)}</title><body><article>SYNTHETIC TEST ONLY. Controlled TypeScript transaction research with durable local observations and reliable browser storage. No participant or personal information is present. ${req.url}</article></body></html>`);
});
await new Promise((r,j)=>{fixture.once('error',j);fixture.listen(8911,'127.0.0.1',r);});
let context,harness;
const launch=()=>chromium.launchPersistentContext(join(evidence,'chrome-profile'),{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH,viewport:{width:1280,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const send=(action,extra={})=>harness.evaluate(({action,extra})=>chrome.runtime.sendMessage({type:`v2-${action}`,...extra}),{action,extra});
async function wait(check,label,timeout=30000){const start=Date.now();while(Date.now()-start<timeout){const s=await send('status');assert.equal(s.storageFailed,false,label);if(check(s))return s;await new Promise(r=>setTimeout(r,200));}throw new Error('Timeout: '+label+'; '+JSON.stringify(await send('status')));}
async function login(){await harness.getByLabel('발급 자격정보').fill(owner.credential);await harness.getByRole('button',{name:'인증 / 계정 전환',exact:true}).click();await harness.getByText(/인증됨/).waitFor();await harness.getByLabel('발급 자격정보').fill('');}
const capture=async name=>{await harness.bringToFront();await harness.screenshot({path:join(evidence,name+'.png'),fullPage:true});};
try {
  context=await launch();let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=worker.url().split('/')[2];
  harness=await context.newPage();await harness.goto(`chrome-extension://${id}/participant/index.html`);
  if(process.env.FOCUS101_WITHDRAW_ONLY==='1'){
    await login();await harness.getByRole('button',{name:'전체 동의 철회 · 수집 즉시 중지',exact:true}).click();await wait(s=>s.withdrawalPhase==='acknowledged','withdrawal');
    await harness.getByText(/동의 철회됨/).waitFor();await capture('withdrawal');
    const final=await api(operator,'/api/collection/admin/progress');assert.equal(final.raw.syntheticCompleted,0);assert.equal(final.attempts[0].rawStatus,'QUARANTINED');
    console.log(JSON.stringify({result:'PASS',slot,withdrawal:true,syntheticOnly:true}));
  } else {
    const manager=await context.newPage();await manager.goto('chrome://extensions/');await manager.screenshot({path:join(evidence,'extension-install.png'),fullPage:true});await manager.close();
    await capture('extension-login');
    assert.ok((await send('start',{plannedSessionId:'PLAN-001'})).error);
    await login();await capture('consent');
    await harness.getByRole('checkbox').check();await harness.getByRole('button',{name:'합성 동의 기록 저장',exact:true}).click();await harness.getByText(/서버 동의 유효/).waitFor();
    const planned='PLAN-00'+({A:1,B:2,C:3}[slot]);
    await harness.getByLabel('배정 목표').selectOption(planned);await capture('collection-goal');
    await harness.getByRole('button',{name:'세션 시작',exact:true}).click();await wait(s=>s.lifecycle==='ACTIVE','start');await capture('collection-start');
    let page=await context.newPage();
    for(let n=1;n<=10;n++){
      if(n===2){worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>{const original=globalThis.fetch;globalThis.__rawNetworkFailure=true;globalThis.fetch=(input,init)=>globalThis.__rawNetworkFailure&&String(input).endsWith('/visits')?Promise.reject(new TypeError('Synthetic upload outage')):original(input,init);});}
      await page.goto(`http://127.0.0.1:8911/public/page-${metadataOnly ? '1?page='+n : n}`);await page.bringToFront();
      if(n===2){await wait(s=>s.pending>=1,'durable offline queue');await capture('network-recovery');await worker.evaluate(()=>{globalThis.__rawNetworkFailure=false;});await send('retry');await page.bringToFront();}
      await wait(s=>s.validVisits>=n,'measured visit '+n);
      if(n===3){const cdp=await context.newCDPSession(harness);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await cdp.detach();await wait(s=>s.validVisits>=3,'service worker recovery');}
      if(n===5){await capture('collection-progress');await context.close();context=await launch();worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');harness=await context.newPage();await harness.goto(`chrome-extension://${id}/participant/index.html`);assert.equal((await send('status')).collectionAllowed,false);await login();await wait(s=>s.collectionAllowed,'browser reauthentication');page=await context.newPage();}
      console.log(`SYNTHETIC ${slot}: measured visit ${n}/10`);
    }
    await send('stop');await wait(s=>s.lifecycle==='ENDED'&&s.endPhase==='acked','end ack');
    let progress;
    for(let i=0;i<100;i++){progress=await send('progress');if(progress.raw.syntheticCompleted===1)break;await send('retry');await new Promise(r=>setTimeout(r,200));}
    assert.equal(progress.raw.syntheticCompleted,1);assert.equal(progress.completed,0);assert.equal(progress.syntheticQualityPassed,0);
    assert.equal(progress.attempts[0].rawStatus,'RAW_COLLECTED');assert.equal(progress.attempts[0].analysisState,'NOT_RUN');assert.equal(progress.attempts[0].analysisWindowCount,0);
    assert.equal(progress.attempts[0].rawQuality.theoreticalWindows,8);assert.equal(progress.attempts[0].quality.validVisits,10);
    await harness.getByRole('button',{name:'진행 상태 새로고침',exact:true}).click();await harness.getByText(/원본 RAW_COLLECTED/).waitFor();await capture('collection-complete');
    const snapshot=await api(owner.credential,'/api/collection/exports','POST',{});assert.equal(snapshot.files.visits.length,10);
    if(metadataOnly) { for (const visit of snapshot.files.visits) { assert.match(visit.normalizedUrl,/\/__focus_page__\/[a-f0-9]{64}$/);assert.equal(visit.content,'METADATA_ONLY: public browsing activity; page text, title and search terms were not collected.');assert.equal(visit.searchQuery,null);assert.equal(visit.title,'Topic: OTHER');assert.ok(!JSON.stringify(visit).includes('Controlled TypeScript')); } assert.equal(new Set(snapshot.files.visits.map(v=>v.normalizedUrl)).size,10); }
    await writeFile(join(evidence,'snapshot.json'),JSON.stringify(snapshot),{mode:0o600});
    await api(operator,`/api/sessions/${progress.attempts[0].sessionId}`,'GET',undefined,404);
    console.log(JSON.stringify({result:'PASS',slot,actualChrome:true,actualSpring:true,actualMySQL:true,aiProcess:false,visits:10,generatedWindows:0,theoreticalWindows:8,workerRestart:true,browserRestart:true,networkRecovery:true,syntheticOnly:true}));
  }
} finally{await context?.close();await new Promise(r=>fixture.close(r));}
