import { AccessError, accessGeneration, authenticatedFetch } from '../api/auth-fetch';
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
  windowId: string | null; windowIndex?: number | null; stateVersion: number | null; createdAt: string; shownAt: null;
  goalText: string; message: string;
}
export interface V2Status {
  apiContractVersion: 2; sessionId: string; sessionStatus: 'ACTIVE' | 'ENDED';
  currentDecision: Decision | null; lastSuccessfulState: Decision | null; alert: V2Alert | null;
}
export type DecisionCursor = {
  current: Decision;
  completed: Decision | null;
};

const uuid = (value: unknown) => typeof value === 'string' && UUID4.test(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const validWindowIndex = (value: unknown) => positive(value) && value <= 2147483647;
function validDecision(d: Decision): boolean {
  return !!d && typeof d === 'object' && uuid(d.windowId) && validWindowIndex(d.windowIndex)
    && (d.analysisId === null || uuid(d.analysisId))
    && (d.decisionStatus === 'COMPLETED'
      ? positive(d.stateVersion) && uuid(d.analysisId)
        && ['NORMAL', 'TRANSITION', 'DRIFT'].includes(d.finalState!) && validTime(d.judgedAt) && d.errorCode === null
      : ['PENDING', 'FAILED', 'INVALIDATED'].includes(d.decisionStatus) && d.stateVersion === null && d.finalState === null
        && d.judgedAt === null && (d.decisionStatus === 'PENDING' ? d.errorCode === null : typeof d.errorCode === 'string' && /^[A-Z_]{1,100}$/.test(d.errorCode)));
}
function sameDecision(a: Decision, b: Decision) {
  return a.windowId === b.windowId && a.windowIndex === b.windowIndex && a.stateVersion === b.stateVersion
    && a.analysisId === b.analysisId && a.finalState === b.finalState && a.judgedAt === b.judgedAt;
}
function decisionFields({ windowId, windowIndex, stateVersion, analysisId, decisionStatus, finalState, judgedAt, errorCode }: Decision): Decision {
  return { windowId, windowIndex, stateVersion, analysisId, decisionStatus, finalState, judgedAt, errorCode };
}
function validStatus(value: unknown, sessionId: string | undefined): value is V2Status {
  if (!value || typeof value !== 'object') return false;
  const s = value as V2Status, d = s.currentDecision, history = s.lastSuccessfulState, a = s.alert;
  return s.apiContractVersion === 2 && uuid(s.sessionId) && s.sessionId === sessionId
    && ['ACTIVE', 'ENDED'].includes(s.sessionStatus)
    && (d === null || validDecision(d))
    && (history === null || !!d && validDecision(history) && history.decisionStatus === 'COMPLETED'
      && (history.windowIndex < d.windowIndex && history.windowId !== d.windowId
        || history.windowIndex === d.windowIndex && history.windowId === d.windowId
        && (d.decisionStatus !== 'COMPLETED' || sameDecision(d, history))))
    && (a === null || !!a && s.sessionStatus === 'ACTIVE' && uuid(a.alertId) && a.sessionId === sessionId && typeof a.goalText === 'string'
      && typeof a.message === 'string' && validTime(a.createdAt) && a.shownAt === null
      && (a.alertType === 'AI' && uuid(a.windowId) && uuid(a.analysisId) && positive(a.stateVersion)
        && (a.windowIndex === undefined || validWindowIndex(a.windowIndex)) && matchesDecision(a, d)
        || a.alertType === 'FIXED_INTERVAL' && a.windowId === null && a.analysisId === null && a.stateVersion === null
        && (a.windowIndex === undefined || a.windowIndex === null)));
}
export function matchesDecision(a: Pick<V2Alert, 'windowId' | 'windowIndex' | 'stateVersion' | 'analysisId'>, d: Decision | null) {
  return d?.decisionStatus === 'COMPLETED' && d.finalState === 'DRIFT'
    && a.windowId === d.windowId && (a.windowIndex === undefined || a.windowIndex === d.windowIndex)
    && a.stateVersion === d.stateVersion && a.analysisId === d.analysisId;
}
type LocalState = V2State & { alertsSuppressed?: boolean };
export function displayableAlert(value: unknown, local: LocalState): V2Alert | null {
  if (!validStatus(value, local.session?.sessionId) || local.lifecycle !== 'ACTIVE' || local.quarantine || local.alertsSuppressed) return null;
  const a = value.alert;
  if (value.sessionStatus !== 'ACTIVE' || !a || a.goalText !== local.session?.goalText || local.notifications.some(r => r.alertId === a.alertId)) return null;
  return a.alertType === 'FIXED_INTERVAL' || matchesDecision(a, value.currentDecision) ? a : null;
}

export function validDecisionCursor(value: DecisionCursor) {
  return !!value && validDecision(value.current) && (value.completed === null || validDecision(value.completed)
    && value.completed.decisionStatus === 'COMPLETED' && value.completed.windowId === value.current.windowId
    && value.completed.windowIndex === value.current.windowIndex
    && (value.current.decisionStatus !== 'COMPLETED' || sameDecision(value.current, value.completed)))
    && (value.current.decisionStatus !== 'COMPLETED' || value.completed !== null);
}

function advance(status: V2Status, previous?: DecisionCursor): DecisionCursor | undefined | false {
  const d = status.currentDecision;
  if (!d) return previous ? false : undefined;
  const old = previous?.current;
  if (old && (d.windowIndex < old.windowIndex || (d.windowIndex === old.windowIndex) !== (d.windowId === old.windowId))) return false;
  const sameWindow = old?.windowId === d.windowId;
  if (sameWindow && (old.decisionStatus === 'INVALIDATED' && d.decisionStatus !== 'INVALIDATED'
    || old.analysisId !== null && d.analysisId !== old.analysisId
    && !(d.decisionStatus === 'INVALIDATED' && d.analysisId === null))) return false;

  const history = status.lastSuccessfulState;
  const completed = sameWindow ? previous?.completed : null;
  const next = d.decisionStatus === 'COMPLETED' ? d : history?.windowId === d.windowId ? history : null;
  if (completed && next) {
    if (next.stateVersion! < completed.stateVersion!
      || next.stateVersion === completed.stateVersion && !sameDecision(next, completed)) return false;
  }
  if (sameWindow && completed && d.decisionStatus === 'COMPLETED'
    && old.decisionStatus !== 'COMPLETED' && d.stateVersion === completed.stateVersion) return false;
  return { current: decisionFields(d), completed: next ? decisionFields(next) : completed ?? null };
}

export async function readV2Status(sessionId: string, allowed?: () => boolean): Promise<unknown> {
  const r = await authenticatedFetch(`${API_BASE_URL}/api/sessions/${sessionId}/analysis-status`, { signal: AbortSignal.timeout(10_000) }, allowed);
  if (r.status === 401) throw new AccessError('authentication', r.status);
  if (r.status === 403) throw new AccessError('consent', r.status);
  if (r.status === 409 && (await r.json().catch(() => null))?.code === 'PRIVACY_RETRACTED') throw new AccessError('consent', r.status);
  if (r.status >= 500) throw new AccessError('network', r.status);
  if (!r.ok) throw new Error('V2_STATUS_UNAVAILABLE');
  return r.json();
}
export class V2StatusClient {
  private request = 0;
  private latest?: { sessionId: string; cursor?: DecisionCursor };
  constructor(private state: () => LocalState, private read = readV2Status, private scope: () => unknown = accessGeneration) {}

  async status(persisted?: DecisionCursor) {
    const id = ++this.request;
    const { session, lifecycle, quarantine, alertsSuppressed } = this.state();
    const scope = this.scope();
    if (!session || lifecycle !== 'ACTIVE' || quarantine || alertsSuppressed) return null;
    const sessionId = session.sessionId;
    const value = await this.read(sessionId);
    const local = this.state();
    if (id !== this.request || scope !== this.scope() || local.session?.sessionId !== sessionId
      || local.lifecycle !== 'ACTIVE' || local.alertsSuppressed || local.quarantine) return null;
    if (!validStatus(value, sessionId) || value.alert && value.alert.goalText !== session.goalText) throw new Error('V2_STATUS_INVALID');
    if (value.sessionStatus === 'ENDED') return { value, cursor: undefined, alert: null };
    const cursor = advance(value, this.latest?.sessionId === sessionId ? this.latest.cursor ?? persisted : persisted);
    if (cursor === false) return null;
    this.latest = { sessionId, cursor };
    return { value, cursor, alert: displayableAlert(value, local) };
  }

  async candidate() {
    return (await this.status())?.alert ?? null;
  }
}
