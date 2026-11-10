import { expect, it, vi, afterEach } from 'vitest';
import { sendNotification, validNotification } from '../src/v2/notifications';
import { session } from './v2-fixture';
const receipt = { alertId: '50000000-0000-4000-8000-000000000001', shownAt: session.startedAt, shownAck: false };
afterEach(() => vi.unstubAllGlobals());
it('keeps original shown timestamp on lost ACK retry and validates ACK identity', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(new Response(JSON.stringify(receipt), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(sendNotification(session.sessionId, receipt)).rejects.toThrow('network');
  expect(await sendNotification(session.sessionId, receipt)).toBe('shown');
  expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  fetcher.mockResolvedValue(new Response(JSON.stringify({ ...receipt, shownAt: '2026-11-10T00:00:01.000Z' }), { status: 200 }));
  await expect(sendNotification(session.sessionId, receipt)).rejects.toThrow('ACK_MISMATCH');
});
it('sends selection with original shownAt and preserves privacy errors', async () => {
  const selection = { action: 'RETURN_TO_GOAL' as const, selectedAt: '2026-11-10T00:00:01.000Z' };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ alertId: receipt.alertId, ...selection, feedbackId: session.sessionId }), { status: 200 })));
  expect(validNotification({ ...receipt, selection })).toBe(true);
  expect(await sendNotification(session.sessionId, { ...receipt, selection })).toBe('selection');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"PRIVACY_RETRACTED"}', { status: 409 })));
  await expect(sendNotification(session.sessionId, receipt)).rejects.toThrow('PRIVACY_RETRACTED');
});
