import { API_BASE_URL } from '../api/client';
import { endSession, getSession, matchesEndedSession, matchesSession, SessionEndError } from '../api/session-end';
import { MAX_DELIVERY_ATTEMPTS, stopExhaustedDelivery } from './delivery-retry';
import type { EndWorkSessionRequest, WorkSessionResponse } from '../api/types';

export interface SessionEndCheckpoint {
  apiBaseUrl: string;
  session: WorkSessionResponse;
  requestedAt: string;
  phase: 'draining' | 'queued' | 'sending' | 'retry-wait' | 'failed' | 'acked';
  request?: EndWorkSessionRequest;
  attempts: number;
  nextRetryAt?: number;
  retryable?: boolean;
  error?: string;
  code?: string;
  lastServer?: WorkSessionResponse;
  ack?: WorkSessionResponse;
}
export class SessionEndDelivery {
  checkpoint?: SessionEndCheckpoint;
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private mutate: <T>(operation: () => T) => Promise<T>, private canSend: () => boolean,
    private drained: () => boolean, private serverEndedConflict: () => boolean,
    private send = endSession, private query = getSession, private queryBeforeRetry = false) {}
  begin(session: WorkSessionResponse, now: number) {
    if (this.checkpoint) return;
    this.checkpoint = { apiBaseUrl: API_BASE_URL, session: structuredClone(session), requestedAt: new Date(now).toISOString(), phase: 'draining', attempts: 0 };
  }
  restore(value?: SessionEndCheckpoint) {
    this.checkpoint = structuredClone(value);
    if (this.checkpoint?.phase === 'sending') {
      this.checkpoint.phase = 'retry-wait';
      this.checkpoint.retryable = true;
      this.checkpoint.nextRetryAt ??= 0;
    }
  }
  clear() { clearTimeout(this.timer); this.checkpoint = undefined; }
  retry() {
    const e = this.checkpoint;
    if (e?.phase === 'failed' && e.retryable) { e.phase = e.request ? 'queued' : 'draining'; e.attempts = 0; delete e.nextRetryAt; }
  }
  kick() {
    const e = this.checkpoint;
    if (!this.running && this.canSend() && e && ['draining', 'queued', 'retry-wait'].includes(e.phase)
      && (this.drained() || this.serverEndedConflict())) void this.pump();
  }
  private async pump() {
    this.running = true; clearTimeout(this.timer);
    try {
      const e = await this.mutate(() => {
        const e = this.checkpoint;
        if (!this.canSend() || !e || !['draining', 'queued', 'retry-wait'].includes(e.phase)
          || !this.drained() && !this.serverEndedConflict()) return;
        if (stopExhaustedDelivery(e)) return;
        if (e.nextRetryAt !== undefined && e.nextRetryAt > Date.now()) {
          return;
        }
        // All final ACKs must already be in the aggregate before freezing the END DTO.
        if (this.drained()) e.request ??= {};
        e.phase = 'sending'; e.attempts++;
        return e;
      });
      if (!e || e !== this.checkpoint || !this.canSend()) return;
      let response: WorkSessionResponse | undefined, failure: SessionEndError | undefined;
      try {
        // A SESSION_ENDED data rejection is evidence of a conflict, never a data ACK.
        if (!e.request || this.queryBeforeRetry && e.attempts > 1) {
          response = await this.query(e.session);
          if (!matchesSession(response, e.session)) throw new SessionEndError('response', '서버 세션 정보가 일치하지 않습니다.', false);
        }
        if (e.request && response?.status !== 'ENDED') response = await this.send(e.session, structuredClone(e.request));
        if (!matchesSession(response, e.session) || e.request && !matchesEndedSession(response, e.session)) {
          throw new SessionEndError('response', '서버 종료 응답 확인이 필요합니다.', false);
        }
      } catch (error) { failure = error instanceof SessionEndError ? error : new SessionEndError('network', '서버 종료 확인에 실패했습니다.', true); }
      await this.mutate(() => {
        if (e !== this.checkpoint) return;
        if (response) e.lastServer = structuredClone(response);
        if (!failure && response && this.drained() && matchesEndedSession(response, e.session)) {
          e.ack = structuredClone(response); e.phase = 'acked'; delete e.error; delete e.code; delete e.retryable; delete e.nextRetryAt;
        } else {
          failure ??= new SessionEndError('response', '서버 상태와 미확인 방문·행동 정보가 일치하지 않습니다. 원본을 보존하고 수동 확인이 필요합니다.', false, undefined,
            response?.status === 'ENDED' ? 'SERVER_ENDED_UNCONFIRMED' : 'SERVER_STATE_CONFLICT');
          e.error = failure.message; e.code = failure.code; e.retryable = failure.retryable;
          e.phase = failure.retryable && e.attempts < MAX_DELIVERY_ATTEMPTS ? 'retry-wait' : 'failed';
          if (e.phase === 'retry-wait') e.nextRetryAt = Date.now() + 1000 * e.attempts;
          else {
            delete e.nextRetryAt;
            if (failure.retryable && stopExhaustedDelivery(e)) e.error = `${failure.message} ${e.error}`;
          }
        }
      });
    } catch { /* The aggregate owner blocks all delivery on a storage failure. */ }
    finally {
      this.running = false;
      const e = this.checkpoint;
      if (e?.phase === 'retry-wait') this.timer = setTimeout(() => this.kick(), Math.max(0, (e.nextRetryAt ?? 0) - Date.now()));
      else this.kick();
    }
  }
}
