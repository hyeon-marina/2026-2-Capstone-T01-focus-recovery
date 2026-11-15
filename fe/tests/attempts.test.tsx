// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Attempts, type Attempt } from '../participant/Attempts';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const attempt=(plan:string,complete:boolean):Attempt=>({attemptId:'attempt-'+plan,sessionId:'session-'+plan,plannedSessionId:plan,sessionStatus:'ENDED',privacyStatus:'CLEAR',reviewStatus:'PENDING',source:'PARTICIPANT',status:'RECOLLECT_REQUIRED',rawStatus:complete?'RAW_COLLECTED':'RECOLLECT_REQUIRED',analysisState:'NOT_RUN',rawQuality:{validVisits:complete?10:2,theoreticalWindows:complete?8:0},quality:{validVisits:complete?10:2,validWindows:0,reasons:['AI_NOT_RUN']},deliveryConfirmed:true});
let cleanup:()=>void;
afterEach(()=>cleanup?.());
it('binds PLAN-006 confirmation through reorder to its own tuple, prevents duplicate clicks, protects PLAN-003', async()=>{
  const holder=document.createElement('div');document.body.append(holder);const root=createRoot(holder);cleanup=()=>{act(()=>root.unmount());holder.remove();};
  const a=attempt('PLAN-003',true),b=attempt('PLAN-006',false);let resolve!:()=>void;
  const recollect=vi.fn(()=>new Promise<void>(r=>{resolve=r;}));
  const render=(attempts:Attempt[])=>act(()=>root.render(<Attempts attempts={attempts} local disabled={false} recollect={recollect}/>));
  const click=(name:string)=>act(()=>{const button=[...holder.querySelectorAll('button')].find(b=>b.textContent===name)!;expect(button).toBeTruthy();button.click();});
  render([a,b]);expect(holder.textContent).toContain('PLAN-003 · PARTICIPANT · 원본 RAW_COLLECTED');
  click('PLAN-006 · Visit 2 · 재수집 대상 확인');render([b,a]);
  click('PLAN-006 재수집 확정');click('PLAN-006 재수집 확정');
  expect(recollect).toHaveBeenCalledTimes(1);expect(recollect).toHaveBeenCalledWith({attemptId:b.attemptId,sessionId:b.sessionId,plannedSessionId:'PLAN-006',reasonCode:'INSUFFICIENT_VISITS',confirmCompleted:false});
  await act(async()=>resolve());
  click('PLAN-003 · Visit 10 · 정상 완료 재수집 검토');expect(holder.querySelector('[role="dialog"]')?.textContent).toContain('완료 집계에서는 제외');
  render([{...a,reviewStatus:'RECOLLECT_REQUIRED'},b]);expect(holder.querySelector('[role="alert"]')).toBeTruthy();
  const confirm=[...holder.querySelectorAll('button')].find(b=>b.textContent==='PLAN-003 재수집 확정')!;expect(confirm.disabled).toBe(true);
});
it('keeps AI quality as the primary status outside RAW_ONLY local collection',()=>{
  const holder=document.createElement('div');document.body.append(holder);const root=createRoot(holder);cleanup=()=>{act(()=>root.unmount());holder.remove();};
  const a={...attempt('PLAN-001',true),source:'SYNTHETIC',status:'QUALITY_PASSED'};
  act(()=>root.render(<Attempts attempts={[a]} local={false} disabled={false} recollect={async()=>{}}/>));
  expect(holder.querySelector('li')?.textContent).toMatch(/^PLAN-001 · SYNTHETIC · QUALITY_PASSED/);
});
