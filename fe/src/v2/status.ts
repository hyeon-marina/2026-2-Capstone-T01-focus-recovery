import { authenticatedFetch } from '../api/auth-fetch';
import { API_BASE_URL } from '../api/client';
import { validTime } from '../api/visit';
import { UUID4 } from './contract';
import type { V2State } from './state';

export interface Decision {
  windowId: string; windowIndex: number; stateVersion: number | null; analysisId: string | null;
  decisionStatus: 'PENDING' | 'COMPLETED' | 'FAILED' | 'INVALIDATED';
  finalState: 'NORMAL' | 'TRANSITION' | 'DRIFT' | null; judgedAt: string | null; errorCode: string | null;
}
export interface V2Alert {
  alertId: string; sessionId: string; alertType: 'AI' | 'FIXED_INTERVAL'; analysisId: string | null;
  windowId: string | null; stateVersion: number | null; createdAt: string; shownAt: null;
  goalText: string; message: string;
}
export interface V2Status {
  apiContractVersion: 2; sessionId: string; sessionStatus: 'ACTIVE' | 'ENDED';
  currentDecision: Decision | null; lastSuccessfulState: Decision | null; alert: V2Alert | null;
}
function decision(d: Decision | null): boolean {
  return d === null || !!d && UUID4.test(d.windowId) && Number.isInteger(d.windowIndex) && d.windowIndex > 0
    && (d.analysisId === null || UUID4.test(d.analysisId))
    && (d.decisionStatus === 'COMPLETED'
      ? Number.isSafeInteger(d.stateVersion) && d.stateVersion! > 0 && UUID4.test(d.analysisId!)
        && ['NORMAL', 'TRANSITION', 'DRIFT'].includes(d.finalState!) && validTime(d.judgedAt) && d.errorCode === null
      : ['PENDING', 'FAILED', 'INVALIDATED'].includes(d.decisionStatus) && d.stateVersion === null && d.finalState === null
        && d.judgedAt === null && (d.decisionStatus === 'PENDING' ? d.errorCode === null : typeof d.errorCode === 'string' && /^[A-Z_]{1,100}$/.test(d.errorCode)));
}
export function displayableAlert(value: unknown, local: V2State & { alertsSuppressed?: boolean }): V2Alert | null {
  if (!value || typeof value !== 'object' || local.lifecycle !== 'ACTIVE' || local.quarantine || local.alertsSuppressed) return null;
  const s = value as V2Status, a = s.alert, d = s.currentDecision;
  if (s.apiContractVersion !== 2 || s.sessionId !== local.session?.sessionId || s.sessionStatus !== 'ACTIVE'
    || !decision(d) || !decision(s.lastSuccessfulState) || !a || !UUID4.test(a.alertId)
    || a.sessionId !== s.sessionId || a.goalText !== local.session.goalText || typeof a.message !== 'string'
    || !validTime(a.createdAt) || a.shownAt !== null || local.notifications.some(r => r.alertId === a.alertId)) return null;
  if (a.alertType === 'FIXED_INTERVAL') return a.analysisId === null && a.windowId === null && a.stateVersion === null ? a : null;
  return a.alertType === 'AI' && d?.decisionStatus === 'COMPLETED' && d.finalState === 'DRIFT'
    && a.windowId === d.windowId && a.stateVersion === d.stateVersion && a.analysisId === d.analysisId ? a : null;
}
export class V2StatusClient {
  private request = 0;
  private windowIndex = 0;
  private version = 0;
  constructor(private state: () => V2State, private read = async (sessionId: string): Promise<unknown> => {
    const r = await authenticatedFetch(`${API_BASE_URL}/api/sessions/${sessionId}/analysis-status`, { credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (!r.ok) throw new Error('V2_STATUS_UNAVAILABLE');
    return r.json();
  }) {}
  async candidate() {
    const id = ++this.request, sessionId = this.state().session?.sessionId;
    if ((this.state() as V2State & { alertsSuppressed?: boolean }).alertsSuppressed || !sessionId || this.state().lifecycle !== 'ACTIVE' || this.state().quarantine) return null;
    const status = await this.read(sessionId) as V2Status;
    if (id !== this.request || this.state().session?.sessionId !== sessionId) return null;
    const d = status.currentDecision;
    if (!decision(d) || d && (d.windowIndex < this.windowIndex || d.windowIndex === this.windowIndex && d.stateVersion !== null && d.stateVersion < this.version)) return null;
    if (d && d.windowIndex > this.windowIndex) { this.windowIndex = d.windowIndex; this.version = 0; }
    if (d?.stateVersion) this.version = Math.max(this.version, d.stateVersion);
    return displayableAlert(status, this.state());
  }
}
