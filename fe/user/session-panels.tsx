import type { FixedAlertStatus, UserCommand, UserSnapshot } from './protocol';
import { Button, Notice, StatusBadge } from './ui';

export const timeFormat = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const analysis: Record<UserSnapshot['analysis'], string> = {
  unconnected: '분석 미연결',
  empty: '분석 결과 없음',
  pending: '분석 대기',
  delayed: '분석 지연',
  failed: '분석 실패',
  invalidated: '분석 무효화',
  unavailable: '분석 상태 확인 불가',
  completed: '분석 완료',
};
const decisions = { NORMAL: '정상 탐색', TRANSITION: '전환 탐색', DRIFT: '목표 확인 필요' };
const fixedAlerts = {
  waiting: ['neutral', '예정 회차 대기'],
  checking: ['info', '알림 확인 중'],
  confirmed: ['positive', '현재 회차 후보 확인 완료'],
  delayed: ['attention', '알림 확인 지연'],
  disabled: ['error', '알림 사용 불가'],
  unavailable: ['error', '알림 사용 불가'],
  unverified: ['attention', '알림 상태 확인 필요'],
  skipped: ['neutral', '예정 회차 대기'],
  suspended: ['attention', '알림 일시 중지'],
  'notification-denied': ['attention', 'Chrome 알림 권한 꺼짐'],
} as const satisfies Record<FixedAlertStatus, readonly [string, string]>;
type Request = (command: UserCommand) => void;

function duration(startedAt: string, end: number) {
  const elapsed = Math.floor((end - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(elapsed) || elapsed < 0) return;
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor(elapsed / 60) % 60;
  const seconds = elapsed % 60;
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

export function SessionTimes({ startedAt, endedAt, active }: { startedAt: string; endedAt?: string; active?: boolean }) {
  // Use the existing snapshot renders to refresh the on-screen clock.
  const elapsed = active || endedAt ? duration(startedAt, endedAt ? Date.parse(endedAt) : Date.now()) : undefined;
  return <dl className="session-times">
    {elapsed && <div className="elapsed"><dt>세션 경과</dt><dd>{elapsed}</dd></div>}
    <div><dt>시작</dt><dd><time dateTime={startedAt}>{timeFormat.format(Date.parse(startedAt))}</time></dd></div>
    {endedAt && <div><dt>종료</dt><dd><time dateTime={endedAt}>{timeFormat.format(Date.parse(endedAt))}</time></dd></div>}
  </dl>;
}

export function ActiveSession({ session: s, showDetails, ready, busy, request }: {
  session: UserSnapshot; showDetails: boolean; ready: boolean; busy?: UserCommand['type']; request: Request;
}) {
  const attention = s.finalState === 'DRIFT' || s.finalState === 'TRANSITION' || ['delayed', 'failed', 'invalidated', 'unavailable'].includes(s.analysis);
  const fixedStatus = !s.collecting || s.reconnectRequired ? 'suspended' : s.fixedAlertStatus ?? 'unverified';
  const [fixedTone, fixedLabel] = fixedAlerts[fixedStatus];
  return <>
    {showDetails && s.startedAt && <SessionTimes startedAt={s.startedAt} active={busy !== 'stop'} />}
    <dl className="facts">
      <div><dt>탐색 수집</dt><dd><StatusBadge tone={s.collecting && showDetails ? 'positive' : 'neutral'}>
        {s.collecting && showDetails ? '합성 페이지에서 가능' : '일시 중지'}
      </StatusBadge></dd></div>
      {showDetails && <div><dt>{s.alertMode === 'FIXED_INTERVAL' ? '알림 방식' : 'AI 분석'}</dt><dd>
        {s.alertMode === 'FIXED_INTERVAL' ? <StatusBadge tone="info">고정 주기 알림</StatusBadge>
          : <StatusBadge tone={s.finalState === 'NORMAL' ? 'positive' : attention ? 'attention' : 'neutral'}>
            {s.finalState ? decisions[s.finalState] : analysis[s.analysis]}
          </StatusBadge>}
      </dd></div>}
      {showDetails && s.alertMode === 'FIXED_INTERVAL' && <div><dt>알림 상태</dt><dd role="status">
        <StatusBadge tone={fixedTone}>{fixedLabel}</StatusBadge>
      </dd></div>}
    </dl>
    {showDetails && s.alertMode === 'FIXED_INTERVAL' && fixedStatus === 'disabled' && <Notice tone="error">
      서버에서 고정 주기 알림을 허용하지 않았어요. 다음 회차에 다시 확인해요.
    </Notice>}
    {showDetails && s.alertMode === 'FIXED_INTERVAL' && fixedStatus === 'skipped' && <Notice>
      이번 회차는 건너뛰었어요. 다음 회차에 다시 확인해요.
    </Notice>}
    {s.privacyHold && s.access !== 'withdrawn' && <Notice tone="attention">개인정보 보호를 위해 수집과 전송을 멈췄어요. 종료를 선택해 격리된 작업을 정리해 주세요.</Notice>}
    {s.reconnectRequired && !s.privacyHold && <Button disabled={!ready || !!busy} onClick={() => request({ type: 'reconnect' })}>기존 작업 재연결</Button>}
    {s.deliveryIssue && !s.privacyHold && <>
      <Notice tone="attention">서버 확인을 받지 못한 탐색 기록이 있어요.</Notice>
      <Button disabled={!ready || !!busy} onClick={() => request({ type: 'retry' })}>미전송 기록 다시 보내기</Button>
    </>}
    <Button pending={busy === 'stop'} disabled={!!busy || s.storageFailed || s.privacyPending || s.access === 'withdrawn'} onClick={() => {
      if (s.sessionHandle) request({ type: 'stop', sessionHandle: s.sessionHandle });
    }}>{busy === 'stop' ? '종료 요청 중…' : '작업 종료'}</Button>
  </>;
}

export function ReceiptStatus({ snapshot: s, disabled, retry }: { snapshot: UserSnapshot; disabled: boolean; retry: () => void }) {
  const r = s.receipts;
  if (!r || (!r.pending && !r.acknowledged)) return null;

  return <section className="receipt-section flow" aria-labelledby="receipt-title">
    <h2 id="receipt-title">알림 기록</h2>
    <div className="receipt-copy" role="status">
      {r.acknowledged > 0 && <p>서버에 저장된 기록 <strong>{r.acknowledged}건</strong></p>}
      {r.pending > 0 && <p>기기에 보관 중인 미확인 기록 <strong>{r.pending}건</strong>
        {r.previousPending > 0 && <span className="previous-receipts">이전 작업 {r.previousPending}건 포함</span>}</p>}
      {r.retryWaiting > 0 && <p>연결을 확인한 뒤 자동으로 다시 보내요.</p>}
      {r.exhausted > 0 && <p>자동 재시도를 마쳤어요. 아래 버튼으로 서버 저장 여부를 다시 확인할 수 있어요.</p>}
      {r.rejected > 0 && <p>서버에서 거절되거나 충돌한 기록은 기기에 보관했어요.</p>}
      {r.accessBlocked > 0 && <p>전송을 재개하려면 연결 및 동의 상태를 확인해 주세요.</p>}
    </div>
    {r.exhausted > 0 && <Button disabled={disabled} onClick={retry}>미확인 알림 기록 다시 보내기</Button>}
  </section>;
}
