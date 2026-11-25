import { describe, expect, it, vi } from 'vitest';
import { fixedCandidate, fixedSlot, requestFixedCandidate } from '../user/fixed-interval';
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
