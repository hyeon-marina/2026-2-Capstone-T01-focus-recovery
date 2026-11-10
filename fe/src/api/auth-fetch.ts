import { API_BASE_URL } from './client';
// Credentials stay in MV3 trusted-context session storage, never IndexedDB/local/sync.
const TOKEN_KEY = 'focus.accessCredential';
let generation = 0;
export class AccessError extends Error {
  constructor(public kind: 'authentication' | 'network' | 'consent' | 'account', public status?: number) { super(kind === 'network' ? 'network' : `ACCESS_${kind.toUpperCase()}`); }
}
export async function setCredential(token?: string) {
  generation++;
  if (!globalThis.chrome?.storage?.session) throw new AccessError('authentication');
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  if (token !== undefined && !/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new AccessError('authentication');
  if (token) await chrome.storage.session.set({ [TOKEN_KEY]: token });
  else await chrome.storage.session.remove(TOKEN_KEY);
}
export function accessGeneration() { return generation; }
export async function authenticatedFetch(url: string, init?: RequestInit) {
  const target = new URL(url), expected = new URL(API_BASE_URL);
  if (target.origin !== expected.origin || !target.pathname.startsWith('/api/') || target.username || target.password) throw new AccessError('authentication');
  const started = generation;
  const stored = globalThis.chrome?.storage?.session ? await chrome.storage.session.get(TOKEN_KEY) : {};
  if (started !== generation) throw new AccessError('account');
  const token = stored[TOKEN_KEY];
  const headers = new Headers(init?.headers);
  if (typeof token === 'string' && target.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(target.hostname)) throw new AccessError('authentication');
  if (typeof token === 'string') headers.set('Authorization', `Bearer ${token}`);
  try {
    const response = await fetch(url, { ...init, ...(token ? { headers } : {}), credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (started !== generation) throw new AccessError('account');
    return response;
  } catch (error) {
    if (error instanceof AccessError) throw error;
    throw new AccessError('network');
  }
}
