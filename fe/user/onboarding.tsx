import { useState, type FormEvent } from 'react';
import { normalizeGoal, validGoal } from '../src/shared/goal';
import { Button, Notice } from './ui';

export function LoginScreen({ accountMismatch, busy, pending, onLogin }: {
  accountMismatch: boolean; busy: boolean; pending: boolean; onLogin: (token: string) => void;
}) {
  function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const token = new FormData(form).get('credential');
    form.reset();
    if (typeof token === 'string') onLogin(token.trim());
  }

  return <>
    <p className="lead">작업 목표를 정해 두고, 웹을 탐색하는 중에 처음 목표를 다시 확인할 수 있어요.</p>
    {accountMismatch && <Notice tone="attention">기존 작업을 시작한 계정으로 다시 인증해 주세요.</Notice>}
    <form className="flow" onSubmit={authenticate}>
      <div className="field">
        <label htmlFor="credential">합성 테스트 자격정보</label>
        <input id="credential" name="credential" type="password" autoComplete="off" spellCheck={false}
          aria-describedby="credential-help" required disabled={busy} />
        <p className="field-note" id="credential-help">로컬 모의 서버의 테스트 전용 자격정보를 입력해 주세요.</p>
      </div>
      <Button type="submit" variant="primary" disabled={busy} pending={pending}>{pending ? '인증 확인 중…' : '인증하기'}</Button>
    </form>
  </>;
}

export function ConsentScreen({ disabled, pending, onAgree }: {
  disabled: boolean; pending: boolean; onAgree: () => void;
}) {
  const [checked, setChecked] = useState(false);
  return <form className="flow" onSubmit={event => { event.preventDefault(); if (checked && !disabled) onAgree(); }}>
    <p className="lead" id="consent-description">합성 사이트에서 목표 확인 기능을 검증할 때 탐색 기록을 사용해요.</p>
    <dl className="facts consent-facts">
      <div><dt>수집 범위</dt><dd>허용된 합성 페이지</dd></div>
      <div><dt>수집 항목</dt><dd>문서 제목과 본문, 활성 체류시간, 탭 전환</dd></div>
      <div><dt>전송 대상</dt><dd>로컬 모의 서버</dd></div>
    </dl>
    <p className="field-note">연결 및 동의 설정에서 언제든 동의를 철회할 수 있어요.</p>
    <label className="checkbox">
      <input type="checkbox" checked={checked} disabled={disabled} aria-describedby="consent-description"
        onChange={event => setChecked(event.currentTarget.checked)} />
      <span>합성 탐색 데이터 수집에 동의합니다.</span>
    </label>
    <Button type="submit" variant="primary" disabled={!checked || disabled} pending={pending}>
      {pending ? '동의 저장 중…' : '합성 동의 저장'}
    </Button>
  </form>;
}

export function GoalScreen({ goal, setGoal, busy, pending, onStart }: {
  goal: string; setGoal: (value: string) => void; busy: boolean; pending: boolean; onStart: () => void;
}) {
  const size = normalizeGoal(goal).length;
  const valid = validGoal(goal);
  return <form className="flow" onSubmit={event => { event.preventDefault(); if (valid && !busy) onStart(); }}>
    <p className="lead">이 탐색을 마칠 때 무엇을 알고 싶거나 끝내고 싶나요?</p>
    <div className="field">
      <label htmlFor="goal">최초 작업 목표</label>
      <textarea id="goal" value={goal} rows={3} onChange={event => setGoal(event.currentTarget.value)}
        aria-describedby="goal-length" aria-invalid={size > 0 && !valid} disabled={busy}
        placeholder="예: React 상태 관리 방식 비교하기" />
      <div className="field-note goal-count" id="goal-length">
        <span>{size > 150 ? '목표를 150자 이하로 줄여 주세요.'
          : size > 0 && size < 5 ? '목표를 5자 이상 입력해 주세요.' : '앞뒤 공백을 제외하고 5~150자'}</span>
        <span>{size} / 150</span>
      </div>
    </div>
    <Button type="submit" variant="primary" disabled={busy || !valid} pending={pending}>
      {pending ? '시작 요청 중…' : '작업 시작'}
    </Button>
  </form>;
}
