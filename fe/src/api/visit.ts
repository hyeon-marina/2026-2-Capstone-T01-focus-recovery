import { authenticatedFetch, AccessError } from './auth-fetch';
import { API_BASE_URL, ApiError, REQUEST_TIMEOUT_MS } from './client';
import type { CreatePageVisitRequest, PageVisitResponse } from './types';
import type { PageVisit } from '../shared/types';

const originals = ['visitId', 'sequence', 'browserTabKey', 'normalizedUrl', 'domain', 'title', 'content', 'searchQuery', 'isSearchResultPage', 'visitedAt'] as const;
const counters = ['activeDurationMs', 'tabSwitchCount', 'behaviorVersion'] as const;
const codes = ['PRIVACY_RETRACTED', 'V2_STORAGE_DISABLED', 'COLLECTION_VERSION_MISMATCH', 'INVALID_REQUEST', 'SESSION_NOT_FOUND', 'VISIT_NOT_FOUND', 'SESSION_ENDED', 'VISIT_ID_CONFLICT', 'VISIT_SEQUENCE_CONFLICT', 'VISIT_SEQUENCE_OUT_OF_ORDER'];
export class VisitApiError extends ApiError {
  constructor(kind: ApiError['kind'], message: string, public retryable: boolean, status?: number, public code?: string) {
    super(kind, message, status);
  }
}
export function visitRequest(visit: PageVisit): CreatePageVisitRequest {
  // Whitelist DTO fields; do not normalize or truncate the collector's original data.
  return Object.fromEntries([...originals, ...counters, ...(visit.extractionStatus ? ['extractionStatus' as const] : [])].map(key => [key, visit[key]])) as unknown as CreatePageVisitRequest;
}
export function validTime(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function matchesVisitResponse(value: unknown, visit: PageVisit, status: number): value is PageVisitResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (visit.extractionStatus === undefined || v.extractionStatus === visit.extractionStatus
    && Object.keys(v).every(key => [...originals, ...counters, 'extractionStatus', 'sessionId', 'updatedAt'].includes(key))) && v.sessionId === visit.sessionId && originals.every(key => v[key] === visit[key]) && validTime(v.visitedAt)
    && counters.every(key => Number.isSafeInteger(v[key]) && (v[key] as number) >= visit[key]
      && (status !== 201 || v[key] === visit[key]))
    && (status === 201 ? v.updatedAt === null : v.updatedAt === null || validTime(v.updatedAt));
}
export async function savePageVisit(visit: PageVisit): Promise<PageVisitResponse> {
  if (!validTime(visit.visitedAt)) throw new VisitApiError('response', '방문 시각의 UTC 밀리초 형식을 확인해 주세요.', false);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new VisitApiError('timeout', '방문 저장 응답 시간이 초과되었습니다.', true));
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/sessions/${encodeURIComponent(visit.sessionId)}/visits`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(visitRequest(visit)),
        signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
      });
      if (response.status !== 201 && response.status !== 200) {
        let code: string | undefined;
        try {
          const error = await response.json() as { code?: unknown };
          if (typeof error?.code === 'string' && codes.includes(error.code)) code = error.code;
        } catch { /* Status still determines retry policy when the error body is unreadable. */ }
        const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
        const message = response.status === 400 ? '방문 요청 데이터 확인이 필요합니다.'
          : response.status === 404 ? '서버 세션 또는 리소스 확인이 필요합니다. 새 세션을 자동 생성하지 않습니다.'
          : response.status === 409 ? '서버 방문 기록과 충돌했습니다. 기존 ID와 순서를 유지한 채 서버 상태를 확인해 주세요.'
          : retryable ? '방문 저장 서버가 일시적으로 응답하지 못했습니다.' : '방문 저장 요청이 거절되었습니다. 서버 설정을 확인해 주세요.';
        throw new VisitApiError('http', message, retryable, response.status, code);
      }
      let value: unknown;
      try { value = await response.json(); }
      catch { throw new VisitApiError('response', '방문 저장 응답을 읽을 수 없습니다.', true); }
      if (!matchesVisitResponse(value, visit, response.status)) {
        throw new VisitApiError('response', '방문 저장 응답이 원본 요청과 일치하지 않습니다.', false);
      }
      return value;
    })()]);
  } catch (error) {
    if (error instanceof AccessError && error.kind !== 'network') throw error;
    if (error instanceof VisitApiError) throw error;
    throw new VisitApiError('network', '방문 저장 서버에 연결할 수 없습니다.', true);
  } finally { clearTimeout(timer!); }
}
