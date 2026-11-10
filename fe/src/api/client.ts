import { authenticatedFetch, AccessError } from './auth-fetch';
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
export const REQUEST_TIMEOUT_MS = 10000;
export class ApiError extends Error {
  constructor(public kind: 'network' | 'timeout' | 'http' | 'response', message: string, public status?: number) {
    super(message);
  }
}
export async function postJson(path: string, body: unknown, idempotencyKey: string): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApiError('timeout', '서버 응답 시간이 초과되었습니다. 같은 요청으로 재시도해 주세요.'));
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await authenticatedFetch(`${API_BASE_URL}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(body), signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
      });
      if (!response.ok) {
        const message = response.status === 401 ? '인증이 필요하거나 만료되었습니다. 재인증 후 같은 요청으로 확인해 주세요.'
          : response.status === 400 ? '서버가 요청을 거절했습니다. 목표는 앞뒤 공백을 제외하고 5~150자여야 합니다.'
          : response.status === 422 ? '기존 요청 키와 서버의 목표가 충돌합니다. 새 세션을 만들지 말고 서버 상태를 확인해 주세요.'
          : response.status >= 500 ? '서버 오류가 발생했습니다. 같은 요청으로 재시도해 주세요.'
          : '세션 생성 요청이 거절되었습니다. 서버 연결 설정을 확인해 주세요.';
        throw new ApiError('http', message, response.status);
      }
      if (response.status !== 201) throw new ApiError('response', '세션 생성 응답이 올바르지 않습니다. 같은 요청으로 재시도해 주세요.');
      try { return await response.json() as unknown; }
      catch { throw new ApiError('response', '서버 응답을 읽을 수 없습니다. 같은 요청으로 재시도해 주세요.'); }
    })()]);
  } catch (error) {
    if (error instanceof AccessError && error.kind !== 'network') throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError('network', '서버에 연결할 수 없습니다. 연결을 확인한 뒤 같은 요청으로 재시도해 주세요.');
  } finally { clearTimeout(timer!); }
}
