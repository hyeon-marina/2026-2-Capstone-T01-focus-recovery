import { AccessError, authenticatedFetch } from '../api/auth-fetch';
import { API_BASE_URL } from '../api/client';
import { UUID4 } from './contract';
import { validTime } from '../api/visit';
import type { AlertMode } from './state';
export interface NotificationReceipt {
  alertId: string; shownAt: string; shownAck: boolean;
  alertType?: AlertMode;
  selection?: { action: 'RETURN_TO_GOAL' | 'CONTINUE_BROWSING'; selectedAt: string };
  selectionAck?: boolean;
}
export function notificationPending(receipt: NotificationReceipt) {
  return !receipt.shownAck || !!receipt.selection && !receipt.selectionAck;
}
export function validNotification(r: NotificationReceipt) {
  return !!r && typeof r.alertId === 'string' && UUID4.test(r.alertId) && validTime(r.shownAt) && typeof r.shownAck === 'boolean'
    && (r.alertType === undefined || ['AI', 'FIXED_INTERVAL'].includes(r.alertType))
    && (!r.selection || ['RETURN_TO_GOAL', 'CONTINUE_BROWSING'].includes(r.selection.action) && validTime(r.selection.selectedAt)
      && r.selection.selectedAt >= r.shownAt) && (r.selectionAck === undefined || r.selectionAck === true && !!r.selection);
}
const knownCodes = new Set([
  'PRIVACY_RETRACTED', 'CONSENT_REQUIRED', 'COLLECTION_POLICY_BLOCKED', 'INVALID_REQUEST', 'ALERT_NOT_DISPLAYABLE',
  'ALERT_SHOWN_AT_CONFLICT', 'RESPONSE_ALREADY_RECORDED', 'ALERT_NOT_SHOWN', 'SESSION_NOT_FOUND', 'ALERT_NOT_FOUND',
  'V2_STORAGE_DISABLED', 'COLLECTION_VERSION_MISMATCH',
]);

export class NotificationError extends Error {
  constructor(readonly code: string, readonly status?: number, readonly retryAfter?: number) {
    super(code);
  }
}
async function notificationError(response: Response) {
  let code: unknown;
  try { code = (await response.json())?.code; } catch { /* Only known structured codes are retained. */ }
  const header = response.status === 429 ? response.headers.get('Retry-After') : null;
  const retryAfter = header && /^\d+$/.test(header) ? Date.now() + Number(header) * 1000 : header ? Date.parse(header) : NaN;
  return new NotificationError(typeof code === 'string' && knownCodes.has(code) ? code : 'V2_NOTIFICATION_UNCONFIRMED',
    response.status, Number.isFinite(retryAfter) ? retryAfter : undefined);
}

function validSelectionAck(ack: Record<string, unknown> | null | undefined, receipt: NotificationReceipt): ack is Record<string, unknown> & { feedbackId: string } {
  return !!receipt.selection && ack?.alertId === receipt.alertId && ack.action === receipt.selection.action
    && ack.selectedAt === receipt.selection.selectedAt && typeof ack.feedbackId === 'string' && UUID4.test(ack.feedbackId);
}

const alertPath = (sessionId: string) => `${API_BASE_URL}/api/sessions/${sessionId}/alerts`;
const ackMismatch = () => new NotificationError('V2_NOTIFICATION_ACK_MISMATCH');
const matchesAlertType = (value: unknown, receipt: NotificationReceipt) =>
  receipt.alertType === undefined || value === receipt.alertType;

export async function sendNotificationLeg(sessionId: string, receipt: NotificationReceipt, leg: 'shown' | 'selection',
  allowed?: () => boolean, strict = true): Promise<{ feedbackId?: string }> {
  const selected = leg === 'selection' ? receipt.selection : undefined;
  if (leg === 'selection' && !selected) throw new NotificationError('INVALID_REQUEST');
  const signal = AbortSignal.timeout(10000);
  const response = await authenticatedFetch(`${alertPath(sessionId)}/${receipt.alertId}/${selected ? 'responses' : 'shown'}`, {
    method: selected ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(selected ? { ...selected, shownAt: receipt.shownAt } : { shownAt: receipt.shownAt }), signal,
  }, allowed).catch(error => {
    if (error instanceof AccessError && error.kind === 'network' && signal.aborted) throw new NotificationError('REQUEST_TIMEOUT');
    throw error;
  });
  if (!response.ok) throw await notificationError(response);
  let ack;
  try { ack = await response.json(); }
  catch { throw signal.aborted ? new NotificationError('REQUEST_TIMEOUT') : ackMismatch(); }
  if (selected) {
    if (!validSelectionAck(ack, receipt)
      || strict && (ack.sessionId !== undefined && ack.sessionId !== sessionId
        || ack.shownAt !== undefined && ack.shownAt !== receipt.shownAt)) throw ackMismatch();
    return { feedbackId: ack.feedbackId };
  }
  if (ack?.alertId !== receipt.alertId || ack.shownAt !== receipt.shownAt || strict && ack.sessionId !== sessionId
    || !matchesAlertType(ack?.alertType, receipt)) throw ackMismatch();
  return {};
}

export async function sendNotification(sessionId: string, receipt: NotificationReceipt, allowed?: () => boolean): Promise<'shown' | 'selection'> {
  const leg = receipt.selection ? 'selection' : 'shown';
  await sendNotificationLeg(sessionId, receipt, leg, allowed, false);
  return leg;
}

export async function findNotificationHistory(sessionId: string, receipt: NotificationReceipt, allowed: () => boolean) {
  const size = 20, signal = AbortSignal.timeout(10000);
  for (let page = 0; page < 3; page++) {
    const response = await authenticatedFetch(`${alertPath(sessionId)}?page=${page}&size=${size}`, { signal }, allowed);
    if (!response.ok) throw await notificationError(response);
    let body;
    try { body = await response.json(); } catch { throw ackMismatch(); }
    if (body?.page !== page || body.size !== size || !Array.isArray(body.items) || body.items.length > size
      || typeof body.hasNext !== 'boolean') throw ackMismatch();
    const matches = body.items.filter((item: { alertId?: unknown }) => item?.alertId === receipt.alertId);
    if (matches.length > 1) throw ackMismatch();
    const item = matches[0];
    if (item) {
      if (item.sessionId !== sessionId || item.shownAt !== null && !validTime(item.shownAt)
        || !matchesAlertType(item.alertType, receipt)) throw ackMismatch();
      if (item.shownAt === null) return;
      if (item.shownAt !== receipt.shownAt) return { conflict: 'ALERT_SHOWN_AT_CONFLICT' } as const;
      if (item.response === null || !receipt.selection) return { shown: true } as const;
      if (validSelectionAck(item.response, receipt)) return { shown: true, feedbackId: item.response.feedbackId } as const;
      if (item.response?.alertId !== receipt.alertId || typeof item.response.feedbackId !== 'string'
        || !UUID4.test(item.response.feedbackId) || !['RETURN_TO_GOAL', 'CONTINUE_BROWSING'].includes(item.response.action) || !validTime(item.response.selectedAt)
        || item.response.selectedAt < item.shownAt) throw ackMismatch();
      return { shown: true, conflict: 'RESPONSE_ALREADY_RECORDED' } as const;
    }
    if (!body.hasNext) return;
  }
}
