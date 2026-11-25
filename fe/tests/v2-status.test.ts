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
it('checks the session before advancing freshness and accepts a new session at window 1', async () => {
  const local = activeState();
  let response = status();
  response.currentDecision!.windowIndex = 99;
  const client = new V2StatusClient(() => local, async () => response);
  expect(await client.candidate()).toEqual(response.alert);
  local.session!.sessionId = '10000000-0000-4000-8000-000000000099';
  await expect(client.candidate()).rejects.toThrow('V2_STATUS_INVALID');
  response = status();
  response.sessionId = local.session!.sessionId;
  response.alert!.sessionId = response.sessionId;
  expect(await client.candidate()).toEqual(response.alert);
});
it('continues from a durable cursor after restart and accepts only matching IDs and newer versions', async () => {
  const local = activeState();
  let response = status();
  response.currentDecision!.stateVersion = response.alert!.stateVersion = 3;
  const { cursor } = (await new V2StatusClient(() => local, async () => response).status())!;
  const restarted = new V2StatusClient(() => local, async () => response);
  response = status();
  expect(await restarted.status(cursor)).toBeNull();
  response.currentDecision!.stateVersion = response.alert!.stateVersion = 4;
  response.currentDecision!.windowId = response.alert!.windowId = crypto.randomUUID();
  expect(await restarted.status(cursor)).toBeNull();
  response.currentDecision!.windowId = response.alert!.windowId = windowId;
  response.alert!.windowIndex = 2;
  await expect(restarted.status(cursor)).rejects.toThrow('V2_STATUS_INVALID');
  response.alert!.windowIndex = 1;
  expect(await restarted.candidate()).toEqual(response.alert);
});
it('rejects a malformed candidate and an incorrect goal before either can advance the cursor', async () => {
  let response = status();
  const client = new V2StatusClient(activeState, async () => response);
  response.currentDecision!.windowIndex = 99;
  response.alert!.windowIndex = 98;
  await expect(client.status()).rejects.toThrow('V2_STATUS_INVALID');
  response.alert!.windowIndex = 99;
  response.alert!.goalText = 'Unrelated synthetic goal';
  await expect(client.status()).rejects.toThrow('V2_STATUS_INVALID');
  response = status();
  expect(await client.candidate()).toEqual(response.alert);
});
it('cannot replay a completed version after the same window becomes pending or invalidated', async () => {
  const completed = status();
  let response = completed;
  const client = new V2StatusClient(activeState, async () => response);
  expect(await client.candidate()).not.toBeNull();
  response = { ...completed, alert: null, lastSuccessfulState: completed.currentDecision,
    currentDecision: { ...completed.currentDecision!, decisionStatus: 'PENDING', stateVersion: null, finalState: null, judgedAt: null } };
  expect((await client.status())?.value.currentDecision?.decisionStatus).toBe('PENDING');
  response = completed;
  expect(await client.status()).toBeNull();
  response = { ...response, alert: null, lastSuccessfulState: null, currentDecision: {
    ...completed.currentDecision!, decisionStatus: 'INVALIDATED', analysisId: null,
    stateVersion: null, finalState: null, judgedAt: null, errorCode: 'PRIVACY_RETRACTED',
  } };
  expect((await client.status())?.value.currentDecision?.decisionStatus).toBe('INVALIDATED');
  response = completed;
  expect(await client.status()).toBeNull();
});
it('discards a response crossing an access epoch even after the same session returns', async () => {
  let resolve!: (value: V2Status) => void, epoch = 1;
  const client = new V2StatusClient(activeState, () => new Promise(r => { resolve = r; }), () => epoch);
  const pending = client.status();
  epoch++;
  resolve(status());
  expect(await pending).toBeNull();
});
