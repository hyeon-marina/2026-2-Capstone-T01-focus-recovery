import { API_BASE_URL } from '../api/client';
import { UUID4 } from './contract';
import { validTime } from '../api/visit';
export interface NotificationReceipt {
  alertId: string; shownAt: string; shownAck: boolean;
  selection?: { action: 'RETURN_TO_GOAL' | 'CONTINUE_BROWSING'; selectedAt: string };
  selectionAck?: boolean;
}
export function validNotification(r: NotificationReceipt) {
  return UUID4.test(r.alertId) && validTime(r.shownAt) && typeof r.shownAck === 'boolean'
    && (!r.selection || ['RETURN_TO_GOAL', 'CONTINUE_BROWSING'].includes(r.selection.action) && validTime(r.selection.selectedAt)
      && r.selection.selectedAt >= r.shownAt) && (r.selectionAck === undefined || r.selectionAck === true && !!r.selection);
}
export async function sendNotification(sessionId: string, receipt: NotificationReceipt): Promise<'shown' | 'selection'> {
  const selected = receipt.selection;
  const r = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/alerts/${receipt.alertId}/${selected ? 'responses' : 'shown'}`, {
    method: selected ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(selected ? { ...selected, shownAt: receipt.shownAt } : { shownAt: receipt.shownAt }),
    signal: AbortSignal.timeout(10000), credentials: 'omit', redirect: 'error', cache: 'no-store',
  });
  if (!r.ok) {
    let code: unknown; try { code = (await r.json()).code; } catch { /* No server text retained. */ }
    throw new Error(code === 'PRIVACY_RETRACTED' ? 'PRIVACY_RETRACTED' : 'V2_NOTIFICATION_UNCONFIRMED');
  }
  const ack = await r.json();
  if (ack.alertId !== receipt.alertId || (selected ? ack.action !== selected.action || ack.selectedAt !== selected.selectedAt || !UUID4.test(ack.feedbackId)
    : ack.shownAt !== receipt.shownAt)) throw new Error('V2_NOTIFICATION_ACK_MISMATCH');
  return selected ? 'selection' : 'shown';
}
