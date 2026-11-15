import { useRef, useState } from 'react';

export type Attempt = {
  attemptId: string; sessionId: string; plannedSessionId: string; sessionStatus: string;
  privacyStatus: string; reviewStatus: string; source: string; status: string; rawStatus: string;
  analysisState: string; rawQuality: { validVisits: number; theoreticalWindows: number };
  quality: { validVisits: number; validWindows: number; reasons: string[] }; deliveryConfirmed: boolean;
};
export function Attempts({ attempts, local, disabled, recollect }: {
  attempts: Attempt[]; local: boolean; disabled: boolean;
  recollect: (payload: { attemptId: string; sessionId: string; plannedSessionId: string; reasonCode: string; confirmCompleted: boolean }) => Promise<void>;
}) {
  const [target, setTarget] = useState<Attempt>();
  const [reason, setReason] = useState('INSUFFICIENT_VISITS');
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const current = attempts.find(a => a.attemptId === target?.attemptId);
  const unchanged = current?.sessionId === target?.sessionId && current?.plannedSessionId === target?.plannedSessionId
    && current?.reviewStatus === target?.reviewStatus && current?.rawStatus === target?.rawStatus
    && current?.privacyStatus === target?.privacyStatus && current?.sessionStatus === target?.sessionStatus
    && current?.rawQuality.validVisits === target?.rawQuality.validVisits && current?.deliveryConfirmed === target?.deliveryConfirmed;
  return <><ul>{attempts.map(a => <li key={a.attemptId}>
    {a.plannedSessionId} · {a.source} · {local ? `원본 ${a.rawStatus}` : a.status} · Visit {a.rawQuality.validVisits} · 전송 {a.deliveryConfirmed ? '확인' : '미확인'} · AI {a.analysisState} · 이론상 Window {a.rawQuality.theoreticalWindows}
    {!local && <span> / Window {a.quality.validWindows} · 원본 {a.rawStatus}{a.quality.reasons.length ? ` · AI 포함 품질: ${a.quality.reasons.join(', ')}` : ''}</span>}
    {local && a.sessionStatus === 'ENDED' && a.privacyStatus === 'CLEAR' && a.rawStatus !== 'QUARANTINED' && a.reviewStatus === 'PENDING' && <button disabled={disabled || !!target || pending} onClick={() => {
      setError(''); setTarget({ ...a }); setReason(a.rawStatus === 'RAW_COLLECTED' ? 'USER_REQUEST' : 'INSUFFICIENT_VISITS');
    }}>{a.plannedSessionId} · Visit {a.rawQuality.validVisits} · {a.rawStatus === 'RAW_COLLECTED' ? '정상 완료 재수집 검토' : '재수집 대상 확인'}</button>}
  </li>)}</ul>{target && <div role="dialog" aria-modal="true" aria-label="재수집 대상 확인" onKeyDown={e=>{
    if(e.key==='Escape' && !disabled && !pending){e.preventDefault();setTarget(undefined);}
    if(e.key==='Tab'){
      const controls=[...e.currentTarget.querySelectorAll<HTMLElement>(':is(button,select):not(:disabled)')];
      const next=e.shiftKey && document.activeElement===controls[0] ? controls.at(-1) : !e.shiftKey && document.activeElement===controls.at(-1) ? controls[0] : undefined;
      if(next){e.preventDefault();next.focus();}
    }
  }}>
    <p>{target.plannedSessionId} · Visit {target.rawQuality.validVisits} · {target.rawStatus}</p>
    <p>Attempt {target.attemptId} · Session {target.sessionId}</p>
    <p>이 대상만 재수집으로 변경합니다. 기존 데이터와 감사 기록은 보존되며 완료 집계에서는 제외됩니다.</p>
    {target.rawStatus === 'RAW_COLLECTED' && <p>이미 정상 RAW 수집을 완료했습니다. AI NOT_RUN은 재수집 사유가 아닙니다.</p>}
    <label>재수집 사유<select value={reason} disabled={disabled || pending || target.rawStatus === 'RAW_COLLECTED'} onChange={e => setReason(e.target.value)}>
      <option value="INSUFFICIENT_VISITS">유효 Visit 부족</option><option value="DELIVERY_FAILED">전송 실패</option><option value="USER_REQUEST">본인 요청</option>
    </select></label>
    {error && <p role="alert">{error}</p>}
    {!unchanged && <p role="alert">대상 상태가 바뀌었습니다. 취소한 뒤 다시 확인하세요.</p>}
    <button autoFocus disabled={disabled || pending} onClick={() => setTarget(undefined)}>취소</button>
    <button disabled={disabled || pending || !unchanged} onClick={async () => {
      if (sending.current || !unchanged) return;
      sending.current = true;
      setPending(true);
      try { await recollect({ attemptId: target.attemptId, sessionId: target.sessionId, plannedSessionId: target.plannedSessionId, reasonCode: reason, confirmCompleted: target.rawStatus === 'RAW_COLLECTED' }); setTarget(undefined); }
      catch { setError('재수집 응답을 확인하지 못했습니다. 대상 상태를 새로 확인하세요.'); }
      finally { sending.current = false; setPending(false); }
    }}>{target.plannedSessionId} 재수집 확정</button>
  </div>}</>;
}
