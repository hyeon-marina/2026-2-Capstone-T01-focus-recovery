export interface CreateWorkSessionRequest { goalText: string }
export interface WorkSessionResponse {
  collectionSpecVersion?: '1.0' | '2.0';
  sessionId: string;
  goalText: string;
  startedAt: string;
  status: 'ACTIVE' | 'ENDED';
  endedAt: string | null;
}

export type CreatePageVisitRequest = Omit<import('../shared/types').PageVisit, 'sessionId'>;
export type PageVisitResponse = import('../shared/types').PageVisit & { updatedAt: string | null };

export type UpdateVisitBehaviorRequest = import('../shared/types').VisitBehavior;
export interface VisitBehaviorResponse extends UpdateVisitBehaviorRequest {
  visitId: string;
  updatedAt: string | null;
  applied: boolean;
}

export interface EndWorkSessionRequest {
  finalBehaviors?: (import('../shared/types').VisitBehavior & { visitId: string })[] | null;
}
