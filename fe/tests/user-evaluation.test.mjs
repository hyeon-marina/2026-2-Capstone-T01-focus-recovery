import { expect, it } from 'vitest';
import { compareAlerts } from '../scripts/user-evaluation.mjs';

const session = { sessionId: 'session', startedAt: '2026-11-26T00:00:00.000Z', endedAt: '2026-11-26T01:00:00.000Z', status: 'ENDED' };
const server = { sessionId: session.sessionId, alertId: 'a', alertType: 'FIXED_INTERVAL', shownAt: '2026-11-26T00:10:00.000Z', response: null };
const receipt = { sessionId: session.sessionId, alertId: 'a', alertType: 'FIXED_INTERVAL', shownAt: server.shownAt, shownAck: true,
  selection: { action: 'CONTINUE_BROWSING', selectedAt: '2026-11-26T00:10:01.000Z' } };
const submission = { alertId: 'a', phase: 'dismissed', chromeSubmitted: true };
const sample = { mode: 'FIXED_INTERVAL', session, history: [server], submissions: [submission], receipts: [receipt] };

it('deduplicates session and alert evidence and keeps an unconfirmed selection in local choice counts', () => {
  const withDuplicates = { ...sample, history: [server, server], submissions: [submission, submission], receipts: [receipt, receipt] };
  const report = compareAlerts([withDuplicates, structuredClone(withDuplicates)]);
  expect(report).toEqual(compareAlerts([sample]));
  expect(report.totals.FIXED_INTERVAL).toMatchObject({
    sessions: 1, backendCandidates: 1, chromeSubmitted: 1, detailShown: 1,
    localChoices: 1, shownAck: 1, choiceAck: 0, unconfirmedReceipts: 1, shownWithoutLocalChoice: 0,
    meanChoiceMs: 1000, continueBrowsingRate: 1, chromeSubmittedPerHour: 1,
  });
  expect(report.totals.AI).toMatchObject({ meanChoiceMs: null, returnToGoalRate: null, chromeSubmittedPerHour: null });
});

it('excludes quarantined or denied sessions and keeps conflicting alerts out of response metrics', () => {
  const report = compareAlerts([
    { ...sample, history: [server, { ...server, shownAt: receipt.selection.selectedAt }] },
    { ...sample, session: { ...session, sessionId: 'denied' }, excluded: 'NOTIFICATION_PERMISSION_DENIED' },
    { ...sample, session: { ...session, sessionId: 'privacy' }, excluded: 'PRIVACY_WITHDRAWN' },
  ]);
  expect(report.totals.FIXED_INTERVAL).toMatchObject({
    sessions: 1, excludedSessions: 2, backendCandidates: 1, conflictRecords: 1,
    detailShown: 0, localChoices: 0, meanChoiceMs: null,
  });
  expect(report.records.map(row => row.reason)).toEqual([
    'ALERT_CONFLICT', 'NOTIFICATION_PERMISSION_DENIED', 'PRIVACY_WITHDRAWN',
  ]);
});
