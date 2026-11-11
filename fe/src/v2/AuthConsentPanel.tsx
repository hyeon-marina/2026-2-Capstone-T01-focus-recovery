import { useEffect, useRef, useState } from 'react';
import type { CollectionAccess, WithdrawalReceipt } from './access';
import './access.css';
type Result = { access?: CollectionAccess; error?: string; withdrawal?: WithdrawalReceipt };
export function AuthConsentPanel({ command, onAccess, context = 'synthetic' }: {
  context?: 'synthetic' | 'participant' | 'real';
  command: (action: string, body?: Record<string, unknown>) => Promise<Result>;
  onAccess: (access?: CollectionAccess) => void;
}) {
  const revision = useRef(0);
  const [access, setAccess] = useState<CollectionAccess>();
  const [token, setToken] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [withdrawal, setWithdrawal] = useState<WithdrawalReceipt>();
  async function run(action: string, body?: Record<string, unknown>) {
    const request = ++revision.current;
    setBusy(true); setError('');
    if (['login','logout','withdraw'].includes(action)) { onAccess(undefined); setAccess(undefined); }
    try {
      const result = await command(action, body);
      if (request !== revision.current) return;
      if (access?.policy?.policyId !== result.access?.policy?.policyId || access?.policy?.policyVersion !== result.access?.policy?.policyVersion) setChecked(false);
      setAccess(result.access); onAccess(result.access); setWithdrawal(result.withdrawal);
      setError(result.error ?? '');
    } catch { if (request === revision.current) { setAccess(undefined); onAccess(undefined); setError('network'); } }
    finally { if (request === revision.current) { setBusy(false); if (action !== 'access') { setToken(''); setChecked(false); } } }
  }
  useEffect(() => { void run('access'); }, []);
  useEffect(() => {
    const timer = setInterval(() => { if (!busy && document.visibilityState === 'visible') void run('access'); }, 5000);
    return () => clearInterval(timer);
  }, [busy]);
  const policy = access?.policy;
  const synthetic = policy?.status === 'SYNTHETIC';
  const acceptable = synthetic || context === 'real' && policy?.status === 'APPROVED' && !!policy.approvalRef && !!policy.retentionPolicyRef;
  return <section className="access-panel" aria-labelledby="access-title">
    <p className="access-label">{context === 'real' ? 'APPROVED SITES · 서버 승인 필요' : context === 'synthetic' ? 'SYNTHETIC TEST ONLY · 운영 수집 차단' : 'PARTICIPANT PREPARATION · 운영 수집 차단'}</p>
    <h2 id="access-title">인증과 수집 동의</h2>
    <p>{context === 'real' ? '발급 자격정보로 로그인한 뒤 서버의 정책 내용을 직접 확인하세요.' : context === 'synthetic' ? '합성 카탈로그 검증 화면입니다. 실제 참여자 동의서나 개인정보 처리방침이 아닙니다.' : '등록 담당자가 발급한 자격정보로 내 배정을 확인합니다. 실제 수집 동의와 운영 활성화는 아직 차단됩니다.'}</p>
    <p role="status">{access ? `인증됨 · ${access.withdrawn ? '동의 철회됨' : access.consentValid ? '서버 동의 유효' : '동의 필요'}` : context === 'synthetic' ? '인증 필요 · 테스트에서 발급한 자격정보로 확인하세요.' : '인증 필요 · 등록 담당자에게 본인 자격정보를 받으세요.'}</p>
    <form onSubmit={e => { e.preventDefault(); void run('login', { token }); }}>
      <label>{context === 'synthetic' ? '합성 테스트 자격정보' : '발급 자격정보'}<input type="password" value={token} autoComplete="off" spellCheck={false} onChange={e => setToken(e.target.value)} /></label>
      <button disabled={busy || token.length < 43}>인증 / 계정 전환</button>
    </form>
    <div className="access-actions"><button disabled={busy} onClick={() => void run('access')}>서버 상태 재확인</button>
      <button disabled={busy || !access} onClick={() => void run('logout')}>로그아웃</button></div>
    {policy ? <details open><summary>정책 {policy.policyVersion} · {policy.status}</summary><dl>
      <dt>적용 대상</dt><dd>{policy.scope}</dd><dt>수집 목적</dt><dd>{policy.purpose}</dd>
      <dt>수집 항목</dt><dd>{policy.collectionItems}</dd><dt>이용 범위</dt><dd>{policy.useScope}</dd>
      <dt>보존·삭제 정책 참조</dt><dd>{policy.retentionPolicyRef ?? '미승인 · 보존기간 미확정'}</dd>
      <dt>승인 근거</dt><dd>{policy.approvalRef ?? '기관·운영 승인 없음'}</dd>
    </dl><p>철회는 아래 ‘전체 동의 철회’에서 요청합니다. 외부 사본 삭제 확인 전에는 격리 상태를 유지합니다.</p></details>
      : <p>사용할 수 있는 승인 정책이 없습니다. 수집을 시작할 수 없습니다.</p>}
    <label className="access-check"><input type="checkbox" checked={checked} disabled={!acceptable || access?.withdrawn || busy} onChange={e => setChecked(e.target.checked)} />
      {synthetic ? '위 합성 정책의 목적·항목·이용 범위를 확인하고 합성 테스트 처리에 명시적으로 동의합니다.' : '위 정책의 목적·항목·이용 범위·보존·철회 절차를 확인하고 명시적으로 동의합니다.'}</label>
    <button disabled={busy || !checked || !acceptable || access?.withdrawn} onClick={() => void run('agree', { policyId: policy?.policyId, policyVersion: policy?.policyVersion })}>{synthetic ? '합성 동의 기록 저장' : '수집 동의 기록 저장'}</button>
    <p>{access?.collectionEnabled && context === 'real' ? '허용 사이트와 활성 세션에서만 수집합니다.' : '정책·기관·보존기간·운영 승인 미충족 시 수집과 전송을 차단합니다.'}</p>
    <button className="access-withdraw" disabled={busy || !access} onClick={() => void run('withdraw')}>전체 동의 철회 · 수집 즉시 중지</button>
    {withdrawal && <p role="status">철회 접수: {withdrawal.status} · 세션 {withdrawal.sessions.length}개 · 전체 삭제 확인 미완료</p>}
    {error && <p role="alert">{error === 'authentication' ? '인증정보가 없거나 만료되었습니다. 재인증이 필요합니다.' : error === 'network' ? '서버 연결을 확인하세요. 미전송 데이터와 철회 요청은 보존됩니다.' : '동의·정책 또는 계정 연결을 확인하세요. 수집과 전송을 차단했습니다.'}</p>}
  </section>;
}
