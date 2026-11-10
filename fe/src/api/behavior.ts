import { authenticatedFetch, AccessError } from './auth-fetch';
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from './client';
import { validTime, VisitApiError } from './visit';
import type { UpdateVisitBehaviorRequest, VisitBehaviorResponse } from './types';

export const behaviorKeys = ['activeDurationMs', 'tabSwitchCount', 'behaviorVersion'] as const;
export function behaviorSnapshot(value: UpdateVisitBehaviorRequest): UpdateVisitBehaviorRequest {
  return { activeDurationMs: value.activeDurationMs, tabSwitchCount: value.tabSwitchCount, behaviorVersion: value.behaviorVersion };
}
export function validBehavior(value: unknown): value is UpdateVisitBehaviorRequest {
  if (!value || typeof value !== 'object') return false;
  const v = value as UpdateVisitBehaviorRequest;
  return behaviorKeys.every(key => Number.isSafeInteger(v[key]) && v[key] >= 0) && v.tabSwitchCount <= 2147483647;
}
export function sameBehavior(a: UpdateVisitBehaviorRequest, b: UpdateVisitBehaviorRequest) {
  return behaviorKeys.every(key => a[key] === b[key]);
}
export function coversBehavior(server: UpdateVisitBehaviorRequest, request: UpdateVisitBehaviorRequest) {
  return server.behaviorVersion === request.behaviorVersion ? sameBehavior(server, request)
    : server.behaviorVersion > request.behaviorVersion && server.activeDurationMs >= request.activeDurationMs && server.tabSwitchCount >= request.tabSwitchCount;
}
export function matchesBehaviorResponse(value: unknown, visitId: string, request: UpdateVisitBehaviorRequest): value is VisitBehaviorResponse {
  if (!validBehavior(value)) return false;
  const v = value as VisitBehaviorResponse;
  return v.visitId === visitId && typeof v.applied === 'boolean' && (validTime(v.updatedAt) || (!v.applied && v.updatedAt === null))
    && (v.applied ? sameBehavior(v, request) : coversBehavior(v, request));
}
const codes = ['PRIVACY_RETRACTED', 'V2_STORAGE_DISABLED', 'COLLECTION_VERSION_MISMATCH', 'INVALID_REQUEST', 'SESSION_NOT_FOUND', 'VISIT_NOT_FOUND', 'SESSION_ENDED', 'BEHAVIOR_VERSION_CONFLICT', 'BEHAVIOR_COUNTER_DECREASED'];
export async function updateVisitBehavior(sessionId: string, visitId: string, request: UpdateVisitBehaviorRequest): Promise<VisitBehaviorResponse> {
  if (!validBehavior(request)) throw new VisitApiError('response', '행동 요청의 누적값과 버전을 확인해 주세요.', false);
  const snapshot = behaviorSnapshot(request);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new VisitApiError('timeout', '행동 갱신 응답 시간이 초과되었습니다.', true));
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/visits/${encodeURIComponent(visitId)}/behavior`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot),
        signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
      });
      if (response.status !== 200) {
        let code: string | undefined;
        try { const error = await response.json(); if (codes.includes(error?.code)) code = error.code; } catch { /* HTTP status determines retry policy. */ }
        const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
        const message = code === 'BEHAVIOR_VERSION_CONFLICT' ? '같은 행동 버전에 다른 값이 저장되어 있습니다. 서버 상태 확인이 필요합니다.'
          : code === 'BEHAVIOR_COUNTER_DECREASED' ? '서버 누적 행동값보다 작은 요청이 거절되었습니다. 서버 상태 확인이 필요합니다.'
          : code === 'SESSION_ENDED' ? '이미 종료된 서버 세션의 행동 갱신이 거절되었습니다.'
          : response.status === 400 ? '행동 요청 형식과 누적값 확인이 필요합니다.'
          : response.status === 404 ? '서버 세션 또는 방문을 찾을 수 없습니다.'
          : response.status === 409 ? '서버 행동 정보와 충돌했습니다. 기존 값과 버전을 보존합니다.'
          : retryable ? '행동 갱신 서버가 일시적으로 응답하지 못했습니다.' : '행동 갱신 요청이 거절되었습니다. 서버 설정을 확인해 주세요.';
        throw new VisitApiError('http', message, retryable, response.status, code);
      }
      let value: unknown;
      try { value = await response.json(); } catch { throw new VisitApiError('response', '행동 갱신 응답을 읽을 수 없습니다.', true); }
      if (!matchesBehaviorResponse(value, visitId, snapshot)) throw new VisitApiError('response', '행동 갱신 응답의 방문·버전·누적값이 요청과 일치하지 않습니다.', false);
      return value;
    })()]);
  } catch (error) {
    if (error instanceof AccessError && error.kind !== 'network') throw error;
    if (error instanceof VisitApiError) throw error;
    throw new VisitApiError('network', '행동 갱신 서버에 연결할 수 없습니다.', true);
  } finally { clearTimeout(timer!); }
}
