// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let messages: any[], visible: boolean, focused: boolean, allowed: boolean;
let replyContext: () => Promise<any>;
let docEvents: ReturnType<typeof vi.spyOn>, windowEvents: ReturnType<typeof vi.spyOn>;
const paragraph = 'Synthetic public documentation about reliable software and ordinary web navigation. ';
const description = { normalizedUrl: 'https://example.org/__focus_page__/' + 'a'.repeat(64), domain: 'example.org', identity: 'a'.repeat(64), isSearchResultPage: false, searchQuery: null };
const observations = () => messages.filter(m => m.type === 'v2-observation');
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const visibility = async (next: boolean) => { visible = next; document.dispatchEvent(new Event('visibilitychange')); await tick(); };

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers();
  messages = []; visible = focused = allowed = true;
  document.title = 'Synthetic public documentation';
  document.body.innerHTML = `<article>${paragraph.repeat(2)}</article>`;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden');
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  vi.stubGlobal('location', new URL('https://example.org/public'));
  replyContext = async () => ({ collecting: allowed, pageContent: true, metadataOnly: true, maskContacts: true, description });
  vi.stubGlobal('chrome', { runtime: {
    sendMessage: vi.fn(async (m: any) => { messages.push(m); return m.type === 'v2-context' ? replyContext() : {}; }),
    onMessage: { addListener: vi.fn() },
  } });
  docEvents = vi.spyOn(document, 'addEventListener'); windowEvents = vi.spyOn(window, 'addEventListener');
});
afterEach(() => {
  for (const [name, listener] of docEvents.mock.calls) if (name === 'visibilitychange') document.removeEventListener(name, listener as EventListener);
  for (const [name, listener] of windowEvents.mock.calls) if (['focus', 'pageshow', 'popstate', 'pagehide'].includes(name as string)) window.removeEventListener(name as string, listener as EventListener);
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('real Content Script foreground boundary (synthetic DOM only)', () => {
  it.each(['hidden', 'unfocused'] as const)('does not inspect or quarantine a %s document on session startup', async mode => {
    visible = mode !== 'hidden'; focused = mode !== 'unfocused';
    document.body.innerHTML = '<input type="password"><article>Not an eligible foreground document.</article>';
    const title = vi.spyOn(document, 'title', 'get');
    await import('../real/content'); await tick(2000);
    expect(title).not.toHaveBeenCalled();
    expect(observations().length).toBe(0);
  });
  it('rechecks visibility when context arrives after a tab switch', async () => {
    replyContext = async () => { visible = false; return { collecting: true, pageContent: true, metadataOnly: true, maskContacts: true, description }; };
    const title = vi.spyOn(document, 'title', 'get');
    await import('../real/content'); await tick();
    expect(title).not.toHaveBeenCalled(); expect(observations().length).toBe(0);
  });
  it('resumes pulses on activation after an unauthorized startup and after hide/show', async () => {
    allowed = false; await import('../real/content'); await tick();
    expect(observations().length).toBe(0);
    allowed = true; await visibility(false); await visibility(true);
    expect(observations().some(m => !!m.snapshot)).toBe(true);
    messages = []; await tick(2000); expect(observations().length).toBeGreaterThan(0);
    messages = []; await visibility(false); await tick(2000); expect(observations().length).toBe(0);
    await visibility(true); expect(observations().some(m => !!m.snapshot)).toBe(true);
  });
  it('resumes when a visible window regains focus without a visibility event', async () => {
    allowed = false; await import('../real/content'); await tick();
    allowed = true; window.dispatchEvent(new Event('focus')); await tick(2000);
    expect(observations().some(m => !!m.snapshot)).toBe(true);
  });
  it('does not let a stale authorization response cancel a newer activation timer', async () => {
    let resolve!: (context: any) => void;
    const pending = new Promise(context => { resolve = context; });
    replyContext = () => pending;
    await import('../real/content'); await tick();
    await visibility(false); await visibility(true);
    resolve({ collecting: false }); await tick();
    replyContext = async () => ({ collecting: true, pageContent: true, metadataOnly: true, maskContacts: true, description });
    await tick(2000);
    expect(observations().some(m => !!m.snapshot)).toBe(true);
  });
  it('does not reuse a snapshot across SPA navigation or a delayed new page', async () => {
    await import('../real/content'); await tick();
    messages = []; document.body.innerHTML = '<main></main>';
    vi.stubGlobal('location', new URL('https://example.org/next'));
    window.dispatchEvent(new PopStateEvent('popstate')); await tick();
    expect(observations().some(m => !!m.snapshot)).toBe(false);
    document.querySelector('main')!.textContent = paragraph.repeat(2); await tick(6000);
    expect(observations().some(m => !!m.snapshot)).toBe(true);
  });
  it('masks contacts and never reads passive form values', async () => {
    document.body.innerHTML = `<article>${paragraph}desk@example.org 010-0000-0000<form><input value="UNSUBMITTED_FORM_VALUE"><textarea>UNSUBMITTED_DRAFT</textarea></form></article>`;
    await import('../real/content'); await tick();
    const snapshot = observations().find(m => m.snapshot)?.snapshot;
    expect(!!snapshot).toBe(true);
    expect(snapshot.content.includes('[EMAIL]') && snapshot.content.includes('[PHONE]')).toBe(true);
    expect(JSON.stringify(messages).includes('UNSUBMITTED')).toBe(false);
  });
  it('keeps active search focus blocked, including focus without typing; blur restores eligibility', async () => {
    document.body.innerHTML += '<form role="search"><input type="search" name="q" value="UNSUBMITTED_SEARCH"></form>';
    const input = document.querySelector('input')!; input.focus();
    await import('../real/content'); await tick();
    expect(observations().some(m => m.safe === false && m.sensitive === true)).toBe(true);
    expect(observations().every(m => !m.snapshot)).toBe(true);
    expect(JSON.stringify(messages).includes('UNSUBMITTED_SEARCH')).toBe(false);
    input.blur(); messages = []; await tick(1000);
    expect(observations().some(m => !!m.snapshot)).toBe(true);
  });
  it('accepts a public explanation containing the term credit card through the actual content adapter', async () => {
    document.title = 'Credit card safety in public HTTPS documentation';
    document.body.innerHTML = `<article>${paragraph}Public HTTPS documentation discusses credit card protection without disclosing cardholder data.</article>`;
    await import('../real/content'); await tick();
    expect(observations().some(m => !!m.snapshot)).toBe(true);
    expect(observations().some(m => m.sensitive === true)).toBe(false);
  });
  it.each(['<input type="password">', '<input autocomplete="cc-number">', '<article>Bearer synthetic-fixture-only</article>', '<article>4111111111111111</article>'])('retains active sensitive-document signals', async html => {
    document.body.innerHTML = html; await import('../real/content'); await tick();
    expect(observations().some(m => m.safe === false && m.sensitive === true)).toBe(true);
    expect(observations().every(m => !m.snapshot)).toBe(true);
  });
});
