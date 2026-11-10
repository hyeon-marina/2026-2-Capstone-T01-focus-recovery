import { it, expect, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { V2Runtime, v2HttpTransport } from '../src/v2/runtime';
import { V2Repository } from '../src/v2/repository';
import { V2StatusClient } from '../src/v2/status';
import { API_BASE_URL } from '../src/api/client';
import { accessRequest, readCollectionAccess } from '../src/v2/access';
import { observation, time } from './v2-fixture';
it.skipIf(!process.env.FOCUS95_BE_URL)('real authenticated FE → Spring → FastAPI, behavior, alerts and complete consent withdrawal', async () => {
  const base=process.env.FOCUS95_BE_URL!, token=process.env.FOCUS95_TOKEN!;
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)||!token)throw new Error('SYNTHETIC_LOOPBACK_ONLY');
  const originalFetch=globalThis.fetch;
  const evidence:{paths:string[]; stages:string[]; model:string}= {paths:[],stages:[],model:'FakeEmbedding/FakeContext; no real model inference'};
  vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('IDBKeyRange',IDBKeyRange);
  vi.stubGlobal('chrome',{storage:{session:{get:async()=>({'focus.accessCredential':token})}}});
  vi.stubGlobal('fetch',async (input:string,init?:RequestInit)=>{
    const path=input.substring(API_BASE_URL.length);evidence.paths.push(`${init?.method??'GET'} ${path}`);
    return originalFetch(base+path,init);
  });
  async function until(check:()=>boolean|Promise<boolean>) { for(let i=0;i<800;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}throw new Error('SYNTHETIC_TIMEOUT'); }
  expect((await originalFetch(base+'/api/auth/me')).status).toBe(401);
  const before=await readCollectionAccess();expect(before.consentValid).toBe(false);expect(before.policy?.status).toBe('SYNTHETIC');evidence.stages.push('authenticated; no consent blocks collection');
  const consent={requestId:crypto.randomUUID(),policyId:before.policy!.policyId,policyVersion:before.policy!.policyVersion,accepted:true};
  const accepted=await accessRequest('/api/consent',consent);expect((await accessRequest('/api/consent',consent)).consentId).toBe(accepted.consentId);
  const repo=new V2Repository(API_BASE_URL),t={...v2HttpTransport};const runtime=new V2Runtime(repo,t);await runtime.initialize();
  await runtime.start('Synthetic TypeScript transaction research');await runtime.foreground(1,time(0));
  for(let visit=0;visit<3;visit++) {
    const start=visit*11000;for(let ms=start;ms<=start+5000;ms+=1000)await runtime.observe(observation(ms,{document:`auth-http-${visit}`}));
    if(visit<2){await runtime.foreground(null,time(start+5000));await runtime.foreground(1,time(start+10000));}
  }
  await until(()=>runtime.snapshot().posts.entries.length===3&&runtime.snapshot().posts.entries.every(e=>e.phase==='acked'));
  const session=runtime.snapshot().session!,path=`/api/sessions/${session.sessionId}`;
  await until(async()=> (await accessRequest(path+'/analysis-status')).currentDecision?.finalState==='NORMAL');evidence.stages.push('server consent; owned session; FE virtual-clock collection; IndexedDB; visits; actual AI HTTP composition and mock page inference; BE NORMAL');
  for(let ms=28000;ms<=322000;ms+=1000)await runtime.observe(observation(ms,{document:'auth-http-2'}));
  await until(async()=> (await accessRequest(path+'/analysis-status')).currentDecision?.finalState==='DRIFT');
  const status=await accessRequest(path+'/analysis-status'),client=new V2StatusClient(()=>runtime.snapshot());const alert=await client.candidate();expect(alert).not.toBeNull();
  const shownAt=new Date().toISOString();await runtime.recordShown(alert!,shownAt);await runtime.selectAlert(alert!.alertId,{action:'RETURN_TO_GOAL',selectedAt:new Date().toISOString()});
  expect(runtime.snapshot().notifications[0].selectionAck).toBe(true);expect((await accessRequest(`${path}/windows/${status.currentDecision.windowId}/states`)).items.length).toBeGreaterThanOrEqual(2);
  evidence.stages.push('FE behavior PATCH at first 300000ms crossing; state history; DRIFT; runtime shown ACK and selection (no browser rendering in this test)');
  await runtime.stop(time(322500));await until(()=>runtime.snapshot().lifecycle==='ENDED');evidence.stages.push('POST/PATCH/END drain');
  await runtime.start(session.goalText);const active=runtime.snapshot().session!;expect(active.sessionId).not.toBe(session.sessionId);
  let lost=false;t.withdraw=async id=>{const response=await v2HttpTransport.withdraw!(id);if(!lost){lost=true;throw new Error('Synthetic lost ACK after withdrawal commit');}return response;};
  await runtime.withdrawAll();const saved=runtime.snapshot();expect(saved.withdrawal?.phase).toBe('pending');repo.close();
  const recovered=new V2Runtime(new V2Repository(API_BASE_URL),v2HttpTransport);await recovered.initialize();await recovered.retry();
  await until(()=>recovered.snapshot().withdrawal?.phase==='acknowledged');expect(recovered.snapshot().withdrawal!.requestId).toBe(saved.withdrawal!.requestId);expect(recovered.collecting()).toBe(false);
  const receipt=recovered.snapshot().withdrawal!.ack!;
  await until(async()=>{const r=await accessRequest(`/api/consent/withdrawals/${receipt.withdrawalId}`);return r.sessions.every((s:{status:string})=>s.status==='INVENTORIED')&&r.targets.filter((t:Record<string,unknown>)=>['AI_CACHE_AND_MEMORY','BE_PAYLOADS'].includes(String(t.targetType))).every((t:Record<string,unknown>)=>t.processingStatus==='VERIFIED');});
  for(const suffix of ['/analysis-status','/visits',`/windows/${status.currentDecision.windowId}/states`]) {
    const r=await originalFetch(base+path+suffix,{headers:{Authorization:`Bearer ${token}`}});expect(r.status).toBe(suffix==='/analysis-status'?403:409);
  }
  const late=await originalFetch(base+path+`/alerts/${alert!.alertId}/shown`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({shownAt})});expect(late.status).toBe(409);
  const result=await accessRequest(`/api/consent/withdrawals/${receipt.withdrawalId}`);expect(result.status).toBe('QUARANTINED');expect(result.sessions).toHaveLength(2);expect(result.unmet.length).toBeGreaterThan(0);
  evidence.stages.push('whole-participant withdrawal: ACTIVE + ENDED; immediate hold; lost ACK; worker restart; same-ID replay; inventory; BE synthetic scrubbing; authenticated AI durable quarantine; analysis/history/alert blocking; QUARANTINED');
  const fs=await import('node:fs/promises');await fs.mkdir('/private/tmp/focus95-http-evidence',{recursive:true});
  await fs.writeFile('/private/tmp/focus95-http-evidence/flow.json',JSON.stringify({...evidence,withdrawal:result,localOwner:recovered.snapshot().owner},null,2));
},60000);
