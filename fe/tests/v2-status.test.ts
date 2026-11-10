import { expect, it } from 'vitest';
import { activeState, session } from './v2-fixture';
import { displayableAlert, V2StatusClient, type V2Status } from '../src/v2/status';
const windowId = '30000000-0000-4000-8000-000000000001', analysisId = '40000000-0000-4000-8000-000000000001';
function status(): V2Status {
  return { apiContractVersion: 2, sessionId: session.sessionId, sessionStatus: 'ACTIVE', lastSuccessfulState: null,
    currentDecision: { windowId, windowIndex: 1, stateVersion: 1, analysisId, decisionStatus: 'COMPLETED', finalState: 'DRIFT', judgedAt: session.startedAt, errorCode: null },
    alert: { alertId: '50000000-0000-4000-8000-000000000001', sessionId: session.sessionId, alertType: 'AI', analysisId,
      windowId, stateVersion: 1, createdAt: session.startedAt, shownAt: null, goalText: session.goalText, message: 'Synthetic reminder' } };
}
it('accepts only the BE latest matching DRIFT candidate', () => {
  const s = status(); expect(displayableAlert(s, activeState())).toEqual(s.alert);
  s.alert!.stateVersion = 2; expect(displayableAlert(s, activeState())).toBeNull();
  s.alert!.stateVersion = 1; s.currentDecision!.finalState = 'NORMAL'; expect(displayableAlert(s, activeState())).toBeNull();
});
it.each(['PENDING', 'FAILED', 'INVALIDATED'] as const)('never substitutes lastSuccessfulState for %s', state => {
  const s = status(); s.lastSuccessfulState = structuredClone(s.currentDecision);
  Object.assign(s.currentDecision!, { decisionStatus: state, finalState: null, judgedAt: null, stateVersion: null, errorCode: state === 'PENDING' ? null : 'PRIVACY_RETRACTED' });
  expect(displayableAlert(s, activeState())).toBeNull();
});
it('blocks after END intent and quarantine; preserves fixed interval eligibility', () => {
  const s = status(), local = activeState(); local.lifecycle = 'END_PENDING' as 'ACTIVE';
  expect(displayableAlert(s, local)).toBeNull(); local.lifecycle = 'ACTIVE';
  local.quarantine = { observedAt: session.startedAt, reason: 'SENSITIVE_CONTENT', status: 'RETRACTION_REQUIRED', visitIds: [] };
  expect(displayableAlert(s, local)).toBeNull(); delete local.quarantine;
  Object.assign(s.alert!, { alertType: 'FIXED_INTERVAL', analysisId: null, windowId: null, stateVersion: null });
  s.currentDecision = null; expect(displayableAlert(s, local)).toEqual(s.alert);
});
it('discards out-of-order HTTP and old window versions', async () => {
  let first!: (s: V2Status) => void, calls = 0;
  const client = new V2StatusClient(activeState, () => ++calls === 1 ? new Promise(r => { first = r; }) : Promise.resolve(status()));
  const pending = client.candidate(); expect(await client.candidate()).not.toBeNull(); first(status()); expect(await pending).toBeNull();
});
