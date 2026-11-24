import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL } from '../src/api/client';
import { AccessError } from '../src/api/auth-fetch';
import { SessionEndError } from '../src/api/session-end';
import { VisitApiError } from '../src/api/visit';
import { normalizeGoal, validGoal } from '../src/shared/goal';
import { V2Repository } from '../src/v2/repository';
import { V2Runtime, type V2Transport } from '../src/v2/runtime';
import { fixtureId, FIXTURE_ORIGIN } from '../synthetic/catalog';
import { assertMockOrigin, MOCK_ORIGIN, USER_DB } from '../user/mock-config';
import { isUserSnapshot, parseCommand, trustedPopup, type UserSnapshot } from '../user/protocol';
import { observation, session, syntheticAccess, time } from './v2-fixture';

const ended = { ...session, status: 'ENDED' as const, endedAt: '2026-11-10T00:10:00.000Z' };
const snapshot: UserSnapshot = { lifecycle: 'IDLE', access: 'ready', connection: 'verified', collecting: false,
  permission: true, storageFailed: false, reconnectRequired: false, deliveryIssue: false, privacyHold: false,
  analysis: 'unconnected', withdrawalPending: false };

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
