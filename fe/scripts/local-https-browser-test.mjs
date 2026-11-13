// Opt-in automated test identities only; never a real participant consent record.
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
const external=process.env.FOCUS105_AUTOMATED_EXTERNAL==='1';
if (external) {
  assert.equal(await readFile(join(directory,'AUTOMATED_TEST_ONLY'),'utf8'),'NO_HUMAN_PARTICIPANT_CONSENT');
  assert.equal(policy.policyId,'focus-team-raw-v2');
  assert.equal(policy.institution.decision,'NOT_REQUIRED');
} else {
  assert.equal(policy.policyId,'SYNTHETIC-103');
  assert.deepEqual(policy.sites,[{origin:'https://example.org',pathPrefix:'/public'}]);
}
const publicPages=['https://docs.python.org/3/','https://blog.python.org/','https://news.ycombinator.com/','https://books.toscrape.com/','https://docs.python.org/3/howto/','https://docs.python.org/3/tutorial/','https://docs.python.org/3/library/','https://docs.python.org/3/reference/','https://search.naver.com/search.naver?query=Python+venv+documentation','https://docs.python.org/3/faq/'];
const observedPages=[];
const config=JSON.parse(await readFile(join(directory,'config.json'),'utf8'));
if (external && process.env.FOCUS_TEST_TLS_PORT) {
  assert.ok(Number.isInteger(config.tlsPort) && config.tlsPort >= 1024 && config.tlsPort <= 65535);
  assert.equal(config.tlsPort, Number(process.env.FOCUS_TEST_TLS_PORT));
} else {
  assert.ok([19543,19544,19545,19546,19547].includes(config.tlsPort));
}
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
  if (!external) await c.route('https://example.org/public/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>SYNTHETIC Git page</title><article>PRIVATE BODY MUST NEVER BE SENT. person@example.org</article>'}));
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
  const access=await send('access');
  if (!access.access.consentValid) {
    assert.equal(access.access.collectionEnabled,false);
    await harness.getByRole('checkbox').check();
    await harness.getByRole('button',{name:'수집 동의 기록 저장',exact:true}).click();
  }
  await harness.getByText(/서버 동의 유효/).first().waitFor();
}
try {
  context=await launch();let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=worker.url().split('/')[2];
  if (process.env.FOCUS112_RECOVERY === '1') {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    const dev = manager.locator('#devMode');
    if (await dev.getAttribute('aria-pressed') !== 'true' && !(await dev.evaluate(el => el.checked))) await dev.click();
    await manager.locator('extensions-item').filter({hasText:'Focus Recovery'}).locator('#dev-reload-button').click();
    await manager.close();
  }
  await login(id);
  const assigned=external ? await send('assignments') : [];
  if (process.env.FOCUS112_RECOVERY === '1') {
    assert.ok(external);
    const { checkQuarantine } = await import('./quarantine-browser-test.mjs');
    await checkQuarantine({ context, harness, send, wait, assigned });
  } else {
    const planned=external ? assigned.find(a=>a.goalId==='GOAL-003').plannedSessionId : 'PLAN-00'+({A:1,B:2,C:3}[config.slot]);
    await harness.getByLabel('배정 목표').selectOption(planned);
    await harness.getByRole('button',{name:'세션 시작',exact:true}).click();await wait(s=>s.lifecycle==='ACTIVE','start');
    page=await context.newPage();
    for(let n=1;n<=10;n++) {
      if (external) {
        let response;
        response=await page.goto(publicPages[n-1],{waitUntil:'domcontentloaded',timeout:60000});
        if(response) assert.equal(response.status(),200);
        assert.ok(['docs.python.org','blog.python.org','news.ycombinator.com','books.toscrape.com','search.naver.com'].includes(new URL(page.url()).hostname));
        observedPages.push({domain:new URL(page.url()).hostname,status:response?.status()??200});
      } else if(n===2)await page.evaluate(()=>history.pushState({},'','/public/page?page=2'));
      else await page.goto('https://example.org/public/page?page='+n);
      await page.bringToFront();
      const dwellStarted=Date.now();
      const focusedAtStart=await page.evaluate(()=>document.visibilityState==='visible' && document.hasFocus());
      await wait(s=>s.validVisits>=n,'visit '+n);
      if(external) {
        observedPages.at(-1).measuredWaitMs=Date.now()-dwellStarted;
        observedPages.at(-1).focusedAtStart=focusedAtStart;
        const title=await page.title();
        observedPages.at(-1).titleSha256=createHash('sha256').update([...title.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()].slice(0,500).join('')).digest('hex');
      }console.log((external?'AUTOMATED EXTERNAL HTTPS ':'SYNTHETIC HTTPS ')+config.slot+' visit '+n+'/10');
      if(external && n===4) {await harness.bringToFront();await new Promise(r=>setTimeout(r,1200));await page.bringToFront();}
      if(n===3) {const cdp=await context.newCDPSession(harness);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await cdp.detach();await wait(s=>s.validVisits>=3,'worker restart');}
      if(n===5) {await context.close();context=await launch();await login(id);await wait(s=>s.collectionAllowed,'reauthentication');page=await context.newPage();}
    }
    if(external){
      await page.evaluate(()=>{history.pushState({},'', '/account/private');document.body.insertAdjacentHTML('beforeend','<input type="password" hidden>');});
      await page.waitForTimeout(6500);assert.equal((await send('status')).validVisits,10,'sensitive page excluded');
    }
    await send('stop');await wait(s=>s.lifecycle==='ENDED'&&s.endPhase==='acked'&&s.pending===0,'END ACK and drained queue');
    let progress;
    for(let n=0;n<80;n++) {progress=await send('progress');if(progress.raw.completed===1)break;await new Promise(r=>setTimeout(r,200));}
    const attempt=progress.attempts[0];
    assert.equal(attempt.rawStatus,'RAW_COLLECTED');assert.equal(attempt.analysisState,'NOT_RUN');assert.equal(attempt.quality.validVisits,10);
    await harness.bringToFront();await harness.getByRole('button',{name:'진행 상태 새로고침',exact:true}).click();
    await harness.getByText(/원본 RAW_COLLECTED/).waitFor();
    await harness.screenshot({path:join(directory,'https-metadata-complete.png'),fullPage:true});
    await writeFile(join(directory,'https-chrome-summary.json'),JSON.stringify({kind:external?'AUTOMATED_EXTERNAL_SITE_TECHNICAL_E2E_NOT_HUMAN_CONSENT':'SYNTHETIC_PINNED_HTTPS_NOT_OS_TRUST',actualParticipantConsent:false,observedPages,slot:config.slot,sessionId:attempt.sessionId,visits:10,raw:'RAW_COLLECTED',ai:'NOT_RUN',fileLogin:true,explicitUiConsent:true,spa:!external,sensitivePageExcluded:external,workerRestart:true,browserRestart:true,wrongPinRejected:true},null,2),{flag:'wx'});
  }
} finally {await context?.close();}
