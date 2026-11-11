// Read-only compatibility smoke: no extension/session/credentials and no page text in the report.
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const policy = JSON.parse(await readFile(resolve('../docs/data-collection/TEAM_POLICY.json'),'utf8'));
const output = process.argv[2];
if (!output) throw new Error('Provide a NEW report path outside public raw data');
const source = await build({entryPoints:['src/content/extraction.ts'],bundle:true,format:'iife',globalName:'reviewGuard',write:false});
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const rows=[];
try {
  for (const site of policy.sites) {
    const page=await browser.newPage();
    const row={...site,participantCollection:false};
    try {
      const sample = site.origin === 'https://ko.wikipedia.org' ? '/wiki/'+encodeURIComponent('광합성') : site.origin === 'https://en.wikipedia.org' ? '/wiki/Public_transport' : site.pathPrefix;
      const response=await page.goto(site.origin+sample,{waitUntil:'domcontentloaded',timeout:20000});
      await page.waitForTimeout(1000);
      row.httpStatus=response?.status();
      const final=new URL(page.url());
      row.finalOrigin=final.origin; row.finalPath=final.pathname;
      row.stillInScope=final.origin===site.origin && (site.pathPrefix==='/' || final.pathname===site.pathPrefix || final.pathname.startsWith(site.pathPrefix.endsWith('/')?site.pathPrefix:site.pathPrefix+'/'));
      row.dom=await page.evaluate(code=>{
        const guard=new Function(code+';return reviewGuard;')();
        const initialMetadataExcluded=guard.isExcludedMetadataDocument(document);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        return {initialMetadataExcluded,html:document.contentType==='text/html',hasTitle:!!document.title.trim(),metadataExcluded:guard.isExcludedMetadataDocument(document),passwordInputs:document.querySelectorAll('input[type=password]').length,emailInputs:document.querySelectorAll('input[type=email]').length,visibleForms:[...document.querySelectorAll('form')].filter(guard.isVisible).length,editable:document.querySelectorAll('[contenteditable=true],[role=textbox]').length,historyAPI:typeof history.pushState==='function'};
      },source.outputFiles[0].text);
      row.result=row.httpStatus===200 && row.stillInScope && row.dom.html && !row.dom.metadataExcluded?'COMPATIBLE_SMOKE':'BLOCKED_SMOKE';
    } catch { row.result='NOT_TESTED_NETWORK_OR_BROWSER_ERROR'; }
    rows.push(row);console.log(site.origin+site.pathPrefix+': '+row.result);
    await page.close();
  }
} finally {await browser.close();}
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({kind:'READ_ONLY_SITE_SMOKE_NOT_COLLECTION',rows},null,2)+'\n',{flag:'wx'});
