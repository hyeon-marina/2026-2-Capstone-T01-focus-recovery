import { chromium } from 'playwright';
import { mkdtemp,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import assert from 'node:assert/strict';
const extension=resolve('dist-real');
const manifest=JSON.parse(await readFile(extension+'/manifest.json','utf8'));
assert.equal(manifest.content_scripts,undefined);assert.deepEqual(manifest.host_permissions,['https://127.0.0.1:9443/*']);
const root=await mkdtemp(join(tmpdir(),'focus99-zero-sites-'));
const context=await chromium.launchPersistentContext(root,{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try {
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=worker.url().split('/')[2];const page=await context.newPage();await page.goto(`chrome-extension://${id}/participant/index.html`);
 await page.getByText('실제 사용자 수집 BLOCKED',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'세션 시작',exact:true}).isDisabled(),true);
 const s=await page.evaluate(()=>chrome.runtime.sendMessage({type:'v2-status'}));assert.equal(s.collectionAllowed,false);assert.equal(s.validVisits,0);
 console.log(JSON.stringify({result:'PASS',kind:'actual-Chrome-zero-site-real-build',chrome:await context.browser().version(),collectionAllowed:false,sitePermissions:0}));
}finally{await context.close();}
