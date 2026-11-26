import { AccessError } from '../src/api/auth-fetch';
import { getSession, SessionEndError } from '../src/api/session-end';
import { serialExecutor } from '../src/background/serial';
import { matchesDecision, readV2Status, V2StatusClient, type V2Status } from '../src/v2/status';
import type { V2Runtime } from '../src/v2/runtime';
import type { FixedAlertSubmission, UserAlertSubmission } from '../src/v2/state';
import { fixedAccessBlocks, fixedSlot, readFixedCandidate, requestFixedCandidate } from './fixed-interval';
import { FIXED_INTERVAL_MS } from './mock-config';
import { alertUrl, parseAlertKey, type AlertCommand, type AlertDetail, type FixedAlertStatus, type UserSnapshot } from './protocol';
import { hasMockPermission } from './transport';

const ALARM = 'user-analysis';
const FIXED_ALARM = 'user-fixed-interval';
const PREFIX = 'focus-drift:';
const NAVIGATION_INTERVAL = 5_000;
const PENDING_DELAY = 90_000;
const FIXED_VIEW_VALID_MS = 60_000;

// Chrome 106 supports the callback forms of the Notifications API.
function notificationCall<T>(call: (callback: (value: T) => void) => void) {
  return new Promise<T>((resolve, reject) => call(value => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve(value);
  }));
}
const notificationPermission = () => notificationCall<`${chrome.notifications.PermissionLevel}`>(
  callback => chrome.notifications.getPermissionLevel(callback));
const clearNotification = (id: string) => notificationCall<boolean>(callback => chrome.notifications.clear(id, callback));
const getNotifications = () => notificationCall<Record<string, true>>(callback => chrome.notifications.getAll(callback));
const mayHaveReachedChrome = (a: UserAlertSubmission) => !['reserved', 'retired', 'dismissed'].includes(a.phase ?? '');

function fixedFailure(error: unknown): FixedAlertStatus {
  if (error instanceof AccessError && error.kind === 'network' || error instanceof SessionEndError &&
    (error.kind === 'network' || error.kind === 'timeout' || (error.status ?? 0) >= 500)) return 'delayed';
  return 'unverified';
}

export function installUserAnalysis(runtime: V2Runtime, ready: Promise<void>) {
  const platform = serialExecutor();
  const actions = serialExecutor();
  let epoch = 0;
  const scope = () => {
    const active = runtime.alertScope();
    return active && `${active}:${epoch}`;
  };
  let latest: { scope: string; status?: V2Status; error?: 'delayed' | 'unavailable' } | undefined;
  let latestFixed: { scope: string; alertId: string; checkedAt: number } | undefined;
  let fixedResult: { scope: string; slot: number; status: FixedAlertStatus } | undefined;
  let notificationLevel: `${chrome.notifications.PermissionLevel}` | undefined;
  let permissionRevision = 0;
  let fixedCheck = 0;
  let checkingFixed: string | undefined;
  let lastFixedCheck: { scope: string; slot: number } | undefined;
  let lastCheck = 0;
  let flight: { scope: string; done: Promise<void> } | undefined;
  let pendingChromeId: string | undefined;

  const client = new V2StatusClient(() => runtime.snapshot(), sessionId => {
    const current = scope();
    return readV2Status(sessionId, () => !!current && scope() === current);
  }, scope);
  const submissions = (local = runtime.snapshot()) => {
    return local.start?.alertMode === 'FIXED_INTERVAL' ? local.userFixedAlerts?.submissions : local.userAnalysis?.submissions;
  };

  async function clearNotifications(keep?: string, notifications?: Record<string, true>) {
    await Promise.all(Object.keys(notifications ?? await getNotifications()).filter(id => id.startsWith(PREFIX) && id !== keep)
      .map(clearNotification));
  }
  function invalidateFixed() {
    latestFixed = undefined;
    fixedResult = undefined;
    checkingFixed = undefined;
    return ++fixedCheck;
  }
  function clear(retire = false) {
    epoch++;
    latest = undefined;
    invalidateFixed();
    lastFixedCheck = undefined;
    lastCheck = 0;
    const sessionId = runtime.snapshot().session?.sessionId;
    if (pendingChromeId) void clearNotification(pendingChromeId).catch(() => {});
    void chrome.alarms.clear(FIXED_ALARM).catch(() => {});
    void platform(() => clearNotifications()).catch(() => {});
    if (retire && sessionId) return runtime.retireAlertReservations(sessionId).catch(() => {});
  }

  async function submit(candidate: UserAlertSubmission, allowed: () => boolean,
    verify?: () => Promise<(() => boolean) | undefined>) {
    if (!allowed() || await notificationPermission() !== 'granted' || !await hasMockPermission() || !allowed()) return;
    const id = PREFIX + candidate.alertId;
    const listed = await getNotifications();
    await clearNotifications(id, listed);
    if (!allowed()) return;
    let submission = submissions()?.find(a => a.alertId === candidate.alertId);
    if (submission && ('slot' in submission
      ? !('slot' in candidate) || candidate.slot !== submission.slot
      : !matchesDecision(submission, latest?.status?.currentDecision ?? null))) return;
    if (submission?.phase === 'dismissed' || submission?.phase === 'retired') return;
    if (!submission) {
      if (!await runtime.claimAlert(candidate, allowed) || !allowed()) return;
      submission = { ...candidate, phase: 'reserved' };
    }
    if (listed[id]) {
      if (submission.phase !== 'presented') await runtime.updateAlertSubmission(submission, 'presented', allowed);
      return;
    }
    if (submission.phase !== 'reserved' || !await hasMockPermission() || await notificationPermission() !== 'granted' || !allowed()) return;
    const confirmedNow = verify ? await verify() : allowed;
    if (!confirmedNow || verify && (!await hasMockPermission() || await notificationPermission() !== 'granted') || !confirmedNow()) return;
    // A persisted handoff without Chrome evidence remains ambiguous after a crash.
    if (!await runtime.updateAlertSubmission(submission, 'submitting', confirmedNow) || !confirmedNow()) return;
    let confirmed = false;
    pendingChromeId = id;
    try {
      confirmed = await notificationCall<string>(callback => chrome.notifications.create(id, {
        type: 'basic', iconUrl: chrome.runtime.getURL('alert-icon.png'),
        title: 'Focus Recovery', message: 'slot' in candidate
          ? '작업 중간 점검 시간이에요. 최초 작업 목표를 확인해 보세요.'
          : '지금 탐색을 점검하고 최초 작업 목표를 확인해 보세요.',
      }, callback)) === id;
    } catch { /* The next valid poll can reconcile positive Chrome evidence. */ }
    finally { pendingChromeId = undefined; }
    // The callback is evidence of the handoff even if a newer check has replaced its grant.
    if (allowed()) await runtime.updateAlertSubmission({ ...submission, phase: 'submitting' }, confirmed ? 'presented' : 'uncertain', allowed);
    if (!confirmedNow()) await clearNotification(id);
  }

  function blockAlerts(reason?: 'authentication' | 'consent') {
    runtime.suspendAccess(reason);
    void clear(true);
  }

  function fixedConfirmed(alertId: string, current: string) {
    const age = Date.now() - (latestFixed?.checkedAt ?? 0);
    return latestFixed?.scope === current && latestFixed.alertId === alertId && age >= 0 && age < FIXED_VIEW_VALID_MS;
  }

  async function verifyFixed(submission: FixedAlertSubmission) {
    const current = scope();
    const { session, start, userFixedAlerts } = runtime.snapshot();
    if (!current || !session || start?.alertMode !== 'FIXED_INTERVAL' || userFixedAlerts?.slot !== submission.slot
      || fixedSlot(session.startedAt) !== submission.slot) return;
    const check = invalidateFixed();
    checkingFixed = current;
    const allowed = () => check === fixedCheck && scope() === current && fixedSlot(session.startedAt) === submission.slot;
    const report = (status: FixedAlertStatus) => { fixedResult = { scope: current, slot: submission.slot, status }; };
    try {
      if (!await hasMockPermission() || await notificationPermission() !== 'granted' || !allowed()) return;
      report('checking');
      const checkedAt = Date.now();
      const receipt = runtime.notificationDetail(submission.alertId);
      const result = receipt?.sessionId === session.sessionId
        ? { ended: (await getSession(session, allowed)).status === 'ENDED', alertId: submission.alertId }
        : await readFixedCandidate(session, allowed);
      if (!allowed()) return;
      if (result.ended) { blockAlerts(); return; }
      if (result.alertId !== submission.alertId) { report('unavailable'); return; }
      fixedResult = undefined;
      latestFixed = { scope: current, alertId: submission.alertId, checkedAt };
      return () => allowed() && fixedConfirmed(submission.alertId, current);
    } catch (error) {
      if (!allowed()) return;
      if (error instanceof AccessError && (error.kind === 'authentication' || error.kind === 'consent')) blockAlerts(error.kind);
      else if (error instanceof SessionEndError && ([401, 403, 404].includes(error.status ?? 0)
        || fixedAccessBlocks.includes(error.code ?? ''))) blockAlerts(error.status === 401 ? 'authentication' : 'consent');
      else report(fixedFailure(error));
    } finally {
      if (check === fixedCheck) checkingFixed = undefined;
    }
  }

  async function readFixed(current: string, allowed: () => boolean) {
    const { session, userFixedAlerts: checkpoint } = runtime.snapshot();
    if (!session) return;
    const slot = fixedSlot(session.startedAt);
    const boundary = Date.parse(session.startedAt) + (Math.max(slot, checkpoint?.slot ?? 0) + 1) * FIXED_INTERVAL_MS;
    const alarm = await chrome.alarms.get(FIXED_ALARM);
    if (!allowed()) return;
    if (alarm?.scheduledTime !== boundary) await chrome.alarms.create(FIXED_ALARM, { when: boundary });
    const inSlot = () => allowed() && fixedSlot(session.startedAt) === slot;
    if (slot < 1 || slot < (checkpoint?.slot ?? 0) || !inSlot()) return;
    if (checkpoint?.slot === slot && checkpoint.skipped) return;
    if (checkpoint?.slot !== slot) {
      if (!await runtime.checkpointFixedSlot(slot, inSlot)) return;
      if (checkpoint) await platform(() => clearNotifications());
    }
    let candidate = checkpoint?.submissions.find(a => a.slot === slot);
    if (candidate?.phase === 'retired' || candidate?.phase === 'dismissed') return;
    if (!candidate) {
      const report = (status: FixedAlertStatus) => { fixedResult = { scope: current, slot, status }; };
      const check = invalidateFixed();
      report('checking');
      let result;
      try { result = await requestFixedCandidate(session, inSlot); }
      catch (error) {
        if (inSlot() && check === fixedCheck) report(fixedFailure(error));
        throw error;
      }
      if (!allowed()) return;
      if (result.kind === 'ended') { blockAlerts(); return; }
      // A response crossing the local boundary can't identify a slot from the current DTO.
      if (!inSlot()) return;
      if (check === fixedCheck) fixedResult = undefined;
      if (result.kind !== 'candidate') {
        if (check === fixedCheck) report(result.kind === 'disabled' ? 'disabled' : 'skipped');
        await runtime.checkpointFixedSlot(slot, inSlot, true);
        return;
      }
      if (checkpoint?.submissions.some(a => a.alertId === result.alertId)) {
        if (check === fixedCheck) report('skipped');
        await runtime.checkpointFixedSlot(slot, inSlot, true);
        return;
      }
      candidate = { alertId: result.alertId, viewId: crypto.randomUUID(), slot, phase: 'reserved' };
      if (!await runtime.claimAlert(candidate, inSlot) || !inSlot()) return;
      latest = undefined;
    }
    const submission = candidate;
    if (submission.phase === 'reserved') {
      await platform(() => submit(submission, inSlot, () => verifyFixed(submission)));
    } else if (checkingFixed !== current) {
      if (!fixedConfirmed(submission.alertId, current) && !(await verifyFixed(submission))?.()) return;
      if (!runtime.notificationDetail(submission.alertId)) {
        await platform(() => submit(submission, () => inSlot() && fixedConfirmed(submission.alertId, current)));
      }
    }
  }

  async function read(current: string) {
    const allowed = () => scope() === current;
    try {
      if (!await hasMockPermission()) { if (allowed()) void clear(true); return; }
      if (!allowed()) return;
      if (runtime.snapshot().start?.alertMode === 'FIXED_INTERVAL') {
        const revision = ++permissionRevision;
        void notificationPermission().then(level => {
          if (revision === permissionRevision) notificationLevel = level;
        }).catch(() => {
          if (revision === permissionRevision) notificationLevel = undefined;
        });
        await readFixed(current, allowed);
        return;
      }
      const result = await client.status(runtime.snapshot().userAnalysis?.cursor);
      if (!allowed()) return;
      if (!await hasMockPermission()) { if (allowed()) void clear(true); return; }
      if (!allowed()) return;
      if (result?.value.sessionStatus === 'ENDED') {
        blockAlerts();
        return;
      }
      if (result?.cursor) await runtime.checkpointAnalysis(result.cursor, result.alert, allowed);
      if (!allowed()) return;
      latest = { scope: current, status: result?.value, ...(result ? {} : { error: 'unavailable' }) };
      const alert = result?.alert;
      if (alert?.alertType !== 'AI' || !result?.cursor) return;
      const { windowIndex } = result.cursor.current;
      await platform(() => submit({
        alertId: alert.alertId, viewId: crypto.randomUUID(), windowId: alert.windowId!, windowIndex,
        stateVersion: alert.stateVersion!, analysisId: alert.analysisId!,
      }, allowed)).catch(() => {});
    } catch (error) {
      if (!allowed()) return;
      if (error instanceof AccessError && (error.kind === 'authentication' || error.kind === 'consent')) {
        blockAlerts(error.kind);
      } else latest = { scope: current, error: error instanceof AccessError && error.kind === 'network' ? 'delayed' : 'unavailable' };
    } finally {
      await platform(async () => {
        if (!allowed()) {
          if (!scope()) await clearNotifications();
          return;
        }
        if (checkingFixed === current) return;
        const id = notificationToKeep();
        const keep = id && await hasMockPermission()
          && await notificationPermission() === 'granted' && allowed() ? PREFIX + id : undefined;
        await clearNotifications(keep);
      }).catch(() => {});
    }
  }

  async function poll(force = false) {
    await ready;
    const current = scope();
    if (!current) {
      if (latest || !lastCheck) clear();
      lastCheck = Date.now();
      return;
    }
    if (flight?.scope === current) return flight.done;
    const { session, start } = runtime.snapshot();
    const slot = start?.alertMode === 'FIXED_INTERVAL' && session ? fixedSlot(session.startedAt) : undefined;
    const recent = slot === undefined ? latest?.scope === current : lastFixedCheck?.scope === current && lastFixedCheck.slot === slot;
    if (!force && recent && Date.now() - lastCheck < NAVIGATION_INTERVAL) return;
    if (slot !== undefined) lastFixedCheck = { scope: current, slot };
    lastCheck = Date.now();
    const done = read(current);
    const request = { scope: current, done };
    flight = request;
    try { await done; }
    finally {
      if (flight === request) {
        flight = undefined;
        if (session && slot !== undefined && scope() === current && fixedSlot(session.startedAt) > slot) wake(true);
      }
    }
  }

  function analysis(permitted: boolean): Pick<UserSnapshot, 'analysis' | 'finalState'> {
    const current = scope();
    if (!permitted || !current || latest?.scope !== current) return { analysis: 'unconnected' };
    if (latest.error) return { analysis: latest.error };
    const d = latest.status?.currentDecision;
    if (!d) return { analysis: 'empty' };
    if (d.decisionStatus === 'PENDING') {
      const observedAt = runtime.snapshot().userAnalysis?.observedAt ?? Date.now();
      return { analysis: Date.now() - observedAt >= PENDING_DELAY ? 'delayed' : 'pending' };
    }
    if (d.decisionStatus === 'COMPLETED') return { analysis: 'completed', finalState: d.finalState! };
    return { analysis: d.decisionStatus === 'FAILED' ? 'failed' : 'invalidated' };
  }

  function fixedStatus({ session, userFixedAlerts }: ReturnType<V2Runtime['snapshot']>): FixedAlertStatus {
    const current = scope();
    if (!current || !session) return 'suspended';
    if (notificationLevel === 'denied') return 'notification-denied';
    const slot = fixedSlot(session.startedAt);
    if (slot === 0) return 'waiting';
    if (fixedResult?.scope === current && fixedResult.slot === slot) return fixedResult.status;
    const candidate = userFixedAlerts?.slot === slot && userFixedAlerts.submissions.find(a => a.slot === slot);
    if (!candidate) return 'unverified';
    if (candidate.phase === 'dismissed' || candidate.phase === 'retired') return 'waiting';
    return fixedConfirmed(candidate.alertId, current) ? 'confirmed' : 'unverified';
  }

  function displayCandidate(alertId: string) {
    const current = scope();
    const local = runtime.snapshot();
    if (!current || !local.session) return;
    const submission = submissions(local)?.find(a => a.alertId === alertId);
    if (!submission || !mayHaveReachedChrome(submission)) return;
    const receipt = runtime.notificationDetail(alertId);
    if ('slot' in submission) {
      if (!fixedConfirmed(alertId, current)
        || local.userFixedAlerts?.slot !== submission.slot || fixedSlot(local.session.startedAt) !== submission.slot) return;
      return { session: local.session, receipt, viewId: submission.viewId, alertType: 'FIXED_INTERVAL' as const };
    }
    const value = latest?.status;
    if (latest?.scope !== current || value?.sessionStatus !== 'ACTIVE' || !matchesDecision(submission, value.currentDecision)) return;
    const alert = value.alert;
    // The status endpoint omits a candidate after the server has recorded shownAt.
    if (alert ? alert.alertType !== 'AI' || alert.alertId !== alertId || alert.goalText !== local.session.goalText
      || !matchesDecision(alert, value.currentDecision) : !receipt) return;
    return { session: local.session, receipt, viewId: submission.viewId, alertType: 'AI' as const };
  }

  function notificationToKeep() {
    if (runtime.snapshot().start?.alertMode === 'FIXED_INTERVAL') {
      const id = latestFixed?.alertId;
      if (id && displayCandidate(id) && !runtime.notificationDetail(id)) return id;
      return;
    }
    const alert = latest?.status?.alert;
    if (alert?.alertType === 'AI' && displayCandidate(alert.alertId)) return alert.alertId;
    // Keep submitted notifications until a verified decision or access change supersedes them.
    if (latest?.error) {
      const { userAnalysis, notifications } = runtime.snapshot();
      return userAnalysis?.submissions.find(a => mayHaveReachedChrome(a) && matchesDecision(a, userAnalysis.cursor.current)
        && !notifications.some(r => r.alertId === a.alertId))?.alertId;
    }
  }
  const submissionFor = (viewId: string) => submissions()?.find(a => a.viewId === viewId);
  async function detail(viewId: string): Promise<AlertDetail | undefined> {
    if (!await hasMockPermission()) return;
    const alertId = submissionFor(viewId)?.alertId;
    const candidate = alertId && displayCandidate(alertId);
    if (!candidate) return;
    const receipt = candidate.receipt;
    return {
      alertType: candidate.alertType,
      goal: candidate.session.goalText,
      shown: !!receipt,
      ...(receipt ? { shownDelivery: receipt.shownDelivery.phase } : {}),
      ...(receipt?.selection ? { action: receipt.selection.action, selectionDelivery: receipt.selectionDelivery?.phase,
        acknowledged: receipt.selectionAck === true } : {}),
    };
  }
  async function command(request: AlertCommand) {
    const receivedAt = Date.now();
    const acceptedEpoch = epoch;
    const receivedScope = scope();
    await ready;
    const current = scope();
    if (epoch !== acceptedEpoch || !current || receivedScope && receivedScope !== current) return;
    if (request.type === 'alert-view') return detail(request.viewId);
    return actions(async () => {
      const { viewId, type } = request;
      const submission = submissionFor(viewId);
      if (scope() !== current || !submission) return;
      const { alertId } = submission;
      let verified: (() => boolean) | undefined;
      if ('slot' in submission) {
        if (!mayHaveReachedChrome(submission)) return;
        const receipt = runtime.notificationDetail(alertId);
        if (type === 'alert-open' || type === 'alert-shown' && !receipt
          || type === 'alert-select' && receipt && !receipt.selection) {
          verified = await verifyFixed(submission);
          if (!verified?.()) return;
        }
      } else if (type === 'alert-open' || type === 'alert-select') {
        if (type === 'alert-select') await flight?.done;
        await poll(true);
      }
      if (!await hasMockPermission() || scope() !== current) return;
      const allowed = () => scope() === current && (!verified || verified()) && displayCandidate(alertId)?.viewId === viewId;
      const candidate = displayCandidate(alertId);
      if (!candidate) return;
      if (type === 'alert-shown') {
        if (!candidate.receipt) await runtime.recordShown({ sessionId: candidate.session.sessionId, alertId }, new Date(receivedAt).toISOString(), allowed);
        void platform(() => clearNotification(PREFIX + alertId)).catch(() => {});
      }
      if (type === 'alert-select') {
        if (!candidate.receipt || candidate.receipt.selection) return;
        await runtime.selectAlert(alertId, { action: request.action,
          selectedAt: new Date(receivedAt).toISOString() }, allowed);
      }
      return detail(viewId);
    });
  }

  const wake = (force = false) => { void poll(force).catch(() => {}); };
  const navigation = ({ frameId }: { frameId: number }) => { if (frameId === 0) wake(); };
  chrome.webNavigation.onCommitted.addListener(navigation);
  chrome.webNavigation.onHistoryStateUpdated.addListener(navigation);
  chrome.webNavigation.onReferenceFragmentUpdated.addListener(navigation);
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name !== ALARM && alarm.name !== FIXED_ALARM) return;
    wake(true);
    runtime.wakeNotifications();
  });
  chrome.permissions.onAdded.addListener(permission => {
    if (permission.origins?.includes('http://127.0.0.1/*')) void ready.then(() => runtime.wakeNotifications(true)).catch(() => {});
  });
  chrome.permissions.onRemoved.addListener(permission => {
    if (permission.origins?.includes('http://127.0.0.1/*')) void clear(true);
  });
  chrome.notifications.onPermissionLevelChanged.addListener(level => {
    permissionRevision++;
    notificationLevel = level;
    if (level === 'denied') {
      invalidateFixed();
      void platform(() => clearNotifications()).catch(() => {});
    }
    else wake(true);
  });
  chrome.notifications.onClosed.addListener((id, byUser) => {
    if (!byUser || !id.startsWith(PREFIX)) return;
    const received = epoch;
    void ready.then(async () => {
      const current = scope();
      const submission = submissions()?.find(a => PREFIX + a.alertId === id);
      if (current && received === epoch && submission && mayHaveReachedChrome(submission)) {
        await runtime.updateAlertSubmission(submission, 'dismissed', () => scope() === current);
      }
    }).catch(() => {});
  });
  chrome.notifications.onClicked.addListener(id => {
    const alertId = id.startsWith(PREFIX) ? parseAlertKey(id.slice(PREFIX.length)) : undefined;
    if (!alertId) return;
    const acceptedEpoch = epoch;
    void (async () => {
      await ready;
      const submission = submissions()?.find(a => a.alertId === alertId);
      if (submission && 'slot' in submission) {
        await actions(async () => {
          if (acceptedEpoch !== epoch || !mayHaveReachedChrome(submission)) return;
          const verified = await verifyFixed(submission);
          const candidate = displayCandidate(alertId);
          if (verified?.() && candidate) await chrome.tabs.create({ url: alertUrl(candidate.viewId) });
        });
        return;
      }
      if (runtime.snapshot().start?.alertMode === 'FIXED_INTERVAL') return;
      await poll(true);
      if (!await hasMockPermission() || await notificationPermission() !== 'granted' || epoch !== acceptedEpoch) return;
      const candidate = displayCandidate(alertId);
      if (!candidate) return;
      const allowed = () => epoch === acceptedEpoch && displayCandidate(alertId)?.viewId === candidate.viewId;
      if (allowed()) await chrome.tabs.create({ url: alertUrl(candidate.viewId) });
    })().catch(() => {});
  });
  void ready.then(async () => {
    if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
    wake();
  }).catch(() => {});
  return { analysis, fixedStatus, command, clear, wake };
}
