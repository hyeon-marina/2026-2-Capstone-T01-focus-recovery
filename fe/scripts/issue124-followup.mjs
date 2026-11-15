// Opt-in technical validation. Only the previously directly-consented isolated test C is used.
import {chromium} from 'playwright';
import {readFile,writeFile,cp,rename,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash,X509Certificate,randomUUID} from 'node:crypto';
import https from 'node:https';
import {build as bundle} from 'esbuild';
import assert from 'node:assert/strict';
process.umask(0o077);
const mode=process.argv[2];assert.ok(['public','stress'].includes(mode));
const publicPlan=process.env.FOCUS124_PLAN??'PLAN-012';assert.ok(['PLAN-012','PLAN-018'].includes(publicPlan));
const root='/private/tmp/focus124-evidence/stabilization',directory=process.env.FOCUS124_DIRECTORY;
assert.equal(directory,'/private/tmp/focus124-evidence/live-C-final');
const config=JSON.parse(await readFile(directory+'/config.json','utf8'));assert.equal(config.dbPort,33425);assert.equal(config.tlsPort,19425);assert.equal(config.project,'focus-local-707b3782a3f5');
const executable=root+'/cft157/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const extension=root+'/extension-157',profile=root+'/chrome157-pipe-profile',server='https://localhost:19425';
const hash=s=>createHash('sha256').update(s).digest('hex');
const build=JSON.parse(await readFile(extension+'/build-info.json','utf8'));
assert.equal(build.policyDigest,'4c5fe813d703a3ae1d6bf95f3de3aca8ae12c94a5c4a8ca4a161ad29d6dd11f9');assert.equal(build.rawContent,true);
const certBytes=await readFile(directory+'/tls/localhost.pem'),cert=new X509Certificate(certBytes);
const spki=createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64');
const report={kind:'ISOLATED_TECHNICAL_VALIDATION_NOT_RESEARCH_SAMPLE',mode,sourceCommit:build.sourceCommit,policyDigest:build.policyDigest,focusEmulation:false,extensionInstall:'OFFICIAL_CDP_LOCAL_PIPE_DEVELOPMENT_ONLY',steps:[],pages:[],appReturns:[],failures:[]};
const probe=(await bundle({stdin:{contents:"export {extractMainContent,mainContentRoots} from './src/content/extraction';export {articleFrame} from './src/content/article-frame';export {extractSearchContent} from './src/content/search';export {credentialText} from './src/shared/privacy';",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'FocusProbe'})).outputFiles[0].text;
const runId=randomUUID(),output=root+'/'+mode+'-'+runId+'.json';
const save=()=>writeFile(output,JSON.stringify(report,null,2),{mode:0o600});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let context,harness,page,id,sessionId,holdPosts=mode==='stress',interrupted=0;
let nativeSessions=new WeakMap();
const virtual='통제된 공개 테스트 문서 의료 patient 계좌번호 fictional@example.org 010-0000-0000 02-000-0000. '.repeat(3);
function sql(query){const secret=execFileSync('cat',[directory+'/secrets/mysql-root'],{encoding:'utf8'}).trim();return execFileSync('docker',['exec','-i',config.project+'-mysql-1','sh','-c','IFS= read -r MYSQL_PWD; export MYSQL_PWD; exec mysql -uroot --default-character-set=utf8mb4 --batch --skip-column-names focus_collection'],{input:secret+'\n'+query,encoding:'utf8'}).trim();}
const send=(action,extra={})=>harness.evaluate(({action,extra})=>chrome.runtime.sendMessage({type:'v2-'+action,...extra}),{action,extra});
async function natural(p){let session=nativeSessions.get(p);if(!session){session=context.newCDPSession(p);nativeSessions.set(p,session);}const c=await session;await c.send('Emulation.setFocusEmulationEnabled',{enabled:false});}
async function activate(p){
 await natural(p);await p.bringToFront();

 const worker=context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://'+id+'/'))??await context.waitForEvent('serviceworker',{predicate:w=>w.url().startsWith('chrome-extension://'+id+'/')});
 await worker.evaluate(async url=>{const tab=(await chrome.tabs.query({})).filter(t=>t.url===url).at(-1);if(!tab)throw new Error('TEST_TAB_NOT_FOUND');await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true,state:'normal'});},p.url());
 await p.waitForFunction(()=>document.hasFocus()&&document.visibilityState==='visible',undefined,{timeout:5000});
}
function wire(p){p.on('framenavigated',f=>{if(f===p.mainFrame())void natural(p).catch(()=>{});});void natural(p).catch(()=>{});}
async function launch(){
 nativeSessions=new WeakMap();
 context=await chromium.launchPersistentContext(profile,{headless:false,executablePath:executable,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1280,height:920},args:['--enable-unsafe-extension-debugging','--ignore-certificate-errors-spki-list='+spki]});
 const browser=await context.browser().newBrowserCDPSession();const installed=await browser.send('Extensions.loadUnpacked',{path:extension});
 if(id)assert.equal(installed.id,id);id=installed.id;report.extensionId=id;report.chrome=context.browser().version();
 context.on('page',wire);for(const p of context.pages())wire(p);
 await context.route(server+'/api/sessions/*/visits',r=>{if(holdPosts&&r.request().method()==='POST'){interrupted++;return r.abort('internetdisconnected');}return r.continue();});
 await context.route('https://controlled.focus-recovery.org/**',r=>{
  const path=new URL(r.request().url()).pathname;
  const body=path==='/credential'?'<title>Controlled credential exclusion</title><article>'+virtual+'{&quot;비밀번호&quot;:&quot;fictional-value&quot;}</article>':path==='/dynamic'?'<title>Controlled dynamic article</title><main></main><script>setTimeout(()=>document.querySelector("main").textContent='+JSON.stringify(virtual)+',2500)</script>':'<title>Controlled raw article</title><article>'+virtual+'<form><input type="password" value="NEVER_COLLECT_PASSWORD"><textarea>NEVER_COLLECT_DRAFT</textarea></form></article>';
  return r.fulfill({contentType:'text/html; charset=utf-8',body});
 });
 harness=await context.newPage();await harness.goto('chrome-extension://'+id+'/participant/index.html');await activate(harness);await natural(harness);
 await harness.getByLabel('로컬 Credential 파일 불러오기').setInputFiles(directory+'/participant.json');
 await harness.getByText(/로컬 슬롯 C/).waitFor();const access=await send('access');assert.equal(access.access?.consentValid,true,'requires existing direct consent; never accepts consent automatically');assert.equal(access.access.policy.policyVersion,'7');
 report.directConsentVerified=true;await save();
}
async function state(){return harness.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('focus-recovery');r.onerror=()=>reject('IDB_READ_FAILED');r.onsuccess=()=>{const db=r.result,tx=db.transaction(['v2','v2-receipts'],'readonly'),q=tx.objectStore('v2').get('current');q.onsuccess=()=>{const s=q.result,receipts=tx.objectStore('v2-receipts').getAll(IDBKeyRange.bound(s.session.sessionId+'/',s.session.sessionId+'/\uffff'));receipts.onsuccess=()=>{resolve({session:s.session.sessionId,candidates:s.candidates.map(c=>({id:c.id,duration:c.behavior.activeDurationMs,post:!!c.post,excluded:c.excluded})),rows:[...receipts.result.map(r=>({id:r.visitId,sequence:r.sequence,...r.behaviorAck})),...s.posts.entries.map(p=>({id:p.visitId,sequence:p.sequence,...(s.behaviors.entries.find(b=>b.visitId===p.visitId)?.ack??p.serverBehavior??p.visit)}))]});db.close();};};};}));}
async function wait(test,label,limit=65000){let last;const start=Date.now();while(Date.now()-start<limit){last=await send('status');assert.equal(last.storageFailed,false);assert.equal(last.quarantined,false);if(test(last))return last;await delay(200);}throw new Error('Timeout '+label+' '+JSON.stringify(last));}
async function checkpoint(label,n){const s=await send('status'),p=await send('progress'),a=p.attempts.find(a=>a.sessionId===sessionId);assert.ok(a);assert.match(sessionId,/^[a-f0-9-]{36}$/);const count=Number(sql(`SELECT COUNT(*) FROM page_visit WHERE session_id='${sessionId}';`));if(n!==undefined){assert.equal(s.localVisits,n);assert.equal(s.validVisits,n);assert.equal(count,n);assert.equal(s.pending,0);}const row={label,local:s.localVisits,acked:s.validVisits,mysql:count,pending:s.pending,lifecycle:s.lifecycle,privacy:a.privacyStatus,rawStatus:a.rawStatus,sessionHash:hash(sessionId)};report.steps.push(row);await save();console.log(JSON.stringify(row));return {s,a};}
async function start(plan){await activate(harness);await harness.getByLabel('배정 목표').selectOption(plan);await harness.getByRole('button',{name:'세션 시작',exact:true}).click();await wait(s=>s.lifecycle==='ACTIVE'&&s.localVisits===0,'start');sessionId=(await state()).session;report.assignment=plan;report.sessionHash=hash(sessionId);await checkpoint('start',0);}
async function finish(n){await activate(harness);await harness.getByRole('button',{name:'세션 종료 · 수집 중지',exact:true}).click();await wait(s=>s.lifecycle==='ENDED'&&s.endPhase==='acked'&&s.pending===0,'end');return checkpoint('ended',n);}
async function inspect(p,label){const details=await p.evaluate(source=>{const code=new Function(source+';return FocusProbe;')();const selected=code.articleFrame(document,location.href),d=selected.frame?.document??document,roots=code.mainContentRoots(d),search=/^(?:www\.google\.com|search\.naver\.com)$/.test(location.hostname);let extractionLength=0,extractionCode='SUCCESS',organicResultCount=null;try{const extracted=search?code.extractSearchContent(d,location.href,false,true):null;if(search)organicResultCount=extracted?.organicResultCount??0;const text=search?extracted?.content:code.extractMainContent(d,true,false,true);extractionLength=text?[...text].length:0;if(!text)extractionCode='NO_CONTENT';}catch(e){extractionCode=e.message;}const credentialMarkers=[...d.querySelectorAll('h3,[class*="headline"],.VwiC3b,[class*="desc"],[class*="snippet"]')].filter(e=>code.credentialText(e.textContent??'')).map(e=>({tag:e.tagName,classes:e.className,key:(e.textContent??'').match(/(password|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?(?:id|token|key|credential)|cookie|passwd|secret|비밀번호)\s*["']?\s*[:=]/i)?.[1]??'Bearer'})).slice(0,8);return {organicResultCount,advertisementContainers:d.querySelectorAll('#tads,#tadsb,#power_link,[data-block-id^="ad/"]').length,generator:d.querySelector('meta[name="generator"]')?.getAttribute('content')??null,titleLength:d.title.length,iframe:!!selected.frame,frameDiagnostic:selected.diagnostic,extractionLength,extractionCode,credentialMarkers,roots:roots.map(r=>({tag:r.tagName,id:r.id,classes:r.className,textLength:(r.textContent??'').length})).slice(0,12)};},probe);if(/preflight/.test(label))assert.ok(details.organicResultCount>0);report.pages.push({label,url:p.url(),...details});await save();console.log('PAGE_PROBE '+JSON.stringify({label,extractionCode:details.extractionCode,extractionLength:details.extractionLength,credentialMarkers:details.credentialMarkers}));}
async function collect(label,url,n){page??=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await natural(page);await activate(page);await wait(s=>s.validVisits===n,label);await inspect(page,label);if([1,5,10].includes(n))await checkpoint(label,n);}
async function search(engine,query,n,recoverStored=false){
 if(recoverStored)await activate(harness);page??=await context.newPage();await page.goto(engine==='google'?'https://www.google.com/':'https://www.naver.com/',{waitUntil:'domcontentloaded'});await natural(page);if(!recoverStored)await activate(page);
 const input=page.locator(engine==='google'?'textarea[name="q"],input[name="q"]':'input[name="query"]').first();await input.fill(query);await input.press('Enter');
 await page.waitForURL(engine==='google'?/google\.[^/]+\/search\?/:/search\.naver\.com\/search.naver\?/);await natural(page);
 const results=page.locator(engine==='google'?'#search #rso a:has(h3)':'#main_pack a[href]:has([class*="headline"])');await results.first().waitFor({timeout:45000});await inspect(page,engine+' preflight');await activate(page);
 if(!recoverStored){await wait(s=>s.validVisits===n,engine+' search');await inspect(page,engine+' search');if(n===1)await checkpoint('one',1);}
 const row=JSON.parse(sql(`SELECT JSON_OBJECT('query',search_query,'search',is_search_result_page+0,'length',CHAR_LENGTH(content)) FROM page_visit WHERE session_id='${sessionId}' AND sequence=${n};`));assert.equal(row.query,query);assert.equal(row.search,1);assert.ok(row.length>0);report[engine]={query,rendered:true,storedQueryEqual:true,organicContentStored:true};
 const desired=engine==='google'?'martinfowler.com':'notice.tistory.com';const links=await results.evaluateAll(nodes=>nodes.map(n=>n.href));let index=links.findIndex(url=>{try{return new URL(url).hostname===desired;}catch{return false;}});if(index<0&&engine==='google')index=links.findIndex(url=>new URL(url).hostname==='www.google.com'&&new URL(url).pathname==='/goto');assert.ok(index>=0,'expected organic result');
 const newPage=context.waitForEvent('page',{timeout:10000}).catch(()=>null);await results.nth(index).click();const opened=await newPage;if(opened)page=opened;await page.waitForURL(u=>u.hostname===desired||engine==='google'&&u.hostname==='refactoring.com',{timeout:45000,waitUntil:'domcontentloaded'});await natural(page);await activate(page);await wait(s=>s.validVisits===n+1,engine+' result');await inspect(page,engine+' result');report[engine].landingHost=new URL(page.url()).hostname;await save();
}
async function reconcile(){const local=(await state()).rows;const db=sql(`SELECT visit_id,sequence,active_duration_ms,tab_switch_count,behavior_version FROM page_visit WHERE session_id='${sessionId}' ORDER BY sequence;`).split('\n').filter(Boolean).map(l=>{const [id,sequence,duration,switches,version]=l.split('\t');return {id,sequence:+sequence,activeDurationMs:+duration,tabSwitchCount:+switches,behaviorVersion:+version};});assert.equal(local.length,db.length);assert.equal(new Set(local.map(r=>r.id)).size,db.length);for(const r of db){const l=local.find(l=>l.id===r.id);assert.ok(l);for(const k of ['sequence','activeDurationMs','tabSwitchCount','behaviorVersion'])assert.equal(l[k],r[k]);}report.reconciled={count:db.length,idsSequencesBehaviorEqual:true,minimumActiveMs:Math.min(...db.map(r=>r.activeDurationMs))};await save();}
async function appReturn(seconds,n){
 page=await context.newPage();await page.goto('https://controlled.focus-recovery.org/raw-'+seconds);await natural(page);await activate(page);await wait(s=>s.activeDurationMs>=3000&&s.localVisits===n-1,'partial '+seconds);
 const initial=(await state()).candidates.find(c=>!c.post&&c.duration>=3000);assert.ok(initial);const c=await context.newCDPSession(page),target=(await c.send('Target.getTargetInfo')).targetInfo.targetId,b=await context.browser().newBrowserCDPSession(),{windowId}=await b.send('Browser.getWindowForTarget',{targetId:target});
 await b.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});const began=Date.now();await delay(300);assert.equal(await page.evaluate(()=>document.hasFocus()),false);const gate=root+'/APP_READY_'+runId+'_'+seconds;console.log('APP_INACTIVE '+JSON.stringify({seconds,gate}));report.waitingForApp=seconds;await save();
 let activated=false;for(let i=0;i<450;i++){try{await access(gate);activated=true;break;}catch{await delay(200);}}assert.ok(activated,'native other app must be raised before timing');
 await delay(seconds*1000);const paused=(await state()).candidates.find(c=>c.id===initial.id);assert.ok(paused);assert.ok(paused.duration<5000);assert.ok(paused.duration<=initial.duration+1500);const inactiveMs=Date.now()-began;
 await b.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});await natural(page);await activate(page);await wait(s=>s.localVisits===n,'app return '+seconds);const returned=(await state()).candidates.find(c=>c.id===initial.id);assert.ok(returned?.post);assert.ok(returned.duration>=5000&&returned.duration<12000);
 report.appReturns.push({requestedSeconds:seconds,inactiveMs,initialMs:initial.duration,finalMs:returned.duration,sameId:true});delete report.waitingForApp;await save();console.log('APP_RETURN_PASS_'+seconds);
}
async function authPost(path,body){const credential=JSON.parse(await readFile(directory+'/participant.json','utf8')).credential;return new Promise((resolve,reject)=>{const req=https.request(server+path,{method:'POST',ca:certBytes,headers:{authorization:'Bearer '+credential,'content-type':'application/json'}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});req.on('error',reject);req.end(JSON.stringify(body));});}
async function mixedVersions(original){
 const saved=extension+'-v7-'+randomUUID(),legacy=extension+'-v6-'+randomUUID();await rename(extension,saved);await cp(root+'/v6-code/fe/dist-real',extension,{recursive:true});
 async function reload(){const c=await context.browser().newBrowserCDPSession();assert.equal((await c.send('Extensions.loadUnpacked',{path:extension})).id,id);harness=await context.newPage();await harness.goto('chrome-extension://'+id+'/participant/index.html');await activate(harness);await natural(harness);await harness.getByLabel('로컬 Credential 파일 불러오기').setInputFiles(directory+'/participant.json');await harness.getByText(/로컬 슬롯 C/).waitFor();}
 try{await reload();const s=await send('status');assert.equal(s.collectionAllowed,false);assert.equal(s.quarantined,false);assert.equal((await state()).rows[0].id,original);report.oldFeNewBeQueuePreserved=true;
 }finally{await rename(extension,legacy);await rename(saved,extension);await reload();}
 const p=JSON.parse(await readFile(root+'/v6-code/docs/data-collection/TEAM_POLICY.json','utf8'));
 const oldPolicy={digest:hash(await readFile(root+'/v6-code/docs/data-collection/TEAM_POLICY.json')),buildId:p.buildId,policyId:p.policyId,policyVersion:p.policyVersion,status:'APPROVED',expiresAt:p.expiresAt,sites:p.sites,metadataOnly:true,publicWeb:true,pageContent:true};
 const fixture=r=>r.fulfill({json:oldPolicy});await context.route(server+'/api/collection/site-policy',fixture);
 try{await send('access');const s=await send('status');assert.equal(s.collectionAllowed,false);assert.equal(s.quarantined,false);assert.equal((await state()).rows[0].id,original);report.newFeOldPolicyResponseQueuePreserved=true;
 }finally{await context.unroute(server+'/api/collection/site-policy',fixture);}
 await send('resume',{plannedSessionId:'PLAN-015'});assert.equal((await state()).rows[0].id,original);await save();
}
const before=sql("SELECT CONCAT(visit_id,':',sequence,':',SHA2(content,256)) FROM page_visit ORDER BY visit_id;");
try {
 await launch();
 if(mode==='public'){
  const current=await send('status');
  if(current.lifecycle==='ACTIVE'){
   assert.equal(current.sessionAssignment,publicPlan);assert.ok(current.validVisits>=2&&current.validVisits<=10);await send('resume',{plannedSessionId:publicPlan});sessionId=(await state()).session;report.assignment=publicPlan;report.resumedStoredVisits=current.validVisits;await checkpoint('resumed',current.validVisits);
   const stored=sql(`SELECT domain FROM page_visit WHERE session_id='${sessionId}' ORDER BY sequence;`).split('\n');assert.deepEqual(stored.slice(0,2),['www.google.com','refactoring.com']);report.retainedGoogleSearchAndRedirect=true;
  }else{await start(publicPlan);await search('google','site:martinfowler.com refactoring',1);}
  let count=(await send('status')).validVisits;
  if(count<4)await search('naver','site:notice.tistory.com 티스토리 공지',3,count===3);else report.retainedNaverSearchAndResult=true;
  count=(await send('status')).validVisits;
  if(count<5)await collect('second-tistory-skin','https://goddaehee.tistory.com/199',5);if(count<6)await collect('naver-mainFrame','https://blog.naver.com/insaweb/221650456057',6);
  if(count<7)await collect('wordpress-new-article','https://www.joelonsoftware.com/2000/08/09/the-joel-test-12-steps-to-better-code/',7);
  if(count<8)await collect('official-blogger-post','https://blogger.googleblog.com/2020/05/a-better-blogger-experience-on-web.html',8);
  if(count<10){await collect('dynamic-react-document','https://react.dev/learn',9);await page.getByRole('link',{name:'Thinking in React',exact:true}).first().click();await page.waitForURL('https://react.dev/learn/thinking-in-react',{waitUntil:'domcontentloaded'});await natural(page);await activate(page);await wait(s=>s.validVisits===10,'SPA document');await inspect(page,'react-SPA-navigation');}await checkpoint('ten',10);
  const final=await finish(10);assert.equal(final.a.rawStatus,'RAW_COLLECTED');await reconcile();report.final={...report.steps.at(-1),endPhase:final.s.endPhase};
 }else{
  const existing=await send('status');if(existing.lifecycle==='ACTIVE'){assert.equal(existing.sessionAssignment,'PLAN-015');assert.equal(existing.localVisits,1);assert.equal(existing.validVisits,0);await send('resume',{plannedSessionId:'PLAN-015'});sessionId=(await state()).session;report.retainedPendingAfterHarnessFocusFailure=true;}else{await start('PLAN-015');await appReturn(10,1);}await wait(()=>interrupted>0,'interrupted POST');const pending=await state(),original=pending.rows[0].id;
  await mixedVersions(original);
  const cdp=await context.newCDPSession(harness);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await cdp.detach();await wait(s=>s.localVisits===1&&s.validVisits===0,'worker restores queue');assert.equal((await state()).rows[0].id,original);report.workerRestartWithPending=true;
  sql("UPDATE access_credential SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE participant_id=(SELECT participant_id FROM collection_local_owner WHERE owner_key=1) AND revoked_at IS NULL;");assert.equal((await send('access')).error,'authentication');await context.close();context=undefined;
  const jdk=execFileSync('/usr/libexec/java_home',['-v','21'],{encoding:'utf8'}).trim();execFileSync('python3',['../tools/individual-local/local.py','--directory',directory,'setup','--slot','C','--rotate-credential'],{env:{...process.env,JAVA_HOME:jdk,PATH:jdk+'/bin:'+process.env.PATH},stdio:['ignore','ignore','pipe'],timeout:120000});
  await launch();sessionId=(await state()).session;assert.equal((await state()).rows[0].id,original);holdPosts=false;await send('retry');await wait(s=>s.validVisits===1&&s.pending===0,'queue recovery');report.chromeRestartAndReauthentication=true;report.actualInterruptedPosts=interrupted;
  for(const [seconds,n] of [[10,2],[60,3],[300,4]]){await appReturn(seconds,n);await wait(s=>s.validVisits===n&&s.pending===0,'app ACK '+seconds);}
  const first=await context.newPage();await first.goto('https://controlled.focus-recovery.org/tab-a');await natural(first);await activate(first);await wait(s=>s.activeDurationMs>=3000&&s.localVisits===4,'first tab partial');const a=(await state()).candidates.find(c=>!c.post&&c.duration>=3000);assert.ok(a);
  const second=await context.newPage();await second.goto('https://controlled.focus-recovery.org/tab-b');await natural(second);await activate(second);await wait(s=>s.activeDurationMs>=2500&&s.localVisits===4,'second tab partial');await activate(first);await wait(s=>s.validVisits===5,'multi-tab return');assert.ok((await state()).candidates.find(c=>c.id===a.id)?.post);report.multiTabReturn=true;page=first;
  await collect('controlled-dynamic-render','https://controlled.focus-recovery.org/dynamic',6);
  const stored=sql(`SELECT content FROM page_visit WHERE session_id='${sessionId}' AND sequence=1;`);assert.ok(stored.includes('fictional@example.org')&&stored.includes('010-0000-0000')&&!stored.includes('NEVER_COLLECT'));report.virtualRawAndFormsProtected=true;
  await page.goto('https://controlled.focus-recovery.org/credential');await natural(page);await activate(page);await delay(8000);const excluded=await send('status');assert.equal(excluded.validVisits,6);assert.equal(excluded.quarantined,false);assert.equal(excluded.lifecycle,'ACTIVE');report.quotedCredentialPageExcluded=true;
  await collect('next-real-public-document','https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers',7);const final=await finish(7);await reconcile();report.final={...report.steps.at(-1),endPhase:final.s.endPhase};
  await activate(harness);let requests=0;context.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/recollect'))requests++;});
  await harness.getByRole('button',{name:'PLAN-003 · Visit 10 · 정상 완료 재수집 검토',exact:true}).click();await harness.keyboard.press('Enter');assert.equal(await harness.getByRole('dialog').count(),0);assert.equal(requests,0);
  await harness.getByRole('button',{name:'PLAN-015 · Visit 7 · 재수집 대상 확인',exact:true}).click();await harness.getByRole('dialog').getByRole('button',{name:'PLAN-015 재수집 확정',exact:true}).focus();await harness.keyboard.press('Enter');await harness.keyboard.press('Enter');await wait(()=>requests===1,'one keyboard recollect');report.keyboardTargetSafe=true;
  const progress=await send('progress'),target=progress.attempts.find(a=>a.plannedSessionId==='PLAN-009');assert.equal(target.rawQuality.validVisits,2);assert.equal(target.reviewStatus,'PENDING');
  const completedBefore=progress.attempts.filter(a=>a.rawStatus==='RAW_COLLECTED').map(a=>({id:a.attemptId,session:a.sessionId,plan:a.plannedSessionId,visits:a.rawQuality.validVisits}));
  const body={reasonCode:'INSUFFICIENT_VISITS',plannedSessionId:target.plannedSessionId,sessionId:target.sessionId,confirmCompleted:false};assert.deepEqual(await Promise.all([authPost('/api/collection/attempts/'+target.attemptId+'/recollect',body),authPost('/api/collection/attempts/'+target.attemptId+'/recollect',body)]),[204,204]);
  assert.equal(Number(sql(`SELECT COUNT(*) FROM collection_audit WHERE action='LOCAL_RECOLLECT' AND target_id='${target.attemptId}';`)),1);
  const after=(await send('progress')).attempts;for(const old of completedBefore){const a=after.find(a=>a.attemptId===old.id);assert.equal(a.sessionId,old.session);assert.equal(a.plannedSessionId,old.plan);assert.equal(a.rawQuality.validVisits,old.visits);assert.equal(a.rawStatus,'RAW_COLLECTED');}report.concurrentRecollectPreservedCompleted=true;
 }
 const after=sql("SELECT CONCAT(visit_id,':',sequence,':',SHA2(content,256)) FROM page_visit ORDER BY visit_id;").split('\n');for(const old of before.split('\n').filter(Boolean))assert.ok(after.includes(old));report.previousVisitsUnchanged=true;report.result='PASS';await save();console.log('PASS '+mode+' '+output);
}catch(error){report.result='FAILED';report.error=String(error);report.currentPage=page?.url();if(page&&!page.isClosed())await inspect(page,'failed-page').catch(()=>{});report.status=harness&&!harness.isClosed()?await send('status').catch(()=>null):null;await save();console.error(String(error));console.log(output);process.exitCode=1;}finally{await context?.close();}
