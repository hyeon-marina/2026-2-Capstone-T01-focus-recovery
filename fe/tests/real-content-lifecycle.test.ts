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
  it('excludes active search focus without quarantining; blur restores eligibility', async () => {
    document.body.innerHTML += '<form role="search"><input type="search" name="q" value="UNSUBMITTED_SEARCH"></form>';
    const input = document.querySelector('input')!; input.focus();
    await import('../real/content'); await tick();
    expect(observations().some(m => m.safe === false && m.sensitive === false && m.failureReason === 'INPUT_FOCUSED')).toBe(true);
    expect(observations().every(m => !m.snapshot)).toBe(true);
    expect(JSON.stringify(messages).includes('UNSUBMITTED_SEARCH')).toBe(false);
    input.blur(); messages = []; await tick(1000);
    expect(observations().some(m => !!m.snapshot)).toBe(true);
  });
  it('excludes non-HTML without marking it sensitive', async () => {
    vi.spyOn(document, 'contentType', 'get').mockReturnValue('application/pdf');
    await import('../real/content'); await tick();
    expect(observations().some(m => m.sensitive === true)).toBe(false);
    expect(observations().every(m => !m.snapshot)).toBe(true);
  });
  it('does not inspect an unsubmitted textarea when checking public layout', async () => {
    document.body.innerHTML += '<form><textarea>subscription required UNSUBMITTED_DRAFT</textarea></form>';
    await import('../real/content'); await tick();
    expect(observations().some(m => !!m.snapshot)).toBe(true);
    expect(JSON.stringify(messages)).not.toContain('UNSUBMITTED_DRAFT');
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


describe('public article frames', () => {
  function frame(html = `<article>${paragraph.repeat(2)}</article>`) {
    document.body.innerHTML = '<iframe id="mainFrame" src="https://example.org/article"></iframe>';
    const element = document.querySelector('iframe')!;
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ x:0,y:0,left:0,top:0,right:1000,bottom:700,width:1000,height:700,toJSON(){} });
    const doc = element.contentDocument!;
    doc.open(); doc.write(`<html><title>Public blog article</title><body>${html}</body></html>`); doc.close();
    return { element, doc };
  }
  function grants() {
    (chrome.runtime.sendMessage as any).mockImplementation(async (m: any) => {
      messages.push(m);
      if (m.type !== 'v2-context') return {};
      return { ...(await replyContext()), ...(m.contentRaw ? { source: { url:m.contentRaw, frameId:1, documentId:'frame-doc' },description:{...description,identity:'b'.repeat(64)} } : {}) };
    });
  }
  it('collects the main article of a visible same-origin frame under its own grant', async () => {
    frame(); grants(); await import('../real/content'); await tick();
    expect(observations().some(m => m.snapshot?.content.includes(paragraph.trim()) && m.source?.documentId === 'frame-doc')).toBe(true);
  });
  it('does not read the article title or body until frame policy authorization', async () => {
    const {doc}=frame(); const title=vi.spyOn(doc,'title','get');
    (chrome.runtime.sendMessage as any).mockImplementation(async (m:any)=>{messages.push(m);return m.type==='v2-context'?(m.contentRaw?{collecting:false}:replyContext()):{};});
    await import('../real/content');await tick();expect(title).not.toHaveBeenCalled();
    expect(observations().every(m=>!m.snapshot)).toBe(true);
  });
  it('does not bypass an outer paywall through a public article frame',async()=>{
    frame();grants();document.body.insertAdjacentHTML('afterbegin','<div data-paywall>Restricted</div>');
    await import('../real/content');await tick();expect(observations().every(m=>!m.snapshot)).toBe(true);
  });
  it('blocks sensitive frame DOM without sending the frame body',async()=>{
    frame(`<input type="password"><article>${paragraph.repeat(2)}</article>`);grants();await import('../real/content');await tick();
    expect(observations().some(m=>m.sensitive===true)).toBe(true);expect(observations().every(m=>!m.snapshot)).toBe(true);
  });
  it('excludes focused frame inputs and resumes without reading their values',async()=>{
    const {doc}=frame(`<article>${paragraph.repeat(2)}</article><form><input name="q" value="PRIVATE_DRAFT"></form>`);grants();doc.querySelector('input')!.focus();
    await import('../real/content');await tick();
    expect(observations().some(m=>m.failureReason==='INPUT_FOCUSED'&&!m.sensitive)).toBe(true);
    expect(JSON.stringify(messages)).not.toContain('PRIVATE_DRAFT');
    (doc.querySelector('input') as HTMLInputElement).blur();messages=[];await tick(1000);
    expect(observations().some(m=>!!m.snapshot)).toBe(true);
  });
  it('invalidates cached content when a frame is replaced at the same URL',async()=>{
    frame();grants();await import('../real/content');await tick();messages=[];
    frame(`<article>Replacement public article with different content. ${paragraph}</article>`);await tick(1000);
    expect(observations().some(m=>m.snapshot?.content.includes('Replacement public article'))).toBe(true);
  });
  it('invalidates cached content on source-frame SPA navigation',async()=>{
    const {doc}=frame();grants();await import('../real/content');await tick();messages=[];
    doc.defaultView!.history.pushState({},'', '/another-article');doc.body.innerHTML=`<article>New source route content. ${paragraph}</article>`;await tick(1000);
    expect(observations().some(m=>m.source?.url.endsWith('/another-article')&&m.snapshot?.content.includes('New source route content.'))).toBe(true);
  });
  it('does not accept a detached frame after a late authorization response',async()=>{
    const {element}=frame();
    (chrome.runtime.sendMessage as any).mockImplementation(async (m:any)=>{messages.push(m);if(m.type!=='v2-context')return {};if(m.contentRaw){element.remove();return {...await replyContext(),source:{url:m.contentRaw,frameId:1,documentId:'old-frame'}};}return replyContext();});
    await import('../real/content');await tick();expect(observations().every(m=>!m.snapshot)).toBe(true);
  });
});
