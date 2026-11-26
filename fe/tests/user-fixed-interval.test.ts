import { describe, expect, it, vi } from 'vitest';
import { fixedCandidate, fixedSlot, readFixedCandidate, requestFixedCandidate } from '../user/fixed-interval';
import { FIXED_INTERVAL_MS, syntheticAlertMode } from '../user/mock-config';
import { session } from './v2-fixture';

const alert = {
  alertId: '10000000-0000-4000-8000-000000000002', sessionId: session.sessionId, alertType: 'FIXED_INTERVAL',
  analysisId: null, windowIndex: null, shownAt: null, goalText: session.goalText,
  createdAt: '2026-11-10T00:11:05.200Z', message: 'Check your goal.',
};
describe('fixed interval POST boundary', () => {
  it('starts at ten minutes and selects only the latest elapsed slot', () => {
    const start = Date.parse(session.startedAt);
    expect([-1, 0, FIXED_INTERVAL_MS - 1, FIXED_INTERVAL_MS, 4 * FIXED_INTERVAL_MS + 23_000]
      .map(ms => fixedSlot(session.startedAt, start + ms))).toEqual([0, 0, 0, 1, 4]);
  });
  it('accepts AlertResponse including nullable fields without assigning a slot from createdAt', () => {
    expect(fixedCandidate(alert, session)).toBe(alert.alertId);
  });
  it.each([
    { windowId: null }, { stateVersion: null }, { windowIndex: undefined }, { analysisId: undefined },
    { goalText: 'Wrong goal' }, { sessionId: alert.alertId }, { shownAt: alert.createdAt },
    { alertType: 'AI' }, { alertId: 'invalid' }, { createdAt: 'not-a-date' },
  ])('rejects a mismatched POST payload with %j', change => {
    expect(fixedCandidate({ ...alert, ...change }, session)).toBeUndefined();
  });
  it.each([
    ['ALERT_INTERVAL_NOT_REACHED', 'skipped'], ['FIXED_INTERVAL_DISABLED', 'disabled'], ['SESSION_ENDED', 'ended'],
  ])('interprets the existing %s response', async (code, kind) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code }, { status: 409 }));
    try {
      await expect(requestFixedCandidate(session, () => true)).resolves.toEqual({ kind });
      expect(fetchMock.mock.calls[0][0]).toMatch(/\/alerts\/fixed-interval$/);
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    } finally { fetchMock.mockRestore(); }
  });
  it('rejects unknown synthetic assignments and defaults existing builds to AI', () => {
    expect(syntheticAlertMode()).toBe('AI');
    expect(syntheticAlertMode('FIXED_INTERVAL')).toBe('FIXED_INTERVAL');
    expect(() => syntheticAlertMode('unknown')).toThrow();
  });
  it.each(['CONSENT_REQUIRED', 'COLLECTION_POLICY_BLOCKED', 'PRIVACY_RETRACTED'])('blocks on %s', async code => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code }, { status: 409 }));
    try {
      await expect(requestFixedCandidate(session, () => true)).rejects.toMatchObject({ kind: 'consent', status: 409 });
    } finally { fetchMock.mockRestore(); }
  });
});

describe('fixed interval read-only verification', () => {
  const v2 = { ...alert, windowId: null, stateVersion: null };
  const status = { apiContractVersion: 2, sessionId: session.sessionId, sessionStatus: 'ACTIVE',
    currentDecision: { decisionStatus: 'FAILED' }, alert: v2 };
  it.each([
    [status, false, alert.alertId],
    [{ ...status, alert: null }, false, undefined],
    [{ ...status, alert }, false, undefined],
    [{ ...status, alert: { ...v2, goalText: 'another work goal' } }, false, undefined],
    [{ ...status, sessionStatus: 'ENDED', alert: null }, true, undefined],
  ])('checks the v2 session envelope and candidate independently of the AI decision (%j)', async (value, ended, alertId) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(value));
    try {
      await expect(readFixedCandidate(session, () => true)).resolves.toEqual({ ended, alertId });
      expect(fetchMock.mock.calls[0][0]).toMatch(/\/analysis-status$/);
      expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
    } finally { fetchMock.mockRestore(); }
  });
  it.each([
    [401, 'INVALID_REQUEST', 'authentication'],
    [403, 'INVALID_REQUEST', 'consent'],
    [404, 'SESSION_NOT_FOUND', 'consent'],
    [409, 'PRIVACY_RETRACTED', 'consent'],
    [503, 'SERVICE_UNAVAILABLE', 'network'],
  ])('refuses to authorize from HTTP %i %s', async (http, code, kind) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code }, { status: http }));
    try {
      await expect(readFixedCandidate(session, () => true)).rejects.toMatchObject({ kind, status: http });
    } finally { fetchMock.mockRestore(); }
  });
  it('rejects an envelope for a different session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ...status, sessionId: alert.alertId }));
    try {
      await expect(readFixedCandidate(session, () => true)).rejects.toThrow('FIXED_INTERVAL_RESPONSE_INVALID');
    } finally { fetchMock.mockRestore(); }
  });
});
