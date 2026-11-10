import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { V2Runtime, type V2Transport } from '../src/v2/runtime';
import { V2Repository } from '../src/v2/repository';
import { API_BASE_URL } from '../src/api/client';
import { AccessError, authenticatedFetch, setCredential } from '../src/api/auth-fetch';
import { readCollectionAccess } from '../src/v2/access';
import { session, syntheticAccess, observation, time } from './v2-fixture';
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange); });
function transport(access = structuredClone(syntheticAccess)): V2Transport {
  return { access: vi.fn(async () => access), start: vi.fn(async () => session), post: vi.fn(async v => ({ ...v, updatedAt: null })),
    patch: vi.fn(async (_s,visitId,b) => ({ ...b,visitId,applied:true,updatedAt:null })),
    end: vi.fn(async s => ({ ...s,status:'ENDED',endedAt:'2026-11-10T01:00:00.000Z' })), query: vi.fn(async () => session),
    withdraw: vi.fn(async requestId => ({ requestId, withdrawalId:requestId,status:'QUARANTINED',sessions:[],targets:[],unmet:['EXTERNAL_EVIDENCE_MISSING'] })) };
}
async function start(t=transport()) {
  const repo=new V2Repository(API_BASE_URL), r=new V2Runtime(repo,t);await r.initialize();await r.start(session.goalText);await r.foreground(1,time(0));return {repo,r,t};
}
async function observe(r:V2Runtime) { for(let ms=0;ms<=5000;ms+=1000) await r.observe(observation(ms)); }
async function until(check:()=>boolean) { for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,1));}expect(check()).toBe(true); }
it.each(['no-consent','withdrawn','disabled','expired'])('blocks %s before durable start and any visit',async reason=>{
  const access=structuredClone(syntheticAccess);
  if(reason==='no-consent')access.consentValid=false;if(reason==='withdrawn')access.withdrawn=true;if(reason==='disabled')access.collectionEnabled=false;if(reason==='expired')access.expiresAt='2000-01-01T00:00:00Z';
  const t=transport(access),r=new V2Runtime(new V2Repository(API_BASE_URL),t);await r.initialize();
  await expect(r.start(session.goalText)).rejects.toThrow();expect(t.start).not.toHaveBeenCalled();expect(r.snapshot().lifecycle).toBe('IDLE');expect(r.collecting()).toBe(false);
});
it('account switch holds old POST PATCH END and visit retraction queues without deleting originals',async()=>{
  const {repo,r,t}=await start();t.post=vi.fn(async()=>{throw new Error('network');});await observe(r);await r.stop(time(6000));await until(()=>r.snapshot().posts.entries[0]?.phase!=='sending');
  const original=await repo.load();repo.close();const other=transport({...syntheticAccess,participantId:'95000000-0000-4000-8000-000000000002'});
  const nextRepo=new V2Repository(API_BASE_URL),next=new V2Runtime(nextRepo,other);await next.initialize();await expect(next.retry()).rejects.toThrow();
  expect(other.post).not.toHaveBeenCalled();expect(other.patch).not.toHaveBeenCalled();expect(other.end).not.toHaveBeenCalled();
  expect(next.snapshot().posts.entries.map(e=>e.visit)).toEqual(original.posts.entries.map(e=>e.visit));expect(next.snapshot().end).toBeDefined();expect(next.collecting()).toBe(false);
});
it('worker restart rechecks the server and stale local consent never re-enables collection',async()=>{
  const {repo,r}=await start();await observe(r);await until(()=>r.snapshot().posts.entries.every(e=>e.phase==='acked'));await r.idle();const before=r.snapshot().nextSequence;repo.close();const t=transport({...syntheticAccess,consentValid:false,withdrawn:true});
  const next=new V2Runtime(new V2Repository(API_BASE_URL),t);await next.initialize();await next.observe(observation(7000));
  expect(t.access).toHaveBeenCalled();expect(t.post).not.toHaveBeenCalled();expect(next.collecting()).toBe(false);expect(next.snapshot().nextSequence).toBe(before);
});
it('authentication failure and network failure are distinguishable and preserve pending data',async()=>{
  const {r,t}=await start();await r.observe(observation(0));const before=r.snapshot().candidates;
  t.access=vi.fn(async()=>{throw new AccessError('network');});await r.observe(observation(1000));expect(r.snapshot().accessError).toBe('network');
  t.access=vi.fn(async()=>{throw new AccessError('authentication');});await r.observe(observation(2000));expect(r.snapshot().accessError).toBe('authentication');
  expect(r.snapshot().candidates).toEqual(before);expect(t.post).not.toHaveBeenCalled();
});
it('offline withdrawal intent is committed before HTTP and recovered with the same request ID',async()=>{
  const {repo,r,t}=await start();await observe(r);t.access=vi.fn(async()=>{throw new AccessError('network');});await r.withdrawAll();
  const saved=await repo.load();expect(saved.withdrawal?.phase).toBe('pending');expect(saved.quarantine).toBeDefined();expect(r.collecting()).toBe(false);repo.close();
  const nextTransport=transport({...syntheticAccess,consentValid:false,withdrawn:true});const next=new V2Runtime(new V2Repository(API_BASE_URL),nextTransport);await next.initialize();await next.retry();
  await until(()=>next.snapshot().withdrawal?.phase==='acknowledged');expect(nextTransport.withdraw).toHaveBeenCalledWith(saved.withdrawal!.requestId);
  expect(nextTransport.post).not.toHaveBeenCalled();expect(nextTransport.end).not.toHaveBeenCalled();expect(next.snapshot().posts.entries.map(e=>e.visit)).toEqual(saved.posts.entries.map(e=>e.visit));
});
it('another account cannot send an earlier participant withdrawal after restart',async()=>{
  const {repo,r,t}=await start();t.withdraw=vi.fn(async()=>{throw new Error('network');});await r.withdrawAll();repo.close();
  const other=transport({...syntheticAccess,participantId:'95000000-0000-4000-8000-000000000002'}),next=new V2Runtime(new V2Repository(API_BASE_URL),other);await next.initialize();await next.retry();expect(other.withdraw).not.toHaveBeenCalled();expect(next.snapshot().withdrawal?.phase).toBe('pending');
});
it('legacy ownerless IndexedDB values are preserved and never adopted by the current identity',async()=>{
  const {repo,r}=await start();const original=r.snapshot();delete original.owner;repo.close();vi.stubGlobal('indexedDB',new IDBFactory());original.revision=0;const legacy=new V2Repository(API_BASE_URL);await legacy.save(original,0);legacy.close();
  const t=transport(),next=new V2Runtime(new V2Repository(API_BASE_URL),t);await next.initialize();expect(next.snapshot().owner).toBeUndefined();expect(t.post).not.toHaveBeenCalled();await expect(next.retry()).rejects.toThrow();
});
it('credentials are session-only, redacted from IndexedDB, and cannot be sent to another origin',async()=>{
  const values:Record<string,string>={};const set=vi.fn(async(v:Record<string,string>)=>{Object.assign(values,v);});
  vi.stubGlobal('chrome',{storage:{session:{get:vi.fn(async()=>values),set,remove:vi.fn(async(k:string)=>{delete values[k];}),setAccessLevel:vi.fn(async()=>{})}}});
  const secret='synthetic-test-credential-95-012345678901234567890';await setCredential(secret);
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:200})));await authenticatedFetch(`${API_BASE_URL}/api/auth/me`);
  expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('Authorization')).toBe(`Bearer ${secret}`);
  await expect(authenticatedFetch('https://example.org/api/auth/me')).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
  await setCredential();expect(Object.keys(values)).toHaveLength(0);
});
it('server identity mismatch cannot reuse another participant consent response',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({participantId:syntheticAccess.participantId,expiresAt:syntheticAccess.expiresAt})))
    .mockResolvedValueOnce(new Response(JSON.stringify({...syntheticAccess,participantId:'95000000-0000-4000-8000-000000000002'}))));
  await expect(readCollectionAccess()).rejects.toThrow('ACCESS_AUTHENTICATION');
});

it('a drained ended session is archived before a different authenticated owner starts a new session',async()=>{
  const {repo,r,t}=await start();await r.stop(time(0));await until(()=>r.snapshot().lifecycle==='ENDED');const old=r.snapshot();
  t.access=vi.fn(async()=>({...syntheticAccess,participantId:'95000000-0000-4000-8000-000000000002',consentId:'95000000-0000-4000-8000-000000000004'}));
  t.start=vi.fn(async()=>({...session,sessionId:crypto.randomUUID()}));await r.start(session.goalText);
  expect(r.snapshot().owner?.participantId).not.toBe(old.owner?.participantId);expect(r.snapshot().posts.entries).toEqual([]);
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('focus-recovery');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const tx=db.transaction('v2'),request=tx.objectStore('v2').get(`session/${old.session!.sessionId}`);await new Promise<void>(resolve=>{tx.oncomplete=()=>resolve();});expect(request.result.owner).toEqual(old.owner);db.close();repo.close();
});

it('a mismatched authenticated subject cannot create an earlier owner consent-withdrawal intent',async()=>{
  const {r,t}=await start();t.access=vi.fn(async()=>({...syntheticAccess,participantId:'95000000-0000-4000-8000-000000000002'}));
  await expect(r.verifyAccess(false,true)).rejects.toThrow('ACCESS_ACCOUNT');
  await expect(r.withdrawAll()).rejects.toThrow('ACCESS_ACCOUNT');expect(r.snapshot().withdrawal).toBeUndefined();expect(t.withdraw).not.toHaveBeenCalled();
});

it('an ownerless legacy START_PENDING request cannot acquire the newly authenticated subject',async()=>{
  const {repo,r}=await start();const legacy=r.snapshot();delete legacy.owner;delete legacy.session;legacy.lifecycle='START_PENDING';legacy.revision=0;repo.close();
  vi.stubGlobal('indexedDB',new IDBFactory());const oldRepo=new V2Repository(API_BASE_URL);await oldRepo.save(legacy,0);oldRepo.close();
  const t=transport(),next=new V2Runtime(new V2Repository(API_BASE_URL),t);await next.initialize();await expect(next.start(session.goalText)).rejects.toThrow('ACCESS_ACCOUNT');
  expect(t.start).not.toHaveBeenCalled();expect(next.snapshot().owner).toBeUndefined();expect(next.snapshot().start).toEqual(legacy.start);
});
