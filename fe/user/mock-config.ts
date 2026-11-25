export const MOCK_ORIGIN = 'http://127.0.0.1:8912';
export const USER_POPUP = 'user/index.html';
export const USER_DB = 'focus-recovery-user-v2-mock';

export function assertMockOrigin(origin: string) {
  if (origin !== MOCK_ORIGIN) throw new Error('User mock requires ' + MOCK_ORIGIN);
}
