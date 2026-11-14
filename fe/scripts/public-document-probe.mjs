// Independent unauthenticated live-site DOM probe; no participant session or raw-text output.
import {chromium} from 'playwright';
import {build} from 'vite';
import {resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
const pages=JSON.parse(await readFile(resolve('tests/fixtures/public-document-pages.json'),'utf8')).map(p=>[p.label,p.url]);
const bundles=[];
for(const [entry,name] of [['src/content/extraction.ts','ExtractionProbe'],['src/content/article-frame.ts','ArticleFrameProbe']]){
 const output=await build({configFile:false,logLevel:'silent',build:{write:false,minify:false,lib:{entry:resolve(entry),name,formats:['iife']}}});
 bundles.push((Array.isArray(output)?output[0]:output).output.find(x=>x.type==='chunk').code);
}
const browser=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.CHROMIUM_PATH});
const results=[];
try{
 for(const [label,url] of pages){
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  try{
   const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
   await page.waitForTimeout(2500);
   for(const code of bundles)await page.addScriptTag({content:code});
   const result=await page.evaluate(()=>{
    try{
     const outerSensitive=ExtractionProbe.isSensitivePublicDocument(document);
     const outerExcluded=ExtractionProbe.excludedPublicLayout(document);
     const selected=ArticleFrameProbe.articleFrame(document,location.href);
     const doc=selected.frame?.document??document;
     const sensitive=outerSensitive||ExtractionProbe.isSensitivePublicDocument(doc);
     const excluded=outerExcluded||ExtractionProbe.excludedPublicLayout(doc);
     let content=null;
     if(!sensitive&&!excluded&&!selected.diagnostic)content=ExtractionProbe.extractMainContent(doc,true,true);
     return {frame:!!selected.frame,frameDiagnostic:selected.diagnostic??null,sensitive,excluded,contentLength:content?.length??0,ready:!!content&&[...content].length>=50};
    }catch{return {ready:false,fixedCode:'PRIVACY_OR_DOM_REJECTED'};}
   });
   results.push({label,httpStatus:response?.status(),...result});
  }catch{results.push({label,ready:false,fixedCode:'NETWORK_OR_NAVIGATION_FAILED'});}
  finally{await page.close();}
 }
 const report={kind:'LIVE_PUBLIC_DOM_NOT_COLLECTION',browser:browser.version(),results,rawTextLogged:false,operatingChanges:false};
 if(process.env.FOCUS121_PROBE_OUTPUT)await writeFile(process.env.FOCUS121_PROBE_OUTPUT,JSON.stringify(report,null,2),{mode:0o600});
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
