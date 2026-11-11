import { API_BASE_URL } from '../api/client';
import { authenticatedFetch, AccessError } from '../api/auth-fetch';
import { UUID4 } from './contract';
export interface ConsentPolicy {
  policyId: string; policyVersion: string; scope: string; purpose: string; collectionItems: string;
  useScope: string; retentionPolicyRef: string | null; approvalRef: string | null; status: 'DRAFT' | 'SYNTHETIC' | 'APPROVED' | 'RETIRED'; effectiveAt: string;
}
export interface CollectionAccess {
  local?: { slot: string; policyDigest: string; blockers: string[]; ready: boolean; details: Record<string, string>; planRevision?: number; planChecksum?: string; goalChecksum?: string; assignmentChecksum?: string };
  participantId: string; expiresAt: string; consentId: string | null; consentValid: boolean; collectionEnabled: boolean; withdrawn: boolean; policy: ConsentPolicy | null;
}
export async function accessRequest(path: string, body?: unknown) {
  const response = await authenticatedFetch(`${API_BASE_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new AccessError(response.status === 401 ? 'authentication' : 'consent', response.status);
  if (response.status === 204) return;
  return response.json();
}
export async function readCollectionAccess(): Promise<CollectionAccess> {
  const identity = await accessRequest('/api/auth/me');
  const consent = await accessRequest('/api/consent');
  if (!identity || !UUID4.test(identity.participantId) || !Number.isFinite(Date.parse(identity.expiresAt))
    || Date.parse(identity.expiresAt) <= Date.now() || consent?.participantId !== identity.participantId
    || typeof consent.consentValid !== 'boolean' || typeof consent.collectionEnabled !== 'boolean' || typeof consent.withdrawn !== 'boolean'
    || consent.consentId !== null && !UUID4.test(consent.consentId)
    || consent.consentValid && (!consent.consentId || consent.withdrawn)) throw new AccessError('authentication');
  const p = consent.policy;
  if (p !== null && (!p || ['policyId','policyVersion','scope','purpose','collectionItems','useScope','status','effectiveAt'].some(k => typeof p[k] !== 'string')
    || !['DRAFT','SYNTHETIC','APPROVED','RETIRED'].includes(p.status)
    || [p.retentionPolicyRef,p.approvalRef].some(v => v !== null && typeof v !== 'string'))) throw new AccessError('consent');
  const local = identity.localMode ? await accessRequest('/api/collection/local-status') : undefined;
  if (local && (!['','A','B','C'].includes(local.slot) || !Array.isArray(local.blockers) || typeof local.ready !== 'boolean')) throw new AccessError('consent');
  return { ...consent, expiresAt: identity.expiresAt, ...(local ? { local } : {}) };
}
export interface WithdrawalReceipt { requestId: string; withdrawalId: string; status: 'QUARANTINED'; sessions: unknown[]; targets: unknown[]; unmet: string[] }
export function validWithdrawal(value: unknown, id: string): value is WithdrawalReceipt {
  const v = value as WithdrawalReceipt;
  return !!v && v.requestId === id && UUID4.test(v.withdrawalId) && v.status === 'QUARANTINED' && Array.isArray(v.sessions) && Array.isArray(v.targets)
    && Array.isArray(v.unmet) && v.unmet.every(x => typeof x === 'string');
}
