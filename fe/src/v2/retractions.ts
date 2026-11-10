import { authenticatedFetch } from '../api/auth-fetch';
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from '../api/client';
import { validTime } from '../api/visit';
import { UUID4 } from './contract';

export interface RetractionRequest {
  retractionId: string; visitId: string; observedAt: string;
  reasonCode: 'SENSITIVE_CONTENT' | 'CONSENT_WITHDRAWN';
}
export interface RetractionAck {
  retractionId: string; visitId: string; status: 'QUARANTINED' | 'PURGED'; invalidatedWindowIds: string[];
}
export interface RetractionEntry {
  request: RetractionRequest; phase: 'pending' | 'sending' | 'acknowledged';
  attempts: number; nextAttemptAt: number; errorCode?: 'DELIVERY_UNCONFIRMED'; ack?: RetractionAck;
}
export function validRetraction(e: RetractionEntry) {
  const r = e?.request;
  return r && Object.keys(r).sort().join() === 'observedAt,reasonCode,retractionId,visitId'
    && UUID4.test(r.retractionId) && UUID4.test(r.visitId) && validTime(r.observedAt)
    && ['SENSITIVE_CONTENT', 'CONSENT_WITHDRAWN'].includes(r.reasonCode)
    && ['pending', 'sending', 'acknowledged'].includes(e.phase)
    && Number.isSafeInteger(e.attempts) && e.attempts >= 0 && Number.isFinite(e.nextAttemptAt)
    && (e.phase === 'acknowledged' ? validRetractionAck(e.ack, r) : e.ack === undefined);
}
export function validRetractionAck(value: unknown, r: RetractionRequest): value is RetractionAck {
  if (!value || typeof value !== 'object') return false;
  const a = value as RetractionAck;
  return Object.keys(a).sort().join() === 'invalidatedWindowIds,retractionId,status,visitId'
    && a.retractionId === r.retractionId && a.visitId === r.visitId && ['QUARANTINED', 'PURGED'].includes(a.status)
    && Array.isArray(a.invalidatedWindowIds) && a.invalidatedWindowIds.every(id => UUID4.test(id))
    && new Set(a.invalidatedWindowIds).size === a.invalidatedWindowIds.length;
}
export async function sendRetraction(sessionId: string, request: RetractionRequest): Promise<unknown> {
  // Production has no v2 entry point or ownership credentials. The BE default denies this request.
  const response = await authenticatedFetch(`${API_BASE_URL}/api/sessions/${sessionId}/visit-retractions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), credentials: 'omit', redirect: 'error', cache: 'no-store',
  });
  if (![200, 202].includes(response.status)) throw new Error('DELIVERY_UNCONFIRMED');
  return response.json();
}
