import { AccessError, accessGeneration } from '../src/api/auth-fetch';
import { serialExecutor } from '../src/background/serial';
import { normalizeGoal } from '../src/shared/goal';
import { installV2Browser } from '../src/v2/browser';
import { notificationPending } from '../src/v2/notifications';
import { installUserAnalysis } from './analysis';
import { USER_DB, USER_POPUP } from './mock-config';
import { alertUrl, isPrivacyCommand, parseAlertCommand, parseCommand, trustedPopup, type UserReply, type UserSnapshot } from './protocol';
import { commandError, createMockTransport, hasMockPermission, login, logout, rememberLogout,
  saveSyntheticConsent, serverStatus, suspendUserHttp } from './transport';

installV2Browser({
  uiPath: USER_POPUP,
  user: {
    databaseName: USER_DB,
    transport: createMockTransport(),
    setup(runtime, ready, capture, stamp) {
      const commandQueue = serialExecutor();
      const accountQueue = serialExecutor();
      const pendingPrivacy = new Map<string, Promise<UserReply>>();
      let privacyVersion = 0;
      const hydrated = ready.catch(() => {});
      const restored = hydrated.then(() => commandQueue(async () => {
        if (runtime.accessSnapshot().reconnectRequired && runtime.snapshot().collectionAllowed) await refresh();
      })).catch(() => {});
      const alerts = installUserAnalysis(runtime, restored);
      let stopHandle: { sessionId: string; value: Promise<string> } | undefined;

      function currentStopHandle() {
        const s = runtime.snapshot();
        const sessionId = s.session?.sessionId;
        if (!sessionId || !s.start || s.lifecycle !== 'ACTIVE' || !runtime.accessSnapshot().ownerVerified) return;
        if (stopHandle?.sessionId !== sessionId) {
          // Derive a stable UI handle from durable values without sending either internal ID.
          const input = new TextEncoder().encode(`focus-user-stop:${sessionId}:${s.start.idempotencyKey}`);
          const value = crypto.subtle.digest('SHA-256', input)
            .then(hash => Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''));
          stopHandle = { sessionId, value };
        }
        return stopHandle;
      }
      async function snapshot(): Promise<UserSnapshot> {
        const permitted = await hasMockPermission();
        const handle = currentStopHandle();
        const sessionHandle = await handle?.value;
        const s = runtime.snapshot();
        const access = runtime.accessSnapshot();
        const own = access.ownerVerified;
        const visible = !s.owner || own;
        if (own && s.lifecycle === 'ACTIVE' && s.session?.sessionId !== handle?.sessionId) return snapshot();
        const server = serverStatus();
        if (!access.authenticated && ['verified', 'stale'].includes(server.connection)) server.connection = 'auth-required';
        return {
          lifecycle: visible ? s.lifecycle : 'IDLE',
          access: s.accessError === 'account' ? 'account'
            : !access.authenticated ? 'auth'
            : access.withdrawn || s.withdrawal ? 'withdrawn'
            : server.connection === 'denied' ? 'denied'
            : s.accessError === 'network' ? 'ready'
            : !access.consentValid ? 'consent'
            : !access.collectionEnabled ? 'denied' : 'ready',
          ...server,
          privacyPending: access.privacyPending,
          collecting: permitted && runtime.collecting(),
          permission: permitted,
          storageFailed: s.storageFailed,
          reconnectRequired: own && access.reconnectRequired,
          privacyHold: own && !!s.quarantine && s.quarantineClose?.phase !== 'acknowledged',
          withdrawalPending: own && !!s.withdrawal && s.withdrawal.phase !== 'acknowledged',
          deliveryIssue: own && [s.end, ...s.posts.entries, ...s.behaviors.entries].some(e =>
            e?.phase === 'failed' || e?.phase === 'retry-wait'),
          ...alerts.analysis(permitted),
          receiptPending: own && s.notifications.some(notificationPending),
          ...(own && s.start ? { goal: s.start.goalText, startedAt: s.session?.startedAt,
            ...(s.lifecycle === 'ACTIVE' ? { sessionHandle } : {}) } : {}),
        };
      }
      async function refresh() {
        try {
          await runtime.verifyAccess(false, true);
          const state = runtime.snapshot();
          if (runtime.accessSnapshot().reconnectRequired && state.collectionAllowed && !state.quarantine && !state.storageFailed && await hasMockPermission()) {
            await runtime.resumeUserSession();
            await capture();
          }
        } finally {
          if (runtime.alertScope()) alerts.wake(true);
          else alerts.clear();
        }
      }
      return (message, sender, reply) => {
        const command = parseCommand(message);
        const detail = parseAlertCommand(message);
        if (detail && trustedPopup(sender, chrome.runtime.id, alertUrl(detail.viewId))) {
          if (detail.type === 'alert-shown' && sender.tab?.active !== true) {
            reply({ error: 'blocked' });
            return false;
          }
          void alerts.command(detail).then(value => reply({ detail: value }), () => reply({ error: 'blocked' }));
          return true;
        }
        if (!trustedPopup(sender, chrome.runtime.id, chrome.runtime.getURL(USER_POPUP)) || !command) {
          reply({ error: 'invalid' } satisfies UserReply);
          return false;
        }
        const received = stamp();
        if (isPrivacyCommand(command.type)) {
          const type = command.type;
          const existing = pendingPrivacy.get(type);
          if (existing) { void existing.then(reply, () => reply({ error: 'blocked' })); return true; }
          const identity = runtime.accessSnapshot();
          if (type === 'withdraw' && (!identity.authenticated || runtime.snapshot().owner && !identity.ownerVerified)) {
            void snapshot().then(s => reply({ snapshot: s, error: 'auth' } satisfies UserReply), () => reply({ error: 'blocked' }));
            return true;
          }
          const credential = accessGeneration();
          privacyVersion++;
          const resumeRuntime = runtime.beginUserPrivacyChange();
          const resumeHttp = suspendUserHttp();
          void alerts.clear(true);
          const savedLogout = type === 'logout' ? rememberLogout().catch(() => {}) : undefined;
          // Order credential writes and privacy operations independently of normal session HTTP.
          const operation = accountQueue(async (): Promise<UserReply> => {
            let error: ReturnType<typeof commandError> | undefined;
            try {
              await hydrated;
              if (type === 'logout') { await savedLogout; await logout(); }
              else {
                if (credential !== accessGeneration()) throw new AccessError('account');
                await runtime.withdrawAll(received.wall);
              }
            } catch (failure) { error = commandError(failure); }
            finally { resumeHttp(); resumeRuntime(); }
            return { snapshot: await snapshot(), ...(error ? { error } : {}) };
          }).finally(() => pendingPrivacy.delete(type));
          pendingPrivacy.set(type, operation);
          void operation.then(reply, () => reply({ error: 'blocked' }));
          return true;
        }
        const acceptedVersion = privacyVersion;
        const checkCommand = () => {
          if (acceptedVersion !== privacyVersion || pendingPrivacy.size) throw new Error('V2_BLOCKED');
        };
        const run = async (): Promise<UserReply> => {
          await hydrated;
          try {
            if (command.type !== 'status') checkCommand();
            const s = runtime.snapshot();
            const own = runtime.accessSnapshot().ownerVerified;
            switch (command.type) {
              case 'status': break;
              case 'analysis-refresh': alerts.wake(true); break;
              case 'access': await refresh(); break;
              case 'login':
                await accountQueue(async () => {
                  checkCommand();
                  runtime.suspendAccess();
                  await alerts.clear(true);
                  await login(command.token);
                });
                checkCommand();
                await refresh();
                checkCommand();
                if (!runtime.accessSnapshot().reconnectRequired && s.lifecycle === 'END_PENDING') await runtime.retry();
                break;
              case 'agree': {
                if (s.storageFailed || s.withdrawal) throw new Error('V2_BLOCKED');
                const { policy } = await runtime.verifyAccess(false, true);
                checkCommand();
                await saveSyntheticConsent(policy);
                await refresh();
                break;
              }
              case 'start':
              case 'retry-start': {
                const goal = command.type === 'start' && ['IDLE', 'ENDED'].includes(s.lifecycle) ? normalizeGoal(command.goal)
                  : command.type === 'retry-start' && s.lifecycle === 'START_PENDING' && own ? s.start?.goalText : undefined;
                if (!goal || s.storageFailed || !await hasMockPermission()) throw new Error('V2_BLOCKED');
                checkCommand();
                try { await runtime.start(goal); }
                catch (error) {
                  if (acceptedVersion === privacyVersion && commandError(error) === 'auth') runtime.suspendAccess();
                  throw error;
                }
                await capture();
                alerts.wake(true);
                break;
              }
              case 'stop': {
                const handle = currentStopHandle();
                if (!handle || await handle.value !== command.sessionHandle) throw new Error('V2_BLOCKED');
                checkCommand();
                const current = runtime.snapshot();
                if (!runtime.accessSnapshot().ownerVerified || current.lifecycle !== 'ACTIVE'
                  || current.session?.sessionId !== handle.sessionId || current.withdrawal) throw new Error('V2_BLOCKED');
                const stopped = runtime.stop(received);
                void alerts.clear(true);
                await stopped;
                break;
              }
              case 'reconnect':
                if (!await hasMockPermission()) throw new Error('V2_BLOCKED');
                checkCommand();
                await runtime.resumeUserSession();
                await capture();
                alerts.wake(true);
                break;
              case 'retry':
                if (!own) throw new Error('V2_BLOCKED');
                if (s.lifecycle === 'ACTIVE' && runtime.accessSnapshot().reconnectRequired && !s.quarantine) await refresh();
                checkCommand();
                await runtime.retry();
                await runtime.flushNotifications();
                break;
            }
            return { snapshot: await snapshot() };
          } catch (error) {
            return { snapshot: await snapshot(), error: acceptedVersion === privacyVersion ? commandError(error) : 'blocked' };
          }
        };
        const operation = command.type === 'status' || command.type === 'analysis-refresh' || command.type === 'stop' ? run() : commandQueue(run);
        void operation.then(reply, () => reply({ error: 'blocked' }));
        return true;
      };
    },
  },
});
