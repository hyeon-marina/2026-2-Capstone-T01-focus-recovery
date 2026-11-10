import { authenticatedFetch, AccessError } from './auth-fetch';
import { API_BASE_URL, ApiError, REQUEST_TIMEOUT_MS } from './client';
import { isWorkSession, UUID } from './session';
import { validBehavior } from './behavior';
import type { EndWorkSessionRequest, WorkSessionResponse } from './types';

const codes = ['PRIVACY_RETRACTED', 'V2_STORAGE_DISABLED', 'INVALID_REQUEST', 'SESSION_NOT_FOUND', 'VISIT_NOT_FOUND', 'BEHAVIOR_VERSION_CONFLICT', 'BEHAVIOR_COUNTER_DECREASED'];
export class SessionEndError extends ApiError {
  constructor(kind: ApiError['kind'], message: string, public retryable: boolean, status?: number, public code?: string) {
    super(kind, message, status);
  }
}
export function validEndRequest(value: unknown): value is EndWorkSessionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => k !== 'finalBehaviors')) return false;
  const entries = (value as EndWorkSessionRequest).finalBehaviors;
  return entries === undefined || entries === null || Array.isArray(entries) && entries.every(e => e && typeof e.visitId === 'string' && UUID.test(e.visitId)
    && validBehavior(e) && Object.keys(e).every(k => ['visitId', 'activeDurationMs', 'tabSwitchCount', 'behaviorVersion'].includes(k)))
    && new Set(entries.map(e => e.visitId)).size === entries.length;
}
export function matchesSession(value: unknown, session: WorkSessionResponse): value is WorkSessionResponse {
  return isWorkSession(value, session.collectionSpecVersion ?? '1.0') && value.sessionId === session.sessionId && value.goalText === session.goalText
    && value.startedAt === session.startedAt && (value.endedAt === null || Date.parse(value.endedAt) >= Date.parse(session.startedAt));
}
export function matchesEndedSession(value: unknown, session: WorkSessionResponse): value is WorkSessionResponse & { status: 'ENDED'; endedAt: string } {
  return matchesSession(value, session) && value.status === 'ENDED';
}
async function requestSession(session: WorkSessionResponse, body?: EndWorkSessionRequest): Promise<WorkSessionResponse> {
  if (!isWorkSession(session, session.collectionSpecVersion ?? '1.0') || session.status !== 'ACTIVE' || !UUID.test(session.sessionId)
    || body !== undefined && !validEndRequest(body)) throw new SessionEndError('response', '종료 대상 또는 고정 요청 정보 확인이 필요합니다.', false);
  // Copy before any asynchronous work so callers cannot change an in-flight request.
  const expected = structuredClone(session);
  const snapshot = body === undefined ? undefined : JSON.stringify(body);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new SessionEndError('timeout', '서버 종료 확인 시간이 초과되었습니다.', true)); controller.abort(); }, REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/sessions/${encodeURIComponent(expected.sessionId)}${body === undefined ? '' : '/end'}`, {
        method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: snapshot,
        signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
      });
      if (response.ok && response.status !== 200) throw new SessionEndError('response', '서버 종료 확인 응답의 HTTP 상태가 올바르지 않습니다.', false);
      if (response.status !== 200) {
        let code: string | undefined;
        try { const error = await response.json(); if (codes.includes(error?.code)) code = error.code; } catch { /* Never retain server text. */ }
        const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
        throw new SessionEndError('http', retryable ? '서버 종료 확인 중 일시적인 서버 오류가 발생했습니다.'
          : '서버 종료 요청 또는 세션 상태 확인이 필요합니다. 원본을 보존합니다.', retryable, response.status, code);
      }
      let value: unknown;
      try { value = await response.json(); } catch { throw new SessionEndError('response', '서버 종료 응답을 읽을 수 없습니다. 같은 요청으로 확인합니다.', true); }
      if (!matchesSession(value, expected) || body !== undefined && value.status !== 'ENDED') {
        throw new SessionEndError('response', '서버 세션 응답이 종료 대상 또는 종료 계약과 일치하지 않습니다.', false);
      }
      return value;
    })()]);
  } catch (error) {
    if (error instanceof AccessError && error.kind !== 'network') throw error;
    if (error instanceof SessionEndError) throw error;
    throw new SessionEndError('network', '서버 종료 확인 서버에 연결할 수 없습니다.', true);
  } finally { clearTimeout(timer!); }
}
export const endSession = (session: WorkSessionResponse, request: EndWorkSessionRequest) => requestSession(session, request);
export const getSession = (session: WorkSessionResponse) => requestSession(session);
