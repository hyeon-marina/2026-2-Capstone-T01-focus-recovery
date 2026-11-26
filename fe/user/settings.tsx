import { useRef } from 'react';
import type { UserCommand, UserSnapshot } from './protocol';
import { timeFormat } from './session-panels';
import { Button } from './ui';

export function Settings({ snapshot: s, busy, privacyBusy, request }: {
  snapshot: UserSnapshot; busy?: UserCommand['type']; privacyBusy: boolean; request: (command: UserCommand) => void;
}) {
  const confirm = useRef<HTMLDialogElement>(null);
  const canWithdraw = s.access === 'ready' && !privacyBusy;

  return <details className="settings">
    <summary>연결 및 동의 설정</summary>
    <div className="settings-content flow">
      <dl className="facts">
        <div><dt>합성 계정</dt><dd>{s.access === 'auth' || s.access === 'account' ? '재인증 필요' : '인증됨'}</dd></div>
        <div><dt>마지막 서버 검증</dt><dd>{s.serverCheckedAt
          ? <time dateTime={new Date(s.serverCheckedAt).toISOString()}>{timeFormat.format(s.serverCheckedAt)}</time> : '확인 전'}</dd></div>
        <div><dt>합성 사이트 액세스</dt><dd>{s.permission ? '허용됨' : '권한 확인 필요'}</dd></div>
      </dl>
      <p className="field-note">사이트 접근은 Chrome 확장 프로그램 설정에서, 알림 표시는 Chrome과 운영체제의 알림 설정에서 확인할 수 있어요.</p>
      <Button disabled={!!busy} pending={busy === 'access'} onClick={() => request({ type: 'access' })}>접근 상태 확인</Button>
      {busy === 'access' && <p className="field-note" role="status">서버 접근 상태를 확인하고 있어요.</p>}
      {(s.access !== 'auth' || busy === 'logout') && <div className="privacy-actions">
        <Button disabled={privacyBusy} pending={busy === 'logout'} onClick={() => request({ type: 'logout' })}>
          {busy === 'logout' ? '로그아웃 중…' : '로그아웃'}
        </Button>
        {(s.access === 'ready' || busy === 'withdraw') && <Button variant="danger" disabled={!canWithdraw}
          pending={busy === 'withdraw'} onClick={() => confirm.current?.showModal()}>
          {busy === 'withdraw' ? '동의 철회 중…' : '합성 동의 철회'}
        </Button>}
      </div>}
    </div>
    <dialog ref={confirm} aria-labelledby="withdraw-title" aria-describedby="withdraw-description">
      <div className="flow">
        <h2 id="withdraw-title">수집 동의를 철회할까요?</h2>
        <p id="withdraw-description">수집과 전송이 중단돼요. 연결이 끊기면 서버 확인이 보류될 수 있어요.</p>
        <div className="dialog-actions">
          <Button onClick={() => confirm.current?.close()}>취소</Button>
          <Button variant="danger" disabled={!canWithdraw} onClick={() => {
            confirm.current?.close();
            if (canWithdraw) request({ type: 'withdraw' });
          }}>동의 철회하기</Button>
        </div>
      </div>
    </dialog>
  </details>;
}
