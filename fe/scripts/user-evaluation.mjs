import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { MOCK_ORIGIN } from '../user/mock-config.ts';

const size = 20;
const modes = ['AI', 'FIXED_INTERVAL'];
const actions = ['RETURN_TO_GOAL', 'CONTINUE_BROWSING'];
const ratio = (value, denominator) => denominator > 0 ? value / denominator : null;
const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isUuid = value => typeof value === 'string' && uuid4.test(value);
const time = value => {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : NaN;
};
const within = (value, start, end) => time(value) >= start && time(value) <= end;

export async function endedAlertHistory(sessionId, token) {
  const sessionUrl = `${MOCK_ORIGIN}/api/sessions/${encodeURIComponent(sessionId)}`;
  async function read(url) {
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Alert evaluation HTTP ' + response.status);
    return response.json();
  }
  let session;
  try { session = await read(sessionUrl); }
  catch { return { session: { sessionId }, excluded: 'HISTORY_UNAVAILABLE' }; }
  if (session?.sessionId !== sessionId || session.status !== 'ENDED') return { session: { sessionId }, excluded: 'SESSION_NOT_EVALUABLE' };
  const history = [];
  const incomplete = { session, excluded: 'HISTORY_INCOMPLETE' };
  let total;
  for (let page = 0; ; page++) {
    let result;
    try { result = await read(`${sessionUrl}/alerts?page=${page}&size=${size}`); }
    catch { return { session, excluded: 'HISTORY_UNAVAILABLE' }; }
    total ??= result?.totalElements;
    if (!Number.isSafeInteger(total) || total < 0 || result?.totalElements !== total || result.page !== page || result.size !== size
      || !Array.isArray(result.items) || result.items.length !== Math.min(size, total - page * size)
      || result.items.some(item => !isUuid(item?.alertId))) return incomplete;
    history.push(...result.items);
    if (result.hasNext !== (history.length < total)) return incomplete;
    if (!result.hasNext) return new Set(history.map(row => row.alertId)).size === total ? { session, history } : incomplete;
  }
}

function consistentEvidence(server, receipt, sessionId, mode, start, end) {
  if (!server || server.sessionId !== sessionId || server.alertType !== mode) return false;
  if (server.shownAt !== null && !within(server.shownAt, start, end)) return false;
  if (!receipt) return server.shownAt === null && server.response === null;
  if (receipt.sessionId !== sessionId || receipt.alertType !== undefined && receipt.alertType !== mode
    || !within(receipt.shownAt, start, end)
    || (server.shownAt !== null ? server.shownAt !== receipt.shownAt : receipt.shownAck)
    || receipt.selectionAck && !receipt.shownAck
    || receipt.feedbackId !== undefined && (!receipt.selectionAck || !isUuid(receipt.feedbackId))) return false;
  const selection = receipt.selection;
  if (selection && (!actions.includes(selection.action) || !within(selection.selectedAt, time(receipt.shownAt), end))) return false;
  const response = server.response;
  if (response === null) return !receipt.selectionAck;
  return !!response && !!selection && server.shownAt !== null && response.alertId === server.alertId
    && response.selectedAt === selection.selectedAt && response.action === selection.action && isUuid(response.feedbackId)
    && (receipt.feedbackId === undefined || response.feedbackId === receipt.feedbackId);
}

export function compareAlerts(samples) {
  const totals = Object.fromEntries(modes.map(mode => [mode, {
    sessions: 0, durationMs: 0, backendCandidates: 0, chromeSubmitted: 0, submissionUncertain: 0,
    detailShown: 0, detailShownWithConfirmedSubmission: 0, detailShownWithUncertainSubmission: 0,
    localChoices: 0, serverShown: 0, serverChoices: 0, shownAck: 0, choiceAck: 0,
    returnToGoal: 0, continueBrowsing: 0, serverReturnToGoal: 0, serverContinueBrowsing: 0,
    choiceLatencyMs: 0, serverChoiceLatencyMs: 0, unconfirmedReceipts: 0, shownWithoutLocalChoice: 0, conflictRecords: 0,
    excludedRecords: 0, excludedSessions: 0,
  }]));
  const records = [];
  const report = (mode, sessionId, reason, alertId) => records.push({ mode, sessionId, ...(alertId ? { alertId } : {}), reason });
  const sessions = new Map();
  for (const sample of samples) {
    const { sessionId } = sample.session;
    const group = sessions.get(sessionId) ?? [];
    if (!group.some(previous => isDeepStrictEqual(sample, previous))) group.push(sample);
    sessions.set(sessionId, group);
  }
  for (const [sessionId, group] of sessions) {
    const [{ mode, session, history, submissions, receipts, excluded }] = group;
    const t = totals[mode];
    assert.ok(t && sessionId);
    if (group.length !== 1) {
      t.conflictRecords++;
      t.excludedSessions++;
      report(mode, sessionId, 'SESSION_CONFLICT');
      continue;
    }
    const started = time(session.startedAt), ended = time(session.endedAt);
    const duration = ended - started;
    if (excluded || session.status !== 'ENDED' || !Number.isFinite(duration) || duration < 0) {
      t.excludedSessions++;
      report(mode, sessionId, excluded ?? 'SESSION_NOT_EVALUABLE');
      continue;
    }
    t.sessions++;
    t.durationMs += duration;
    const byId = new Map();
    for (const [source, entries] of [['server', history], ['submission', submissions], ['receipt', receipts]]) {
      for (const entry of entries) {
        const row = byId.get(entry.alertId) ?? {};
        if (row[source] && !isDeepStrictEqual(row[source], entry)) row.conflict = true;
        row[source] ??= entry;
        byId.set(entry.alertId, row);
      }
    }
    for (const [alertId, { server, submission, receipt, conflict }] of byId) {
      if (server?.sessionId === sessionId && server.alertType === mode) t.backendCandidates++;
      const phases = [receipt?.shownDelivery?.phase, receipt?.selectionDelivery?.phase];
      if (server?.invalidatedAt || phases.includes('privacy-blocked')) {
        t.excludedRecords++;
        report(mode, sessionId, server?.invalidatedAt ? 'INVALIDATED' : 'PRIVACY_BLOCKED', alertId);
        continue;
      }
      if (conflict || !consistentEvidence(server, receipt, sessionId, mode, started, ended)) {
        t.conflictRecords++;
        report(mode, sessionId, 'ALERT_CONFLICT', alertId);
        continue;
      }
      const submitted = submission?.chromeSubmitted === true || submission?.phase === 'presented';
      const uncertain = !submitted && ['submitting', 'uncertain'].includes(submission?.phase);
      if (submitted) t.chromeSubmitted++;
      if (uncertain) t.submissionUncertain++;
      if (!receipt) continue;
      t.detailShown++;
      if (submitted) t.detailShownWithConfirmedSubmission++;
      if (uncertain) t.detailShownWithUncertainSubmission++;
      if (server.shownAt !== null) t.serverShown++;
      if (server.response) t.serverChoices++;
      if (receipt.shownAck) t.shownAck++;
      if (receipt.selectionAck) t.choiceAck++;
      if (!receipt.shownAck || receipt.selection && !receipt.selectionAck) {
        t.unconfirmedReceipts++;
        report(mode, sessionId, 'RECEIPT_UNCONFIRMED', alertId);
      }
      if (!receipt.selection) {
        if (receipt.shownAck) t.shownWithoutLocalChoice++;
        continue;
      }
      const latency = time(receipt.selection.selectedAt) - time(receipt.shownAt);
      t.localChoices++;
      t.choiceLatencyMs += latency;
      if (receipt.selection.action === actions[0]) t.returnToGoal++;
      else t.continueBrowsing++;
      if (server.response) {
        t.serverChoiceLatencyMs += latency;
        if (server.response.action === actions[0]) t.serverReturnToGoal++;
        else t.serverContinueBrowsing++;
      }
    }
  }
  for (const t of Object.values(totals)) {
    t.detailShownRate = ratio(t.detailShownWithConfirmedSubmission, t.chromeSubmitted);
    t.localChoiceRate = ratio(t.localChoices, t.detailShown);
    t.serverChoiceRate = ratio(t.serverChoices, t.serverShown);
    t.returnToGoalRate = t.localReturnToGoalRate = ratio(t.returnToGoal, t.localChoices);
    t.continueBrowsingRate = t.localContinueBrowsingRate = ratio(t.continueBrowsing, t.localChoices);
    t.serverReturnToGoalRate = ratio(t.serverReturnToGoal, t.serverChoices);
    t.serverContinueBrowsingRate = ratio(t.serverContinueBrowsing, t.serverChoices);
    t.meanChoiceMs = ratio(t.choiceLatencyMs, t.localChoices);
    t.meanServerChoiceMs = ratio(t.serverChoiceLatencyMs, t.serverChoices);
    t.chromeSubmittedPerHour = ratio(t.chromeSubmitted, t.durationMs / 3_600_000);
  }
  return { totals, records };
}
