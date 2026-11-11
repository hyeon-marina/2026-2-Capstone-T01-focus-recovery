import { metadataPath, validMetadataTitle, METADATA_CONTENT, OMITTED_QUERY } from './metadata';
import type { ContentMessage, PopupMessage } from './types';
import { inspectUrl, normalizeUrl, validSearchQuery } from './url';
import { normalizeGoal } from './goal';
const reasons = new Set(['url-policy', 'dom-policy', 'search-pending', 'short-content', 'short-duration', 'unavailable-content']);
export function isContentMessage(value: unknown): value is ContentMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.type === 'context') return true;
  if (typeof v.sessionId !== 'string' || v.sessionId.length > 100) return false;
  if (v.type === 'leave') return true;
  if (v.type !== 'snapshot' || (v.reason !== undefined && !reasons.has(v.reason as string))) return false;
  if (v.snapshot === null) return true;
  if (!v.snapshot || typeof v.snapshot !== 'object') return false;
  const s = v.snapshot as Record<string, unknown>;
  if (Object.keys(s).some(key => !['normalizedUrl', 'domain', 'identity', 'title', 'content', 'isSearchResultPage', 'searchQuery', 'organicResultCount'].includes(key))) return false;
  if (!(typeof s.normalizedUrl === 'string' && s.normalizedUrl.length <= 8192 && typeof s.domain === 'string' && s.domain.length <= 253 && typeof s.identity === 'string' && /^[a-f0-9]{64}$/.test(s.identity) && typeof s.title === 'string' && [...s.title].length <= 500 && typeof s.content === 'string' && [...s.content].length <= 5000 && typeof s.isSearchResultPage === 'boolean')) return false;
  const url = inspectUrl(s.normalizedUrl);
  if (!url || normalizeUrl(s.normalizedUrl) !== s.normalizedUrl || url.url.hostname !== s.domain || url.isSearchResultPage !== s.isSearchResultPage) return false;
  if (metadataPath(url.url.pathname)) return validMetadataTitle(s.title as string) && s.content === METADATA_CONTENT && s.searchQuery === (s.isSearchResultPage ? OMITTED_QUERY : null) && s.organicResultCount === undefined;
  if (!s.isSearchResultPage) return s.searchQuery == null && s.organicResultCount === undefined;
  return validSearchQuery(s.searchQuery) && Number.isSafeInteger(s.organicResultCount) && (s.organicResultCount as number) > 0 && (s.organicResultCount as number) <= 100 && s.content.trim().length > 0;
}
export function isPopupMessage(value: unknown): value is PopupMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return ['status', 'stop', 'clear', 'sync-permissions', 'retry-visits', 'retry-behaviors', 'end-session', 'retry-end'].includes(v.type as string) || (v.type === 'start' && typeof v.goalText === 'string' && normalizeGoal(v.goalText).length <= 150);
}
