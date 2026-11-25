import { AccessError } from '../src/api/auth-fetch';
import { serialExecutor } from '../src/background/serial';
import { matchesDecision, readV2Status, V2StatusClient, type V2Status } from '../src/v2/status';
import { notificationPending } from '../src/v2/notifications';
import type { V2Runtime } from '../src/v2/runtime';
import { alertUrl, parseAlertKey, type AlertCommand, type AlertDetail, type UserSnapshot } from './protocol';
import { hasMockPermission } from './transport';

const ALARM = 'user-analysis';
const PREFIX = 'focus-drift:';
const NAVIGATION_INTERVAL = 5_000;
const PENDING_DELAY = 90_000;

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

export function installUserAnalysis(runtime: V2Runtime, ready: Promise<void>) {
  const platform = serialExecutor();
  const actions = serialExecutor();
  let epoch = 0;
  const scope = () => {
    const active = runtime.alertScope();
    return active && `${active}:${epoch}`;
  };
  let latest: { scope: string; status?: V2Status; error?: 'delayed' | 'unavailable' } | undefined;
  let lastCheck = 0;
  let flight: { scope: string; done: Promise<void> } | undefined;

  const client = new V2StatusClient(() => runtime.snapshot(), sessionId => {
    const current = scope();
    return readV2Status(sessionId, () => !!current && scope() === current);
  }, scope);

  async function clearNotifications(keep?: string) {
    const notifications = await notificationCall<Record<string, true>>(callback => chrome.notifications.getAll(callback));
    await Promise.all(Object.keys(notifications).filter(id => id.startsWith(PREFIX) && id !== keep)
      .map(clearNotification));
  }
  function clear() {
    epoch++;
    latest = undefined;
    lastCheck = 0;
    void platform(() => clearNotifications()).catch(() => {});
  }

  async function read(current: string) {
    const allowed = () => scope() === current;
    try {
      if (!await hasMockPermission() || !allowed()) return;
      const result = await client.status(runtime.snapshot().userAnalysis?.cursor);
      if (!allowed() || !await hasMockPermission() || !allowed()) return;
      if (result?.value.sessionStatus === 'ENDED') {
        runtime.suspendAccess();
        clear();
        return;
      }
      if (result?.cursor) await runtime.checkpointAnalysis(result.cursor, allowed);
      if (!allowed()) return;
      latest = { scope: current, status: result?.value, ...(result ? {} : { error: 'unavailable' }) };
      const alert = result?.alert;
      if (alert?.alertType !== 'AI' || !result?.cursor) return;
      const { windowIndex } = result.cursor.current;
      await platform(async () => {
        const permitted = await notificationPermission() === 'granted';
        if (!allowed() || !permitted || !await hasMockPermission() || !allowed()) return;
        const id = PREFIX + alert.alertId;
        await clearNotifications(id);
        if (!allowed()) return;
        const s = runtime.snapshot();
        const prior = s.userAnalysis?.submissions.find(a => a.alertId === alert.alertId);
        if (prior) return;
        const submission = {
          alertId: alert.alertId, viewId: crypto.randomUUID(), windowId: alert.windowId!, windowIndex,
          stateVersion: alert.stateVersion!, analysisId: alert.analysisId!,
        };
        // Reserve the ID durably before crossing the Chrome API boundary.
        if (!await runtime.claimAlert(submission, allowed) || !allowed()
          || !await hasMockPermission() || await notificationPermission() !== 'granted' || !allowed()) return;
        await notificationCall<string>(callback => chrome.notifications.create(id, {
          type: 'basic', iconUrl: chrome.runtime.getURL('alert-icon.png'),
          title: 'Focus Recovery', message: '지금 탐색을 점검하고 최초 작업 목표를 확인해 보세요.',
        }, callback));
        if (!allowed()) await clearNotification(id);
      }).catch(() => {}); // A submission error can have an ambiguous outcome. Keep its reservation.
    } catch (error) {
      if (!allowed()) return;
      if (error instanceof AccessError && ['authentication', 'consent'].includes(error.kind)) {
        runtime.suspendAccess();
        clear();
      } else latest = { scope: current, error: error instanceof AccessError && error.kind === 'network' ? 'delayed' : 'unavailable' };
    } finally {
      await platform(async () => {
        if (!allowed()) {
          if (!scope()) await clearNotifications();
          return;
        }
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
    if (!force && latest?.scope === current && Date.now() - lastCheck < NAVIGATION_INTERVAL) return;
    lastCheck = Date.now();
    const done = read(current);
    const request = { scope: current, done };
    flight = request;
    try { await done; }
    finally { if (flight === request) flight = undefined; }
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

  function displayCandidate(alertId: string) {
    const current = scope();
    const value = latest?.status;
    if (!current || latest?.scope !== current || value?.sessionStatus !== 'ACTIVE') return;
    const local = runtime.snapshot();
    const submission = local.userAnalysis?.submissions.find(a => a.alertId === alertId);
    if (!submission || !local.session || !matchesDecision(submission, value.currentDecision)) return;
    const receipt = local.notifications.find(r => r.alertId === alertId);
    const alert = value.alert;
    // The status endpoint omits a candidate after the server has recorded shownAt.
    if (alert ? alert.alertType !== 'AI' || alert.alertId !== alertId || alert.goalText !== local.session.goalText
      || !matchesDecision(alert, value.currentDecision) : !receipt) return;
    return { session: local.session, receipt, viewId: submission.viewId };
  }

  function notificationToKeep() {
    const alert = latest?.status?.alert;
    if (alert?.alertType === 'AI' && displayCandidate(alert.alertId)) return alert.alertId;
    // Keep submitted notifications until a verified decision or access change supersedes them.
    if (latest?.error) {
      const { userAnalysis, notifications } = runtime.snapshot();
      return userAnalysis?.submissions.find(a => matchesDecision(a, userAnalysis.cursor.current)
        && !notifications.some(r => r.alertId === a.alertId))?.alertId;
    }
  }
  const submissionFor = (viewId: string) => runtime.snapshot().userAnalysis?.submissions.find(a => a.viewId === viewId);
  async function detail(viewId: string): Promise<AlertDetail | undefined> {
    if (!await hasMockPermission()) return;
    const alertId = submissionFor(viewId)?.alertId;
    const candidate = alertId && displayCandidate(alertId);
    if (!candidate) return;
    const receipt = candidate.receipt;
    return {
      goal: candidate.session.goalText,
      shown: !!receipt,
      ...(receipt?.selection ? { action: receipt.selection.action, acknowledged: receipt.selectionAck === true } : {}),
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
      const alertId = submissionFor(viewId)?.alertId;
      if (scope() !== current || !alertId) return;
      if (type === 'alert-open' || type === 'alert-select') {
        if (type === 'alert-select') await flight?.done;
        await poll(true);
      }
      if (!await hasMockPermission() || scope() !== current) return;
      const allowed = () => scope() === current && displayCandidate(alertId)?.viewId === viewId;
      const candidate = displayCandidate(alertId);
      if (!candidate) return;
      if (type === 'alert-shown') {
        if (!candidate.receipt) await runtime.recordShown({ sessionId: candidate.session.sessionId, alertId }, new Date(receivedAt).toISOString(), allowed);
        void platform(() => clearNotification(PREFIX + alertId)).catch(() => {});
      }
      if (type === 'alert-select') {
        if (!candidate.receipt || candidate.receipt.selection) return;
        await runtime.selectAlert(alertId, { action: request.action,
          selectedAt: new Date(Math.max(receivedAt, Date.parse(candidate.receipt.shownAt))).toISOString() }, allowed);
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
    if (alarm.name !== ALARM) return;
    wake(true);
    if (runtime.snapshot().notifications.some(notificationPending)) {
      void runtime.flushNotifications().catch(() => {});
    }
  });
  chrome.permissions.onRemoved.addListener(permission => {
    if (permission.origins?.includes('http://127.0.0.1/*')) clear();
  });
  chrome.notifications.onPermissionLevelChanged.addListener(level => {
    if (level === 'denied') void platform(() => clearNotifications()).catch(() => {});
    else wake(true);
  });
  chrome.notifications.onClicked.addListener(id => {
    const alertId = id.startsWith(PREFIX) ? parseAlertKey(id.slice(PREFIX.length)) : undefined;
    if (!alertId) return;
    const acceptedEpoch = epoch;
    void (async () => {
      await poll(true);
      if (!await hasMockPermission() || epoch !== acceptedEpoch) return;
      const candidate = displayCandidate(alertId);
      if (candidate) await chrome.tabs.create({ url: alertUrl(candidate.viewId) });
    })().catch(() => {});
  });
  void ready.then(async () => {
    if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
    wake();
  }).catch(() => {});
  return { analysis, command, clear, wake };
}
