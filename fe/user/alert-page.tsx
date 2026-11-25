import { useEffect, useRef, useState } from 'react';
import { validGoal } from '../src/shared/goal';
import type { AlertAction, AlertCommand, AlertDetail } from './protocol';

async function message(command: AlertCommand): Promise<AlertDetail | undefined> {
  const reply = await chrome.runtime.sendMessage(command);
  const detail = reply?.detail;
  if (typeof detail?.goal === 'string' && validGoal(detail.goal) && typeof detail.shown === 'boolean'
    && (detail.action === undefined || ['RETURN_TO_GOAL', 'CONTINUE_BROWSING'].includes(detail.action)
      && typeof detail.acknowledged === 'boolean')) return detail;
}

export function AlertPage({ viewId }: { viewId: string }) {
  const [detail, setDetail] = useState<AlertDetail>();
  const [loading, setLoading] = useState(true);
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
    try {
      const next = await message({ type: 'alert-select', viewId, action });
      // A second detail tab may have won the selection race.
      setDetail(next ?? await message({ type: 'alert-view', viewId }));
    } catch { setDetail(undefined); }
    finally { busy.current = false; }
  }

  return <main>
    <header><span className="brand"><span className="mark" aria-hidden="true" />Focus Recovery</span></header>
    <section className="workspace" aria-busy={loading}>
      <h1>목표 이탈 알림</h1>
      {detail ? <>
        <p>현재 탐색이 작업 목표에서 벗어났어요. 최초 목표를 다시 확인해 보세요.</p>
        <p>최초 작업 목표</p>
        <p className="goal">{detail.goal}</p>
        {detail.action ? <p role="status">
          {detail.action === 'RETURN_TO_GOAL' ? '목표로 돌아가기를' : '탐색 계속하기를'} 선택했어요. {detail.acknowledged ? '서버에 기록했어요.' : '서버 확인을 기다리고 있어요.'}
        </p> : <>
          <button className="primary" disabled={!detail.shown} onClick={() => void select('RETURN_TO_GOAL')}>목표로 돌아가기</button>
          <button disabled={!detail.shown} onClick={() => void select('CONTINUE_BROWSING')}>탐색 계속하기</button>
        </>}
      </> : <p role="status">{loading ? '알림을 확인하고 있어요.' : '현재 확인할 수 있는 알림이 없어요.'}</p>}
    </section>
  </main>;
}
