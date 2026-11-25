import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { API_BASE_URL } from '../src/api/client';
import { NotificationDelivery, receiptFailure } from '../src/v2/notification-delivery';
import { NotificationError } from '../src/v2/notifications';
import { initialDelivery, type OutboxReceipt } from '../src/v2/notification-store';
import { V2Repository } from '../src/v2/repository';
import { activeState, session, syntheticAccess } from './v2-fixture';

const owner = { participantId: syntheticAccess.participantId, consentId: syntheticAccess.consentId! };
const scope = { ...owner, sessionId: session.sessionId };
const shownAt = session.startedAt;
const selection = { action: 'RETURN_TO_GOAL' as const, selectedAt: '2026-11-10T00:00:01.000Z' };
const feedbackId = '96000000-0000-4000-8000-000000000001';
let repo: V2Repository;
let now: number;
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  now = Date.parse('2026-11-10T00:05:00.000Z');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  repo = new V2Repository(API_BASE_URL, 'receipt-test');
});
afterEach(() => { repo.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const allowed = () => true;
const json = (value: unknown, status = 200) => Response.json(value, { status });

async function add(options: Partial<OutboxReceipt> = {}) {
  const store = repo.enableNotificationOutbox();
  const entry: OutboxReceipt = { ...scope, alertId: crypto.randomUUID(), apiOrigin: store.origin, shownAt,
    shownAck: false, shownDelivery: initialDelivery(), ...options };
  await store.write(entry, entry.alertId, allowed, () => entry);
  return entry;
}
const lookup = async (id: string) => (await repo.enableNotificationOutbox().list(owner)).find(entry => entry.alertId === id)!;
const sender = (access = allowed, blocked = vi.fn(async () => {})) => new NotificationDelivery(repo.enableNotificationOutbox(),
  async () => ({ scope: owner, allowed: access }), () => {}, blocked);
const history = (entry: OutboxReceipt, shown = entry.shownAt, response: unknown = null, page = 0, hasNext = false) =>
  json({ items: [{ alertId: entry.alertId, sessionId: entry.sessionId, shownAt: shown, response }], page, size: 20, hasNext });
async function seed(values: [string, unknown][]) {
  await repo.load();
  const request = indexedDB.open('receipt-test');
  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('v2', 'readwrite');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      for (const [key, value] of values) tx.objectStore('v2').put(value, key);
    };
  });
}

it('migrates current and archived legacy receipts once, rolls back interrupted migration and preserves isolated records', async () => {
  const legacy = { alertId: crypto.randomUUID(), shownAt, shownAck: true, selection };
  const completed = { ...legacy, alertId: crypto.randomUUID(), selectionAck: true };
  const active = { ...activeState(), owner, notifications: [legacy] };
  const archivedId = crypto.randomUUID(), privateId = crypto.randomUUID(), foreignId = crypto.randomUUID();
  const archive = (sessionId: string) => ({ ...active, session: { ...session, sessionId }, notifications: [completed] });
  const foreign = { ...owner, participantId: crypto.randomUUID() };
  await seed([
    ['current', active],
    ['session/' + archivedId, archive(archivedId)],
    ['session/' + privateId, { ...archive(privateId), quarantine: { reason: 'SENSITIVE_CONTENT' } }],
    ['session/' + foreignId, { ...archive(foreignId), owner: foreign }],
    ['session/' + crypto.randomUUID(), active],
  ]);
  const store = repo.enableNotificationOutbox();
  const put = IDBObjectStore.prototype.add;
  const abort = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(function (this: IDBObjectStore, ...args) {
    const write = put.apply(this, args);
    this.transaction.abort();
    return write;
  });
  await expect(store.migrate(API_BASE_URL)).rejects.toThrow();
  expect(await store.list(owner)).toEqual([]);
  abort.mockRestore();
  await store.migrate(API_BASE_URL);
  await store.migrate(API_BASE_URL);
  expect((await repo.load()).notifications).toEqual([legacy]);
  expect(await store.list(owner)).toEqual(expect.arrayContaining([
    expect.objectContaining({ ...legacy, sessionId: session.sessionId, selectionDelivery: { phase: 'pending', attempts: 0 } }),
    expect.objectContaining({ ...completed, sessionId: archivedId, selectionDelivery: { phase: 'acknowledged', attempts: 0 } }),
  ]));
  expect(await store.list(owner)).toHaveLength(2);
  expect(await store.list(foreign)).toHaveLength(1);
  expect(await store.list({ ...owner, consentId: crypto.randomUUID() })).toEqual([]);
  expect(await new V2Repository('https://other.invalid', 'receipt-test').enableNotificationOutbox().list(owner)).toEqual([]);
});

it('keeps original shown and selection immutable and rolls back a failed write', async () => {
  const store = repo.enableNotificationOutbox();
  const entry = await add({ selection, selectionDelivery: initialDelivery() });
  await expect(store.write(entry, entry.alertId, allowed, old => ({ ...old!, shownAt: selection.selectedAt }))).rejects.toThrow();
  await expect(store.write(entry, entry.alertId, allowed, old => ({
    ...old!, selection: { ...selection, action: 'CONTINUE_BROWSING' },
  }))).rejects.toThrow();
  expect(await lookup(entry.alertId)).toEqual(entry);
  expect(await store.write(entry, entry.alertId, () => false, () => undefined)).toBeUndefined();
});

it('isolates a permanent failure and sends a selection without a prior shown ACK, once despite duplicate wakes', async () => {
  const bad = await add();
  const good = await add({ sessionId: crypto.randomUUID(), selection, selectionDelivery: initialDelivery() });
  const fetcher = vi.fn(async (url: string) => url.includes(bad.alertId) ? json({ code: 'ALERT_NOT_DISPLAYABLE' }, 409)
    : json({ alertId: good.alertId, ...selection, feedbackId }, 201));
  vi.stubGlobal('fetch', fetcher);
  const delivery = sender();
  await Promise.all([delivery.wake(), delivery.wake(), delivery.wake()]);
  expect((await lookup(bad.alertId)).shownDelivery.phase).toBe('rejected');
  expect(await lookup(good.alertId)).toMatchObject({ shownAck: true, selectionAck: true, feedbackId, selection });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.some(([url]) => url.endsWith(good.alertId + '/responses'))).toBe(true);
});

it('persists the 429/backoff and three attempts across sender recreation, then manually verifies history', async () => {
  const entry = await add();
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => init.method === 'PATCH'
    ? new Response('{}', { status: 429, headers: { 'Retry-After': '90' } }) : history(entry, shownAt, null));
  vi.stubGlobal('fetch', fetcher);
  await sender().wake();
  expect((await lookup(entry.alertId)).shownDelivery).toMatchObject({ phase: 'retry-wait', attempts: 1, nextRetryAt: now + 90_000 });
  await sender().wake();
  expect(fetcher).toHaveBeenCalledTimes(1);
  now += 90_000;
  await sender().wake();
  expect((await lookup(entry.alertId)).shownDelivery.attempts).toBe(2);
  now += 120_000;
  fetcher.mockImplementation(async () => json({ code: 'INVALID_REQUEST' }, 503));
  await sender().wake();
  expect((await lookup(entry.alertId)).shownDelivery).toMatchObject({ phase: 'exhausted', attempts: 3 });
  const writes = fetcher.mock.calls.filter(([, init]) => init.method === 'PATCH');
  expect(writes).toHaveLength(3);
  expect(writes.map(([, init]) => init.body)).toEqual(Array(3).fill(JSON.stringify({ shownAt })));
  const calls = fetcher.mock.calls.length;
  await sender().wake();
  expect(fetcher).toHaveBeenCalledTimes(calls);
  fetcher.mockImplementation(async () => history(entry));
  await sender().wake(true, true);
  expect(fetcher.mock.calls.at(-1)![0]).toContain('/alerts?page=0&size=20');
  expect((await lookup(entry.alertId)).shownAck).toBe(true);
});

it('does not trust a wrong-session ACK, checks bounded history and records a proven selection conflict', async () => {
  const entry = await add({ shownAck: true, shownDelivery: initialDelivery(true), selection, selectionDelivery: initialDelivery() });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/responses')
    ? json({ alertId: entry.alertId, ...selection, feedbackId, sessionId: crypto.randomUUID() })
    : url.includes('page=0') ? json({ items: [], page: 0, size: 20, hasNext: true })
    : history(entry, shownAt, { alertId: entry.alertId, ...selection, action: 'CONTINUE_BROWSING', feedbackId }, 1)));
  await sender().wake();
  expect(await lookup(entry.alertId)).toMatchObject({ selection, shownAck: true, selectionDelivery: {
    phase: 'rejected', code: 'RESPONSE_ALREADY_RECORDED',
  } });
  expect((await lookup(entry.alertId)).selectionAck).toBeUndefined();
});

it('fences delayed ACKs and recovers the original sending checkpoint after the durable deadline', async () => {
  const entry = await add();
  let live = true, reply: (value: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { reply = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  const sending = sender(() => live).wake();
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  live = false;
  reply!(json({ alertId: entry.alertId, sessionId: entry.sessionId, shownAt }));
  await sending;
  expect((await lookup(entry.alertId)).shownDelivery).toMatchObject({ phase: 'sending', attempts: 1 });
  await sender().wake();
  expect(fetcher).toHaveBeenCalledTimes(1);
  now += 60_000;
  fetcher.mockResolvedValue(json({ alertId: entry.alertId, sessionId: entry.sessionId, shownAt }));
  await sender().wake();
  expect((await lookup(entry.alertId)).shownDelivery).toMatchObject({ phase: 'acknowledged', attempts: 2 });
});

it('blocks all queued legs in a retracted session while delivering authorized receipts from a different session', async () => {
  const retracted = await add();
  await add({ sessionId: retracted.sessionId });
  const good = await add({ sessionId: crypto.randomUUID() });
  const fetcher = vi.fn(async (url: string) => url.includes(retracted.sessionId) ? json({ code: 'PRIVACY_RETRACTED' }, 409)
    : json({ alertId: good.alertId, sessionId: good.sessionId, shownAt }));
  vi.stubGlobal('fetch', fetcher);
  await sender().wake();
  expect(fetcher.mock.calls.filter(([url]) => url.includes(retracted.sessionId))).toHaveLength(1);
  expect(await repo.enableNotificationOutbox().list(owner)).toEqual([expect.objectContaining({ alertId: good.alertId, shownAck: true })]);
  await sender().wake(true, true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([[401, 'access-blocked'], [403, 'access-blocked'], [404, 'rejected'], [409, 'rejected'], [503, 'retry-wait']] as const)(
  'classifies HTTP %i as %s without storing arbitrary server text', (status, phase) => {
    expect(receiptFailure(new NotificationError('V2_NOTIFICATION_UNCONFIRMED', status))).toEqual({
      phase, code: 'V2_NOTIFICATION_UNCONFIRMED', status,
    });
  },
);

it('keeps a 401 scope blocked across sender recreation and restores it after authenticated access is renewed', async () => {
  const denied = await add({ shownAt: '2026-11-09T23:59:59.000Z' });
  const other = await add();
  const fetcher = vi.fn(async (url: string) => {
    const alertId = url.includes(denied.alertId) ? denied.alertId : other.alertId;
    return json({ alertId, sessionId: scope.sessionId, shownAt: alertId === denied.alertId ? denied.shownAt : other.shownAt });
  }).mockResolvedValueOnce(json({}, 401));
  vi.stubGlobal('fetch', fetcher);
  await sender().wake();
  expect((await lookup(denied.alertId)).shownDelivery).toMatchObject({ attempts: 0, phase: 'access-blocked', status: 401 });
  expect((await lookup(other.alertId)).shownDelivery.phase).toBe('pending');
  await sender().wake();
  await sender().wake(false, true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await sender().wake(true);
  expect((await lookup(denied.alertId)).shownAck).toBe(true);
  expect((await lookup(other.alertId)).shownAck).toBe(true);
});
