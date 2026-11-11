import { useEffect, useRef, useState } from 'react';
import type { CollectionAccess, WithdrawalReceipt } from './access';
import './access.css';
import { localBlocker } from './local-status';
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
    <p className="access-label">{context === 'real' ? 'APPROVED SITES · 공통 정책 확인' : context === 'synthetic' ? 'SYNTHETIC TEST ONLY · 운영 수집 차단' : 'PARTICIPANT PREPARATION · 운영 수집 차단'}</p>
    <h2 id="access-title">인증과 수집 동의</h2>
    <p>{context === 'real' ? '로컬 setup이 저장한 participant.json을 본인 Chrome 프로필에서 선택하거나 자격정보를 입력하세요. 파일은 서버로 업로드하지 않습니다.' : context === 'synthetic' ? '합성 카탈로그 검증 화면입니다. 실제 참여자 동의서나 개인정보 처리방침이 아닙니다.' : '등록 담당자가 발급한 자격정보로 내 배정을 확인합니다. 실제 수집 동의와 운영 활성화는 아직 차단됩니다.'}</p>
    <p role="status">{access ? `인증됨 · ${access.withdrawn ? '동의 철회됨' : access.consentValid ? '서버 동의 유효' : '동의 필요'}` : context === 'synthetic' ? '인증 필요 · 테스트에서 발급한 자격정보로 확인하세요.' : context === 'real' ? 'Credential 없음 · local.py setup --slot A/B/C를 실행하세요.' : '인증 필요 · 등록 담당자에게 본인 자격정보를 받으세요.'}</p>
    {context === 'real' && <label>로컬 Credential 파일 불러오기<input type="file" accept="application/json,.json" disabled={busy} onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
      try { if (file.size > 4096) throw new Error(); const data = JSON.parse(await file.text());
        if (typeof data.credential !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(data.credential) || !['A','B','C'].includes(data.slot)) throw new Error();
        await run('login', { token: data.credential });
      } catch { setError('credential-file'); }
    }} /></label>}
    {access?.local && <div role="status"><p>로컬 슬롯 {access.local.slot || '미초기화'} · Credential 준비됨 · 서버 HTTPS 연결됨</p>
      <p>공통 정책 SHA-256: {access.local.policyDigest || '미적용'}</p>
      <details><summary>공통 Plan revision {access.local.planRevision ?? '미적용'} · 체크섬</summary><p>Plan: {access.local.planChecksum || '미적용'}</p><p>Goal: {access.local.goalChecksum || '미적용'}</p><p>Assignment: {access.local.assignmentChecksum || '미적용'}</p></details>
      {access.local.details && <dl><dt>보존·삭제 방침</dt><dd>{access.local.details.retentionPolicy}</dd><dt>민감 페이지 제외</dt><dd>{access.local.details.sensitivePageExclusions}</dd><dt>검색어·본문 개인정보 처리</dt><dd>{access.local.details.textPrivacyPolicy}</dd><dt>정책 변경·만료</dt><dd>{access.local.details.changePolicy}</dd><dt>수집 개시 범위</dt><dd>{access.local.details.collectionScope}</dd></dl>}
      {access.local.blockers.map(code => <p key={code}>{localBlocker(code)}</p>)}
      <p>{access.local.ready ? '수집 준비 완료 · 허용 사이트와 본인 배정에서 시작하세요.' : '위 항목을 완료한 뒤 서버 상태를 재확인하세요.'}</p></div>}
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
      : <p>공통 동의 정책이 없습니다. local.py setup --slot A/B/C --policy FILE --policy-sha256 HASH로 팀의 확정 정책을 적용하세요.</p>}
    <label className="access-check"><input type="checkbox" checked={checked} disabled={!acceptable || access?.withdrawn || busy} onChange={e => setChecked(e.target.checked)} />
      {synthetic ? '위 합성 정책의 목적·항목·이용 범위를 확인하고 합성 테스트 처리에 명시적으로 동의합니다.' : '위 정책의 목적·항목·이용 범위·보존·철회 절차를 확인하고 명시적으로 동의합니다.'}</label>
    <button disabled={busy || !checked || !acceptable || access?.withdrawn} onClick={() => void run('agree', { policyId: policy?.policyId, policyVersion: policy?.policyVersion })}>{synthetic ? '합성 동의 기록 저장' : '수집 동의 기록 저장'}</button>
    <p>{access?.collectionEnabled && context === 'real' ? '허용 사이트와 활성 세션에서만 수집합니다.' : '정책·기관·보존기간·운영 승인 미충족 시 수집과 전송을 차단합니다.'}</p>
    <button className="access-withdraw" disabled={busy || !access} onClick={() => void run('withdraw')}>전체 동의 철회 · 수집 즉시 중지</button>
    {withdrawal && <p role="status">철회 접수: {withdrawal.status} · 세션 {withdrawal.sessions.length}개 · 전체 삭제 확인 미완료</p>}
    {error && <p role="alert">{error === 'authentication' ? 'Credential이 만료·폐기되었거나 유효하지 않습니다. local.py setup --slot A/B/C --rotate-credential 후 파일을 다시 불러오세요.' : error === 'credential-file' ? '본인 로컬 participant.json을 선택하세요. Credential 값을 화면에 표시하지 않습니다.' : error === 'network' ? '서버 연결 실패 · local.py status와 localhost 인증서 신뢰·만료를 확인하세요. TLS 경고를 무시하지 마세요. 미전송 데이터와 철회 요청은 보존됩니다.' : '동의·정책 또는 계정 연결을 확인하세요. 수집과 전송을 차단했습니다.'}</p>}
  </section>;
}
