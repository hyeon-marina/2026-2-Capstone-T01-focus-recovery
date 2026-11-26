import { useEffect, useState } from 'react';
import { FIXTURE_ORIGIN } from '../synthetic/catalog';
import { ConsentScreen, GoalScreen, LoginScreen } from './onboarding';
import { isPrivacyCommand, type UserCommand, type UserError } from './protocol';
import { ActiveSession, ReceiptStatus, SessionTimes } from './session-panels';
import { Settings } from './settings';
import { Button, Footer, GoalCard, Header, Notice } from './ui';
import { useUserSession } from './use-user-session';

const headings = {
  IDLE: '오늘의 작업 목표',
  START_PENDING: '작업 시작 확인 중',
  ACTIVE: '작업 진행 중',
  END_PENDING: '작업 종료 확인 중',
  ENDED: '작업 종료 완료',
};

const errors: Record<UserError, string> = {
  invalid: '입력을 확인해 주세요. 인증 시 합성 테스트 자격정보를 사용해 주세요.',
  auth: '인증을 확인하지 못했어요. 같은 계정으로 다시 인증해 주세요.',
  consent: '수집 동의와 사이트 접근 권한을 확인해 주세요.',
  account: '다른 계정의 작업이 남아 있어요. 기존 계정으로 다시 인증해 주세요.',
  network: '서버에 연결할 수 없어요. 연결을 확인한 뒤 같은 요청을 다시 시도해 주세요.',
  response: '서버의 세션 정보를 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
  blocked: '지금은 요청을 처리할 수 없어요. 작업 상태와 권한을 확인해 주세요.',
};

export function Popup() {
  const { snapshot: s, busy, error, offline, request } = useUserSession();
  const [goal, setGoal] = useState('');
  const [next, setNext] = useState(false);
  const access = s?.access;

  useEffect(() => {
    if (access === 'auth' || access === 'account' || access === 'withdrawn') {
      setGoal('');
      setNext(false);
    }
  }, [access]);

  const privacyBusy = !!s?.privacyPending || !!busy && isPrivacyCommand(busy);
  const loginRequired = !privacyBusy && (access === 'auth' || access === 'account');
  const ready = s?.access === 'ready' && s.permission && !s.storageFailed && !privacyBusy;
  const showDetails = ready && !s?.privacyHold;
  const canStart = ready && ['verified', 'stale'].includes(s.connection)
    && (s.lifecycle === 'IDLE' || s.lifecycle === 'ENDED' && next);
  const needsRecovery = s?.reconnectRequired || s?.deliveryIssue || s?.privacyHold;

  const title = !s ? '작업 상태 확인'
    : privacyBusy && !s.withdrawalPending ? '접근 중단 처리 중'
    : loginRequired ? '합성 계정으로 시작'
    : access === 'consent' ? '합성 수집 동의'
    : access === 'withdrawn' ? s.withdrawalPending ? '동의 철회 확인 중' : '수집 동의 철회됨'
    : access === 'denied' ? '수집 권한 확인'
    : canStart ? headings.IDLE : headings[s.lifecycle];

  function send(command: UserCommand) {
    if (isPrivacyCommand(command.type)) {
      setGoal('');
      setNext(false);
    }
    void request(command);
  }

  async function start() {
    const result = await request({ type: 'start', goal });
    if (result && ['START_PENDING', 'ACTIVE'].includes(result.lifecycle)) {
      setNext(false);
      setGoal('');
    }
  }

  return <main className="popup">
    <Header />
    <section className="workspace flow" aria-labelledby="heading">
      <h1 id="heading">{title}</h1>
      {!s && <Notice tone={offline ? 'error' : 'info'} role={offline ? 'alert' : 'status'}>{offline
        ? '확장 프로그램 상태를 읽을 수 없어요. 잠시 기다리거나 팝업을 다시 열어 주세요.'
        : '저장된 작업 상태를 확인하고 있어요.'}</Notice>}
      {privacyBusy && !s?.withdrawalPending && <Notice tone="attention">{s?.privacyPending
        ? '수집과 전송을 멈췄어요. 개인정보 요청을 처리하고 있어요.'
        : '개인정보 요청을 보내고 있어요.'}</Notice>}
      {s?.storageFailed && <Notice tone="error" role="alert">작업 저장소를 열 수 없어 수집과 전송을 멈췄어요. 팝업을 다시 열어 상태를 확인해 주세요.</Notice>}
      {s && !s.permission && <Notice tone="attention" role="alert">Chrome에서 합성 사이트 액세스를 확인해 주세요. 사이트 권한이 꺼져 있어요.</Notice>}
      {error && <Notice tone="error" role="alert">{errors[error]}</Notice>}
      {loginRequired && <LoginScreen accountMismatch={access === 'account' && error !== 'account'} busy={!!busy}
        pending={busy === 'login'} onLogin={token => send({ type: 'login', token })} />}
      {s?.access === 'consent' && !privacyBusy && <ConsentScreen disabled={!!busy || s.storageFailed} pending={busy === 'agree'}
        onAgree={() => send({ type: 'agree' })} />}
      {access === 'denied' && !privacyBusy && <Notice tone="attention">서버가 수집 권한을 허용하지 않았어요. 권한이 복구되면 연결 및 동의 설정에서 접근 상태를 다시 확인해 주세요.</Notice>}
      {s?.access === 'withdrawn' && <Notice tone="attention">{s.withdrawalPending
        ? '기기의 수집과 전송을 멈췄어요. 서버에서 철회 여부를 확인하고 있어요.'
        : '합성 탐색의 수집과 전송을 멈췄어요.'}</Notice>}
      {s?.withdrawalPending && <Button disabled={!!busy || privacyBusy} onClick={() => send({ type: 'retry' })}>철회 요청 다시 확인</Button>}
      {canStart && <GoalScreen goal={goal} setGoal={setGoal} busy={!!busy} pending={busy === 'start'} onStart={() => void start()} />}
      {ready && s.lifecycle === 'IDLE' && !canStart && <Notice tone="attention">
        작업을 시작하려면 연결 및 동의 설정에서 서버 접근 상태를 확인해 주세요.
      </Notice>}
      {showDetails && s?.goal && !canStart && <GoalCard goal={s.goal} />}
      {s?.lifecycle === 'START_PENDING' && access === 'ready' && !privacyBusy && <>
        <Notice>서버에서 시작을 확인하면 탐색 기록을 수집해요.</Notice>
        <Button variant="primary" disabled={!ready || !!busy} pending={busy === 'start' || busy === 'retry-start'}
          onClick={() => send({ type: 'retry-start' })}>
          {busy === 'start' || busy === 'retry-start' ? '시작 요청 확인 중…' : '같은 시작 요청 다시 확인'}
        </Button>
      </>}
      {s?.lifecycle === 'ACTIVE' && !loginRequired && !privacyBusy && access !== 'withdrawn' &&
        <ActiveSession session={s} showDetails={showDetails} ready={ready} busy={busy} request={send} />}
      {s?.lifecycle === 'END_PENDING' && access === 'ready' && !privacyBusy && <>
        <Notice tone={needsRecovery ? 'attention' : 'info'}>{needsRecovery
          ? '서버 종료 확인이 지연되고 있어요. 남은 기록을 전송한 뒤 종료를 확인해요.'
          : '수집을 멈췄어요. 남은 기록을 전송하고 서버에서 종료를 확인 중이에요.'}</Notice>
        <Button disabled={!ready || !!busy} onClick={() => send({ type: 'retry' })}>전송 및 종료 다시 확인</Button>
      </>}
      {s?.lifecycle === 'ENDED' && access === 'ready' && !canStart && !privacyBusy && <>
        <Notice tone="positive">서버에서 작업 종료를 확인했어요.</Notice>
        {showDetails && s.startedAt && <SessionTimes startedAt={s.startedAt} endedAt={s.endedAt} />}
        <Button variant="primary" disabled={!ready || !!busy || next} onClick={() => setNext(true)}>새 작업 준비</Button>
        {next && <p className="field-note">새 작업을 시작하려면 설정에서 서버 연결을 확인해 주세요.</p>}
      </>}
      {s && !privacyBusy && <ReceiptStatus snapshot={s} disabled={!s.permission || !!busy} retry={() => send({ type: 'retry-receipts' })} />}
    </section>
    <Footer fixture={`${FIXTURE_ORIGIN}/__focus_synthetic__/a`} connection={s?.connection} />
    {s && <Settings snapshot={s} busy={busy} privacyBusy={privacyBusy} request={send} />}
  </main>;
}
