import type { PageSnapshot, PageVisit, VisitBehavior } from '../shared/types';
import type { VisitDelivery } from '../background/visit-delivery';
import type { BehaviorDelivery } from '../background/behavior-delivery';
import type { SessionEndCheckpoint } from '../background/session-end';
import type { V2Session } from './contract';

export interface Stamp { epoch: string; mono: number; wall: number }
export interface Candidate {
  id: string; tabId: number; tabKey: string; target: string; document: string; generation: string;
  visitedAt: string; left?: Stamp; returned: Stamp; cursor?: Stamp; remainder: number;
  behavior: VisitBehavior; snapshot?: PageSnapshot; post?: PageVisit;
  extractionFailureReason?: 'POLICY' | 'EXTRACTION_NO_CONTENT' | 'EXTRACTION_DOM_ERROR' | 'EXTRACTION_RENDER_TIMEOUT' | 'EXTRACTION_ACCESS_DENIED';
  closed: boolean; crossed: boolean; excluded?: 'EXTRACTION_FAILED' | 'POLICY' | 'SHORT_DURATION';
}
export interface V2State {
  format: 2; collectionSpecVersion: '2.0'; revision: number; nextSequence: number;
  lifecycle: 'IDLE' | 'START_PENDING' | 'ACTIVE' | 'END_PENDING' | 'ENDED';
  owner?: { participantId: string; consentId: string | null };
  withdrawal?: { requestId: string; phase: 'pending' | 'sending' | 'acknowledged'; attempts: number; ack?: import('./access').WithdrawalReceipt };
  start?: { plannedSessionId?: string; idempotencyKey: string; goalText: string; collectionSpecVersion: '2.0'; apiBaseUrl: string };
  session?: V2Session;
  foreground: number | null; lastTab: number | null; lastVisit?: string;
  candidates: Candidate[]; tabKeys: Record<number, string>; discardedCandidates: number; tabs: Record<number, string>;
  posts: VisitDelivery['checkpoint']; behaviors: BehaviorDelivery['checkpoint']; end?: SessionEndCheckpoint;
  notifications: import('./notifications').NotificationReceipt[];
  compactedThrough: number; compactedCount: number;
  retractions?: import('./retractions').RetractionEntry[];
  quarantineConfirmedFor?: string;
  quarantineClose?: { sessionId: string; phase: 'pending' | 'acknowledged' };
  quarantine?: { reason: 'SENSITIVE_CONTENT' | 'CONSENT_WITHDRAWN' | 'PRIVACY_RETRACTED'; observedAt: string; visitIds: string[]; status: 'RETRACTION_REQUIRED' };
}
export function initialState(apiBaseUrl: string): V2State {
  return { format: 2, collectionSpecVersion: '2.0', revision: 0, nextSequence: 1, lifecycle: 'IDLE',
    foreground: null, lastTab: null, candidates: [], tabs: {}, tabKeys: {}, discardedCandidates: 0, compactedThrough: 0, compactedCount: 0, notifications: [],
    posts: { apiBaseUrl, entries: [] }, behaviors: { apiBaseUrl, entries: [] } };
}
export interface CompactReceipt { visitId: string; sequence: number; originalHash: string; postAck: VisitBehavior; behaviorAck: VisitBehavior }
