import { setCredential } from '../src/api/auth-fetch';
import { serialExecutor } from '../src/background/serial';
import { normalizeGoal } from '../src/shared/goal';
import { installV2Browser } from '../src/v2/browser';
import { USER_DB, USER_POPUP } from './mock-config';
import { parseCommand, trustedPopup, type UserReply, type UserSnapshot } from './protocol';
import { commandError, createMockTransport, hasMockPermission, logout, saveSyntheticConsent } from './transport';

installV2Browser({
  uiPath: USER_POPUP,
  user: {
    databaseName: USER_DB,
    transport: createMockTransport(),
    setup(runtime, ready, capture, stamp) {
      const commandQueue = serialExecutor();
      const hydrated = ready.catch(() => {});
      async function snapshot(): Promise<UserSnapshot> {
        const permitted = await hasMockPermission();
        const s = runtime.snapshot();
        const access = runtime.accessSnapshot();
        const own = access.ownerVerified;
        const visible = !s.owner || own;
        return {
          lifecycle: visible ? s.lifecycle : 'IDLE',
          access: s.accessError === 'account' ? 'account'
            : !access.authenticated ? 'auth'
            : access.withdrawn || s.withdrawal ? 'withdrawn'
            : !access.serverVerified && s.accessError !== 'consent' ? 'ready'
            : !access.consentValid ? 'consent'
            : !access.collectionEnabled ? 'denied' : 'ready',
          connection: access.serverVerified && !access.reconnectRequired ? 'verified' : 'unverified',
          collecting: permitted && runtime.collecting(),
          permission: permitted,
          storageFailed: s.storageFailed,
          reconnectRequired: own && access.reconnectRequired,
          privacyHold: own && !!s.quarantine && s.quarantineClose?.phase !== 'acknowledged',
          withdrawalPending: own && !!s.withdrawal && s.withdrawal.phase !== 'acknowledged',
          deliveryIssue: own && [s.end, ...s.posts.entries, ...s.behaviors.entries].some(e =>
            e?.phase === 'failed' || e?.phase === 'retry-wait'),
          analysis: 'unconnected',
          ...(own && s.start ? { goal: s.start.goalText, startedAt: s.session?.startedAt } : {}),
        };
      }
      async function refresh() {
        await runtime.verifyAccess(false, true);
        const state = runtime.snapshot();
        if (runtime.accessSnapshot().reconnectRequired && state.collectionAllowed && !state.quarantine && !state.storageFailed && await hasMockPermission()) {
          await runtime.resumeUserSession();
          await capture();
        }
      }
      void hydrated.then(() => commandQueue(async () => {
        if (runtime.accessSnapshot().reconnectRequired && runtime.snapshot().collectionAllowed) await refresh();
      })).catch(() => {});

      return (message, sender, reply) => {
        const command = parseCommand(message);
        if (!trustedPopup(sender, chrome.runtime.id, chrome.runtime.getURL(USER_POPUP)) || !command) {
          reply({ error: 'invalid' } satisfies UserReply);
          return false;
        }
        const received = stamp();
        const run = async (): Promise<UserReply> => {
          await hydrated;
          try {
            const s = runtime.snapshot();
            const own = runtime.accessSnapshot().ownerVerified;
            switch (command.type) {
              case 'status': break;
              case 'access': await refresh(); break;
              case 'login':
                runtime.suspendAccess();
                await setCredential(command.token);
                await refresh();
                if (!runtime.accessSnapshot().reconnectRequired && s.lifecycle === 'END_PENDING') await runtime.retry();
                break;
              case 'logout':
                runtime.suspendAccess();
                await logout();
                break;
              case 'agree':
                if (s.storageFailed || s.withdrawal) throw new Error('V2_BLOCKED');
                await saveSyntheticConsent((await runtime.verifyAccess(false, true)).policy);
                await refresh();
                break;
              case 'start':
              case 'retry-start': {
                const goal = command.type === 'start' && ['IDLE', 'ENDED'].includes(s.lifecycle) ? normalizeGoal(command.goal)
                  : command.type === 'retry-start' && s.lifecycle === 'START_PENDING' && own ? s.start?.goalText : undefined;
                if (!goal || s.storageFailed || !await hasMockPermission()) throw new Error('V2_BLOCKED');
                try { await runtime.start(goal); }
                catch (error) {
                  if (commandError(error) === 'auth') runtime.suspendAccess();
                  throw error;
                }
                await capture();
                break;
              }
              case 'stop':
                if (!own || s.lifecycle !== 'ACTIVE' || s.session?.startedAt !== command.startedAt || s.withdrawal) throw new Error('V2_BLOCKED');
                await runtime.stop(received);
                break;
              case 'reconnect':
                if (!await hasMockPermission()) throw new Error('V2_BLOCKED');
                await runtime.resumeUserSession();
                await capture();
                break;
              case 'retry':
                if (!own) throw new Error('V2_BLOCKED');
                if (s.lifecycle === 'ACTIVE' && runtime.accessSnapshot().reconnectRequired && !s.quarantine) await refresh();
                await runtime.retry();
                break;
              case 'withdraw':
                runtime.suspendAccess();
                await runtime.withdrawAll(received.wall);
                break;
            }
            return { snapshot: await snapshot() };
          } catch (error) {
            return { snapshot: await snapshot(), error: commandError(error) };
          }
        };
        // State reads stay responsive during HTTP. A verified owner's stop intent enters the runtime immediately.
        const operation = command.type === 'status' || command.type === 'stop' ? run() : commandQueue(run);
        void operation.then(reply, () => reply({ error: 'blocked' }));
        return true;
      };
    },
  },
});
