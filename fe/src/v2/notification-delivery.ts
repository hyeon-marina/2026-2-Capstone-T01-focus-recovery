import { AccessError } from '../api/auth-fetch';
import { MAX_DELIVERY_ATTEMPTS } from '../background/delivery-retry';
import { findNotificationHistory, NotificationError, sendNotificationLeg } from './notifications';
import {
  receiptDelivery, type NotificationStore, type OutboxReceipt, type ReceiptDelivery, type ReceiptLeg, type ReceiptScope,
} from './notification-store';

const BACKOFF_MS = [60_000, 120_000, 240_000];
const LEGS = ['selection', 'shown'] as const;
const HISTORY_CODES = ['V2_NOTIFICATION_ACK_MISMATCH', 'ALERT_SHOWN_AT_CONFLICT', 'RESPONSE_ALREADY_RECORDED'];

export function receiptFailure(error: unknown) {
  const status = error instanceof NotificationError || error instanceof AccessError ? error.status : undefined;
  const code = error instanceof NotificationError ? error.code : error instanceof AccessError && error.kind === 'network'
    ? 'NETWORK_UNCONFIRMED' : 'V2_NOTIFICATION_UNCONFIRMED';
  const phase = status === 409 && code === 'PRIVACY_RETRACTED' ? 'privacy-blocked'
    : status === 401 || status === 403 || ['CONSENT_REQUIRED', 'COLLECTION_POLICY_BLOCKED'].includes(code)
      || error instanceof AccessError && error.kind !== 'network' ? 'access-blocked'
    : status === 408 || status === 429 || status !== undefined && status >= 500
      || code === 'V2_NOTIFICATION_ACK_MISMATCH' || ['NETWORK_UNCONFIRMED', 'REQUEST_TIMEOUT'].includes(code) ? 'retry-wait' : 'rejected';
  return { phase, code, ...(status === undefined ? {} : { status }) } satisfies Omit<ReceiptDelivery, 'attempts'>;
}

export function receiptDue(delivery: ReceiptDelivery | undefined, now: number, manual: boolean, restoreAccess: boolean) {
  return !!delivery && (delivery.phase === 'pending'
    || delivery.phase === 'access-blocked' && restoreAccess
    || delivery.phase === 'exhausted' && manual
    || ['retry-wait', 'sending'].includes(delivery.phase) && delivery.nextRetryAt! <= now);
}

export function notificationScopeBlocked(entries: OutboxReceipt[]) {
  return entries.some(entry => LEGS.some(leg => {
    const delivery = receiptDelivery(entry, leg);
    return delivery?.phase === 'access-blocked' && (delivery.status === 401
      || delivery.code === 'CONSENT_REQUIRED' || delivery.code === 'COLLECTION_POLICY_BLOCKED');
  }));
}

export class NotificationDelivery {
  private flight?: Promise<void>;
  private queued = false;
  private manual = false;
  private restoreAccess = false;

  constructor(private store: NotificationStore, private access: (options: {
    manual: boolean; restoreAccess: boolean;
  }) => Promise<{ scope: ReceiptScope; allowed: (sessionId?: string) => boolean } | undefined>,
  private changed: (entry: OutboxReceipt) => void,
  private blocked: (entry: OutboxReceipt, state: ReceiptDelivery) => Promise<void>) {}

  wake(restoreAccess = false, manual = false) {
    this.queued = true;
    this.restoreAccess ||= restoreAccess;
    this.manual ||= manual;
    this.flight ??= this.drain().finally(() => {
      this.flight = undefined;
      if (this.queued) void this.wake().catch(() => {});
    });
    return this.flight;
  }

  private async drain() {
    while (this.queued) {
      this.queued = false;
      const { manual, restoreAccess } = this;
      this.manual = this.restoreAccess = false;
      const access = await this.access({ manual, restoreAccess });
      if (!access) continue;
      const entries = await this.store.list(access.scope);
      if (!restoreAccess && notificationScopeBlocked(entries)) continue;
      entries.sort((a, b) => a.shownAt.localeCompare(b.shownAt) || a.sessionId.localeCompare(b.sessionId)
        || a.alertId.localeCompare(b.alertId));
      batch: for (const entry of entries) {
        if (!access.allowed()) break;
        const allowed = () => access.allowed(entry.sessionId);
        for (const leg of LEGS) {
          if (!allowed() || !receiptDue(receiptDelivery(entry, leg), Date.now(), manual, restoreAccess)) continue;
          const result = await this.deliver(entry, leg, allowed, manual, restoreAccess);
          if (result === 'access-blocked') break batch;
          if (result === 'privacy-blocked') break;
        }
      }
    }
  }

  private async deliver(entry: OutboxReceipt, leg: ReceiptLeg, allowed: () => boolean, manual: boolean, restoreAccess: boolean) {
    const save = async (update: (fresh: OutboxReceipt, delivery: ReceiptDelivery) => ReceiptDelivery | undefined, block = false) => {
      const saved = await this.store.write(entry, entry.alertId, allowed, fresh => {
        const delivery = fresh && receiptDelivery(fresh, leg);
        if (!fresh || !delivery || delivery.phase === 'acknowledged') return;
        const next = update(fresh, delivery);
        if (!next) return;
        if (leg === 'shown') fresh.shownDelivery = next;
        else fresh.selectionDelivery = next;
        return fresh;
      }, block);
      if (saved) this.changed(saved);
      return saved;
    };
    const now = Date.now();
    const started = await save((_, delivery) => {
      if (!receiptDue(delivery, now, manual, restoreAccess)) return;
      const attempts = delivery.phase === 'exhausted' ? 0 : delivery.attempts;
      if (attempts >= MAX_DELIVERY_ATTEMPTS) return { phase: 'sending', attempts, nextRetryAt: now + BACKOFF_MS.at(-1)! };
      return { phase: 'sending', attempts: attempts + 1, nextRetryAt: now + BACKOFF_MS[attempts] };
    });
    if (!started || !allowed()) return;
    const original = receiptDelivery(started, leg)!;
    const previous = receiptDelivery(entry, leg)!;
    const manualCycle = previous.phase === 'exhausted';
    const reconcileOnly = !manualCycle && previous.attempts === MAX_DELIVERY_ATTEMPTS;
    let attemptedWrite = false;
    let shown = false, feedbackId: string | undefined;
    let failure: ReturnType<typeof receiptFailure> | undefined;
    let retryAfter: number | undefined;
    const reconcile = async () => {
      const evidence = await findNotificationHistory(started.sessionId, started, allowed);
      if (evidence && 'shown' in evidence) shown = true;
      if (evidence && 'feedbackId' in evidence) feedbackId = evidence.feedbackId;
      if (evidence && 'conflict' in evidence && evidence.conflict) failure = { phase: 'rejected', code: evidence.conflict };
    };
    try {
      if (reconcileOnly || manualCycle) {
        try { await reconcile(); }
        catch (error) {
          const result = receiptFailure(error);
          if (result.phase === 'access-blocked' || result.phase === 'privacy-blocked') failure = result;
        }
      }
      if (allowed() && !reconcileOnly && !(leg === 'selection' ? feedbackId : shown) && !failure) {
        attemptedWrite = true;
        ({ feedbackId } = await sendNotificationLeg(started.sessionId, started, leg, allowed));
        // The exact POST also confirms shownAt under AlertDisplayService's transaction.
        shown = true;
      }
    } catch (error) {
      failure = receiptFailure(error);
      if (error instanceof NotificationError) retryAfter = error.retryAfter;
      if (allowed() && (HISTORY_CODES.includes(failure.code)
        || failure.phase === 'retry-wait' && original.attempts === MAX_DELIVERY_ATTEMPTS)) {
        try { await reconcile(); }
        catch (historyError) {
          const historyFailure = receiptFailure(historyError);
          if (['access-blocked', 'privacy-blocked'].includes(historyFailure.phase)) failure = historyFailure;
        }
      }
    }
    if (!allowed()) return;
    const confirmed = leg === 'selection' ? !!feedbackId : shown;
    const attempts = attemptedWrite && failure?.phase !== 'access-blocked' ? original.attempts : previous.attempts;
    const state: ReceiptDelivery = confirmed ? { phase: 'acknowledged', attempts }
      : { ...failure, phase: failure?.phase ?? 'retry-wait', attempts };
    if (state.phase === 'retry-wait') {
      if (state.attempts === MAX_DELIVERY_ATTEMPTS) state.phase = 'exhausted';
      else state.nextRetryAt = Math.max(Date.now() + BACKOFF_MS[state.attempts - 1], retryAfter ?? 0);
    }
    const saved = await save((fresh, delivery) => {
      if (delivery.phase !== 'sending' || delivery.attempts !== original.attempts || delivery.nextRetryAt !== original.nextRetryAt) return;
      if (shown && (leg === 'selection' || confirmed)) {
        fresh.shownAck = true;
        fresh.shownDelivery = { phase: 'acknowledged', attempts: fresh.shownDelivery.attempts };
      }
      if (feedbackId && leg === 'selection') { fresh.selectionAck = true; fresh.feedbackId = feedbackId; }
      return state;
    }, state.phase === 'privacy-blocked');
    if (saved && allowed() && (state.phase === 'access-blocked' || state.phase === 'privacy-blocked')) await this.blocked(saved, state);
    return state.phase;
  }
}
