import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validPost } from '../src/v2/contract';
import { validBehavior } from '../src/api/behavior';
import { session } from './v2-fixture';
import { isWorkSession } from '../src/api/session';
import type { PageVisit } from '../src/shared/types';
const cases = JSON.parse(readFileSync(new URL('../../docs/contracts/v2/fixtures/schema-cases.json', import.meta.url), 'utf8')).cases as {
  name: string; contract: string; input: Record<string, unknown>; expected: { valid: boolean };
}[];
describe('shared Schema fixture input against FE product validators', () => {
  for (const c of cases.filter(c => ['PageVisitPost', 'BehaviorPatch'].includes(c.contract))) {
    it(c.name, () => {
      const valid = c.contract === 'PageVisitPost' ? validPost({ ...c.input, sessionId: session.sessionId } as unknown as PageVisit) : validBehavior(c.input);
      expect(valid).toBe(c.expected.valid);
    });
  }
});
it('versionless sessions stay v1; v2 never passes the default v1 parser', () => {
  const { collectionSpecVersion: _, ...legacy } = session;
  expect(isWorkSession(legacy)).toBe(true); expect(isWorkSession(session)).toBe(false);
  expect(isWorkSession(session, '2.0')).toBe(true);
});

it('validates shared retraction fixtures with exact wire keys', async () => {
  const { validRetraction, validRetractionAck } = await import('../src/v2/retractions');
  const request = { retractionId: '00000000-0000-4000-8000-000000000071', visitId: '00000000-0000-4000-8000-000000000001', observedAt: '2026-11-10T00:00:00.000Z', reasonCode: 'SENSITIVE_CONTENT' as const };
  for (const c of cases.filter(c => ['PrivacyRetraction', 'RetractionAck'].includes(c.contract))) {
    const input = c.input;
    const valid = c.contract === 'PrivacyRetraction'
      ? validRetraction({ request: input as unknown as typeof request, phase: 'pending', attempts: 0, nextAttemptAt: 0 })
      : validRetractionAck(input, { ...request, retractionId: String(input.retractionId), visitId: String(input.visitId) });
    expect(Boolean(valid), c.name).toBe(c.expected.valid);
  }
});
