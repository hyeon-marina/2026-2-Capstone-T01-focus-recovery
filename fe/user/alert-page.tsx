import { useEffect, useRef, useState } from 'react';
import { validGoal } from '../src/shared/goal';
import type { AlertAction, AlertCommand, AlertDetail } from './protocol';
import { Button, GoalCard, Header, Notice } from './ui';

async function message(command: AlertCommand): Promise<AlertDetail | undefined> {
  const reply = await chrome.runtime.sendMessage(command);
  const detail = reply?.detail;
  if (typeof detail?.goal === 'string' && validGoal(detail.goal) && typeof detail.shown === 'boolean'
    && ['AI', 'FIXED_INTERVAL'].includes(detail.alertType)
    && (detail.action === undefined || ['RETURN_TO_GOAL', 'CONTINUE_BROWSING'].includes(detail.action)
      && typeof detail.acknowledged === 'boolean')) return detail;
}

function deliveryMessage(phase: AlertDetail['shownDelivery']) {
  switch (phase) {
    case 'acknowledged': return '서버에 기록했어요.';
    case 'exhausted': return '기기에 저장했어요. 팝업에서 서버 저장 여부를 다시 확인할 수 있어요.';
    case 'rejected': return '기기에 저장했어요. 서버에서 거절되거나 충돌했어요.';
    case 'access-blocked': return '기기에 저장했어요. 연결 및 동의 상태를 확인해 주세요.';
    case 'privacy-blocked': return '개인정보 보호를 위해 전송을 중지했어요.';
    case 'retry-wait': return '기기에 저장했어요. 서버 확인을 기다리고 있어요. 연결되면 자동으로 다시 보내요.';
    default: return '기기에 저장했어요. 서버 확인을 기다리고 있어요.';
  }
}

export function AlertPage({ viewId }: { viewId: string }) {
  const [detail, setDetail] = useState<AlertDetail>();
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    async function refresh() {
      if (busy.current) return;
      busy.current = true;
      try {
        const next = await message({ type: 'alert-view', viewId });
        if (live) setDetail(next);
      } catch { if (live) setDetail(undefined); }
      finally { busy.current = false; }
    }
    busy.current = true;
    void message({ type: 'alert-open', viewId }).then(next => {
      if (live) setDetail(next);
    }, () => { if (live) setDetail(undefined); }).finally(() => {
      busy.current = false;
      if (live) setLoading(false);
    });
    const timer = setInterval(() => void refresh(), 1000);
    return () => { live = false; clearInterval(timer); };
  }, [viewId]);

  const awaitingShown = !!detail && !detail.shown;
  useEffect(() => {
    if (!awaitingShown) return;
    let first = 0, second = 0, live = true;
    function visible() {
      if (document.visibilityState !== 'visible') return;
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => {
          if (!live || document.visibilityState !== 'visible') return;
          if (busy.current) { visible(); return; }
          busy.current = true;
          void message({ type: 'alert-shown', viewId }).then(next => {
            if (live) setDetail(next);
          }, () => { if (live) setDetail(undefined); }).finally(() => { busy.current = false; });
        });
      });
    }
    visible();
    document.addEventListener('visibilitychange', visible);
    return () => {
      live = false;
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [viewId, awaitingShown]);

  async function select(action: AlertAction) {
    if (busy.current || !detail?.shown || detail.action) return;
    busy.current = true;
    setSelecting(true);
    try {
      const next = await message({ type: 'alert-select', viewId, action });
      // A second detail tab may have won the selection race.
      setDetail(next ?? await message({ type: 'alert-view', viewId }));
    } catch { setDetail(undefined); }
    finally { busy.current = false; setSelecting(false); }
  }

  const fixed = detail?.alertType === 'FIXED_INTERVAL';
  return <main className="alert-page">
    <Header />
    <section className="alert-content flow" aria-labelledby="alert-heading">
      <h1 id="alert-heading">{fixed ? '고정 주기 알림' : detail ? '목표 이탈 알림' : '작업 목표 알림'}</h1>
      {detail ? <>
        <p className="lead">{fixed ? '작업 중간 점검 시간이에요. 처음 설정한 목표를 다시 확인해 보세요.'
          : 'AI 분석에서 최근 탐색이 처음 목표와 달라진 것으로 나타났어요. 작업 목표를 다시 확인해 보세요.'}</p>
        <GoalCard goal={detail.goal} />
        {detail.action ? <Notice tone={detail.acknowledged ? 'positive'
          : ['exhausted', 'rejected', 'access-blocked', 'privacy-blocked'].includes(detail.selectionDelivery ?? '') ? 'attention' : 'info'}>
          <strong>{detail.action === 'RETURN_TO_GOAL' ? '목표로 돌아가기를' : '탐색 계속하기를'} 선택했어요.</strong>
          <p>{deliveryMessage(detail.selectionDelivery)}</p>
        </Notice> : <>
          <div className="alert-choices" aria-label="작업 목표 확인 후 선택" role="group">
            <Button disabled={!detail.shown || selecting} onClick={() => void select('RETURN_TO_GOAL')}>목표로 돌아가기</Button>
            <Button disabled={!detail.shown || selecting} onClick={() => void select('CONTINUE_BROWSING')}>탐색 계속하기</Button>
          </div>
          <p role="status" className="field-note">{selecting ? '선택을 저장하고 있어요.' : detail.shown
            ? `알림 표시 기록 · ${deliveryMessage(detail.shownDelivery)}` : '알림 표시를 확인하고 있어요.'}</p>
        </>}
      </> : <Notice tone={loading ? 'info' : 'neutral'}>
        <p>{loading ? '알림을 확인하고 있어요.' : '현재 확인할 수 있는 알림이 없어요.'}</p>
        {!loading && <p>알림이 만료되었거나 접근을 확인할 수 없어요. 연결 상태와 작업 상태는 팝업에서 확인할 수 있어요.</p>}
      </Notice>}
    </section>
  </main>;
}
