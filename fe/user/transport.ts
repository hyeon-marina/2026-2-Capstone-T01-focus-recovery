import { ApiError, API_BASE_URL } from '../src/api/client';
import { AccessError, setCredential } from '../src/api/auth-fetch';
import { accessRequest, readCollectionAccess, type ConsentPolicy } from '../src/v2/access';
import { v2HttpTransport } from '../src/v2/runtime';
import { assertMockOrigin } from './mock-config';

export function hasMockPermission() {
  return chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] });
}

export function createMockTransport() {
  assertMockOrigin(API_BASE_URL);
  return {
    ...v2HttpTransport,
    async access() {
      if (!await hasMockPermission()) throw new AccessError('consent');
      const access = await readCollectionAccess();
      if (access.local || access.policy?.status !== 'SYNTHETIC' || access.policy.scope !== 'SESSION_COLLECTION') {
        throw new AccessError('consent');
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

export async function logout() {
  try { await accessRequest('/api/auth/logout', {}); } finally { await setCredential(); }
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
