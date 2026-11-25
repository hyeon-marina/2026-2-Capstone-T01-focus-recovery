import { AccessError, authenticatedFetch } from '../src/api/auth-fetch';
import { API_BASE_URL } from '../src/api/client';
import { validTime } from '../src/api/visit';
import { UUID4, type V2Session } from '../src/v2/contract';
import { FIXED_INTERVAL_MS } from './mock-config';

export const fixedSlot = (startedAt: string, now = Date.now()) =>
  Math.max(0, Math.floor((now - Date.parse(startedAt)) / FIXED_INTERVAL_MS));
export const fixedAccessBlocks = [
  'PRIVACY_RETRACTED', 'V2_STORAGE_DISABLED', 'COLLECTION_VERSION_MISMATCH', 'CONSENT_REQUIRED', 'COLLECTION_POLICY_BLOCKED',
];

// AlertResponse from the POST omits windowId/stateVersion. V2AlertResponse includes explicit nulls.
export function fixedCandidate(value: unknown, session: V2Session) {
  if (!value || typeof value !== 'object') return;
  const a = value as Record<string, unknown>;
  if (typeof a.alertId === 'string' && UUID4.test(a.alertId) && a.sessionId === session.sessionId
    && a.alertType === 'FIXED_INTERVAL' && a.analysisId === null && a.windowIndex === null && a.shownAt === null
    && !('windowId' in a) && !('stateVersion' in a) && a.goalText === session.goalText
    && typeof a.message === 'string' && validTime(a.createdAt)) return a.alertId;
}

export async function requestFixedCandidate(session: V2Session, allowed: () => boolean) {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/sessions/${session.sessionId}/alerts/fixed-interval`,
    { method: 'POST', signal: AbortSignal.timeout(10_000) }, allowed);
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new AccessError(response.status === 401 ? 'authentication' : 'consent', response.status);
  }
  if (response.status === 409) {
    const code: unknown = (await response.json())?.code;
    if (typeof code === 'string' && fixedAccessBlocks.includes(code)) throw new AccessError('consent', 409);
    if (code === 'SESSION_ENDED') return { kind: 'ended' } as const;
    if (code === 'FIXED_INTERVAL_DISABLED') return { kind: 'disabled' } as const;
    if (code === 'ALERT_INTERVAL_NOT_REACHED') return { kind: 'skipped' } as const;
  }
  if (response.status >= 500) throw new AccessError('network', response.status);
  if (response.status === 200 || response.status === 201) {
    const alertId = fixedCandidate(await response.json(), session);
    if (alertId) return { kind: 'candidate', alertId } as const;
  }
  throw new Error('FIXED_INTERVAL_RESPONSE_INVALID');
}
