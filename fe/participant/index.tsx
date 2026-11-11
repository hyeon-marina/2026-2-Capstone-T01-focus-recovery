import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthConsentPanel } from '../src/v2/AuthConsentPanel';
import type { CollectionAccess } from '../src/v2/access';
import type { V2Alert } from '../src/v2/status';
import './style.css';
import candidates from '../../docs/data-collection/goals.candidates.json';
declare const __COLLECTION_BUILD__: { version: string; sourceCommit: string; dirty: boolean; mode: string; apiOrigin: string; policyDigest?: string; sites?: { origin: string; pathPrefix: string }[] };
const build = __COLLECTION_BUILD__;
const pilot = build.mode === 'collection-pilot';
const real = ['real-collection','controlled-web'].includes(build.mode);
const send = (action: string, extra = {}) => chrome.runtime.sendMessage({ type: `v2-${action}`, ...extra });
type Assignment = { plannedSessionId: string; goalId: string; goalText: string | null; goalStatus: string; scenarioType: string };
type Local = { lifecycle: string; collectionAllowed: boolean; validVisits: number; pending: number; notificationPending?: number; endPhase?: string; storageFailed: boolean; accessError?: string; quarantined: boolean; withdrawalPhase?: string };
type Progress = { planned: number; completed: number; syntheticSessions: number; syntheticQualityPassed: number; raw: { completed: number; syntheticCompleted: number }; attempts: { attemptId: string; sessionStatus: string; reviewStatus: string; plannedSessionId: string; status: string; rawStatus: string; analysisState: string; rawQuality: { theoreticalWindows: number }; source: string; quality: { validVisits: number; validWindows: number; reasons: string[] }; deliveryConfirmed: boolean }[] };
const scenarios: Record<string, string> = { GOAL_MAINTENANCE: '목표 유지', JUSTIFIED_DETOUR: '합리적인 우회', GRADUAL_DRIFT: '점진적인 이탈', CLEAR_DRIFT: '명확한 이탈' };
function Participant() {
  const [access, setAccess] = useState<CollectionAccess>();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selected, setSelected] = useState('');
  const [local, setLocal] = useState<Local>();
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recollectReason, setRecollectReason] = useState('INSUFFICIENT_VISITS');
  const [alert, setAlert] = useState<V2Alert | null>(null);
  const onAccess = useCallback((value?: CollectionAccess) => { setAccess(value); if (!value || value.withdrawn) { setAssignments([]); setProgress(undefined); setAlert(null); } }, []);
  async function refresh() {
    try {
      const s = await send('status'); if (s?.error) throw new Error(); setLocal(s);
      if (!access) return;
      const a = await send('assignments'), p = await send('progress');
      if (!Array.isArray(a) || !p || p.error) throw new Error();
      setAssignments(a); setProgress(p);
      setSelected(current => current || [...p.attempts].reverse().find((attempt: { status: string }) => attempt.status === 'IN_PROGRESS')?.plannedSessionId || '');
      setError('');
    } catch { setError('서버 상태를 확인하지 못했습니다. 데이터는 보존됩니다. 연결·인증을 확인하고 재전송하세요.'); }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 3000);
    return () => clearInterval(timer);
  }, [access?.participantId, access?.consentValid]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && local?.collectionAllowed) void send('alert').then(a => { if (a?.alertId) setAlert(a); }).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [local?.collectionAllowed]);
  useEffect(() => { if (alert) void send('shown', { alertId: alert.alertId, shownAt: new Date().toISOString() }); }, [alert?.alertId]);
  async function command(action: string, extra = {}) {
    setBusy(true);setError('');if (action === 'stop') setAlert(null);
    try { const r = await send(action, { plannedSessionId: selected, ...extra });if (r?.error) throw new Error();await refresh(); }
    catch { setError('요청이 차단되었거나 응답을 확인하지 못했습니다. 미확정 목표·인증·동의·계정 연결을 확인하세요.'); }
    finally { setBusy(false); }
  }
  const assigned = assignments.find(a => a.plannedSessionId === selected);
  const candidate = candidates.goals.find(g => g.goalId === assigned?.goalId && g.description === assigned?.goalText);
  const localBuildMismatch = !!access?.local?.policyDigest && access.local.policyDigest !== build.policyDigest;
  const canStart = !localBuildMismatch && (!access?.local || access.local.ready) && (pilot || real) && access?.collectionEnabled && access.consentValid && !access.withdrawn && assigned?.goalStatus === 'CONFIRMED' && ['IDLE','START_PENDING','ENDED'].includes(local?.lifecycle ?? '');
  return <main><header><p className="eyebrow">FOCUS RECOVERY / FIELD COLLECTION</p><h1>탐색을 시작하기 전에.</h1><p>내 배정과 전송 상태를 한곳에서 확인합니다.</p></header>
    <div className="gate" role="status"><strong>{real ? access?.collectionEnabled ? '서버 수집 Gate 유효' : '실제 사용자 수집 BLOCKED' : '실제 사용자 수집 BLOCKED'}</strong><span>{real ? '설치 패키지와 서버 정책의 허용 사이트에서만 수집합니다. 승인·동의·세션 상태를 계속 확인합니다.' : pilot ? '통제된 카탈로그 합성 파일럿만 실행할 수 있습니다.' : '인증·배정 확인용 패키지입니다. 웹페이지 접근 권한과 수집 시작 권한이 없습니다.'}</span></div>
    {localBuildMismatch && <p role="alert">빌드/정책 불일치 · local.py build 후 chrome://extensions에서 본인 패키지를 새로고침하고 재로그인하세요.</p>}
    {real && <details><summary>이 패키지의 허용 사이트</summary>{build.sites?.length ? <ul>{build.sites.map(s => <li key={s.origin+s.pathPrefix}>{s.origin}{s.pathPrefix}</li>)}</ul> : <p>허용 사이트가 없습니다. 승인된 정책과 새 빌드가 필요합니다.</p>}</details>}
    <div className="layout"><div><AuthConsentPanel command={send} onAccess={onAccess} context={real ? 'real' : pilot ? 'synthetic' : 'participant'} /></div>
    <section className="work" aria-labelledby="work-title"><p className="eyebrow">MY ASSIGNMENTS</p><h2 id="work-title">오늘의 수집</h2>
      <label>배정 목표<select value={selected} onChange={e => setSelected(e.target.value)} disabled={busy || ['ACTIVE','END_PENDING'].includes(local?.lifecycle ?? '')}><option value="">목표를 선택하세요</option>{assignments.map(a => <option key={a.plannedSessionId} value={a.plannedSessionId}>{a.plannedSessionId} · {a.goalText ?? `${a.goalId} 미확정`}</option>)}</select></label>
      {assigned && <div className="scenario"><p>{assigned.goalText ?? '팀이 확정한 공통 정책과 목표 원문을 적용해야 합니다.'}</p><strong>{scenarios[assigned.scenarioType]}</strong><p>시나리오는 수행 조건입니다. AI 예측이나 사람의 정답 라벨이 아닙니다.</p>
        {candidate && <><p>{candidate.scenarioInstructions[assigned.scenarioType as keyof typeof candidate.scenarioInstructions]}</p><p>종료 기준: {candidate.completionCriteria}</p></>}</div>}
      <p>유효 Visit 최소 10개, 권장 12~15개. 활성 탭·창에서 측정한 5초 이상 방문만 포함합니다.</p>
      <div className="actions"><button disabled={!canStart || busy} onClick={() => void command('start')}>세션 시작</button><button disabled={busy || !['ACTIVE','END_PENDING'].includes(local?.lifecycle ?? '')} onClick={() => void command('stop')}>세션 종료 · 수집 중지</button></div>
      <dl className="metrics"><div><dt>세션 상태</dt><dd>{local?.lifecycle ?? '확인 중'}</dd></div><div><dt>서버 수신 Visit</dt><dd>{local?.validVisits ?? 0}</dd></div><div><dt>미완료 POST/PATCH</dt><dd>{local?.pending ?? 0}</dd></div><div><dt>종료 ACK</dt><dd>{local?.endPhase ?? '—'}</dd></div><div><dt>미전송 알림 영수증</dt><dd>{local?.notificationPending ?? 0}</dd></div></dl>
      <button disabled={busy} onClick={() => void command('retry')}>재전송 / 복구</button><button disabled={busy} onClick={() => void refresh()}>진행 상태 새로고침</button>
      {local?.storageFailed && <p role="alert">저장 오류로 안전 중지했습니다. Extension을 삭제하지 말고 관리자에게 문의하세요.</p>}
      {local?.accessError && <p role="alert">인증·동의 또는 이전 계정의 미전송 Queue를 확인하세요. 다른 계정으로 전송하지 않습니다.</p>}
      {local?.quarantined && <p role="status">개인정보 격리 상태입니다. 수집을 재개할 수 없습니다.</p>}
      {local?.lifecycle === 'ENDED' && <p role="status">종료 ACK를 받았습니다. 서버 품질 판정과 전송 확인을 아래에서 별도로 확인하세요.</p>}
      {error && <p role="alert">{error}</p>}
      {progress && <section><h3>나의 진행</h3><p>원본 수집 완료 {progress.raw.completed} / 배정 {progress.planned} · AI 포함 품질 완료 {progress.completed} · 합성 {progress.syntheticSessions}세션 (원본 완료 {progress.raw.syntheticCompleted} / AI 포함 {progress.syntheticQualityPassed})</p>
        {access?.local && <label>재수집 사유<select value={recollectReason} onChange={e => setRecollectReason(e.target.value)}><option value="INSUFFICIENT_VISITS">유효 Visit 부족</option><option value="DELIVERY_FAILED">전송 실패</option><option value="USER_REQUEST">본인 요청</option></select></label>}
        <ul>{progress.attempts.map((a,i) => <li key={i}>{a.plannedSessionId} · {a.source} · {a.status} · Visit {a.quality.validVisits} / Window {a.quality.validWindows} · 전송 {a.deliveryConfirmed ? '확인' : '미확인'} · 원본 {a.rawStatus} · AI {a.analysisState} · 이론상 Window {a.rawQuality.theoreticalWindows}{a.quality.reasons.length ? ` · AI 포함 품질: ${a.quality.reasons.join(', ')}` : ''}{access?.local && a.sessionStatus === 'ENDED' && a.rawStatus !== 'QUARANTINED' && a.reviewStatus === 'PENDING' && <button disabled={busy || access.withdrawn} onClick={() => void command('recollect', { attemptId: a.attemptId, reasonCode: recollectReason })}>사유 기록 후 재수집 허용</button>}</li>)}</ul></section>}
    </section></div>
    {alert && <aside className="reminder" role="alert"><h2>처음의 목표를 확인하세요</h2><p>{alert.goalText}</p>{(['RETURN_TO_GOAL','CONTINUE_BROWSING'] as const).map(action => <button key={action} disabled={busy} onClick={async () => { setBusy(true);try { const r = await send('selection', { alertId: alert.alertId, action, selectedAt: new Date().toISOString() });if (r?.error) throw new Error();setAlert(null);await refresh(); } catch { setError('알림 선택을 확인하지 못했습니다. 재전송 / 복구로 영수증을 확인하세요.'); } finally { setBusy(false); } }}>{action === 'RETURN_TO_GOAL' ? '목표로 돌아가기' : '탐색 계속하기'}</button>)}</aside>}
    <footer>v{build.version} · {build.sourceCommit.slice(0,12)}{build.dirty ? ' + 작업 중 변경' : ''} · {build.mode}<br />서버: {build.apiOrigin} · P1~P6 PROPOSED / P2·P6 BLOCKED</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Participant />);
