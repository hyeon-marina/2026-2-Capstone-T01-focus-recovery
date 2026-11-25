import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { normalizeGoal, validGoal } from '../src/shared/goal';
import { FIXTURE_ORIGIN } from '../synthetic/catalog';
import { isPrivacyCommand, isUserSnapshot, type UserCommand, type UserError, type UserReply, type UserSnapshot } from './protocol';
import { AlertPage } from './alert-page';
import './style.css';

const headings = {
  IDLE: '오늘의 작업 목표',
  START_PENDING: '작업 시작 확인 중',
  ACTIVE: '작업 진행 중',
  END_PENDING: '작업 종료 확인 중',
  ENDED: '작업 종료 완료',
};
const errors: Record<UserError, string> = {
  invalid: '입력을 확인해 주세요. 인증 시 합성 테스트 자격정보를 사용해 주세요.',
  auth: '인증이 만료되었거나 유효하지 않아요. 같은 계정으로 다시 인증해 주세요.',
  consent: '현재 동의 또는 수집 권한을 확인해 주세요.',
  account: '다른 계정의 작업이 남아 있어요. 기존 계정으로 다시 인증해 주세요.',
  network: '서버에 연결할 수 없어요. 연결을 확인한 뒤 같은 요청을 다시 시도해 주세요.',
  response: '서버의 세션 정보를 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
  blocked: '지금은 요청을 처리할 수 없어요. 현재 작업 상태와 권한을 확인해 주세요.',
};
const analysis: Record<UserSnapshot['analysis'], string> = {
  unconnected: '분석 미연결', empty: '분석 결과 없음', pending: '분석 대기', delayed: '분석 지연', failed: '분석 실패',
  invalidated: '분석 무효화', unavailable: '분석 상태 확인 불가', completed: '분석 완료',
};
const decisions = { NORMAL: '정상 탐색', TRANSITION: '전환 탐색', DRIFT: '목표 이탈' };
const connectionLabels: Record<UserSnapshot['connection'], string> = {
  unverified: '서버 검증 전', verified: '최근 서버 검증', stale: '서버 재확인 필요',
  unreachable: '서버 응답 실패', 'auth-required': '인증 확인 필요', denied: '서버 접근 거부',
};
const timeFormat = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Popup() {
  const [snapshot, setSnapshot] = useState<UserSnapshot>();
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState<UserCommand['type']>();
  const [error, setError] = useState<UserError>();
  const [offline, setOffline] = useState(false);
  const [next, setNext] = useState(false);
  const [consent, setConsent] = useState(false);
  const pending = useRef<{ id: number; type: UserCommand['type'] } | undefined>(undefined);
  const generation = useRef(0);

  useEffect(() => {
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      const current = generation.current;
      try {
        const reply: UserReply = await chrome.runtime.sendMessage({ type: 'status' });
        if (!disposed && generation.current === current) {
          if (!('snapshot' in reply) || !isUserSnapshot(reply.snapshot)) throw new Error('Invalid snapshot');
          setSnapshot(reply.snapshot);
          setOffline(false);
        }
      } catch {
        if (!disposed && generation.current === current) { setOffline(true); setSnapshot(undefined); }
      } finally { polling = false; }
    };
    void chrome.runtime.sendMessage({ type: 'analysis-refresh' }).catch(() => {});
    void poll();
    const timer = setInterval(() => void poll(), 500);
    return () => { disposed = true; clearInterval(timer); };
  }, []);

  async function request(command: UserCommand) {
    if (pending.current && (!isPrivacyCommand(command.type) || isPrivacyCommand(pending.current.type))) return;
    const id = ++generation.current;
    pending.current = { id, type: command.type };
    setBusy(command.type);
    setError(undefined);
    try {
      const reply: UserReply = await chrome.runtime.sendMessage(command);
      if (pending.current?.id !== id) return;
      generation.current++;
      if ('snapshot' in reply && isUserSnapshot(reply.snapshot)) {
        setSnapshot(reply.snapshot);
        setOffline(false);
      }
      setError(reply.error);
      if (command.type === 'start' && 'snapshot' in reply && ['START_PENDING', 'ACTIVE'].includes(reply.snapshot.lifecycle)) {
        setNext(false);
        setGoal('');
      }
    } catch {
      if (pending.current?.id === id) { generation.current++; setSnapshot(undefined); setOffline(true); }
    } finally {
      if (pending.current?.id === id) { pending.current = undefined; setBusy(undefined); }
    }
  }

  function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const token = new FormData(form).get('credential');
    form.reset();
    if (typeof token === 'string') void request({ type: 'login', token: token.trim() });
  }

  const size = normalizeGoal(goal).length;
  const s = snapshot;
  const loginRequired = !s?.privacyPending && (s?.access === 'auth' || s?.access === 'account');
  const ready = s?.access === 'ready' && s.permission && !s.storageFailed && !s.privacyPending;
  const privacyBusy = !!s?.privacyPending || !!busy && isPrivacyCommand(busy);
  const canStart = ready && ['verified', 'stale'].includes(s.connection) && (s.lifecycle === 'IDLE' || s.lifecycle === 'ENDED' && next);
  const needsRecovery = s?.reconnectRequired || s?.deliveryIssue || s?.privacyHold;
  const fixture = `${FIXTURE_ORIGIN}/__focus_synthetic__/a`;
  const title = !s ? '작업 상태 확인'
    : s.privacyPending && !s.withdrawalPending ? '접근 중단 처리 중'
    : loginRequired ? '합성 계정으로 시작'
    : s.access === 'consent' ? '합성 수집 동의'
    : s.access === 'withdrawn' ? (s.withdrawalPending ? '동의 철회 확인 중' : '수집 동의 철회됨')
    : s.access === 'denied' ? '수집 권한 확인'
    : canStart ? headings.IDLE : headings[s.lifecycle];

  return <main>
    <header>
      <div className="brand"><span className="mark" aria-hidden="true" /> Focus Recovery</div>
      <span className="environment">합성 테스트</span>
    </header>
    <section aria-labelledby="heading" className="workspace">
      <h1 id="heading">{title}</h1>
      {!s && <p role="status">{offline ? '확장 프로그램 상태를 읽을 수 없어요. 팝업을 다시 열어 주세요.' : '저장된 작업 상태를 확인하고 있어요.'}</p>}
      {s?.privacyPending && <p role="status">수집과 전송을 멈췄어요. 개인정보 요청을 처리하고 있어요.</p>}
      {s?.storageFailed && <p role="alert" className="notice">작업 저장소를 열 수 없어요. 기록을 보존하고 수집과 전송을 멈췄어요. 확장 프로그램을 다시 열어 상태를 확인해 주세요.</p>}
      {s && !s.permission && <p role="alert" className="notice">Chrome에서 합성 사이트 권한이 꺼져 있어요. 확장 프로그램의 사이트 액세스를 확인해 주세요.</p>}
      {error && <p className="notice" role="alert">{errors[error]}</p>}
      {loginRequired && <form onSubmit={authenticate}>
        <p>{s.access === 'account' ? errors.account : '로컬 Mock 서버에서만 사용하는 합성 계정으로 인증해 주세요.'}</p>
        <label htmlFor="credential">합성 테스트 자격정보</label>
        <input id="credential" name="credential" type="password" autoComplete="off" spellCheck={false} required disabled={!!busy} />
        <button className="primary" disabled={!!busy}>{busy === 'login' ? '인증 확인 중…' : '인증하기'}</button>
      </form>}
      {s?.access === 'consent' && <>
        <p>허용된 합성 문서의 제목과 본문, 활성 체류시간, 탭 전환을 로컬 Mock 서버에 저장해요.</p>
        <label className="check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> 합성 탐색 데이터 수집에 동의합니다.</label>
        <button className="primary" disabled={!consent || !!busy || s.storageFailed} onClick={() => void request({ type: 'agree' })}>
          {busy === 'agree' ? '동의 저장 중…' : '합성 동의 저장'}
        </button>
      </>}
      {s?.access === 'denied' && <p className="notice">서버가 수집 권한을 허용하지 않았어요. 권한이 복구되면 연결 상태를 다시 확인해 주세요.</p>}
      {s?.access === 'withdrawn' && <p className="notice">{s.withdrawalPending
        ? '수집과 전송을 멈췄어요. 서버 확인이 끝날 때까지 기록을 보호합니다.'
        : '합성 탐색의 수집과 전송을 멈췄어요.'}</p>}
      {s?.withdrawalPending && <button disabled={!!busy} onClick={() => void request({ type: 'retry' })}>철회 요청 다시 확인</button>}
      {canStart && <form onSubmit={event => { event.preventDefault(); if (validGoal(goal)) void request({ type: 'start', goal }); }}>
        <label htmlFor="goal">최초 작업 목표</label>
        <textarea id="goal" value={goal} rows={3} onChange={e => setGoal(e.target.value)}
          aria-describedby="goal-length" aria-invalid={size > 150} disabled={!!busy}
          placeholder="예: React 상태 관리 방식에 대한 자료 조사하기" />
        <div className="field-note" id="goal-length">
          <span>{size > 150 ? '목표를 150자 이하로 줄여 주세요.' : '앞뒤 공백을 제외하고 5~150자'}</span><span>{size} / 150</span>
        </div>
        <button className="primary" disabled={!!busy || !validGoal(goal)}>{busy === 'start' ? '시작 요청 중…' : '작업 시작'}</button>
      </form>}
      {s?.goal && !loginRequired && !canStart && <p className="goal">{s.goal}</p>}
      {s?.lifecycle === 'START_PENDING' && !loginRequired && <>
        <p>서버에서 시작을 확인하면 탐색 기록을 수집해요.</p>
        <button className="primary" disabled={!ready || !!busy} onClick={() => void request({ type: 'retry-start' })}>
          {busy ? '시작 요청 확인 중…' : '같은 시작 요청 다시 확인'}
        </button>
      </>}
      {s?.lifecycle === 'ACTIVE' && !loginRequired && <>
        <dl>
          <div><dt>시작 시각</dt><dd>{timeFormat.format(new Date(s.startedAt!))}</dd></div>
          <div><dt>탐색 수집</dt><dd>{s.collecting ? '합성 페이지에서 가능' : '일시 중지'}</dd></div>
          <div><dt>분석</dt><dd>{s.finalState ? decisions[s.finalState] : analysis[s.analysis]}</dd></div>
        </dl>
        {s.privacyHold && s.access !== 'withdrawn' && <p className="notice">개인정보 보호를 위해 수집과 전송을 멈췄어요. 종료를 선택해 격리된 작업을 정리해 주세요.</p>}
        {s.reconnectRequired && !s.privacyHold && <button disabled={!ready || !!busy} onClick={() => void request({ type: 'reconnect' })}>기존 작업 재연결</button>}
        {s.deliveryIssue && !s.privacyHold && <>
          <p className="notice">서버에 확인되지 않은 기록이 있어요. 연결을 확인한 뒤 다시 보내 주세요.</p>
          <button disabled={!ready || !!busy} onClick={() => void request({ type: 'retry' })}>미전송 기록 다시 보내기</button>
        </>}
        <button className="primary" disabled={!!busy || s.storageFailed || s.privacyPending || s.access === 'withdrawn'} onClick={() => {
          if (s.sessionHandle) void request({ type: 'stop', sessionHandle: s.sessionHandle });
        }}>{busy === 'stop' ? '종료 요청 중…' : '작업 종료'}</button>
      </>}
      {s?.lifecycle === 'END_PENDING' && !loginRequired && <>
        <p>{needsRecovery ? '종료 확인이 지연되고 있어요. 전송이 끝나면 서버에서 종료 상태를 확인해요.' : '수집을 멈췄어요. 남은 기록을 전송하고 서버에서 종료를 확인 중이에요.'}</p>
        <button className="primary" disabled={!ready || !!busy} onClick={() => void request({ type: 'retry' })}>전송 및 종료 다시 확인</button>
      </>}
      {s?.lifecycle === 'ENDED' && !next && s.access === 'ready' && <>
        <p>서버에서 종료를 확인했어요. 새 목표로 작업을 시작할 수 있어요.</p>
        <button className="primary" disabled={!ready || !!busy} onClick={() => setNext(true)}>새 작업 준비</button>
      </>}
      {s?.receipts && (s.receiptPending || s.receipts.acknowledged > 0) && <div role="status">
        {s.receipts.acknowledged > 0 && <p>서버에 저장된 알림 기록 {s.receipts.acknowledged}건</p>}
        {s.receiptPending && <p>기기에 저장된 미확인 알림 기록 {s.receipts.pending}건
          {s.receipts.previousPending > 0 && ` (이전 작업 ${s.receipts.previousPending}건)`}</p>}
        {s.receipts.retryWaiting > 0 && <p>연결을 확인한 뒤 자동으로 다시 보내요.</p>}
        {s.receipts.exhausted > 0 && <p>자동 전송을 마쳤어요. 기기에 보관된 기록의 서버 저장 여부를 다시 확인할 수 있어요.</p>}
        {s.receipts.rejected > 0 && <p>서버에서 거절되거나 충돌한 알림 기록은 기기에 보관했어요.</p>}
        {s.receipts.accessBlocked > 0 && <p>알림 기록을 보내려면 연결 및 동의 상태를 확인해 주세요.</p>}
      </div>}
      {!!s?.receipts?.exhausted && <button disabled={!s.permission || !!busy || s.privacyPending}
        onClick={() => void request({ type: 'retry-receipts' })}>미확인 알림 기록 다시 보내기</button>}
    </section>
    <footer>
      <a href={fixture} target="_blank" rel="noreferrer">합성 페이지 열기 <span aria-hidden="true">↗</span></a>
      {s && <span role="status" className={s.connection === 'verified' ? 'connected' : ''}
        title={s.serverCheckedAt ? `마지막 검증 ${timeFormat.format(s.serverCheckedAt)}` : undefined}>
        {connectionLabels[s.connection]}
      </span>}
    </footer>
    {s && <details className="settings">
      <summary>연결 및 동의 설정</summary>
      <div className="settings-actions">
        <button disabled={!!busy} onClick={() => void request({ type: 'access' })}>접근 상태 확인</button>
        {s.access !== 'auth' && <button disabled={privacyBusy} onClick={() => { setConsent(false); void request({ type: 'logout' }); }}>로그아웃</button>}
        {s.access === 'ready' && <button disabled={privacyBusy} onClick={() => {
          if (window.confirm('합성 수집 동의를 철회하고 수집과 전송을 중단할까요?')) void request({ type: 'withdraw' });
        }}>합성 동의 철회</button>}
      </div>
    </details>}
  </main>;
}

const viewId = new URLSearchParams(location.search).get('alert');
createRoot(document.getElementById('root')!).render(viewId === null ? <Popup /> : <AlertPage viewId={viewId} />);
