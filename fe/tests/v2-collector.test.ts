import { describe, expect, it } from 'vitest';
import { V2Collector } from '../src/v2/collector';
import { activeState, observation, snapshot, time } from './v2-fixture';
import { validPost, validSnapshot } from '../src/v2/contract';
function setup() {
  const c = new V2Collector(activeState());
  c.foreground(1, time(0)); c.observe(observation(0)); return c;
}
function advance(c: V2Collector, start: number, end: number) {
  for (let i = start; i < end; i += 1000) c.observe(observation(i));
  return c.observe(observation(end))!;
}
describe('v2 observation boundaries', () => {
  it('keeps 4999 uncommitted, freezes at 5000 without finalization', () => {
    const c = setup(); const v = advance(c, 1000, 4999);
    expect(v.behavior.activeDurationMs).toBe(4999); expect(v.post).toBeUndefined();
    c.observe(observation(5000)); expect(v.post?.sequence).toBe(1); expect(v.post?.activeDurationMs).toBe(5000);
    expect(validPost(v.post!)).toBe(true); expect(v.closed).toBe(false);
    const frozen = structuredClone(v.post);
    c.observe(observation(6000, { snapshot: { ...snapshot, title: 'Changed title' } }));
    expect(v.post).toEqual(frozen);
  });
  it.each([3999, 4000])('return interval %i uses event observation, not extraction arrival', gap => {
    const c = setup(), id = advance(c, 1000, 5000).id;
    c.foreground(null, time(5000)); c.foreground(1, time(5000 + gap));
    const v = c.observe(observation(11000, { enteredAt: time(5000 + gap) }))!;
    expect(v.id === id).toBe(gap < 4000);
    expect(v.behavior.activeDurationMs).toBe(gap < 4000 ? 5000 : 0);
  });
  it('does not let repeated blur extend the first departure', () => {
    const c = setup(); c.foreground(null, time(1000)); c.pause(1, time(3000));
    expect(c.current(1)?.left?.mono).toBe(1000);
    c.foreground(1, time(5000)); const id = c.state.candidates[0].id;
    expect(c.observe(observation(5000))?.id).not.toBe(id);
  });
  it('reuses A on A-B-A within four seconds using same tab/document/generation', () => {
    const c = setup(), a = advance(c, 1000, 5000);
    c.invalidateTarget(1, time(5000));
    c.observe(observation(5500, { target: 'b'.repeat(64), generation: 'b', snapshot: { ...snapshot, identity: 'b'.repeat(64) } }));
    c.invalidateTarget(1, time(6000));
    expect(c.observe(observation(7000))?.id).toBe(a.id);
    c.invalidateTarget(1, time(7000));
    expect(c.observe(observation(11000))?.id).not.toBe(a.id);
  });
  it.each([
    { tabId: 2 }, { document: 'reload-document' }, { generation: 'changed-content' },
    { target: 'b'.repeat(64), snapshot: { ...snapshot, identity: 'b'.repeat(64) } },
  ])('separates tab/document/content/target %o', change => {
    const c = setup(), first = c.state.candidates[0].id;
    expect(c.observe(observation(1000, change))?.id).not.toBe(first);
  });
  it('gives sequence by validation order, not candidate observation order', () => {
    const c = setup(); c.observe(observation(1000, { snapshot: null }));
    const a = c.current(1)!; delete a.snapshot;
    c.foreground(2, time(1000), true);
    for (let t = 1000; t <= 6000; t += 1000) c.observe(observation(t, { tabId: 2, document: 'doc2' }));
    expect(c.current(2)?.post?.sequence).toBe(1); expect(a.post).toBeUndefined();
    c.foreground(1, time(6500), true);
    for (let t = 6500; t <= 11500; t += 1000) c.observe(observation(t));
    expect(c.current(1)?.post?.sequence).toBe(2);
  });
  it.each([null, { ...snapshot, content: 'short' }, { ...snapshot, content: '😀'.repeat(5001) },
    { ...snapshot, isSearchResultPage: true, normalizedUrl: 'https://www.google.com/search', domain: 'www.google.com', searchQuery: null, organicResultCount: 1 }])('does not POST failed/invalid content', invalid => {
    const c = new V2Collector(activeState()); c.foreground(1, time(0));
    for (let t = 0; t <= 6000; t += 1000) c.observe(observation(t, { snapshot: invalid }));
    expect(c.ready()).toEqual([]);
  });
  it.each([false, true])('blocks URL/DOM or permission %s', permitted => {
    const c = setup(); c.observe(observation(1000, { permitted, safe: false }));
    expect(c.current(1)?.excluded).toBe('POLICY'); expect(c.ready()).toEqual([]);
  });
  it('accepts supplementary Unicode at code point limit', () => {
    expect(validSnapshot({ ...snapshot, content: '😀'.repeat(5000) }, activeState().session.sessionId)).toBe(true);
  });
  it('counts switches once on previous A even when B has no collectable visit', () => {
    const c = setup(); advance(c, 1000, 5000);
    c.foreground(2, time(5000), true); c.foreground(2, time(5000), true);
    c.foreground(null, time(5500)); c.foreground(2, time(5600));
    expect(c.state.candidates[0].behavior.tabSwitchCount).toBe(1);
  });
  it('excludes sleep/clock discontinuities, retains fractional remainder without rounding', () => {
    const c = setup(); c.observe(observation(999.9)); c.observe(observation(1999.9));
    expect(c.current(1)?.behavior.activeDurationMs).toBe(1999);
    c.observe(observation(10000)); expect(c.current(1)?.behavior.activeDurationMs).toBe(1999);
    c.observe(observation(11000, { stamp: time(11000, 'worker-1', 0) }));
    expect(c.current(1)?.behavior.activeDurationMs).toBe(1999);
    c.observe(observation(12000, { stamp: time(12000, 'worker-2') }));
    expect(c.current(1)?.behavior.activeDurationMs).toBe(1999);
  });
  it('queues behavior on first 300000 crossing and departure, not each pulse', () => {
    const c = setup(); advance(c, 1000, 5000);
    const post = c.ready()[0]; c.state.behaviors.entries = [{ visitId: post.visitId, sessionId: post.sessionId, sequence: 1,
      initial: post, latest: post, phase: 'waiting-post', attempts: 0 }];
    advance(c, 6000, 299999);
    expect(c.transmissionVisits()[0].activeDurationMs).toBe(5000);
    c.observe(observation(300000)); expect(c.transmissionVisits()[0].activeDurationMs).toBe(300000);
    c.state.behaviors.entries[0].latest = structuredClone(c.current(1)!.behavior);
    c.observe(observation(301000)); expect(c.transmissionVisits()[0].activeDurationMs).toBe(300000);
    c.foreground(null, time(301000)); expect(c.transmissionVisits()[0].activeDurationMs).toBe(301000);
  });
});
it.each(['pause', 'finish'] as const)('freezes a visit when %s first observes exactly 5000ms', action => {
  const c = new V2Collector(activeState()); c.foreground(1, time(0));
  for (let t = 0; t <= 4000; t += 1000) c.observe(observation(t));
  if (action === 'pause') c.pause(1, time(5000)); else c.finish(time(5000));
  expect(c.state.candidates[0].post?.activeDurationMs).toBe(5000);
  expect(c.state.candidates[0].post?.sequence).toBe(1);
});
