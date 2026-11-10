import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DevStatus, PopupMessage, Reply } from '../shared/types';
import { validGoal } from '../shared/goal';
import './style.css';
async function currentSitePattern() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) throw new Error();
  const url = new URL(tab.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  return `${url.origin}/*`;
}
function App() {
  const [goal, setGoal] = useState('');
  const [status, setStatus] = useState<DevStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sitePermission, setSitePermission] = useState<boolean | null>();
  const sitePermissionVersion = useRef(0);
  const requestInFlight = useRef(false);
  const [inspect, setInspect] = useState(false);
  const end = status?.sessionEnd;
  const endPending = end?.state === 'END_PENDING';
  const recovery = status?.sessionStartRecovery;
  const pending = recovery?.kind === 'pending' ? recovery : undefined;
  const invalid = recovery?.kind === 'invalid' ? recovery : undefined;
  const storage = status?.storage;
  const storageBlocked = !storage || storage.phase !== 'ready';
  const held = status?.candidates.filter(candidate => candidate.recoveryRequired) ?? [];
  const stoppable = held.filter(candidate => candidate.state === 'valid').length;
  const sequenceWaiting = status?.visits.filter(visit => visit.sequence === null).length ?? 0;
  const delivery = status?.visitDelivery;
  const behavior = status?.behaviorDelivery;
  const pendingBehavior = behavior?.visits.filter(visit => visit.phase !== 'acked') ?? [];
  const unconfirmed = delivery?.visits.filter(visit => visit.phase !== 'acked') ?? [];
  const serverEndConflict = (unconfirmed.length > 0 || pendingBehavior.length > 0)
    && (end?.code === 'SERVER_ENDED_UNCONFIRMED' || end?.lastServer?.status === 'ENDED'
      || [...unconfirmed, ...pendingBehavior].some(visit => visit.code === 'SESSION_ENDED'));
  async function request(message: PopupMessage) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true); setError('');
    try {
      const reply = await chrome.runtime.sendMessage(message) as Reply;
      if (reply.status) setStatus(reply.status);
      if (!reply.ok) setError(reply.error ?? '요청에 실패했습니다.');
    } catch { setError('요청에 실패했습니다. 입력 목표와 확장 프로그램 상태를 확인해 주세요.'); }
    finally { requestInFlight.current = false; setBusy(false); }
  }
  useEffect(() => { void request({ type: 'status' }); }, []);
  useEffect(() => {
    const version = ++sitePermissionVersion.current;
    // A native permission dialog can close the Popup before its request resolves.
    void currentSitePattern().then(pattern => chrome.permissions.contains({ origins: [pattern] })).catch(() => null).then(allowed => {
      if (version === sitePermissionVersion.current) setSitePermission(allowed);
    });
    return () => { sitePermissionVersion.current++; };
  }, []);
  async function allowSite() {
    setBusy(true); setError('');
    sitePermissionVersion.current++; setSitePermission(undefined);
    try {
      const granted = await chrome.permissions.request({ origins: [await currentSitePattern()] });
      setSitePermission(granted);
      if (!granted) { setError('사이트 수집 권한이 허용되지 않았습니다.'); return; }
      await request({ type: 'sync-permissions' });
    } catch { setSitePermission(null); setError('일반 HTTP(S) 페이지에서 확장 프로그램을 열어 주세요.'); }
    finally { setBusy(false); }
  }
  return <main>
    <h1>Focus Recovery 개발용 수집기</h1>
    <p>서버 인증·동의가 필요한 개발용 화면입니다. 운영 참여자 등록과 실제 사용자 수집은 비활성 상태입니다.</p>
    <p>작업 목표와 허용한 사이트의 확정된 방문·본문·누적 행동 정보를 설정된 API 서버에 전송합니다.</p>
    <p>작업 종료 시 수집을 중단하고 마지막 방문·행동 정보의 서버 저장을 확인한 뒤 서버 세션을 종료합니다.</p>
    <button disabled={busy} onClick={() => void allowSite()}>현재 사이트 수집 허용</button>
    <p role="status">{sitePermission === undefined ? '현재 사이트 접근 권한 확인 중…'
      : sitePermission === null ? '현재 사이트 접근 권한을 확인할 수 없습니다. 일반 HTTP(S) 페이지에서 다시 열어 주세요.'
      : sitePermission ? '현재 사이트 접근 권한: 허용됨' : '현재 사이트 접근 권한: 허용되지 않음'}</p>
    <p>권한을 거부하거나 철회한 사이트는 수집하지 않습니다. 수집하려면 ‘현재 사이트 수집 허용’을 눌러 주세요.</p>
    <p>IndexedDB: {storage?.phase ?? 'initializing'} / {storage?.recovered ? '이전 작업 복구됨' : '이전 작업 없음'}</p>
    {storage?.phase === 'failed' && <p role="alert">영속 저장·복구 실패 ({storage.error}). 서버 오류와 별개로 전송을 차단했습니다. 원본을 보존했으며 Worker 재시작 후 확인이 필요합니다.</p>}
    {storage?.metadataSyncPending && <p role="alert">IndexedDB 데이터는 저장됐지만 local 세션 메타데이터 동기화가 남았습니다. 서버 저장 오류와 구분하며, 상태 새로고침 또는 Worker 재시작에서 같은 영수증으로 확인합니다.</p>}
    {storage?.legacyCleanupPending && <p role="alert">검증된 이전 데이터는 IndexedDB에 저장됐지만 legacy 키 정리가 남았습니다. Worker 재시작에서 이전 해시를 확인한 뒤 정리를 재시도합니다.</p>}
    {held.length > 0 && <div role="alert">
      <p>동일한 Chrome 문서를 확인하지 못한 후보 {held.length}건을 보존했습니다. 유효 방문 중 순서 미확정 {sequenceWaiting}건은 앞 후보의 판정이 끝날 때까지 POST를 기다립니다. 확인 필요 후보가 남으면 신규 세션을 시작할 수 없습니다.</p>
      {stoppable > 0 && <p>이미 유효했던 {stoppable}건은 명시적 로컬 수집 종료에서 마지막 저장 누적값으로 확정할 수 있습니다.</p>}
      {held.length > stoppable && <p>판정 미완료·복구 가능한 제외 후보 {held.length - stoppable}건은 로컬 종료로 해결되지 않습니다. 자동 판정이나 임의 재연결 기능은 없으며 원본을 보존합니다.</p>}
      <p>로컬 기록 삭제는 이 후보와 뒤에서 대기 중인 방문·미확인 요청도 버립니다. 서버 데이터는 삭제하지 않습니다.</p>
    </div>}
    <p>상태: {invalid ? '시작 요청 복구 필요' : end ? end.state : status?.session ? 'ACTIVE · 서버 세션으로 수집 중' : pending ? '이전 시작 요청 확인 필요' : '수집 중지'}</p>
    {invalid && <div role="alert">
      <p>{invalid.reason === 'initialization-failed' ? '저장된 상태를 확인할 수 없습니다. 확장 프로그램과 저장소 상태를 확인한 뒤 Worker를 재시작해 주세요.'
        : invalid.reason === 'missing-request' ? '서버 세션은 확인되지만 생성 요청 키가 없습니다. 중복 생성을 막기 위해 새 작업 시작을 차단했습니다.'
        : '저장된 시작 요청이 손상되었거나 다른 세션 정보와 일치하지 않습니다. 중복 생성을 막기 위해 새 작업 시작을 차단했습니다.'}</p>
      {invalid.sessionId && <p>확인할 서버 세션: <code>{invalid.sessionId}</code></p>}
      <p>원본 저장 정보는 보존했습니다. 담당자와 기존 API 서버의 키·세션 상태를 확인해 주세요. 요청을 지우거나 새 키로 우회하지 마세요. 자동 초기화·수동 복구 UI는 아직 제공하지 않습니다. 로컬 기록 삭제로 이 문제는 해결되지 않습니다.</p>
    </div>}
    {pending?.blockedReason && <p role="alert">{pending.blockedReason === 'server-changed' ? '이전 요청과 API 서버 설정이 다릅니다. 기존 서버 설정으로 되돌린 뒤 같은 요청을 재시도해 주세요.' : '기존 서버 세션이 이미 종료되었습니다. 담당자와 서버 상태를 확인해 주세요. 자동 초기화 기능은 제공하지 않습니다.'}</p>}
    {status?.session ? <><p>목표: {status.session.goalText}</p><code>{status.session.sessionId}</code><button disabled={busy} onClick={() => void request({ type: 'end-session' })}>작업 세션 종료</button></> : <>
      <label htmlFor="goal">최초 작업 목표 (현재 BE 구현 기준 5~150자)</label>
      <textarea id="goal" value={pending?.goalText ?? goal} disabled={busy || Boolean(pending) || Boolean(invalid)} onChange={event => setGoal(event.target.value)} />
      {pending && <p>서버에 이미 생성되었을 수 있습니다. 목표와 요청 키를 유지해 재시도합니다. 로컬 기록 삭제로 이 요청을 취소할 수 없습니다.</p>}
      <button disabled={busy || storageBlocked || endPending || serverEndConflict || (!pending && (Boolean(status?.recoveryCandidates) || unconfirmed.length > 0 || pendingBehavior.length > 0)) || !status || Boolean(invalid) || Boolean(pending?.blockedReason) || !validGoal(pending?.goalText ?? goal)} onClick={() => { setInspect(false); void request({ type: 'start', goalText: pending?.goalText ?? goal }); }}>{busy ? '처리 중…' : pending ? '같은 요청 재시도' : '작업 세션 시작'}</button>
    </>}
    {serverEndConflict && <div role="alert">
      <p>서버 종료·로컬 데이터 불일치 (운영자 확인 필요)</p>
      <p>필수 POST 미확인 {unconfirmed.length}건 / PATCH 미확인 {pendingBehavior.length}건이 남아 있습니다. 로컬 기록을 보존하고 담당자와 서버 상태를 확인해 주세요. 일반 네트워크 재시도만으로 최종 데이터 반영을 확인할 수 없습니다.</p>
      <p>로컬 기록을 삭제하면 미확인 최종 데이터와 종료 복구 정보를 영구적으로 잃습니다. 로컬 삭제는 서버 데이터를 삭제하지 않습니다. 확인 전에는 새 작업을 시작하지 마세요.</p>
    </div>}
    {end && <div role={endPending ? 'alert' : undefined}>
      <p>서버 종료: {end.state} / {end.phase === 'draining' ? '최종 데이터 전송 대기' : end.phase === 'retry-wait' ? '재시도 대기' : end.phase === 'failed' ? '확인 필요' : end.phase === 'acked' ? '종료 ACK 저장 완료' : '종료 요청 전송 중·대기'}</p>
      <p>필수 POST 미확인 {unconfirmed.length}건 / PATCH 미확인 {pendingBehavior.length}건 / 복구 보류 {held.length}건 · 종료 확인 시도 {end.attempts}/3회</p>
      {end.nextRetryAt !== undefined && <p>다음 재시도 가능 시각: {new Date(end.nextRetryAt).toLocaleString()}</p>}
      {end.error && <p>{end.code && `${end.code}: `}{end.error}</p>}
      {end.ack?.endedAt && <p>서버 종료 시각: {end.ack.endedAt}</p>}
      <button disabled={busy || storageBlocked || serverEndConflict || end.phase !== 'failed' || !end.retryable} onClick={() => void request({ type: 'retry-end' })}>같은 종료 요청 재시도</button>
      {endPending && <p>종료 ACK를 저장하기 전에는 새 작업을 시작할 수 없습니다. 자동 확인은 최대 3회이며, 예산 소진 후 수동 재시도만 새 예산을 부여합니다.</p>}
      <p>로컬 기록 삭제는 서버 데이터를 삭제하지 않습니다. 미확인 최종 데이터와 종료 복구 정보를 잃으며 진행 중 요청은 서버에 반영될 수 있습니다.</p>
    </div>}
    {status?.capacityReached && <p role="alert">개발용 200건 한도에 도달해 수집이 중지되었습니다. 종료 후 새 세션을 시작해 주세요.</p>}
    {error && <p role="alert">{error}</p>}
    <p>후보 {status?.candidates.length ?? 0}건 / 유효 방문 {status?.visits.length ?? 0}건</p>
    <p>서버 저장 확인 {delivery?.visits.filter(visit => visit.phase === 'acked').length ?? 0}건 / 저장 미확인 {unconfirmed.length}건. 유효 방문 중 순서 미확정 방문은 아직 전송하지 않습니다.</p>
    <p>전송 상태는 IndexedDB에 보존하며 브라우저 재시작·확장 재로드 후 복구합니다. 저장 직전 중단된 이벤트와 중단 중 행동은 복구할 수 없습니다. 로컬 수집 종료 후에도 확정 방문 저장과 최종 행동 갱신은 계속됩니다.</p>
    {delivery?.blocked && <p role="alert">{delivery.blocked}</p>}
    {unconfirmed.map(visit => <p key={visit.visitId} role={visit.error ? 'alert' : undefined}>방문 #{visit.sequence}: {visit.phase} (시도 {visit.attempts}회){visit.error && ` — ${visit.code ? `${visit.code}: ` : ''}${visit.error}`}</p>)}
    <button disabled={busy || storageBlocked || !unconfirmed.some(visit => visit.phase === 'failed' && visit.retryable)} onClick={() => void request({ type: 'retry-visits' })}>같은 방문 재시도</button>
    <p>행동 갱신 {behavior?.blocked ? '상태 확인 필요' : `확인 ${behavior?.visits.filter(visit => visit.phase === 'acked').length ?? 0}건 / 갱신 미확인 ${pendingBehavior.length}건`} (POST 저장 대기 포함).</p>
    {behavior?.blocked && <p role="alert">{behavior.blocked}</p>}
    {pendingBehavior.map(visit => <p key={visit.visitId} role={visit.error ? 'alert' : undefined}>행동 #{visit.sequence}: {visit.phase} (시도 {visit.attempts}회, 최신 v{visit.latest.behaviorVersion} / 서버 ACK {visit.ack ? `v${visit.ack.behaviorVersion}` : '미확인'}){visit.error && ` — ${visit.code ? `${visit.code}: ` : ''}${visit.error}`}{visit.phase === 'failed' && (visit.retryable ? ' / 재시도 가능' : ' / 서버 상태 확인 필요')}</p>)}
    <button disabled={busy || storageBlocked || !pendingBehavior.some(visit => visit.phase === 'failed' && visit.retryable)} onClick={() => void request({ type: 'retry-behaviors' })}>같은 행동 갱신 재시도</button>
    {(pendingBehavior.length > 0 || behavior?.blocked) && <p>행동 갱신이 미확인인 동안 새 세션 시작을 보류합니다. 삭제하면 최종 행동값을 복구할 수 없습니다.</p>}
    <button disabled={busy} onClick={() => void request({ type: 'status' })}>상태 새로고침</button>
    <button disabled={busy || storageBlocked || Boolean(status?.session)} onClick={() => { if ((endPending || unconfirmed.length || pendingBehavior.length || held.length) && !window.confirm('로컬 기록을 삭제하면 미확인 최종 데이터와 서버 종료 복구 정보를 잃습니다. 진행 중 요청은 서버에 반영될 수 있고 서버 데이터는 삭제되지 않습니다. 삭제할까요?')) return; setInspect(false); void request({ type: 'clear' }); }}>로컬 기록 삭제</button>
    {(unconfirmed.length > 0 || pendingBehavior.length > 0) && <p>로컬 기록 삭제는 저장·행동 갱신 미확인 요청도 버립니다. 진행 중 요청은 서버에 저장될 수 있으며 서버 기록은 삭제되지 않습니다.</p>}
    <label><input type="checkbox" checked={inspect} onChange={event => setInspect(event.target.checked)} /> 수집 데이터 표시 (본문이 화면에 나타납니다)</label>
    {inspect && <pre>{JSON.stringify({ candidates: status?.candidates, visits: status?.visits, readyVisits: status?.readyVisits }, null, 2)}</pre>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
