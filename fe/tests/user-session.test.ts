import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL } from '../src/api/client';
import { AccessError, setCredential } from '../src/api/auth-fetch';
import { SessionEndError } from '../src/api/session-end';
import { VisitApiError } from '../src/api/visit';
import { normalizeGoal, validGoal } from '../src/shared/goal';
import { V2Repository } from '../src/v2/repository';
import { V2Runtime, type V2Transport } from '../src/v2/runtime';
import type { Decision, V2Alert } from '../src/v2/status';
import { fixtureId, FIXTURE_ORIGIN } from '../synthetic/catalog';
import { assertMockOrigin, MOCK_ORIGIN, USER_DB } from '../user/mock-config';
import { isUserSnapshot, parseAlertCommand, parseCommand, trustedPopup, type UserSnapshot } from '../user/protocol';
import { observation, session, syntheticAccess, time } from './v2-fixture';

const ended = { ...session, status: 'ENDED' as const, endedAt: '2026-11-10T00:10:00.000Z' };
const snapshot: UserSnapshot = { lifecycle: 'IDLE', access: 'ready', connection: 'verified', collecting: false,
  serverCheckedAt: 1, privacyPending: false, permission: true, storageFailed: false, reconnectRequired: false, deliveryIssue: false, privacyHold: false,
  analysis: 'unconnected', withdrawalPending: false, receiptPending: false };

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange); });
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const repo = new V2Repository(API_BASE_URL, USER_DB);
  const transport: V2Transport = {
    access: vi.fn(async () => syntheticAccess),
    start: vi.fn(async () => session),
    query: vi.fn(async () => session),
    post: vi.fn(async v => ({ ...v, updatedAt: null })),
    patch: vi.fn(async (_session, visitId, b) => ({ visitId, ...b, applied: true, updatedAt: '2026-11-10T00:01:00.000Z' })),
    end: vi.fn(async () => ended),
  };
  return { repo, transport, runtime: new V2Runtime(repo, transport, false, true) };
}
async function until(check: () => boolean) {
  await vi.waitFor(() => expect(check()).toBe(true), { interval: 10, timeout: 3000 });
}

describe('user message and build boundaries', () => {
  it.each([
    ['', false], [' \u3000\t ', false], ['공부하기', false], [' 공부를하기 ', true],
    ['가'.repeat(150), true], ['가'.repeat(151), false], ['😀😀', false], ['😀😀한', true],
    ['\u001c5글자이상\u2003', true], ['\u00a0abcd', true],
  ])('uses the shared BE-compatible goal validation for %j', (goal, allowed) => {
    expect(validGoal(goal)).toBe(allowed);
    expect(!!parseCommand({ type: 'start', goal })).toBe(allowed);
  });
  it('preserves Java strip and UTF-16 length semantics', () => {
    expect(normalizeGoal('\u001c한글과 😀\u2000')).toBe('한글과 😀');
    expect(normalizeGoal('\u00a0한글\u202f')).toBe('\u00a0한글\u202f');
  });
  it('rejects unknown and extra payloads, non-mock credentials and invalid stop identity', () => {
    for (const message of [
      null, [], { type: 'v2-start' }, { type: 'start', goal: 12 }, { type: 'agree', policyId: 'arbitrary' },
      { type: 'login', token: 'x'.repeat(64) }, { type: 'stop', startedAt: false },
    ]) expect(parseCommand(message)).toBeUndefined();
    expect(parseCommand({ type: 'withdraw' })).toEqual({ type: 'withdraw' });
    expect(parseCommand({ type: 'stop', startedAt: session.startedAt })).toBeUndefined();
    expect(parseCommand({ type: 'stop', sessionHandle: 'z'.repeat(64) })).toBeUndefined();
    expect(parseCommand({ type: 'stop', sessionHandle: 'a'.repeat(64) })).toEqual({ type: 'stop', sessionHandle: 'a'.repeat(64) });
  });
  it('accepts only the registered popup document, not a content sender, iframe or another extension', () => {
    const url = 'chrome-extension://test/user/index.html';
    const sender: chrome.runtime.MessageSender = { id: 'test', url, frameId: 0, documentLifecycle: 'active' };
    expect(trustedPopup(sender, 'test', url)).toBe(true);
    expect(trustedPopup({ ...sender, url: FIXTURE_ORIGIN, tab: { id: 7 } as chrome.tabs.Tab }, 'test', url)).toBe(false);
    expect(trustedPopup({ ...sender, id: 'other' }, 'test', url)).toBe(false);
    expect(trustedPopup({ ...sender, origin: 'null' }, 'test', url)).toBe(false);
    expect(trustedPopup({ ...sender, frameId: 1 }, 'test', url)).toBe(false);
    expect(trustedPopup({ ...sender, documentLifecycle: 'cached' }, 'test', url)).toBe(false);
  });
  it('rejects invalid snapshots and impossible collecting states', () => {
    expect(isUserSnapshot(snapshot)).toBe(true);
    expect(isUserSnapshot({ ...snapshot, collecting: true })).toBe(false);
    expect(isUserSnapshot({ ...snapshot, lifecycle: 'ACTIVE' })).toBe(false);
    expect(isUserSnapshot({ ...snapshot, analysis: 'DRIFT' })).toBe(false);
    expect(isUserSnapshot({ ...snapshot, analysis: 'failed', finalState: 'NORMAL' })).toBe(false);
  });
  it('accepts only a detail key and the two actions, with the Worker assigning receipt times', () => {
    const viewId = crypto.randomUUID();
    const select = { type: 'alert-select', viewId, action: 'RETURN_TO_GOAL' };
    expect(parseAlertCommand(select)).toEqual(select);
    expect(parseAlertCommand({ ...select, action: 'STOP' })).toBeUndefined();
    expect(parseAlertCommand({ ...select, selectedAt: session.startedAt })).toBeUndefined();
    expect(parseAlertCommand({ ...select, viewId: 'other' })).toBeUndefined();
    expect(parseCommand(select)).toBeUndefined();
  });
  it('rejects foreign origins, non-catalog paths and catalog prototype names', () => {
    expect(() => assertMockOrigin(MOCK_ORIGIN)).not.toThrow();
    for (const api of ['https://api.example.invalid', 'http://127.0.0.1:8911', MOCK_ORIGIN + '/api', MOCK_ORIGIN + '@example.invalid'])
      expect(() => assertMockOrigin(api)).toThrow();
    expect(fixtureId(FIXTURE_ORIGIN + '/__focus_synthetic__/a')).toBe('a');
    for (const url of [MOCK_ORIGIN + '/__focus_synthetic__/a', FIXTURE_ORIGIN + '/__focus_synthetic__/constructor', FIXTURE_ORIGIN + '/a'])
      expect(fixtureId(url)).toBeUndefined();
  });
});

describe('user Runtime lifecycle and recovery', () => {
  it('restores legacy and interrupted handoffs as uncertain while preserving an unstarted reservation', async () => {
    const { runtime, repo, transport } = setup();
    await runtime.initialize();
    await runtime.start(session.goalText);
    const decision: Decision = {
      windowId: crypto.randomUUID(), windowIndex: 1, analysisId: crypto.randomUUID(), stateVersion: 1,
      decisionStatus: 'COMPLETED', finalState: 'DRIFT', judgedAt: session.startedAt, errorCode: null,
    };
    const checkpoint = runtime.snapshot();
    checkpoint.userAnalysis = { cursor: { current: decision, completed: decision }, observedAt: Date.now(),
      submissions: ([undefined, 'submitting', 'reserved'] as const).map(phase => ({
        phase, viewId: crypto.randomUUID(), alertId: crypto.randomUUID(), windowId: decision.windowId,
        windowIndex: 1, analysisId: decision.analysisId!, stateVersion: 1,
      })) };
    await repo.save(checkpoint, checkpoint.revision);
    const restarted = new V2Runtime(repo, transport, false, true);
    await restarted.initialize();
    const restored = restarted.snapshot().userAnalysis!.submissions;
    expect(restored.map(a => a.phase)).toEqual(['uncertain', 'uncertain', 'reserved']);
    expect(restored.map(a => a.viewId)).toEqual(checkpoint.userAnalysis.submissions.map(a => a.viewId));
    expect(restarted.snapshot().notifications).toEqual([]);
  });
  it('retires an unsubmitted reservation when the verified candidate disappears', async () => {
    const { runtime } = setup();
    await runtime.initialize();
    await runtime.start(session.goalText);
    const current: Decision = {
      windowId: crypto.randomUUID(), windowIndex: 1, analysisId: crypto.randomUUID(), stateVersion: 1,
      decisionStatus: 'COMPLETED', finalState: 'DRIFT', judgedAt: session.startedAt, errorCode: null,
    };
    const submission = { alertId: crypto.randomUUID(), viewId: crypto.randomUUID(), windowId: current.windowId,
      windowIndex: 1, analysisId: current.analysisId!, stateVersion: 1 };
    const alert: V2Alert = { ...submission, alertType: 'AI', createdAt: session.startedAt, shownAt: null,
      sessionId: session.sessionId, goalText: session.goalText, message: 'Synthetic goal reminder' };
    const scope = runtime.alertScope();
    const allowed = () => runtime.alertScope() === scope;
    const cursor = { current, completed: current };
    await runtime.checkpointAnalysis(cursor, alert, allowed);
    expect(await runtime.claimAlert(submission, allowed)).toBe(true);
    await runtime.checkpointAnalysis(cursor, null, allowed);
    expect(runtime.snapshot().userAnalysis!.submissions[0].phase).toBe('retired');
    expect(await runtime.updateAlertSubmission({ ...submission, phase: 'reserved' }, 'submitting', allowed)).toBe(false);
  });
  it('keeps a delayed shown ACK out of a replacement session', async () => {
    const { runtime, transport } = setup();
    await runtime.initialize();
    await runtime.start(session.goalText);
    const shownAt = new Date().toISOString(), alertId = crypto.randomUUID();
    let reply!: (value: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { reply = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const scope = runtime.alertScope();
    await runtime.recordShown({ sessionId: session.sessionId, alertId }, shownAt, () => runtime.alertScope() === scope);
    await until(() => !!reply);
    await runtime.stop(time(1000));
    await until(() => runtime.snapshot().lifecycle === 'ENDED');
    vi.mocked(transport.start).mockResolvedValueOnce({ ...session, sessionId: crypto.randomUUID(), goalText: 'New synthetic task' });
    await runtime.start('New synthetic task');
    reply(Response.json({ alertId, shownAt }));
    await runtime.flushNotifications();
    expect(runtime.snapshot().notifications).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([null, { ...session, collectionSpecVersion: '1.0' }, { ...session, goalText: 'Different goal' }])(
    'does not activate an invalid creation ACK %j', async answer => {
      const { runtime, transport } = setup();
      vi.mocked(transport.start).mockResolvedValueOnce(answer);
      await runtime.initialize();
      await expect(runtime.start(session.goalText)).rejects.toThrow('V2_VERSION_OR_SESSION_MISMATCH');
      expect(runtime.snapshot().lifecycle).toBe('START_PENDING');
      expect(runtime.collecting()).toBe(false);
    });
  it('persists the frozen start before HTTP; rejects concurrency and keeps the key across Worker restart', async () => {
    const { runtime, repo, transport } = setup();
    await runtime.initialize();
    let lose!: (error: unknown) => void;
    vi.mocked(transport.start).mockImplementationOnce(() => new Promise((_, reject) => { lose = reject; }));
    const inFlight = runtime.start(session.goalText);
    const rejected = expect(inFlight).rejects.toThrow('lost');
    await until(() => !!lose);
    await expect(runtime.start(session.goalText)).rejects.toThrow('V2_START_IN_FLIGHT');
    const pending = await repo.load();
    expect(pending.lifecycle).toBe('START_PENDING');
    expect(pending.start?.plannedSessionId).toBeUndefined();
    lose(new Error('lost'));
    await rejected;
    repo.close();
    const restarted = new V2Runtime(new V2Repository(API_BASE_URL, USER_DB), transport, false, true);
    await restarted.initialize();
    await expect(restarted.start('Different pending goal')).rejects.toThrow('V2_START_CONFLICT');
    await restarted.start(session.goalText);
    expect(transport.start).toHaveBeenLastCalledWith(session.goalText, pending.start!.idempotencyKey);
    expect(restarted.collecting()).toBe(true);
  });
  it('requires start access and protects the collection database namespace', async () => {
    const { runtime, repo, transport } = setup();
    vi.mocked(transport.access).mockRejectedValueOnce(new AccessError('authentication'));
    await expect(runtime.start(session.goalText)).rejects.toThrow('ACCESS_AUTHENTICATION');
    vi.mocked(transport.access).mockResolvedValueOnce({ ...syntheticAccess, collectionEnabled: false });
    await expect(runtime.start(session.goalText)).rejects.toThrow('ACCESS_CONSENT');
    expect(transport.start).not.toHaveBeenCalled();
    await runtime.start(session.goalText);
    expect((await repo.load()).lifecycle).toBe('ACTIVE');
    expect((await new V2Repository(API_BASE_URL).load()).lifecycle).toBe('IDLE');
  });
  it('rechecks owned session after restart, rejects mismatched start time and payload from another user', async () => {
    const { runtime, repo, transport } = setup();
    await runtime.initialize();
    await runtime.start(session.goalText);
    repo.close();
    const restarted = new V2Runtime(new V2Repository(API_BASE_URL, USER_DB), transport, false, true);
    await restarted.initialize();
    expect(restarted.collecting()).toBe(false);
    expect(restarted.accessSnapshot().reconnectRequired).toBe(true);
    await expect(restarted.resume('PLAN-001')).rejects.toThrow('V2_RESUME_BLOCKED');
    vi.mocked(transport.access).mockResolvedValueOnce({ ...syntheticAccess, participantId: crypto.randomUUID() });
    await expect(restarted.resumeUserSession()).rejects.toThrow('ACCESS_ACCOUNT');
    expect(restarted.accessSnapshot().ownerVerified).toBe(false);
    expect(transport.query).not.toHaveBeenCalled();
    vi.mocked(transport.query).mockResolvedValueOnce({ ...session, startedAt: '2026-11-11T00:00:00.000Z' });
    await expect(restarted.resumeUserSession()).rejects.toThrow('V2_RESUME_BLOCKED');
    expect(restarted.collecting()).toBe(false);
    await restarted.resumeUserSession();
    expect(restarted.collecting()).toBe(true);
  });
  it('ignores a late active query after an access change and pauses on expired or withdrawn access', async () => {
    const { runtime, transport } = setup();
    await runtime.initialize(); await runtime.start(session.goalText);
    let respond!: (value: typeof session) => void;
    vi.mocked(transport.query).mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }));
    const reconnect = runtime.resumeUserSession();
    const rejected = expect(reconnect).rejects.toThrow('V2_RESUME_BLOCKED');
    await until(() => !!respond);
    runtime.suspendAccess();
    respond(session);
    await rejected;
    expect(runtime.collecting()).toBe(false);
    vi.mocked(transport.access).mockResolvedValueOnce({ ...syntheticAccess, expiresAt: new Date(0).toISOString() });
    await expect(runtime.resumeUserSession()).rejects.toThrow('ACCESS_AUTHENTICATION');
    vi.mocked(transport.access).mockResolvedValue({ ...syntheticAccess, withdrawn: true, collectionEnabled: false, consentValid: false });
    await expect(runtime.resumeUserSession()).rejects.toThrow('ACCESS_CONSENT');
    expect(runtime.collecting()).toBe(false);
  });
  it('cannot collect or start on a failed storage write', async () => {
    const { runtime, repo, transport } = setup();
    await runtime.initialize();
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new DOMException('storage full', 'QuotaExceededError'));
    await expect(runtime.start(session.goalText)).rejects.toThrow();
    expect(runtime.snapshot().storageFailed).toBe(true);
    expect(runtime.collecting()).toBe(false);
    expect(transport.start).not.toHaveBeenCalled();
  });
  it('confirms a lost END by querying the same session; blocks new starts until confirmed', async () => {
    const { runtime, transport } = setup();
    await runtime.initialize(); await runtime.start(session.goalText);
    vi.mocked(transport.end).mockRejectedValueOnce(new SessionEndError('network', 'lost', true));
    vi.mocked(transport.query).mockResolvedValueOnce(ended);
    await runtime.stop(time(1000));
    expect(runtime.collecting()).toBe(false);
    await expect(runtime.start('A next session goal')).rejects.toThrow('V2_START_BLOCKED');
    await until(() => runtime.snapshot().lifecycle === 'ENDED');
    expect(transport.end).toHaveBeenCalledTimes(1);
    expect(transport.query).toHaveBeenCalledWith(session);
    vi.mocked(transport.start).mockResolvedValueOnce({ ...session, sessionId: crypto.randomUUID(), goalText: 'A next session goal' });
    await runtime.start('A next session goal');
    expect(runtime.collecting()).toBe(true);
  });
  it('preserves the preceding session identity across a lost second start ACK', async () => {
    const { runtime, repo, transport } = setup();
    await runtime.initialize(); await runtime.start(session.goalText);
    await runtime.stop(time(1000));
    await until(() => runtime.snapshot().lifecycle === 'ENDED');
    vi.mocked(transport.start).mockRejectedValueOnce(new Error('lost'));
    await expect(runtime.start(session.goalText)).rejects.toThrow('lost');
    expect((await repo.load()).start?.previousSessionId).toBe(session.sessionId);
    await expect(runtime.start(session.goalText)).rejects.toThrow('V2_VERSION_OR_SESSION_MISMATCH');
  });
  it('retains a local Visit when the server ends before acknowledging data', async () => {
    const { runtime, transport } = setup();
    await runtime.initialize(); await runtime.start(session.goalText);
    await runtime.foreground(1, time(0));
    vi.mocked(transport.post).mockRejectedValue(new VisitApiError('http', 'server ended', false, 409, 'SESSION_ENDED'));
    vi.mocked(transport.query).mockResolvedValue(ended);
    for (let ms = 0; ms <= 5000; ms += 1000) await runtime.observe(observation(ms));
    await runtime.stop(time(5050));
    await until(() => runtime.snapshot().posts.entries[0]?.phase === 'failed');
    expect(runtime.snapshot().lifecycle).toBe('END_PENDING');
    expect(runtime.snapshot().posts.entries[0]?.visit).toBeDefined();
    expect(transport.end).not.toHaveBeenCalled();
  });
});

describe('privacy intent and recent access verification', () => {
  it('drops a previous access success after a newer request has failed', async () => {
    const { runtime, transport } = setup();
    await runtime.initialize();
    await runtime.start(session.goalText);
    let finish!: (access: typeof syntheticAccess) => void;
    vi.mocked(transport.access).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = runtime.verifyAccess();
    const rejected = expect(old).rejects.toThrow('ACCESS_ACCOUNT');
    vi.mocked(transport.access).mockRejectedValueOnce(new AccessError('authentication', 401));
    await expect(runtime.verifyAccess()).rejects.toThrow('ACCESS_AUTHENTICATION');
    finish(syntheticAccess);
    await rejected;
    expect(runtime.collecting()).toBe(false);
    expect(runtime.accessSnapshot().authenticated).toBe(false);
  });

  it('keeps a sent Visit unconfirmed across privacy suspension and rejects new work while access is paused', async () => {
    const { runtime, repo, transport } = setup();
    await runtime.initialize();
    await runtime.start(session.goalText);
    await runtime.foreground(1, time(0));
    let finish!: () => void;
    vi.mocked(transport.post).mockImplementationOnce(visit => new Promise(resolve => {
      finish = () => resolve({ ...visit, updatedAt: null });
    }));
    for (let ms = 0; ms <= 5000; ms += 1000) await runtime.observe(observation(ms));
    await until(() => !!finish);
    const frozen = (await repo.load()).posts.entries[0].visit;
    const resume = runtime.beginUserPrivacyChange();
    expect(runtime.collecting()).toBe(false);
    await expect(runtime.stop(time(5500))).rejects.toThrow('V2_STOP_BLOCKED');
    await expect(runtime.retry()).rejects.toThrow('ACCESS_AUTHENTICATION');
    finish();
    await until(() => runtime.snapshot().posts.entries[0].phase === 'retry-wait');
    expect((await repo.load()).posts.entries[0].visit).toEqual(frozen);
    expect(transport.patch).not.toHaveBeenCalled();
    resume();
    expect(runtime.collecting()).toBe(false);
  });


  it('keeps an old END response pending after the credential switches to another account', async () => {
    vi.stubGlobal('chrome', { storage: { session: { setAccessLevel: async () => {}, set: async () => {} } } });
    const { runtime, transport, repo } = setup();
    await runtime.initialize();
    await runtime.start(session.goalText);
    let finish!: (result: typeof ended) => void;
    vi.mocked(transport.end).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await runtime.stop(time(5500));
    await until(() => !!finish);
    runtime.suspendAccess();
    await setCredential('b'.repeat(43));
    vi.mocked(transport.access).mockResolvedValue({ ...syntheticAccess, participantId: crypto.randomUUID() });
    await expect(runtime.verifyAccess(false, true)).rejects.toThrow('ACCESS_ACCOUNT');
    finish(ended);
    await until(() => runtime.snapshot().end?.phase === 'retry-wait');
    expect((await repo.load()).lifecycle).toBe('END_PENDING');
    expect(runtime.accessSnapshot().ownerVerified).toBe(false);
    expect(runtime.collecting()).toBe(false);
  });

  it('expires the last verification label and fences HTTP after an intervening privacy intent', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', MOCK_ORIGIN);
    try {
      const get = vi.fn(async () => ({}));
      vi.stubGlobal('chrome', { permissions: { contains: async () => true }, storage: { session: { get } } });
      const fetch = vi.fn(async (url: string) => url.endsWith('/me')
        ? Response.json({ participantId: syntheticAccess.participantId, expiresAt: syntheticAccess.expiresAt })
        : Response.json({ ...syntheticAccess, policy: {
          policyId: 'fixture', policyVersion: '1', scope: 'SESSION_COLLECTION', status: 'SYNTHETIC',
          purpose: 'synthetic', collectionItems: 'synthetic', useScope: 'synthetic', effectiveAt: session.startedAt,
          retentionPolicyRef: null, approvalRef: null,
        } }));
      vi.stubGlobal('fetch', fetch);
      const { authenticatedFetch } = await import('../src/api/auth-fetch');
      const { createMockTransport, serverStatus, suspendUserHttp } = await import('../user/transport');
      const transport = createMockTransport();
      expect(serverStatus().connection).toBe('unverified');
      await transport.access();
      const recent = serverStatus();
      expect(recent.connection).toBe('verified');
      expect(serverStatus(recent.serverCheckedAt! + 30_000)).toEqual({ ...recent, connection: 'stale' });
      let finishHttp!: (response: Response) => void;
      fetch.mockImplementationOnce(() => new Promise(resolve => { finishHttp = resolve; }));
      const delayed = authenticatedFetch(MOCK_ORIGIN + '/api/sessions');
      await until(() => !!finishHttp);
      await transport.access();
      const newer = serverStatus();
      finishHttp(new Response(null, { status: 503 }));
      await delayed;
      expect(serverStatus()).toEqual(newer);
      const fetches = fetch.mock.calls.length;
      let finishRead!: (storage: object) => void;
      get.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
      const pending = authenticatedFetch(MOCK_ORIGIN + '/api/sessions', { method: 'POST' });
      const rejected = expect(pending).rejects.toMatchObject({ kind: 'account' });
      const resume = suspendUserHttp();
      finishRead({});
      await rejected;
      expect(fetch).toHaveBeenCalledTimes(fetches);
      expect(serverStatus().connection).toBe('unverified');
      resume();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
