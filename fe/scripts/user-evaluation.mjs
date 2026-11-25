import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { MOCK_ORIGIN } from '../user/mock-config.ts';

const size = 20;
const modes = ['AI', 'FIXED_INTERVAL'];
const actions = ['RETURN_TO_GOAL', 'CONTINUE_BROWSING'];
const ratio = (value, denominator) => denominator > 0 ? value / denominator : null;

export async function endedAlertHistory(sessionId, token) {
  const sessionUrl = `${MOCK_ORIGIN}/api/sessions/${encodeURIComponent(sessionId)}`;
  async function read(url) {
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Alert evaluation HTTP ' + response.status);
    return response.json();
  }
  const session = await read(sessionUrl);
  assert.equal(session.sessionId, sessionId);
  assert.equal(session.status, 'ENDED');
  const history = [];
  let total;
  for (let page = 0; ; page++) {
    const result = await read(`${sessionUrl}/alerts?page=${page}&size=${size}`);
    total ??= result.totalElements;
    assert.ok(Number.isSafeInteger(total) && total >= 0);
    assert.equal(result.totalElements, total);
    assert.equal(result.page, page);
    assert.equal(result.size, size);
    assert.equal(result.items.length, Math.min(size, total - page * size));
    history.push(...result.items);
    assert.equal(result.hasNext, history.length < total);
    if (!result.hasNext) return { session, history };
  }
}

export function compareAlerts(samples) {
  const totals = Object.fromEntries(modes.map(mode => [mode, {
    sessions: 0, durationMs: 0, backendCandidates: 0, chromeSubmitted: 0, submissionUncertain: 0,
    detailShown: 0, localChoices: 0, serverShown: 0, serverChoices: 0, shownAck: 0, choiceAck: 0, returnToGoal: 0, continueBrowsing: 0,
    choiceLatencyMs: 0, unconfirmedReceipts: 0, shownWithoutLocalChoice: 0, conflictRecords: 0,
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
    const duration = Date.parse(session.endedAt) - Date.parse(session.startedAt);
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
      const latency = receipt?.selection && Date.parse(receipt.selection.selectedAt) - Date.parse(receipt.shownAt);
      if (conflict || !server || server.sessionId !== sessionId || server.alertType !== mode
        || receipt && (receipt.sessionId !== sessionId || receipt.alertType !== undefined && receipt.alertType !== mode
          || server.shownAt !== null && server.shownAt !== receipt.shownAt || receipt.shownAck && server.shownAt === null
          || server.response && (!receipt.selection || server.response.alertId !== alertId
            || server.response.selectedAt !== receipt.selection.selectedAt || server.response.action !== receipt.selection.action
            || receipt.feedbackId && server.response.feedbackId !== receipt.feedbackId)
          || receipt.selectionAck && !server.response
          || receipt.selection && (!actions.includes(receipt.selection.action) || !Number.isFinite(latency) || latency < 0))
        || !receipt && (server.shownAt !== null || server.response)) {
        t.conflictRecords++;
        report(mode, sessionId, 'ALERT_CONFLICT', alertId);
        continue;
      }
      if (submission?.chromeSubmitted || submission?.phase === 'presented') t.chromeSubmitted++;
      else if (['submitting', 'uncertain'].includes(submission?.phase)) t.submissionUncertain++;
      if (!receipt) continue;
      t.detailShown++;
      if (server.shownAt !== null) t.serverShown++;
      if (server.response) t.serverChoices++;
      if (receipt.shownAck) t.shownAck++;
      if (receipt.selectionAck) t.choiceAck++;
      if (!receipt.shownAck || receipt.selection && !receipt.selectionAck) {
        t.unconfirmedReceipts++;
        report(mode, sessionId, 'RECEIPT_UNCONFIRMED', alertId);
      }
      if (!receipt.selection) {
        t.shownWithoutLocalChoice++;
        continue;
      }
      t.localChoices++;
      t.choiceLatencyMs += latency;
      if (receipt.selection.action === actions[0]) t.returnToGoal++;
      else t.continueBrowsing++;
    }
  }
  for (const t of Object.values(totals)) {
    t.returnToGoalRate = ratio(t.returnToGoal, t.localChoices);
    t.continueBrowsingRate = ratio(t.continueBrowsing, t.localChoices);
    t.meanChoiceMs = ratio(t.choiceLatencyMs, t.localChoices);
    t.chromeSubmittedPerHour = ratio(t.chromeSubmitted, t.durationMs / 3_600_000);
  }
  return { totals, records };
}
