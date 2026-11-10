import { chromium } from 'playwright';
import { build } from 'vite';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = await mkdtemp(join(tmpdir(),'focus97-locked-'));
// Defined preparation profile's local TLS port, not a claimed deployed server.
process.env.VITE_API_BASE_URL='https://127.0.0.1:9443';
const extension=join(root,'extension');
await build({configFile:resolve('vite.participant.config.ts'),mode:'participant',build:{outDir:extension}});
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
assert.deepEqual(manifest.permissions,['storage','alarms']);assert.equal(manifest.content_scripts,undefined);assert.deepEqual(manifest.host_permissions,['https://127.0.0.1/*']);
const context=await chromium.launchPersistentContext(join(root,'profile'),{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try {
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=worker.url().split('/')[2];
 const page=await context.newPage();await page.goto(`chrome-extension://${id}/participant/index.html`);
 await page.getByText('실제 사용자 수집 BLOCKED',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'세션 시작',exact:true}).isDisabled(),true);
 const response=await page.evaluate(()=>chrome.runtime.sendMessage({type:'v2-start',plannedSessionId:'PLAN-001'}));assert.equal(response.error,'V2_BLOCKED');
 const state=await page.evaluate(()=>chrome.runtime.sendMessage({type:'v2-status'}));assert.equal(state.collectionAllowed,false);assert.equal(state.validVisits,0);
 await mkdir('/private/tmp/focus97-chrome-evidence',{recursive:true});await page.screenshot({path:'/private/tmp/focus97-chrome-evidence/participant-locked.png',fullPage:true});
 console.log(JSON.stringify({result:'PASS',chrome:await context.browser()?.version(),mode:'participant',ordinaryPageAccess:false,collectionAllowed:false,server:'NOT_TESTED',minimumPermissions:true}));
}finally{await context.close();}
