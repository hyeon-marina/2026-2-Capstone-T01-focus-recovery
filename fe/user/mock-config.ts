import type { AlertMode } from '../src/v2/state';

export const MOCK_ORIGIN = 'http://127.0.0.1:8912';
export const USER_POPUP = 'user/index.html';
export const USER_DB = 'focus-recovery-user-v2-mock';
export const FIXED_INTERVAL_MS = 10 * 60_000;

export function syntheticAlertMode(mode = 'AI'): AlertMode {
  if (mode === 'AI' || mode === 'FIXED_INTERVAL') return mode;
  throw new Error('USER_ALERT_MODE must be AI or FIXED_INTERVAL');
}

export function assertMockOrigin(origin: string) {
  if (origin !== MOCK_ORIGIN) throw new Error('User mock requires ' + MOCK_ORIGIN);
}
