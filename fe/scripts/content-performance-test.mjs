// Standalone synthetic DOM benchmark; not a collection session or participant data.
import { chromium } from 'playwright';
import { build } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const outputs=await build({configFile:false,logLevel:'silent',build:{write:false,minify:false,
  lib:{entry:resolve('src/content/extraction.ts'),name:'ExtractionProbe',formats:['iife']}}});
const code=(Array.isArray(outputs)?outputs[0]:outputs).output.find(x=>x.type==='chunk').code;
const browser=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.CHROMIUM_PATH});
const results=[];
try {
  const page=await browser.newPage();
  await page.goto('about:blank');await page.addScriptTag({content:code});
  for(const leaves of [1000,5000,10000,25000]) {
    results.push(await page.evaluate(leaves=>{
      document.title='Synthetic public documentation';
      document.body.innerHTML='<main>'+ '<section>'.repeat(24)+
        '<p><span>Ordinary public documentation about durable browser observations.</span></p>'.repeat(leaves)+
        '</section>'.repeat(24)+'</main>';
      let styles=0;
      const original=window.getComputedStyle;
      window.getComputedStyle=function(...args){styles++;return original.apply(this,args);};
      const start=performance.now();
      const eligible=!ExtractionProbe.isExcludedPublicDocument(document);
      const denied=!ExtractionProbe.isExcludedMetadataDocument(document) && ExtractionProbe.excludedPublicLayout(document);
      const content=ExtractionProbe.extractMainContent(document,true,true);
      const elapsedMs=performance.now()-start;
      window.getComputedStyle=original;
      return {leaves,elements:document.querySelectorAll('*').length,styles,elapsedMs,eligible,denied,contentLength:[...content].length};
    },leaves));
  }
  const report={browser:browser.version(),kind:'SYNTHETIC_DOM_NOT_COLLECTION',results};
  if(process.env.FOCUS120_PERF_OUTPUT)await writeFile(process.env.FOCUS120_PERF_OUTPUT,JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify(report,null,2));
  for(const r of results){
    assert.ok(r.contentLength>=50 && r.contentLength<=5000);
    assert.ok(r.eligible && !r.denied);
    assert.ok(r.styles<=r.elements*5,`visibility must be linear: ${r.styles} style reads for ${r.elements} elements`);
    assert.ok(r.elapsedMs<1500,`extraction exceeded observation budget: ${r.elapsedMs}ms`);
  }
}finally{await browser.close();}
