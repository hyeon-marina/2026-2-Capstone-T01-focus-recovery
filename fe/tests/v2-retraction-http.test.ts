import { syntheticAccess } from './v2-fixture';
import { it, expect, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { V2Runtime, type V2Transport } from '../src/v2/runtime';
import { V2Repository } from '../src/v2/repository';
import { API_BASE_URL } from '../src/api/client';
import { observation, time } from './v2-fixture';

// Invoked by RetractionLiveHttpTest against its real loopback Spring/H2 server and separate FastAPI.
it.skipIf(!process.env.FOCUS93_BE_URL)('FE durable queue → authenticated BE → durable AI quarantine, lost ACK and restart', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  const base = process.env.FOCUS93_BE_URL!, session = JSON.parse(process.env.FOCUS93_SESSION!);
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('SYNTHETIC_LOOPBACK_ONLY');
  const auth = 'Bearer synthetic-only-alice-credential-95-01234567890123456789';
  const receipts: unknown[] = [];
  async function call(path: string, body?: unknown, method = 'POST') {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : method,
      headers: { 'Content-Type': 'application/json', Authorization: auth }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect(response.status).toBeGreaterThanOrEqual(200); expect(response.status).toBeLessThan(300);
    return response.json();
  }
  const path = `/api/sessions/${session.sessionId}`;
  let loseFirstAck = true;
  const t: V2Transport = {
    access: async () => syntheticAccess,
    start: async () => call(path),
    post: async v => { const { sessionId: _s, ...wire } = v; return call(path + '/visits', wire); },
    patch: async (_s, visitId, b) => call(path + `/visits/${visitId}/behavior`, b, 'PATCH'),
    end: async () => { throw new Error('END_MUST_BE_BLOCKED'); }, query: async () => session,
    retract: async (_s, request) => {
      const ack = await call(path + '/visit-retractions', request); receipts.push(ack);
      if (loseFirstAck) { loseFirstAck = false; throw new Error('synthetic lost ACK after remote commit'); }
      return ack;
    },
  };
  async function until(check: () => boolean | Promise<boolean>) {
    for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 20)); }
    throw new Error('SYNTHETIC_TIMEOUT');
  }
  const repo = new V2Repository(API_BASE_URL), runtime = new V2Runtime(repo, t);
  await runtime.initialize(); await runtime.start(session.goalText); await runtime.foreground(1, time(0));
  for (let visit = 0; visit < 3; visit++) {
    const start = visit * 11000;
    for (let ms = start; ms <= start + 5000; ms += 1000) await runtime.observe(observation(ms, { document: `http-doc-${visit}` }));
    await runtime.foreground(null, time(start + 5000)); await runtime.foreground(1, time(start + 10000));
  }
  await until(() => runtime.snapshot().posts.entries.length === 3 && runtime.snapshot().posts.entries.every(e => e.phase === 'acked'));
  await until(async () => (await call(path + '/analysis-status')).currentDecision?.decisionStatus === 'COMPLETED');
  const originals = runtime.snapshot().posts.entries.map(e => e.visit);
  await runtime.quarantine('CONSENT_WITHDRAWN', time(33000).wall);
  await until(() => runtime.snapshot().retractions?.length === 3 && runtime.snapshot().retractions!.filter(e => e.phase === 'acknowledged').length === 2);
  const requests = runtime.snapshot().retractions!.map(e => e.request);
  repo.close();
  const restarted = new V2Runtime(new V2Repository(API_BASE_URL), t); await restarted.initialize(); await restarted.retry();
  await until(() => restarted.snapshot().retractions!.every(e => e.phase === 'acknowledged'));
  expect(restarted.snapshot().retractions!.map(e => e.request)).toEqual(requests);
  expect(restarted.snapshot().posts.entries.map(e => e.visit)).toEqual(originals);
  expect(restarted.collecting()).toBe(false);
  const status = await call(path + '/analysis-status');
  expect(status.currentDecision.decisionStatus).toBe('INVALIDATED'); expect(status.lastSuccessfulState).toBeNull(); expect(status.alert).toBeNull();
  const replay = await fetch(base + path + '/visits', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify((({ sessionId: _s, ...rest }) => rest)(originals[0])) });
  expect(replay.status).toBe(409);
  const fs = await import('node:fs/promises');
  await fs.mkdir('/private/tmp/focus93-http-evidence', { recursive: true });
  await fs.writeFile('/private/tmp/focus93-http-evidence/fe.json', JSON.stringify({ requests, receipts, status }));
}, 20000);
