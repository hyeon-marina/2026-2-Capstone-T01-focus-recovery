// Opt-in visible Chrome + actual public pages + existing directly-consented isolated test owner.
// Never creates consent, inserts Visits, changes clocks, spoofs focus or opens operating C.
import {chromium} from 'playwright';
import {build} from 'vite';
import {readFile,writeFile,access} from 'node:fs/promises';
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
const output=join(directory,'app-fixture-result.json');
const save=()=>writeFile(output,JSON.stringify(report,null,2),{mode:0o600});
let context,harness,page,id,holdPosts=false,postFailures=0;
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

try{
 report.kind='CONTROLLED_VIRTUAL_DATA_AND_NATIVE_APP_RETURN_NOT_PUBLIC_TEN_VISITS';
 const gate=join(directory,'RETURN_TO_TEST_CHROME');await assert.rejects(access(gate));
 await launch();assert.equal((await send('progress')).raw.completed,2);await start('PLAN-009');
 const virtual='통제된 공개 테스트 문서: 의료 patient 계좌번호 fictional@example.org 010-0000-0000 02-000-0000. '.repeat(3);
 await context.route('https://controlled.focus-recovery.org/**',r=>r.fulfill({contentType:'text/html',body:r.request().url().endsWith('/credential')?'<title>Controlled Credential exclusion</title><article>'+virtual+' password=fictional-value</article>':'<title>공개 의료 RAW 테스트</title><article>'+virtual+'<form><input type="password" value="NEVER_COLLECT_VIRTUAL_PASSWORD"><textarea>NEVER_COLLECT_VIRTUAL_DRAFT</textarea></form></article>'}));
 page=await naturalPage();await page.goto('https://controlled.focus-recovery.org/raw');const cdp=await naturalFocus(page);await page.bringToFront();
 await wait(s=>s.activeDurationMs>=3000&&s.localVisits===0,'partial active dwell');const first=await ids(),candidate=first.candidates.find(c=>!c.post&&c.duration>=3000);assert.ok(candidate);
 const browser=await context.browser().newBrowserCDPSession(),targetId=(await cdp.send('Target.getTargetInfo')).targetInfo.targetId;
 const {windowId}=await browser.send('Browser.getWindowForTarget',{targetId});await browser.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});
 const before=Date.now();await waitMs(500);report.inactive=await page.evaluate(()=>({visibility:document.visibilityState,focused:document.hasFocus()}));assert.equal(report.inactive.focused,false);
 report.minimized=(await browser.send('Browser.getWindowBounds',{windowId})).bounds.windowState;assert.equal(report.minimized,'minimized');report.ready=true;report.initialMs=candidate.duration;await save();console.log('READY_FOR_OTHER_APP: natively minimized. Activate Calculator; after >=30s create RETURN_TO_TEST_CHROME.');
 for(let n=0;n<1800;n++){try{await access(gate);break;}catch{await waitMs(200);}}await access(gate);const inactiveMs=Date.now()-before;assert.ok(inactiveMs>=30000);
 await browser.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});await naturalFocus(page);await page.bringToFront();
 await wait(s=>s.validVisits===1,'app return');const returned=(await ids()).candidates.find(c=>c.id===candidate.id);assert.ok(returned?.post);assert.ok(returned.duration>=5000&&returned.duration<15000);
 report.appReturn={initialMs:candidate.duration,inactiveMs,finalMs:returned.duration,sameVisitId:true,nativeMinimization:true};
 const sid=(await ids()).session;assert.match(sid,/^[a-f0-9-]{36}$/);
 const stored=sql(`SELECT content FROM page_visit WHERE session_id='${sid}' AND sequence=1;`);assert.ok(stored.includes('fictional@example.org'));assert.ok(stored.includes('010-0000-0000'));assert.ok(stored.includes('patient'));assert.ok(!stored.includes('NEVER_COLLECT'));assert.ok(!stored.includes('[EMAIL]'));report.virtualRawAndInputProtection=true;await save();
 await page.goto('https://controlled.focus-recovery.org/credential');await naturalFocus(page);await page.bringToFront();await waitMs(7500);const rejected=await send('status');assert.equal(rejected.validVisits,1);assert.equal(rejected.quarantined,false);assert.equal(rejected.lifecycle,'ACTIVE');report.credentialPageExcludedWithoutQuarantine=true;
 await collect('next-real-public-page','https://martinfowler.com/bliki/TwoHardThings.html',2);const ended=await finish();assert.equal(ended.row.mysql,2);assert.equal(ended.row.pending,0);assert.equal((await send('progress')).raw.completed,2);
 report.final=ended.row;report.previousRawCompleted=2;report.result='PASS';await save();console.log('PASS native app return, controlled virtual raw, form/Credential protection and continuation');
}catch(e){report.result='FAILED';report.error=String(e);report.status=await send('status').catch(()=>null);await save();console.error(String(e));process.exitCode=1;}finally{await context?.close();}
