import type { V2Session } from '../src/v2/contract';
import { initialState, type Stamp } from '../src/v2/state';
import { API_BASE_URL } from '../src/api/client';
import type { Observation } from '../src/v2/collector';
export const session: V2Session = { sessionId: '10000000-0000-4000-8000-000000000001', goalText: 'Synthetic TypeScript transaction research',
  startedAt: '2026-11-10T00:00:00.000Z', endedAt: null, status: 'ACTIVE', collectionSpecVersion: '2.0' };
export const time = (mono: number, epoch = 'worker-1', wall = Date.parse(session.startedAt) + mono): Stamp => ({ epoch, mono, wall });
export const snapshot = { normalizedUrl: 'https://example.org/a', domain: 'example.org', identity: 'a'.repeat(64), title: 'Synthetic example',
  content: 'Synthetic page describing durable transactions and TypeScript recovery for a public example.', isSearchResultPage: false, searchQuery: null };
export function observation(ms: number, overrides: Partial<Observation> = {}): Observation {
  return { tabId: 1, document: 'document-1', target: snapshot.identity, generation: 'content-1', stamp: time(ms), snapshot, permitted: true, safe: true, ...overrides };
}
export function activeState() {
  return { ...initialState(API_BASE_URL), lifecycle: 'ACTIVE' as const, session,
    start: { goalText: session.goalText, collectionSpecVersion: '2.0' as const, idempotencyKey: '20000000-0000-4000-8000-000000000001', apiBaseUrl: API_BASE_URL } };
}
