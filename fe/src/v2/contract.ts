import { isWorkSession } from '../api/session';
import { validTime } from '../api/visit';
import { normalizeUrl, validSearchQuery } from '../shared/url';
import { isContentMessage } from '../shared/messages';
import { validBehavior } from '../api/behavior';
import { cleanText } from '../content/extraction';
import type { WorkSessionResponse } from '../api/types';
import type { PageSnapshot, PageVisit } from '../shared/types';

export type V2Session = WorkSessionResponse & { collectionSpecVersion: '2.0' };
export const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function isV2Session(value: unknown): value is V2Session {
  if (!value || typeof value !== 'object') return false;
  const v = value as V2Session;
  return v.collectionSpecVersion === '2.0' && UUID4.test(v.sessionId)
    && isWorkSession({ ...v, collectionSpecVersion: '1.0' });
}
export function validSnapshot(s: PageSnapshot, sessionId: string): boolean {
  return isContentMessage({ type: 'snapshot', sessionId, snapshot: s })
    && cleanText(s.title) === s.title && cleanText(s.content) === s.content
    && (s.isSearchResultPage ? typeof s.searchQuery === 'string' && s.searchQuery.trim() === s.searchQuery
      : s.searchQuery === null && [...s.content].length >= 50);
}
export function validPost(v: PageVisit): boolean {
  const keys = ['sessionId', 'visitId', 'sequence', 'browserTabKey', 'normalizedUrl', 'domain', 'title', 'content', 'searchQuery', 'isSearchResultPage', 'visitedAt', 'activeDurationMs', 'tabSwitchCount', 'behaviorVersion', 'extractionStatus'];
  return !!v && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k))
    && UUID4.test(v.visitId) && UUID4.test(v.sessionId) && typeof v.browserTabKey === 'string'
    && v.browserTabKey.length > 0 && [...v.browserTabKey].length <= 100 && validBehavior(v)
    && v.extractionStatus === 'SUCCESS' && Number.isInteger(v.sequence) && v.sequence > 0 && v.sequence <= 2147483647
    && v.activeDurationMs >= 5000 && validTime(v.visitedAt)
    && typeof v.normalizedUrl === 'string' && v.normalizedUrl.length <= 8192 && normalizeUrl(v.normalizedUrl) === v.normalizedUrl
    && v.domain === new URL(v.normalizedUrl).hostname && v.domain.length <= 253
    && typeof v.title === 'string' && [...v.title].length <= 500
    && typeof v.content === 'string' && [...v.content].length <= 5000 && typeof v.isSearchResultPage === 'boolean'
    && (v.isSearchResultPage ? [...v.content].length >= 1 && validSearchQuery(v.searchQuery) : [...v.content].length >= 50 && v.searchQuery === null);
}
