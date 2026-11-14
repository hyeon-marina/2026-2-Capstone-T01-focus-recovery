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
const policy=JSON.parse(await readFile(process.env.COLLECTION_SITE_POLICY_FILE,'utf8'));
const metadataOnly = policy.metadataOnly === true && policy.pageContent !== true;
const faults=process.env.FOCUS119_FAULTS==='1';
const publicDocuments=process.env.FOCUS121_DOCUMENTS==='1';
if(publicDocuments)assert.ok(faults,'public-document checks include the existing fault suite');
if(faults)assert.equal(policy.pageContent,true);
const dwell=[];
let offlineVisitId;
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
  const path=req.url.split('?')[0];
  const child=publicDocuments && /^\/public\/article-[0-9]+$/.test(path);
  if(publicDocuments&&path==='/public/unsupported'){
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>SYNTHETIC unsupported frame</title><iframe src="http://localhost:8911/public/article-99" style="width:100%;height:750px"></iframe>');return;
  }
  if(!child && !/^\/public\/page-[0-9]+(?:\?page=[0-9]+)?$/.test(req.url)){res.writeHead(404);res.end();return;}
  const n=Number(path.split('-').at(-1));
  const text=`SYNTHETIC TEST ONLY. Controlled TypeScript transaction research with durable local observations and reliable browser storage. You should not enter a credit card on untrusted pages. ${path}`;
  if(child){
    const contents=`<div class="se-main-container"><p>${text}</p><p>Another public paragraph explains the article and its observation contract.</p></div>`;
    res.setHeader('Content-Type','text/html');res.end(`<!doctype html><title>SYNTHETIC blog article ${n}</title><div class="post-body">${n===2?'':contents}</div>${n===2?`<script>setTimeout(()=>document.querySelector('.post-body').innerHTML=${JSON.stringify(contents)},2000)</script>`:''}`);return;
  }
  const focused=faults && req.url==='/public/page-1';
  const delayed=faults && req.url==='/public/page-2';
  const large=faults && req.url==='/public/page-9';
  let body=large?'<section>'.repeat(24)+`<p><span>${text}</span></p>`.repeat(10000)+'</section>'.repeat(24):delayed?'':text;
  let article=`<article>${body}</article>`;
  if(publicDocuments && [1,2,4,5].includes(n))article=`<iframe id="mainFrame" src="/public/article-${n}" style="border:0;width:100%;height:750px"></iframe>`;
  else if(publicDocuments && n===3)article=`<div class="contents_style"><p>${text}</p><p>Another complete paragraph supports a public blog article without semantic HTML.</p></div>`;
  else if(publicDocuments && n===10)article=`<div class="unknown-theme"><p>${text}</p><p>Another complete paragraph supports a coherent generic public article.</p></div>`;
  else if(publicDocuments && n===8)article+=`<iframe id="adFrame" style="width:10px;height:10px" srcdoc="&lt;input type='password'&gt;"></iframe>`;
  const delay=delayed && !(publicDocuments && [1,2,4,5].includes(n));
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><title>SYNTHETIC public page ${n}</title><body>${focused?'<form role="search"><input type="search" name="q" autofocus value="UNSUBMITTED_SYNTHETIC_INPUT"></form>':''}${article}${delay?`<script>setTimeout(()=>document.querySelector('article').textContent=${JSON.stringify(text)},2000)</script>`:''}</body></html>`);
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
      if(faults && n===6){
        worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
        await worker.evaluate(()=>{
          const original=globalThis.fetch;
          globalThis.__ackEvidence={lost:{post:false,patch:false,end:false},postBodies:{},postReplays:0};
          globalThis.fetch=async(input,init)=>{
            const kind=String(input).endsWith('/visits')?'post':init?.method==='PATCH'?'patch':String(input).endsWith('/end')?'end':undefined;
            const e=globalThis.__ackEvidence;
            if(kind==='post'){
              const key=JSON.parse(init.body).visitId;
              if(e.postBodies[key]){if(e.postBodies[key]!==init.body)throw new Error('Immutable POST changed');e.postReplays++;}
              else e.postBodies[key]=init.body;
            }
            const response=await original(input,init);
            if(kind && !e.lost[kind] && response.ok){e.lost[kind]=true;throw new TypeError('Synthetic successful request ACK loss');}
            return response;
          };
        });
      }
      if(n===2){worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>{const original=globalThis.fetch;globalThis.__rawNetworkFailure=true;globalThis.fetch=(input,init)=>{if(globalThis.__rawNetworkFailure&&String(input).endsWith('/visits')){globalThis.__offlineVisitId=JSON.parse(init.body).visitId;return Promise.reject(new TypeError('Synthetic upload outage'));}return original(input,init);};});}
      await page.goto(`http://127.0.0.1:8911/public/page-${metadataOnly ? '1?page='+n : faults&&n===7?1:n}`);await page.bringToFront();
      if(faults && n===9)await worker.evaluate(async()=>{
        const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
        const frame=await chrome.webNavigation.getFrame({tabId:tab.id,frameId:0});
        globalThis.__pulseTimes=[];globalThis.__recordPulses=true;
        chrome.runtime.onMessage.addListener((message,sender)=>{
          if(globalThis.__recordPulses && message.type==='v2-observation' && sender.documentId===frame.documentId)globalThis.__pulseTimes.push(performance.now());
        });
      });
      if(faults && n===4){
        const manager=await context.newPage();await manager.goto('chrome://extensions/');
        const dev=manager.locator('#devMode');
        if(await dev.getAttribute('aria-pressed')!=='true' && !(await dev.evaluate(el=>el.checked)))await dev.click();
        await manager.locator('extensions-item').filter({hasText:'Focus v2 Controlled HTML'}).locator('#dev-reload-button').click();
        await manager.close();
        harness=await context.newPage();
        await harness.goto(`chrome-extension://${id}/participant/index.html`);
        assert.equal((await send('status')).collectionAllowed,false,'reload requires reauthentication');
        await login();
        await page.bringToFront();await send('retry');
        await wait(s=>s.diagnostic?.code==='CONTENT_SCRIPT_UNAVAILABLE','extension reload guidance on existing tab');
        assert.ok((await send('status')).localVisits>=3);
        await page.reload();await page.bringToFront();
      }
      if(faults && (n===1||n===7)) {
        await wait(s=>s.diagnostic?.code==='INPUT_FOCUSED','focused input exclusion');
        assert.equal((await send('status')).quarantined,false);
        await page.locator('input').evaluate(el=>el.blur());
      }
      if(publicDocuments && n===5){
        await wait(s=>s.activeDurationMs>=4000&&s.validVisits===4,'confirmed short source-frame dwell');
        await page.evaluate(()=>{const old=document.querySelector('iframe#mainFrame');const next=old.cloneNode();next.src='/public/article-25';old.replaceWith(next);});
        await page.waitForTimeout(1200);
        assert.equal((await send('status')).validVisits,4,'a replaced frame must not gain the unconfirmed interval to reach five seconds');
        const article=page.frames().find(f=>f.url().includes('/public/article-25'));assert.ok(article);
        await article.evaluate(()=>{history.pushState({},'', '/public/article-15');document.querySelector('.post-body').textContent+=' Public frame SPA navigation.';});
      }
      if(faults && n===6)await page.evaluate(()=>{history.pushState({},'', '/public/page-16');document.querySelector('article').textContent+=' Public SPA navigation.';});
      if(faults && n===8){const other=await context.newPage();await other.goto('about:blank');await other.bringToFront();await page.waitForTimeout(700);await other.close();await page.bringToFront();}
      const started=Date.now();
      if(n===2){
        await wait(s=>s.pending>=1 && (!faults || s.localVisits>=n),'durable offline queue');
        if(faults){
          const deadline=Date.now()+10000;
          while(!offlineVisitId && Date.now()<deadline){offlineVisitId=await worker.evaluate(()=>globalThis.__offlineVisitId);if(!offlineVisitId)await page.waitForTimeout(100);}
          assert.ok(offlineVisitId,'the new Visit POST actually failed before worker restart');
          await capture('network-recovery');
          const cdp=await context.newCDPSession(harness);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await cdp.detach();
        }else {await capture('network-recovery');await worker.evaluate(()=>{globalThis.__rawNetworkFailure=false;});}
        await send('retry');await page.bringToFront();
      }
      await wait(s=>s.validVisits>=n,'measured visit '+n);
      if(faults && n===9){
        const timing=await worker.evaluate(()=>{
          globalThis.__recordPulses=false;
          const samples=globalThis.__pulseTimes;
          return {samples:samples.length,maxGapMs:Math.max(...samples.slice(1).map((t,i)=>t-samples[i]))};
        });
        assert.ok(timing.samples>=3);assert.ok(timing.maxGapMs<=1500,JSON.stringify(timing));
        await writeFile(join(evidence,'large-dom-pulses.json'),JSON.stringify(timing),{mode:0o600});
      }
      dwell.push({visit:n,elapsedMs:Date.now()-started});
      if(n===3){const cdp=await context.newCDPSession(harness);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await cdp.detach();await wait(s=>s.validVisits>=3,'service worker recovery');}
      if(n===5){await capture('collection-progress');await context.close();context=await launch();worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');harness=await context.newPage();await harness.goto(`chrome-extension://${id}/participant/index.html`);assert.equal((await send('status')).collectionAllowed,false);await login();await wait(s=>s.collectionAllowed,'browser reauthentication');page=await context.newPage();}
      console.log(`SYNTHETIC ${slot}: measured visit ${n}/10`);
    }
    if(publicDocuments){
      const before=(await send('progress')).attempts[0].collectionFailures;
      await page.goto('http://127.0.0.1:8911/public/unsupported');await page.bringToFront();
      await wait(s=>s.diagnostic?.code==='FRAME_UNSUPPORTED','unsupported source diagnostic');
      await page.waitForTimeout(6500);
      const after=(await send('progress')).attempts[0].collectionFailures;
      assert.equal(after,before+1,'one unsupported document must not create a failure on every observation');
      assert.equal((await send('status')).validVisits,10);assert.equal((await send('status')).quarantined,false);
    }
    await send('stop');await wait(s=>s.lifecycle==='ENDED'&&s.endPhase==='acked'&&s.pending===0,'end ack and drained queue');
    if(faults){
      const ack=await worker.evaluate(()=>({lost:globalThis.__ackEvidence.lost,postReplays:globalThis.__ackEvidence.postReplays}));
      assert.deepEqual(ack.lost,{post:true,patch:true,end:true});assert.ok(ack.postReplays>=1);
      await writeFile(join(evidence,'ack-loss.json'),JSON.stringify(ack),{mode:0o600});
    }
    let progress;
    for(let i=0;i<100;i++){progress=await send('progress');if(progress.raw.syntheticCompleted===1)break;await send('retry');await new Promise(r=>setTimeout(r,200));}
    assert.equal(progress.raw.syntheticCompleted,1);assert.equal(progress.completed,0);assert.equal(progress.syntheticQualityPassed,0);
    assert.equal(progress.attempts[0].rawStatus,'RAW_COLLECTED');assert.equal(progress.attempts[0].analysisState,'NOT_RUN');assert.equal(progress.attempts[0].analysisWindowCount,0);
    assert.equal(progress.attempts[0].rawQuality.theoreticalWindows,8);assert.equal(progress.attempts[0].quality.validVisits,10);
    await harness.getByRole('button',{name:'진행 상태 새로고침',exact:true}).click();await harness.getByText(/원본 RAW_COLLECTED/).waitFor();await capture('collection-complete');
    const snapshot=await api(owner.credential,'/api/collection/exports','POST',{});assert.equal(snapshot.files.visits.length,10);
    assert.ok(snapshot.files.visits.every(v=>v.activeDurationMs>=5000));
    assert.equal(new Set(snapshot.files.visits.map(v=>v.visitId)).size,10);
    assert.deepEqual(snapshot.files.visits.map(v=>v.sequence).sort((a,b)=>a-b),[1,2,3,4,5,6,7,8,9,10]);
    assert.ok(!JSON.stringify(snapshot).includes('UNSUBMITTED_SYNTHETIC_INPUT'));
    if(publicDocuments){
      const framed=snapshot.files.visits.filter(v=>v.title.startsWith('SYNTHETIC blog article'));
      assert.ok(framed.length>=5,'main-frame content must reach real MySQL, including revisit');
      assert.ok(framed.some(v=>v.content.includes('Public frame SPA navigation.')),'frame SPA content stored');
      assert.ok(!JSON.stringify(snapshot).includes('Unbound document'));
      await writeFile(join(evidence,'public-documents.json'),JSON.stringify({result:'PASS',frameVisits:framed.length,frameSPA:true,genericBlog:true,smallPrivateAdIgnored:true,normalSourceCount:10,manifestAllFrames:false}),{mode:0o600});
    }

    if(faults)assert.ok(snapshot.files.visits.some(v=>v.visitId===offlineVisitId),'same queued ID survives offline worker restart');
    if(metadataOnly) { for (const visit of snapshot.files.visits) { assert.match(visit.normalizedUrl,/\/__focus_page__\/[a-f0-9]{64}$/);assert.equal(visit.content,'METADATA_ONLY: public browsing activity; page text, title and search terms were not collected.');assert.equal(visit.searchQuery,null);assert.equal(visit.title,'Topic: OTHER');assert.ok(!JSON.stringify(visit).includes('Controlled TypeScript')); } assert.equal(new Set(snapshot.files.visits.map(v=>v.normalizedUrl)).size,10); }
    await writeFile(join(evidence,'snapshot.json'),JSON.stringify(snapshot),{mode:0o600});
    await writeFile(join(evidence,'dwell.json'),JSON.stringify(dwell),{mode:0o600});
    await api(operator,`/api/sessions/${progress.attempts[0].sessionId}`,'GET',undefined,404);
    console.log(JSON.stringify({result:'PASS',slot,actualChrome:true,actualSpring:true,actualMySQL:true,aiProcess:false,visits:10,generatedWindows:0,theoreticalWindows:8,workerRestart:true,browserRestart:true,networkRecovery:true,syntheticOnly:true}));
  }
} finally{await context?.close();await new Promise(r=>fixture.close(r));}
