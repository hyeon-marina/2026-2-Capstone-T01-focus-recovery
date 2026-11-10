import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import assert from 'node:assert/strict';
const root=process.env.FE97_PROFILE_ROOT;
if(!root || !/^focus97-chrome-/.test(basename(root)))throw new Error('Only the preserved synthetic test profile is accepted');
const credential=JSON.parse(await readFile(process.env.FE97_CREDENTIAL_FILE,'utf8')).credential;
const extension=join(root,'extension'),evidence='/private/tmp/focus97-chrome-evidence';await mkdir(evidence,{recursive:true});
const context=await chromium.launchPersistentContext(join(root,'profile'),{channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try {
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=worker.url().split('/')[2];
 const page=await context.newPage();await page.goto(`chrome-extension://${id}/participant/index.html`);
 await page.getByLabel('합성 테스트 자격정보').fill(credential);await page.getByRole('button',{name:'인증 / 계정 전환',exact:true}).click();await page.getByText(/인증됨/).waitFor();
 await page.getByRole('button',{name:'진행 상태 새로고침',exact:true}).click();await page.getByText(/PLAN-001 · SYNTHETIC · QUALITY_PASSED/).waitFor();
 const progress=await page.evaluate(()=>chrome.runtime.sendMessage({type:'v2-progress'}));assert.equal(progress.syntheticQualityPassed,1);assert.equal(progress.completed,0);assert.equal(progress.attempts[0].quality.validVisits,10);assert.equal(progress.attempts[0].quality.validWindows,8);
 await page.screenshot({path:join(evidence,'recovered-ten-visits.png'),fullPage:true});
 await page.getByRole('button',{name:'전체 동의 철회 · 수집 즉시 중지',exact:true}).click();
 await page.getByText(/철회 접수: QUARANTINED/).waitFor();const state=await page.evaluate(()=>chrome.runtime.sendMessage({type:'v2-status'}));assert.equal(state.collectionAllowed,false);
 await page.screenshot({path:join(evidence,'recovered-withdrawal.png'),fullPage:true});
 console.log(JSON.stringify({result:'PASS',serverProcessRestart:true,preservedBrowserProfile:true,credentialReissue:true,visits:10,windows:8,actualCompleted:0,withdrawal:'QUARANTINED'}));
}finally{await context.close();}
