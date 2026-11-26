import { expect, it, vi } from 'vitest';
import { compareAlerts, endedAlertHistory } from '../scripts/user-evaluation.mjs';

const session = { sessionId: 'session', startedAt: '2026-11-26T00:00:00.000Z', endedAt: '2026-11-26T01:00:00.000Z', status: 'ENDED' };
const server = { sessionId: session.sessionId, alertId: 'a', alertType: 'FIXED_INTERVAL', shownAt: '2026-11-26T00:10:00.000Z', response: null };
const receipt = { sessionId: session.sessionId, alertId: 'a', alertType: 'FIXED_INTERVAL', shownAt: server.shownAt, shownAck: true,
  selection: { action: 'CONTINUE_BROWSING', selectedAt: '2026-11-26T00:10:01.000Z' } };
const submission = { alertId: 'a', phase: 'dismissed', chromeSubmitted: true };
const sample = { mode: 'FIXED_INTERVAL', session, history: [server], submissions: [submission], receipts: [receipt] };
const feedbackId = '96000000-0000-4000-8000-000000000001';
const response = { ...receipt.selection, alertId: receipt.alertId, feedbackId };
const completeServer = { ...server, response };
const completeReceipt = { ...receipt, selectionAck: true, feedbackId };
const stats = overrides => compareAlerts([{ ...sample, ...overrides }]).totals.FIXED_INTERVAL;

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

it.each([['stored and acknowledged', true, true], ['failed before storage', false, false], ['stored without ACK', true, false]])(
  'separates conversion, action mix and acknowledgement when the second choice is %s', (_, stored, acknowledged) => {
    const id = 'b';
    const selection = { ...receipt.selection, action: 'RETURN_TO_GOAL' };
    const secondServer = { ...server, alertId: id, response: { ...selection, alertId: id, feedbackId: crypto.randomUUID() } };
    const secondReceipt = { ...completeReceipt, alertId: id, selection, feedbackId: secondServer.response.feedbackId };
    const result = stats({
      history: [secondServer, stored ? completeServer : server],
      receipts: [secondReceipt, acknowledged ? completeReceipt : receipt],
      submissions: [submission, { ...submission, alertId: id }],
    });
    expect(result).toMatchObject({
      detailShownRate: 1, localChoiceRate: 1, serverChoiceRate: stored ? 1 : 0.5,
      localReturnToGoalRate: 0.5, localContinueBrowsingRate: 0.5,
      serverReturnToGoalRate: stored ? 0.5 : 1, serverContinueBrowsingRate: stored ? 0.5 : 0,
      serverReturnToGoal: 1, serverContinueBrowsing: stored ? 1 : 0, choiceAck: acknowledged ? 2 : 1,
      unconfirmedReceipts: acknowledged ? 0 : 1, shownWithoutLocalChoice: 0, meanChoiceMs: 1000, meanServerChoiceMs: 1000,
    });
    expect(result.returnToGoalRate).toBe(result.localReturnToGoalRate);
    expect(result.continueBrowsingRate).toBe(result.localContinueBrowsingRate);
  },
);

it('includes an uncertain submission in detail counts without increasing the confirmed intersection', () => {
  const uncertain = { alertId: 'a', phase: 'uncertain' };
  expect(stats({ submissions: [uncertain] })).toMatchObject({
    detailShown: 1, detailShownWithConfirmedSubmission: 0, detailShownWithUncertainSubmission: 1,
    chromeSubmitted: 0, submissionUncertain: 1, detailShownRate: null,
  });
  expect(stats({ history: [server, { ...server, alertId: 'b', shownAt: null }], submissions: [uncertain, { ...submission, alertId: 'b' }] }))
    .toMatchObject({ chromeSubmitted: 1, detailShownRate: 0 });
});

it('counts a verified shown-only record separately from an unconfirmed shown receipt', () => {
  const noChoice = { ...receipt, selection: undefined };
  expect(stats({ receipts: [noChoice] })).toMatchObject({ shownWithoutLocalChoice: 1, localChoiceRate: 0, serverChoiceRate: 0 });
  expect(stats({ history: [{ ...server, shownAt: null }], receipts: [{ ...noChoice, shownAck: false }] }))
    .toMatchObject({ shownWithoutLocalChoice: 0, unconfirmedReceipts: 1, serverChoiceRate: null });
});

it.each([
  ['other action', { response: { ...response, action: 'RETURN_TO_GOAL' } }, {}],
  ['other selectedAt', { response: { ...response, selectedAt: server.shownAt } }, {}],
  ['other feedbackId', { response: { ...response, feedbackId: crypto.randomUUID() } }, {}],
  ['invalid feedbackId', { response: { ...response, feedbackId: 'invalid' } }, {}],
  ['other shownAt', { shownAt: receipt.selection.selectedAt }, {}],
  ['selection with no server display', { shownAt: null }, { shownAck: false }],
  ['foreign session', {}, { sessionId: 'other' }],
  ['foreign mode', {}, { alertType: 'AI' }],
  ['shown before start', { shownAt: '2026-11-25T23:59:59.000Z' }, { shownAt: '2026-11-25T23:59:59.000Z' }],
  ['shown after end', { shownAt: '2026-11-26T01:00:01.000Z' }, { shownAt: '2026-11-26T01:00:01.000Z' }],
  ['negative latency', { response: { ...response, selectedAt: session.startedAt } },
    { selection: { ...receipt.selection, selectedAt: session.startedAt } }],
])('excludes %s evidence from normal conversion and latency metrics', (_, serverChange, receiptChange) => {
  expect(stats({ history: [{ ...completeServer, ...serverChange }], receipts: [{ ...completeReceipt, ...receiptChange }] }))
    .toMatchObject({ conflictRecords: 1, localChoices: 0, serverChoices: 0, meanChoiceMs: null, meanServerChoiceMs: null });
});

it('keeps all zero-denominator rates null', () => {
  expect(stats({ session: { ...session, endedAt: session.startedAt }, history: [], submissions: [], receipts: [] })).toMatchObject({
    detailShownRate: null, localChoiceRate: null, serverChoiceRate: null, localReturnToGoalRate: null, serverReturnToGoalRate: null,
    localContinueBrowsingRate: null, serverContinueBrowsingRate: null, meanChoiceMs: null, meanServerChoiceMs: null, chromeSubmittedPerHour: null,
  });
});

it('keeps privacy-blocked and invalidated rows outside conversion metrics', () => {
  expect(stats({ receipts: [{ ...receipt, selectionDelivery: { phase: 'privacy-blocked' } }] }))
    .toMatchObject({ excludedRecords: 1, backendCandidates: 1, localChoices: 0, shownWithoutLocalChoice: 0 });
  expect(stats({ history: [{ ...server, invalidatedAt: session.endedAt }] })).toMatchObject({ excludedRecords: 1, detailShown: 0 });
});

it.each([['later page unavailable', false], ['duplicate across pages', true]])(
  'excludes partial history when a %s is detected', async (_, duplicate) => {
    const items = Array.from({ length: 20 }, () => ({ ...server, alertId: crypto.randomUUID() }));
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json({ page: 0, size: 20, totalElements: 21, hasNext: true, items }))
      .mockResolvedValueOnce(duplicate
        ? Response.json({ page: 1, size: 20, totalElements: 21, hasNext: false, items: [items[0]] })
        : Response.json({}, { status: 503 }));
    try {
      expect(await endedAlertHistory(session.sessionId, 'synthetic')).toEqual({
        session, excluded: duplicate ? 'HISTORY_INCOMPLETE' : 'HISTORY_UNAVAILABLE',
      });
    } finally { fetchMock.mockRestore(); }
  },
);

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
