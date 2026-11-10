import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../src/v2/state';
const fixture = vi.hoisted(() => ({
  access: { participantId: '97000000-0000-4000-8000-000000000001', consentId: '97000000-0000-4000-8000-000000000002', expiresAt: '2099-01-01T00:00:00.000Z', consentValid: true, collectionEnabled: true, withdrawn: false, policy: null },
  request: vi.fn(), start: vi.fn(), message: undefined as undefined | ((m: unknown, sender: unknown, reply: (v: unknown) => void) => void),
}));
vi.mock('../src/v2/access', async original => ({ ...await original<object>(), readCollectionAccess: async () => fixture.access, accessRequest: fixture.request }));
vi.mock('../src/v2/repository', async original => ({ ...await original<object>(), V2Repository: class { async load() { return initialState('http://localhost:8080'); } async save() {} } }));
vi.mock('../src/api/client', async original => ({ ...await original<object>(), postJson: fixture.start }));
import { installV2Browser } from '../src/v2/browser';

describe('participant package fail-closed boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', { runtime: { id: 'extension', getURL: (p: string) => `chrome-extension://extension/${p}`, onMessage: { addListener: (f: typeof fixture.message) => { fixture.message = f; } } }, alarms: { create: vi.fn() } });
    fixture.request.mockResolvedValue([{ plannedSessionId: 'PLAN-001', goalStatus: 'CONFIRMED', goalText: 'Synthetic public catalog research' }]);
  });
  const send = (type: string, body = {}, sender = { id: 'extension', url: 'chrome-extension://extension/participant/index.html' }) => new Promise<any>(resolve => fixture.message!({ type: `v2-${type}`, ...body }, sender, resolve));
  it('server collectionEnabled=true cannot open a locked build', async () => {
    installV2Browser({ uiPath: 'participant/index.html', pilot: false, participant: true });
    const access = await send('access');expect(access.access.collectionEnabled).toBe(false);
    expect(await send('start', { plannedSessionId: 'PLAN-001' })).toEqual({ error: 'V2_BLOCKED' });
    expect(fixture.start).not.toHaveBeenCalled();
    expect((await send('status')).collectionAllowed).toBe(false);
  });
  it('untrusted document payload cannot enter the runtime', async () => {
    installV2Browser({ uiPath: 'participant/index.html', pilot: false, participant: true });
    expect(await send('observation', { raw: 'https://example.org', content: 'Never persist this page' }, { id: 'extension', url: 'https://example.org' })).toBeUndefined();
    expect(fixture.start).not.toHaveBeenCalled();
    const state = await send('status');expect(state.validVisits).toBe(0);expect(state.pending).toBe(0);
    expect(JSON.stringify(state)).not.toContain('Never persist');
  });
});
