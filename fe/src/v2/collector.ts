import { behaviorSnapshot, coversBehavior } from '../api/behavior';
import { canonical } from '../background/durable-state';
import { validSnapshot } from './contract';
import type { Candidate, Stamp, V2State } from './state';
import type { PageSnapshot, PageVisit } from '../shared/types';

export interface Observation {
  tabId: number; document: string; target: string; generation: string; stamp: Stamp;
  snapshot: PageSnapshot | null; permitted: boolean; safe: boolean; enteredAt?: Stamp; extractionFailed?: boolean;
}
export const VALID_MS = 5000, RETURN_MS = 4000, PATCH_MS = 300000;
// Synthetic observation budget, not a claim of continuous focus during scheduler/OS suspension.
export const MAX_OBSERVATION_GAP_MS = 1500;
const sameEpoch = (a: Stamp, b: Stamp) => a.epoch === b.epoch && b.mono >= a.mono;
export class V2Collector {
  constructor(public state: V2State, private uuid = () => crypto.randomUUID() as string) {}
  current(tab: number) { return this.state.candidates.find(c => c.id === this.state.tabs[tab]); }
  private measure(c: Candidate, t: Stamp) {
    const previous = c.cursor;
    c.cursor = t;
    if (!previous || !sameEpoch(previous, t)) return;
    const delta = t.mono - previous.mono, wallDelta = t.wall - previous.wall;
    if (delta > MAX_OBSERVATION_GAP_MS || wallDelta < 0 || Math.abs(wallDelta - delta) > 100) return;
    const total = delta + c.remainder, ms = Math.floor(total);
    c.remainder = total - ms;
    if (ms > 0) {
      c.behavior.activeDurationMs += ms;
      c.behavior.behaviorVersion++;
    }
  }
  private freeze(c: Candidate) {
    const s = this.state;
    if (!c.excluded && !c.post && c.behavior.activeDurationMs >= VALID_MS && c.snapshot) {
      const { identity: _, organicResultCount: __, ...snapshot } = c.snapshot;
      c.post = { ...snapshot, searchQuery: snapshot.searchQuery ?? null, sessionId: s.session!.sessionId,
        visitId: c.id, browserTabKey: c.tabKey, visitedAt: c.visitedAt, sequence: s.nextSequence++,
        extractionStatus: 'SUCCESS', ...behaviorSnapshot(c.behavior) } satisfies PageVisit;
    }
  }
  pause(tab: number, t: Stamp) {
    const c = this.current(tab);
    if (!c || c.closed) return;
    if (c.cursor) this.measure(c, t);
    this.freeze(c);
    c.cursor = undefined;
    c.left ??= t; // Duplicate blur cannot move the boundary forward.
  }
  foreground(tab: number | null, t: Stamp, switchEvent = false) {
    const old = this.state.foreground;
    if (old === tab) return;
    if (old !== null) this.pause(old, t);
    if (switchEvent && tab !== null && this.state.lastTab !== null && this.state.lastTab !== tab) {
      const previous = this.state.candidates.find(c => c.id === this.state.lastVisit);
      if (previous && !previous.excluded) {
        previous.behavior.tabSwitchCount++;
        previous.behavior.behaviorVersion++;
      }
    }
    this.state.foreground = tab;
    if (tab !== null) {
      this.state.lastTab = tab;
      const c = this.current(tab);
      this.state.lastVisit = c?.id;
      // Only an independently protected content observation may restart measurement.
      if (c) c.returned = t;
    }
  }
  invalidateTarget(tab: number, t: Stamp) {
    this.pause(tab, t);
    delete this.state.tabs[tab];
  }
  observe(o: Observation): Candidate | undefined {
    const s = this.state;
    if (s.lifecycle !== 'ACTIVE' || s.quarantine) return;
    let c = this.current(o.tabId);
    if (!o.safe || !o.permitted) {
      if (c) c.excluded = 'POLICY';
      this.pause(o.tabId, o.stamp);
      return;
    }
    if (o.snapshot && !validSnapshot(o.snapshot, s.session!.sessionId)) return;
    // A delayed extraction in an inactive, unchanged document is not a return event.
    // It can complete the old measured visit even after its short-return cache expired.
    if (s.foreground !== o.tabId && o.snapshot) {
      const delayed = s.candidates.find(v => v.tabId === o.tabId && v.target === o.target && v.document === o.document
        && v.generation === o.generation && !v.post && !v.excluded && v.behavior.activeDurationMs >= VALID_MS);
      if (delayed) { delayed.snapshot = structuredClone(o.snapshot); this.freeze(delayed); return delayed; }
    }
    if (s.foreground !== o.tabId) {
      if (c && !c.post && !c.excluded && o.snapshot && c.target === o.target && c.document === o.document && c.generation === o.generation) c.snapshot = structuredClone(o.snapshot);
      return c; // Extraction completion cannot invent a background return or start a new visit.
    }
    // Target/content generation is independently verified before choosing a visit.
    if (c && (c.target !== o.target || c.generation !== o.generation || c.document !== o.document)) {
      this.pause(o.tabId, o.stamp); c = undefined;
    }
    if (c?.left) {
      const returned = c.returned.mono >= c.left.mono && c.returned.epoch === c.left.epoch ? c.returned : o.stamp;
      if (!sameEpoch(c.left, returned) || returned.mono - c.left.mono >= RETURN_MS) c = undefined;
    }
    if (c?.excluded && o.extractionFailed) return c;
    if (c?.excluded) c = undefined;
    if (!c) {
      const prior = s.candidates.filter(v => v.tabId === o.tabId && !v.closed && !v.excluded && v.target === o.target
        && v.document === o.document && v.generation === o.generation && v.left && sameEpoch(v.left, o.enteredAt ?? o.stamp)
        && (o.enteredAt ?? o.stamp).mono - v.left.mono < RETURN_MS).at(-1);
      c = prior;
    }
    if (!c) {
      const tabKey = s.tabKeys[o.tabId] ??= this.uuid();
      c = { id: this.uuid(), tabId: o.tabId, tabKey, target: o.target, document: o.document, generation: o.generation,
        visitedAt: new Date((o.enteredAt ?? o.stamp).wall).toISOString(), returned: o.enteredAt ?? o.stamp, remainder: 0,
        behavior: { activeDurationMs: 0, tabSwitchCount: 0, behaviorVersion: 0 }, closed: false, crossed: false };
      s.candidates.push(c);
    }
    s.tabs[o.tabId] = c.id;
    if (o.extractionFailed) {
      if (c.post) this.pause(o.tabId, o.stamp);
      else { c.cursor = undefined; c.excluded = 'EXTRACTION_FAILED'; delete c.snapshot; delete c.left; }
      return c;
    }
    if (s.foreground === o.tabId) {
      if (c.left) c.cursor = undefined;
      delete c.left;
      this.measure(c, o.stamp);
      s.lastVisit = c.id;
    }
    if (!c.post && o.snapshot) c.snapshot = structuredClone(o.snapshot);
    this.freeze(c);
    return c;
  }
  finish(t: Stamp) {
    if (this.state.foreground !== null) this.pause(this.state.foreground, t);
    for (const c of this.state.candidates) {
      c.closed = true; c.cursor = undefined;
      if (!c.post && !c.excluded) c.excluded = c.snapshot ? 'SHORT_DURATION' : 'EXTRACTION_FAILED';
    }
    this.state.tabs = {}; this.state.foreground = null;
  }
  expire(t: Stamp) {
    for (const c of this.state.candidates) if (c.left && (!sameEpoch(c.left, t) || t.mono - c.left.mono >= RETURN_MS)) {
      c.closed = true; c.cursor = undefined;
      if (this.state.tabs[c.tabId] === c.id) delete this.state.tabs[c.tabId];
    }
  }
  transmissionVisits(flush = false): PageVisit[] {
    return this.state.candidates.flatMap(c => {
      if (!c.post) return [];
      const crossing = !c.crossed && c.behavior.activeDurationMs >= PATCH_MS;
      if (crossing) c.crossed = true;
      const previous = this.state.behaviors.entries.find(e => e.visitId === c.id)?.latest ?? c.post;
      const behavior = flush || c.left || c.closed || crossing ? c.behavior : previous;
      return [{ ...c.post, ...behaviorSnapshot(behavior) }];
    });
  }
  ready() { return this.state.candidates.flatMap(c => c.post ? [structuredClone(c.post)] : []); }
}
export function canCompact(c: Candidate, s: V2State) {
  const p = s.posts.entries.find(p => p.visitId === c.id), b = s.behaviors.entries.find(b => b.visitId === c.id);
  return c.closed && !s.quarantine && c.post && p?.phase === 'acked' && b?.phase === 'acked'
    && !b.request && b.ack && coversBehavior(b.ack, c.behavior)
    && canonical(p.visit) === canonical(c.post);
}
