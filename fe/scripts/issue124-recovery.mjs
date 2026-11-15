// Opt-in visible Chrome + actual public pages + existing directly-consented isolated test owner.
// Never creates consent, inserts Visits, changes clocks, spoofs focus or opens operating C.
import {chromium} from 'playwright';
import {build} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
process.umask(0o077);
const directory=process.env.FOCUS124_DIRECTORY;
assert.equal(directory,'/private/tmp/focus124-evidence/live-C-final');
const config=JSON.parse(await readFile(join(directory,'config.json'),'utf8'));
assert.equal(config.dbPort,33425);assert.equal(config.tlsPort,19425);
const server='https://localhost:19425',extension=join(directory,'extension');
const policy=JSON.parse(await readFile(join(directory,'site-policy.json'),'utf8'));
assert.equal(policy.policyVersion,'7');assert.equal(policy.contentPrivacy,'CONSENTED_RAW');
process.env.VITE_API_BASE_URL=server;process.env.COLLECTION_SITE_POLICY_FILE=join(directory,'site-policy.json');
await build({configFile:resolve('vite.real.config.ts'),mode:'real-collection',build:{outDir:extension}});
await build({configFile:resolve('vite.real.content.config.ts'),build:{outDir:extension}});
const certificate=new X509Certificate(await readFile(join(directory,'tls/localhost.pem')));
const pin=createHash('sha256').update(certificate.publicKey.export({type:'spki',format:'der'})).digest('base64');
const digest=value=>createHash('sha256').update(value).digest('hex');
const report={kind:'ISOLATED_TECHNICAL_PUBLIC_BROWSER_NOT_RESEARCH_SAMPLE',policyDigest:digest(await readFile(join(directory,'site-policy.json'))),steps:[],pages:[],failures:[]};
const output=join(directory,'recovery-result.json');
const save=()=>writeFile(output,JSON.stringify(report,null,2),{mode:0o600});
let context,harness,page,id,holdPosts=true,postFailures=0;
const waitMs=ms=>new Promise(r=>setTimeout(r,ms));
const send=(action,extra={})=>harness.evaluate(({action,extra})=>chrome.runtime.sendMessage({type:'v2-'+action,...extra}),{action,extra});
function sql(query){const password=execFileSync('cat',[join(directory,'secrets/mysql-root')],{encoding:'utf8'}).trim();return execFileSync('docker',['exec','-i',config.project+'-mysql-1','sh','-c','IFS= read -r MYSQL_PWD; export MYSQL_PWD; exec mysql -uroot --batch --skip-column-names focus_collection'],{input:password+'\n'+query,encoding:'utf8'}).trim();}
async function launch(){
 context=await chromium.launchPersistentContext(join(directory,'chrome-profile'),{headless:false,channel:'chromium',executablePath:process.env.CHROMIUM_PATH,viewport:{width:1280,height:920},args:['--ignore-certificate-errors-spki-list='+pin,`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 await context.route(server+'/api/sessions/*/visits',route=>{
  if(holdPosts&&route.request().method()==='POST'){postFailures++;return route.abort('internetdisconnected');}
  return route.continue();
 });
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 // Playwright defaults to emulated document focus. Disable it: only native Chrome focus may create Visits.
 for(const p of context.pages()){const c=await context.newCDPSession(p);await c.send('Emulation.setFocusEmulationEnabled',{enabled:false});await c.detach();}
 context.on('page',async p=>{try{const c=await context.newCDPSession(p);await c.send('Emulation.setFocusEmulationEnabled',{enabled:false});await c.detach();}catch{}});
 report.focusEmulation=false;
 const current=worker.url().split('/')[2];if(id)assert.equal(current,id);id=current;report.extensionId=id;report.browser=context.browser().version();
 harness=await naturalPage();await harness.goto('chrome-extension://'+id+'/participant/index.html');
 await harness.getByLabel('로컬 Credential 파일 불러오기').setInputFiles(join(directory,'participant.json'));
 await harness.getByText(/로컬 슬롯 C/).waitFor();
 const access=await send('access');assert.equal(access.access?.consentValid,true,'requires existing direct v7 consent; never auto-consent');
}
async function naturalFocus(p){const c=await context.newCDPSession(p);await c.send('Emulation.setFocusEmulationEnabled',{enabled:false});return c;}
async function naturalPage(){const p=await context.newPage();const c=await context.newCDPSession(p);await c.send('Emulation.setFocusEmulationEnabled',{enabled:false});await c.detach();return p;}
async function wait(test,label,limit=60000){const start=Date.now();let s;while(Date.now()-start<limit){s=await send('status');assert.equal(s.storageFailed,false);if(test(s))return s;await waitMs(200);}throw new Error('Timeout '+label+' '+JSON.stringify(s));}
async function ids(){return harness.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('focus-recovery');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,q=db.transaction('v2').objectStore('v2').get('current');q.onsuccess=()=>{const s=q.result;resolve({session:s.session?.sessionId,candidates:s.candidates.map(c=>({id:c.id,duration:c.behavior.activeDurationMs,post:!!c.post})),posts:s.posts.entries.map(p=>({id:p.visitId,phase:p.phase}))});db.close();};};}));}
async function checkpoint(label){const s=await send('status'),p=await send('progress');assert.ok(!p.error);const a=p.attempts.find(a=>a.sessionId===(report.currentSession));assert.ok(a);assert.match(a.sessionId,/^[a-f0-9-]{36}$/);const n=Number(sql(`SELECT COUNT(*) FROM page_visit WHERE session_id='${a.sessionId}';`));const row={label,local:s.localVisits,acked:s.validVisits,pending:s.pending,mysql:n,sessionIdHash:digest(a.sessionId),lifecycle:s.lifecycle,rawStatus:a.rawStatus,privacy:a.privacyStatus};report.steps.push(row);await save();console.log(JSON.stringify(row));return {s,a,row};}
async function start(planned){await harness.bringToFront();await harness.getByLabel('배정 목표').selectOption(planned);await harness.getByRole('button',{name:'세션 시작',exact:true}).click();await wait(s=>s.lifecycle==='ACTIVE'&&s.localVisits===0,'start');report.currentSession=(await ids()).session;await checkpoint('start-'+planned);}
async function finish(){await send('stop');await wait(s=>s.lifecycle==='ENDED'&&s.endPhase==='acked'&&s.pending===0,'end');await send('progress');return checkpoint('ended');}
async function collect(label,url,number){await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await naturalFocus(page);await page.bringToFront();await wait(s=>s.validVisits===number,label);report.pages.push({label,url,number});await save();if([1,5,10].includes(number)){const {row}=await checkpoint(label);assert.equal(row.local,number);assert.equal(row.mysql,number);}}
async function search(engine,query,number){
 await page.goto(engine==='google'?'https://www.google.com/':'https://www.naver.com/',{waitUntil:'domcontentloaded',timeout:60000});await page.bringToFront();
 const input=page.locator(engine==='google'?'textarea[name="q"],input[name="q"]':'input[name="query"]').first();await input.waitFor();await input.fill(query);await input.press('Enter');
 await page.waitForURL(engine==='google'?/google\.[^/]+\/search\?/:/search\.naver\.com\/search.naver\?/,{timeout:30000});
 const results=page.locator(engine==='google'?'#search #rso a:has(h3)':'#main_pack a[href]:has([class*="headline"])');
 await results.first().waitFor({timeout:45000});await naturalFocus(page);await wait(s=>s.validVisits===number,engine+' search');
 report.pages.push({label:engine+'-search',url:page.url(),query,number});await save();
 const desired=engine==='google'?'martinfowler.com':'notice.tistory.com';
 const candidates=await results.evaluateAll(nodes=>nodes.map(n=>({href:n.href,text:n.textContent})));
 let index=candidates.findIndex(n=>{try{return new URL(n.href).hostname===desired;}catch{return false;}});
 // Current Google wraps organic destinations in an opaque /goto redirect. Verify the actual landing host after clicking.
 if(index<0&&engine==='google')index=candidates.findIndex(n=>new URL(n.href).hostname==='www.google.com'&&new URL(n.href).pathname==='/goto');
 assert.ok(index>=0,'expected public organic result');
 const newPage=context.waitForEvent('page',{timeout:15000}).catch(()=>null);
 await results.nth(index).click();const opened=await newPage;if(opened)page=opened;
 await page.waitForURL(u=>u.hostname===desired,{timeout:45000});await naturalFocus(page);await page.bringToFront();
 await wait(s=>s.validVisits===number+1,engine+' result');report.pages.push({label:engine+'-result',url:page.url(),number:number+1});await save();
 if(number+1===5)await checkpoint('five');
}
try{
 await launch();
 // The preceding normal ten-Visit attempt must survive the real native Chrome quit/reopen.
 let p=await send('progress');const completed=p.attempts.find(a=>a.plannedSessionId==='PLAN-003');assert.equal(completed?.rawStatus,'RAW_COLLECTED');assert.equal(completed.rawQuality.validVisits,10);
 const originalSession=completed.sessionId;
 const oldHash=sql(`SELECT SHA2(GROUP_CONCAT(CONCAT(visit_id,':',sequence,':',SHA2(content,256)) ORDER BY sequence),256) FROM page_visit WHERE session_id='${originalSession}';`);
 report.previousTenPreservedAfterChromeRestart=true;
 if((await send('status')).lifecycle==='ACTIVE'){await send('resume',{plannedSessionId:'PLAN-006'});report.currentSession=(await ids()).session;await checkpoint('resume-PLAN-006');}else await start('PLAN-006');let partial,candidate;
 if((await send('status')).localVisits===1){
  partial=await ids();candidate=partial.candidates.find(c=>c.post);assert.ok(candidate);report.pendingRecoveredFromPreviousRun=true;
 }else{
  page=await naturalPage();await page.goto('https://goddaehee.tistory.com/199',{waitUntil:'domcontentloaded'});await naturalFocus(page);await page.bringToFront();
  await wait(s=>s.activeDurationMs>=3000&&s.localVisits===0,'first three active seconds');
  partial=await ids();candidate=partial.candidates.find(c=>!c.post&&c.duration>=3000);assert.ok(candidate);
  await naturalFocus(page);await harness.bringToFront();await waitMs(30000);await page.bringToFront();
  await wait(s=>s.localVisits===1&&s.validVisits===0&&s.pending>0,'durable offline POST');
 }
 await send('retry');await wait(()=>postFailures>0,'actual interrupted POST',15000);
 report.actualInterruptedPosts=postFailures;await save();
 const cdp=await context.newCDPSession(harness);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await cdp.detach();
 await wait(s=>s.localVisits===1&&s.validVisits===0,'worker restores pending');assert.equal((await ids()).posts[0].id,candidate.id);report.workerRestartWithPending=true;
 await harness.bringToFront();
 sql("UPDATE access_credential SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE participant_id=(SELECT participant_id FROM collection_local_owner WHERE owner_key=1) AND revoked_at IS NULL;");
 const expired=await send('access');assert.equal(expired.error,'authentication');assert.equal((await ids()).posts[0].id,candidate.id);
 await context.close();context=undefined;
 // Restrict only this closed test profile before the official offline credential rotation.
 execFileSync('python3',['-c',"from pathlib import Path; import os; p=Path(os.environ['FOCUS124_DIRECTORY']); [(x.chmod(0o700 if x.is_dir() else 0o600)) for x in [p,*p.rglob('*')] if not x.is_symlink()]"],{env:process.env});
 const jdk=execFileSync('/usr/libexec/java_home',['-v','21'],{encoding:'utf8'}).trim();
 execFileSync('python3',[resolve('../tools/individual-local/local.py'),'--directory',directory,'setup','--slot','C','--rotate-credential'],{cwd:resolve('..'),env:{...process.env,JAVA_HOME:jdk,PATH:jdk+'/bin:'+process.env.PATH},stdio:['ignore','ignore','pipe'],timeout:120000});
 await launch();await wait(s=>s.localVisits===1&&s.validVisits===0&&s.pending>0,'Chrome and reauthentication restore pending');assert.equal((await ids()).session,partial.session);assert.equal((await ids()).posts[0].id,candidate.id);report.chromeRestartWithPending=true;report.expiryAndReauthentication=true;
 holdPosts=false;await send('retry');await wait(s=>s.validVisits===1&&s.pending===0,'network restored');assert.equal((await ids()).posts[0].id,candidate.id);report.networkRecovery=true;
 const short=await finish();assert.equal(short.row.mysql,1);assert.equal(short.a.plannedSessionId,'PLAN-006');
 await harness.bringToFront();await harness.getByRole('button',{name:'PLAN-006 · Visit 1 · 재수집 대상 확인',exact:true}).click();
 await harness.getByRole('dialog').getByRole('button',{name:'PLAN-006 재수집 확정',exact:true}).click();
 for(let n=0;n<100;n++){p=await send('progress');if(p.attempts.find(a=>a.attemptId===short.a.attemptId)?.reviewStatus==='RECOLLECT_REQUIRED')break;await waitMs(200);}
 assert.equal(p.attempts.find(a=>a.attemptId===short.a.attemptId).reviewStatus,'RECOLLECT_REQUIRED');assert.equal(p.attempts.find(a=>a.sessionId===originalSession).rawStatus,'RAW_COLLECTED');
 assert.equal(Number(sql(`SELECT COUNT(*) FROM collection_audit WHERE action='LOCAL_RECOLLECT' AND target_id='${short.a.attemptId}';`)),1);report.recollectIsolation=true;
 await start('PLAN-006');page=await naturalPage();
 await page.goto('https://goddaehee.tistory.com/199',{waitUntil:'domcontentloaded'});await naturalFocus(page);await page.bringToFront();
 await wait(s=>s.activeDurationMs>=3000&&s.localVisits===0,'final partial dwell');
 const first=await ids(),unfinished=first.candidates.find(c=>!c.post&&c.duration>=3000);assert.ok(unfinished);
 await naturalFocus(page);await harness.bringToFront();report.inactivePageState=await page.evaluate(()=>({visibility:document.visibilityState,focused:document.hasFocus()}));assert.equal(report.inactivePageState.focused,false);
 await waitMs(30000);await page.bringToFront();await wait(s=>s.validVisits===1,'final return');
 const returned=(await ids()).candidates.find(c=>c.id===unfinished.id);assert.ok(returned?.post);assert.ok(returned.duration>=5000&&returned.duration<12000);
 report.tabReturn={initialMs:unfinished.duration,inactiveMs:30000,finalMs:returned.duration,sameId:true};await checkpoint('one');report.pages.push({label:'tistory-other-skin',url:page.url(),number:1});await save();
 await search('google','site:martinfowler.com microservices',2);
 await search('naver','site:notice.tistory.com 티스토리 공지',4);
 await collect('naver-iframe','https://blog.naver.com/insaweb/221650456057',6);
 await collect('wordpress','https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/',7);
 await collect('blogger','https://blog.python.org/',8);
 await collect('legacy-document','https://paulgraham.com/avg.html',9);
 await collect('tistory-second','https://notice.tistory.com/2706',10);
 const final=await finish();assert.equal(final.row.local,10);assert.equal(final.row.acked,10);assert.equal(final.row.mysql,10);assert.equal(final.row.rawStatus,'RAW_COLLECTED');assert.equal(final.row.privacy,'CLEAR');
 assert.equal(sql(`SELECT SHA2(GROUP_CONCAT(CONCAT(visit_id,':',sequence,':',SHA2(content,256)) ORDER BY sequence),256) FROM page_visit WHERE session_id='${originalSession}';`),oldHash);
 report.previousTenUnchanged=true;report.final={...final.row,endPhase:final.s.endPhase,deliveryConfirmed:final.a.deliveryConfirmed};report.result='PASS';await save();console.log('PASS final v7 real sites and durable recovery');
}catch(error){report.result='FAILED';report.error=String(error);if(harness&&!harness.isClosed())report.status=await send('status').catch(()=>null);if(context)report.focusDiagnostic=await (context.serviceWorkers()[0]?.evaluate(async()=>({windows:(await chrome.windows.getAll()).map(w=>({id:w.id,focused:w.focused,state:w.state})),tabs:(await chrome.tabs.query({})).map(t=>({id:t.id,windowId:t.windowId,active:t.active,origin:t.url?.split('/').slice(0,3).join('/')}))}))).catch(()=>null);await save();console.error(String(error));process.exitCode=1;}
finally{await context?.close();}
