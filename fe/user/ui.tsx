import type { ButtonHTMLAttributes, ReactNode } from 'react';
import mark from './assets/brand.svg';
import type { UserSnapshot } from './protocol';

type Tone = 'neutral' | 'positive' | 'attention' | 'error' | 'info';

export function Header() {
  return <header className="site-header">
    <div className="brand"><img src={mark} width="28" height="28" alt="" />Focus Recovery</div>
    <span className="environment">합성 테스트</span>
  </header>;
}

export function Button({ variant = 'secondary', pending, children, type = 'button', disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger'; pending?: boolean;
}) {
  return <button {...props} type={type} className={`button button--${variant}`} disabled={disabled || pending} aria-busy={pending || undefined}>
    {children}
  </button>;
}

export function StatusBadge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`status-badge tone--${tone}`}><span className="status-dot" aria-hidden="true" />{children}</span>;
}

export function Notice({ tone = 'info', role = 'status', children }: { tone?: Tone; role?: 'alert' | 'status'; children: ReactNode }) {
  return <div className={`notice tone--${tone}`} role={role}>{children}</div>;
}

export function GoalCard({ goal }: { goal: string }) {
  return <div className="goal-card">
    <p className="goal-label">최초 작업 목표</p>
    <p className="goal-text">{goal}</p>
  </div>;
}

const connectionLabels: Record<UserSnapshot['connection'], string> = {
  unverified: '서버 검증 전',
  verified: '최근 서버 검증',
  stale: '서버 재확인 필요',
  unreachable: '서버 응답 실패',
  'auth-required': '인증 확인 필요',
  denied: '서버 접근 거부',
};

export function Footer({ fixture, connection }: { fixture: string; connection?: UserSnapshot['connection'] }) {
  return <footer className="site-footer">
    <a href={fixture} target="_blank" rel="noreferrer">합성 페이지 열기 <span aria-hidden="true">↗</span></a>
    {connection && <span role="status"><StatusBadge tone={connection === 'verified' ? 'positive'
      : connection === 'denied' || connection === 'unreachable' ? 'attention' : 'neutral'}>{connectionLabels[connection]}</StatusBadge></span>}
  </footer>;
}
