// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertPage } from '../user/alert-page';
import { Popup } from '../user/popup';
import { isUserSnapshot, type AlertDetail, type UserSnapshot } from '../user/protocol';

const startedAt = '2026-11-26T01:00:00.000Z';
const endedAt = '2026-11-26T01:02:03.000Z';
const goal = '합성 문서를 읽고 비교 기준을 정리하기';
const handle = 'a'.repeat(64);
const ready: UserSnapshot = {
  lifecycle: 'IDLE', access: 'ready', permission: true, collecting: false, connection: 'verified',
  serverCheckedAt: Date.parse(startedAt), privacyPending: false, storageFailed: false, reconnectRequired: false,
  deliveryIssue: false, privacyHold: false, withdrawalPending: false, analysis: 'unconnected', receiptPending: false,
};
const active: UserSnapshot = { ...ready, lifecycle: 'ACTIVE', startedAt, goal, sessionHandle: handle, collecting: true };
const mockDetail: AlertDetail = { alertType: 'AI', goal, shown: false };

let root: Root;
let snapshot: UserSnapshot;
let send: ReturnType<typeof vi.fn>;
const text = () => document.querySelector('main')?.textContent;
const button = (name: string) => [...document.querySelectorAll('button')].find(b => b.textContent === name)!;
const click = async (name: string) => act(async () => button(name).click());
async function render(node: ReactNode = <Popup />) {
  await act(async () => root.render(node));
}
async function tick(ms = 500) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
function hold<T>() {
  let resolve!: (result: T) => void;
  const reply = new Promise<T>(done => { resolve = done; });
  return { reply, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(endedAt));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  snapshot = ready;
  send = vi.fn(async () => ({ snapshot }));
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('user snapshot presentation', () => {
  it('accepts legacy snapshots and only exposes a verified completion timestamp in a visible ended session', () => {
    const ended = { ...active, lifecycle: 'ENDED', sessionHandle: undefined, collecting: false };
    expect(isUserSnapshot(active)).toBe(true);
    expect(isUserSnapshot({ ...ended, endedAt, alertMode: 'AI' })).toBe(true);
    for (const value of [
      { ...active, endedAt }, { ...ended, endedAt: 'yesterday' }, { ...ended, endedAt: '2026-11-26T00:59:00.000Z' },
      { ...ended, endedAt, privacyPending: true }, { ...ended, endedAt, permission: false },
      { ...ended, access: 'account', alertMode: 'AI' }, { ...ended, alertMode: 'OTHER' }, { ...ready, alertMode: 'AI' },
      { ...ready, serverCheckedAt: Number.MAX_SAFE_INTEGER },
    ]) expect(isUserSnapshot(value)).toBe(false);
  });

  it.each([
    [{ ...ready, access: 'auth' }, '합성 계정으로 시작'],
    [{ ...ready, access: 'account' }, '기존 작업을 시작한 계정'],
    [{ ...ready, access: 'consent' }, '로컬 모의 서버'],
    [{ ...ready, access: 'denied', permission: false }, '사이트 권한이 꺼져 있어요'],
    [{ ...ready, storageFailed: true }, '작업 저장소를 열 수 없어'],
    [{ ...ready, lifecycle: 'START_PENDING', goal }, '같은 시작 요청 다시 확인'],
    [{ ...active, lifecycle: 'END_PENDING', collecting: false, sessionHandle: undefined }, '전송 및 종료 다시 확인'],
    [{ ...ready, access: 'withdrawn', withdrawalPending: true }, '철회 요청 다시 확인'],
  ] as const)('renders the applicable state and action %#', async (value, label) => {
    snapshot = value;
    await render();
    expect(text()).toContain(label);
    expect(text()).not.toContain('서버에서 작업 종료를 확인했어요.');
  });

  it('keeps consent unchecked on reopening and waits for explicit consent', async () => {
    snapshot = { ...ready, access: 'consent' };
    await render();
    const check = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(check.checked).toBe(false);
    expect(button('합성 동의 저장').disabled).toBe(true);
    await act(async () => check.click());
    await click('합성 동의 저장');
    expect(send).toHaveBeenCalledWith({ type: 'agree' });
    snapshot = { ...ready, access: 'auth' };
    await tick();
    snapshot = { ...ready, access: 'consent' };
    await tick();
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  });

  it('shows fixed mode, actual elapsed time and the exact handle for stopping', async () => {
    snapshot = { ...active, alertMode: 'FIXED_INTERVAL' };
    await render();
    expect(text()).toContain(goal);
    expect(text()).toContain('00:02:03');
    expect(text()).toContain('고정 주기 알림');
    expect(text()).toContain('알림 상태 확인 필요');
    expect(text()).not.toContain('분석 미연결');
    await click('작업 종료');
    expect(send).toHaveBeenCalledWith({ type: 'stop', sessionHandle: handle });
  });

  it.each([
    ['waiting', '예정 회차 대기'], ['checking', '알림 확인 중'], ['confirmed', '현재 회차 후보 확인 완료'],
    ['delayed', '알림 확인 지연'], ['disabled', '알림 사용 불가'], ['unavailable', '알림 사용 불가'],
    ['unverified', '알림 상태 확인 필요'], ['skipped', '예정 회차 대기'], ['suspended', '알림 일시 중지'],
    ['notification-denied', 'Chrome 알림 권한 꺼짐'],
  ] as const)('shows the fixed alert status %s alongside the assigned mode', async (fixedAlertStatus, label) => {
    snapshot = { ...active, alertMode: 'FIXED_INTERVAL', fixedAlertStatus };
    await render();
    expect(text()).toContain('고정 주기 알림');
    expect(document.querySelector('.facts [role="status"]')?.textContent).toBe(label);
    expect(text()).not.toContain('분석 미연결');
    if (fixedAlertStatus === 'disabled' || fixedAlertStatus === 'skipped') expect(text()).toContain('다음 회차에 다시 확인해요.');
  });

  it('rejects fixed status outside a visible active fixed session', () => {
    const fixed = { ...active, alertMode: 'FIXED_INTERVAL', fixedAlertStatus: 'confirmed' };
    expect(isUserSnapshot(fixed)).toBe(true);
    for (const value of [
      { ...fixed, fixedAlertStatus: 'unknown' }, { ...fixed, alertMode: 'AI' },
      { ...fixed, access: 'account' }, { ...fixed, permission: false, collecting: false },
      { ...fixed, privacyPending: true, collecting: false }, { ...fixed, withdrawalPending: true, collecting: false },
      { ...fixed, lifecycle: 'ENDED', sessionHandle: undefined, collecting: false },
      { ...fixed, reconnectRequired: true, collecting: false },
    ]) expect(isUserSnapshot(value)).toBe(false);
    expect(isUserSnapshot({ ...fixed, reconnectRequired: true, collecting: false, fixedAlertStatus: 'suspended' })).toBe(true);
  });

  it.each([
    [{ analysis: 'completed', finalState: 'NORMAL' }, '정상 탐색'],
    [{ analysis: 'completed', finalState: 'TRANSITION' }, '전환 탐색'],
    [{ analysis: 'completed', finalState: 'DRIFT' }, '목표 확인 필요'],
    [{ analysis: 'empty' }, '분석 결과 없음'],
    [{ analysis: 'pending' }, '분석 대기'],
    [{ analysis: 'delayed' }, '분석 지연'],
    [{ analysis: 'failed' }, '분석 실패'],
    [{ analysis: 'invalidated' }, '분석 무효화'],
    [{ analysis: 'unavailable' }, '분석 상태 확인 불가'],
  ] as const)('presents the Worker analysis %#', async (result, label) => {
    snapshot = { ...active, ...result, alertMode: 'AI' };
    await render();
    expect(text()).toContain(label);
  });

  it('presents only verified end times and preserves previous work receipts alongside the next goal', async () => {
    snapshot = { ...active, lifecycle: 'ENDED', sessionHandle: undefined, collecting: false, receiptPending: true,
      receipts: { pending: 2, previousPending: 1, acknowledged: 1, retryWaiting: 0, exhausted: 0, rejected: 1, accessBlocked: 0 } };
    await render();
    expect(text()).toContain('서버에서 작업 종료를 확인했어요.');
    expect(document.querySelectorAll('time')).toHaveLength(2); // Start and last access check.
    expect(text()).not.toContain('세션 경과');
    snapshot = { ...snapshot, endedAt };
    await tick();
    expect(text()).toContain('00:02:03');
    expect(document.querySelector(`time[datetime="${endedAt}"]`)).not.toBeNull();
    await click('새 작업 준비');
    expect(text()).toContain('이전 작업 1건 포함');
    expect(document.querySelector('#goal')).not.toBeNull();
    expect(button('미확인 알림 기록 다시 보내기')).toBeUndefined();
  });
});

describe('user popup Worker interaction', () => {
  it('distinguishes loading and bad status without overlapping polls and cleans up on close', async () => {
    const pending = hold<unknown>();
    send.mockImplementation(() => pending.reply);
    await render();
    expect(text()).toContain('저장된 작업 상태');
    await tick(1500);
    expect(send.mock.calls.filter(([c]) => c.type === 'status')).toHaveLength(1);
    await act(async () => pending.resolve({ snapshot: null }));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('확장 프로그램 상태를 읽을 수 없어요');
    await act(async () => root.render(null));
    await tick(1000);
    expect(send.mock.calls.filter(([c]) => c.type === 'status')).toHaveLength(1);
  });

  it('prioritizes privacy while blocking duplicate commands and discarding old polling and stop replies', async () => {
    snapshot = active;
    const polling = hold<{ snapshot: UserSnapshot }>();
    const stopping = hold<{ snapshot: UserSnapshot }>();
    const logout = hold<{ snapshot: UserSnapshot }>();
    send.mockImplementation(async command => {
      if (command.type === 'status' && send.mock.calls.filter(([c]) => c.type === 'status').length === 2) return polling.reply;
      if (command.type === 'stop') return stopping.reply;
      if (command.type === 'logout') return logout.reply;
      return { snapshot };
    });
    await render();
    await tick();
    await act(async () => {
      button('작업 종료').click();
      button('작업 종료').click();
    });
    expect(send.mock.calls.filter(([c]) => c.type === 'stop')).toHaveLength(1);
    expect(button('로그아웃').disabled).toBe(false);
    expect(button('합성 동의 철회').disabled).toBe(false);
    await click('로그아웃');
    expect(text()).not.toContain(goal);
    expect(button('로그아웃 중…').disabled).toBe(true);
    snapshot = { ...ready, access: 'auth' };
    await act(async () => {
      logout.resolve({ snapshot });
      polling.resolve({ snapshot: active });
      stopping.resolve({ snapshot: active });
    });
    expect(text()).toContain('합성 계정으로 시작');
    expect(text()).not.toContain(goal);
  });

  it('recovers only eligible alert records', async () => {
    snapshot = { ...ready, receiptPending: true, receipts: {
      pending: 1, previousPending: 1, acknowledged: 0, retryWaiting: 0, exhausted: 1, rejected: 0, accessBlocked: 0,
    } };
    await render();
    await click('미확인 알림 기록 다시 보내기');
    expect(send).toHaveBeenCalledWith({ type: 'retry-receipts' });
    expect(text()).toContain('기기에 보관 중인 미확인 기록');
  });
});

describe('alert page presentation and timing', () => {
  it.each(['AI', 'FIXED_INTERVAL'] as const)('renders %s with equivalent controls and no duplicate display or choice', async alertType => {
    const open = hold<{ detail: AlertDetail }>();
    const select = hold<{ detail: AlertDetail }>();
    let detail: AlertDetail | undefined = { ...mockDetail, alertType };
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    send.mockImplementation(async command => {
      if (command.type === 'alert-open') return open.reply;
      if (command.type === 'alert-shown') {
        expect(text()).toContain(goal);
        detail = { ...mockDetail, alertType, shown: true, shownDelivery: 'pending' };
      }
      if (command.type === 'alert-select') return select.reply;
      return { detail };
    });
    await render(<AlertPage viewId="test-view" />);
    expect(text()).toContain('알림을 확인하고 있어요.');
    await act(async () => open.resolve({ detail: detail! }));
    expect(text()).toContain(alertType === 'AI' ? 'AI 분석' : '작업 중간 점검 시간');
    expect(button('목표로 돌아가기').disabled).toBe(true);
    expect(button('탐색 계속하기').className).toBe(button('목표로 돌아가기').className);
    await tick(100);
    expect(send).not.toHaveBeenCalledWith({ type: 'alert-shown', viewId: 'test-view' });
    visibility.mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await tick(100);
    expect(send).toHaveBeenCalledWith({ type: 'alert-shown', viewId: 'test-view' });
    expect(button('목표로 돌아가기').disabled).toBe(false);
    await act(async () => {
      button('탐색 계속하기').click();
      button('목표로 돌아가기').click();
    });
    expect(text()).toContain('선택을 저장하고 있어요.');
    expect(send.mock.calls.filter(([c]) => c.type === 'alert-select')).toEqual([[
      { type: 'alert-select', viewId: 'test-view', action: 'CONTINUE_BROWSING' },
    ]]);
    detail = { ...detail!, action: 'CONTINUE_BROWSING', acknowledged: false, selectionDelivery: 'retry-wait' };
    await act(async () => select.resolve({ detail: detail! }));
    expect(text()).toContain('기기에 저장했어요.');
    expect(button('탐색 계속하기')).toBeUndefined();
    detail = { ...detail, acknowledged: true, selectionDelivery: 'acknowledged' };
    await tick(1000);
    expect(text()).toContain('서버에 기록했어요.');
    detail = undefined;
    await tick(1000);
    expect(text()).toContain('현재 확인할 수 있는 알림이 없어요.');
    expect(text()).not.toContain(goal);
    expect(send.mock.calls.filter(([c]) => c.type === 'alert-shown')).toHaveLength(1);
  });
});
