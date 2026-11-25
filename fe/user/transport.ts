import { ApiError, API_BASE_URL } from '../src/api/client';
import { AccessError, setCredential, setRequestScope } from '../src/api/auth-fetch';
import { accessRequest, readCollectionAccess, type ConsentPolicy } from '../src/v2/access';
import { v2HttpTransport } from '../src/v2/runtime';
import { assertMockOrigin } from './mock-config';
import type { ServerConnection } from './protocol';

const LOGOUT_PENDING = 'focus.userLogoutPending';
const RECENT_CHECK_MS = 30_000;
let epoch = 0;
let privacyPending = 0;
let logoutRequested = false;
let requestOrder = 0;
let latestResult = 0;
let checkedAt: number | undefined;
let failure: { order: number; connection: ServerConnection; path: string } | undefined;

export function resetServerVerification() {
  epoch++;
  checkedAt = undefined;
  failure = undefined;
}

export function suspendUserHttp() {
  if (privacyPending++ === 0) resetServerVerification();
  return () => { privacyPending--; };
}

export function serverStatus(now = Date.now()): { connection: ServerConnection; serverCheckedAt?: number } {
  const connection = failure?.connection
    ?? (checkedAt === undefined ? 'unverified' : now - checkedAt >= RECENT_CHECK_MS ? 'stale' : 'verified');
  return { connection, ...(checkedAt === undefined ? {} : { serverCheckedAt: checkedAt }) };
}

export function hasMockPermission() {
  return chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] });
}

export function createMockTransport() {
  assertMockOrigin(API_BASE_URL);
  // If the Worker stopped before clearing a requested logout, clear the credential before hydration verifies access.
  const recoveredLogout = chrome.storage.session.get(LOGOUT_PENDING).then(async stored => {
    if (stored[LOGOUT_PENDING]) {
      await setCredential();
      await chrome.storage.session.remove(LOGOUT_PENDING);
    }
  });
  setRequestScope((path, method) => {
    const started = epoch, order = ++requestOrder;
    const privacyRequest = method === 'GET' && ['/api/auth/me', '/api/consent'].includes(path)
      || method === 'POST' && ['/api/auth/logout', '/api/consent/withdrawals'].includes(path);
    return {
      check() {
        if (started !== epoch || privacyPending && !privacyRequest) throw new AccessError('account');
      },
      report(status) {
        if (started !== epoch || order < latestResult || /^\/api\/sessions\/[^/]+\/alerts(?:\/|$)/.test(path)) return;
        latestResult = order;
        const connection = status === null || status >= 500 ? 'unreachable'
          : status === 401 ? 'auth-required' : status === 403 ? 'denied' : undefined;
        if (connection) failure = { order, connection, path };
        else if (status !== null && status < 300 && failure?.path === path && path.endsWith('/analysis-status')) failure = undefined;
      },
    };
  });
  return {
    ...v2HttpTransport,
    async access() {
      await recoveredLogout;
      if (logoutRequested && !privacyPending) throw new AccessError('authentication');
      const started = epoch, order = requestOrder;
      if (!await hasMockPermission()) throw new AccessError('consent');
      let access;
      try { access = await readCollectionAccess(); }
      catch (error) {
        if (error instanceof AccessError && (error.status ?? 0) >= 500) throw new AccessError('network', error.status);
        throw error;
      }
      if (started !== epoch) throw new AccessError('account');
      if (access.local || access.policy?.status !== 'SYNTHETIC' || access.policy.scope !== 'SESSION_COLLECTION') {
        throw new AccessError('consent');
      }
      if (!privacyPending && (!failure || failure.order <= order)) {
        checkedAt = Date.now();
        failure = undefined;
      }
      return access;
    },
  };
}

export async function saveSyntheticConsent(policy: ConsentPolicy | null) {
  if (policy?.status !== 'SYNTHETIC') throw new AccessError('consent');
  await accessRequest('/api/consent', {
    requestId: crypto.randomUUID(), policyId: policy.policyId, policyVersion: policy.policyVersion, accepted: true,
  });
}

export async function login(token: string) {
  resetServerVerification();
  const started = epoch;
  await setCredential(token);
  if (started !== epoch) return;
  await chrome.storage.session.remove(LOGOUT_PENDING);
  if (started === epoch) logoutRequested = false;
}

export function rememberLogout() {
  logoutRequested = true;
  return chrome.storage.session.set({ [LOGOUT_PENDING]: true });
}

export async function logout() {
  try { await accessRequest('/api/auth/logout', {}); }
  finally {
    await setCredential();
    await chrome.storage.session.remove(LOGOUT_PENDING);
    logoutRequested = false;
  }
}

export function commandError(error: unknown) {
  if (error instanceof AccessError) return error.kind === 'authentication' ? 'auth' : error.kind;
  if (error instanceof ApiError) {
    if (error.status === 401) return 'auth';
    if (error.status === 403) return 'consent';
    return error.kind === 'response' ? 'response' : 'network';
  }
  if (error instanceof Error && ['V2_VERSION_OR_SESSION_MISMATCH', 'V2_RESUME_BLOCKED'].includes(error.message)) return 'response';
  return 'blocked';
}
