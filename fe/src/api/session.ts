import { ApiError, postJson } from './client';
import type { CreateWorkSessionRequest, WorkSessionResponse } from './types';
import { normalizeGoal, validGoal } from '../shared/goal';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validTime(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function isWorkSession(value: unknown, version: '1.0' | '2.0' = '1.0'): value is WorkSessionResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return ((v.collectionSpecVersion ?? '1.0') === version) && typeof v.sessionId === 'string' && UUID.test(v.sessionId)
    && typeof v.goalText === 'string' && validGoal(v.goalText) && normalizeGoal(v.goalText) === v.goalText
    && validTime(v.startedAt) && (v.status === 'ACTIVE' ? v.endedAt === null : v.status === 'ENDED' && validTime(v.endedAt));
}
export async function createSession(request: CreateWorkSessionRequest, key: string): Promise<WorkSessionResponse> {
  const value = await postJson('/api/sessions', request, key);
  if (!isWorkSession(value) || value.goalText !== request.goalText) {
    throw new ApiError('response', '세션 정보가 올바르지 않습니다. 같은 요청으로 재시도해 주세요.');
  }
  return value;
}
