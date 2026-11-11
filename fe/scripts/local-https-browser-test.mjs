// Opt-in SYNTHETIC fixture only. Actual local HTTPS/MySQL/extension, routed synthetic web pages.
// Chrome trusts only this fixture's SPKI through a test launch flag; this does not test OS trust installation.
import { chromium } from 'playwright';
import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, X509Certificate } from 'node:crypto';
import assert from 'node:assert/strict';
const directory=process.env.FOCUS105_LOCAL_DIRECTORY;
assert.ok(directory);
const policyFile=join(directory,'site-policy.json');
const policy=JSON.parse(await readFile(policyFile,'utf8'));
assert.equal(policy.policyId,'SYNTHETIC-103');
assert.deepEqual(policy.sites,[{origin:'https://example.org',pathPrefix:'/public'}]);
const config=JSON.parse(await readFile(join(directory,'config.json'),'utf8'));
assert.ok([19543,19544,19545].includes(config.tlsPort));
const server='https://localhost:'+config.tlsPort;
const cert=new X509Certificate(await readFile(join(directory,'tls/localhost.pem')));
const spki=createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64');
const options={headless:true,channel:'chromium',executablePath:process.env.CHROMIUM_PATH};
// Negative control: an unrelated pin must not authorize the self-signed certificate.
const untrusted=await chromium.launch({...options,args:['--ignore-certificate-errors-spki-list='+Buffer.alloc(32).toString('base64')]});
try {
  const p=await untrusted.newPage();
  await assert.rejects(p.goto(server+'/api/health'),/ERR_CERT_AUTHORITY_INVALID/);
} finally {await untrusted.close();}
process.env.VITE_API_BASE_URL=server;process.env.COLLECTION_SITE_POLICY_FILE=policyFile;
const extension=join(directory,'https-extension');
await build({configFile:resolve('vite.real.config.ts'),mode:'real-collection',build:{outDir:extension}});
await build({configFile:resolve('vite.real.content.config.ts'),build:{outDir:extension}});
let context,harness,page;
const launch=async()=>{
  const c=await chromium.launchPersistentContext(join(directory,'https-chrome-profile'),{...options,args:['--ignore-certificate-errors-spki-list='+spki,`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  await c.route('https://example.org/public/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>SYNTHETIC Git page</title><article>PRIVATE BODY MUST NEVER BE SENT. person@example.org</article>'}));
  return c;
};
const send=(action,extra={})=>harness.evaluate(({action,extra})=>chrome.runtime.sendMessage({type:'v2-'+action,...extra}),{action,extra});
async function wait(predicate,label) {
  for(let n=0;n<180;n++) {const s=await send('status');assert.equal(s.storageFailed,false);if(predicate(s))return s;await new Promise(r=>setTimeout(r,200));}
  throw new Error('Timeout '+label+' '+JSON.stringify(await send('status')));
}
async function login(id) {
  harness=await context.newPage();await harness.goto('chrome-extension://'+id+'/participant/index.html');
  await harness.getByLabel('로컬 Credential 파일 불러오기').setInputFiles(join(directory,'participant.json'));
  await harness.getByText(/로컬 슬롯 [ABC]/).waitFor();
  await harness.getByText(/서버 동의 유효/).first().waitFor();
}
try {
  context=await launch();let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=worker.url().split('/')[2];
  await login(id);
  const planned='PLAN-00'+({A:1,B:2,C:3}[config.slot]);
  await harness.getByLabel('배정 목표').selectOption(planned);
  await harness.getByRole('button',{name:'세션 시작',exact:true}).click();await wait(s=>s.lifecycle==='ACTIVE','start');
  page=await context.newPage();
  for(let n=1;n<=10;n++) {
    if(n===2)await page.evaluate(()=>history.pushState({},'','/public/page?page=2'));
    else await page.goto('https://example.org/public/page?page='+n);
    await page.bringToFront();await wait(s=>s.validVisits>=n,'visit '+n);console.log('SYNTHETIC HTTPS '+config.slot+' visit '+n+'/10');
    if(n===3) {const cdp=await context.newCDPSession(harness);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await cdp.detach();await wait(s=>s.validVisits>=3,'worker restart');}
    if(n===5) {await context.close();context=await launch();await login(id);await wait(s=>s.collectionAllowed,'reauthentication');page=await context.newPage();}
  }
  await send('stop');await wait(s=>s.lifecycle==='ENDED'&&s.endPhase==='acked','END ACK');
  let progress;
  for(let n=0;n<80;n++) {progress=await send('progress');if(progress.raw.completed===1)break;await new Promise(r=>setTimeout(r,200));}
  const attempt=progress.attempts[0];
  assert.equal(attempt.rawStatus,'RAW_COLLECTED');assert.equal(attempt.analysisState,'NOT_RUN');assert.equal(attempt.quality.validVisits,10);
  await harness.bringToFront();await harness.getByRole('button',{name:'진행 상태 새로고침',exact:true}).click();
  await harness.getByText(/원본 RAW_COLLECTED/).waitFor();
  await harness.screenshot({path:join(directory,'https-metadata-complete.png'),fullPage:true});
  await writeFile(join(directory,'https-chrome-summary.json'),JSON.stringify({kind:'SYNTHETIC_PINNED_HTTPS_NOT_OS_TRUST',slot:config.slot,sessionId:attempt.sessionId,visits:10,raw:'RAW_COLLECTED',ai:'NOT_RUN',fileLogin:true,spa:true,workerRestart:true,browserRestart:true,wrongPinRejected:true},null,2),{flag:'wx'});
} finally {await context?.close();}
