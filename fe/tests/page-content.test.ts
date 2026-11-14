// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { extractMainContent, isExcludedPublicDocument, isSensitivePublicDocument } from '../src/content/extraction';
import { publicText, publicSearchQuery } from '../real/policy';
import { describeMetadataUrl } from '../real/url';
import { validSnapshot } from '../src/v2/contract';
const session='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{document.title='Public Python tutorial';document.body.innerHTML='';});
it('extracts real Unicode main text and ignores passive forms, navigation and hidden values',()=>{
 document.body.innerHTML='<nav>Menu</nav><main><h1>한글 Python 🙂</h1><p>Actual public content.</p><form><textarea>private draft</textarea><input value="private"></form><p hidden>hidden secret</p></main>';
 expect(extractMainContent(document,true)).toBe('한글 Python 🙂\nActual public content.');
 document.body.innerHTML='<article>'+ '한a🙂'.repeat(2000)+'</article>';
 expect([...extractMainContent(document,true)!]).toHaveLength(5000);
});
it('blocks sensitive content even after the 5000-character prefix',()=>{
 document.body.innerHTML='<article>'+'a'.repeat(5000)+' bearer synthetic-token</article>';
 expect(()=>extractMainContent(document,true)).toThrow('SENSITIVE_CONTENT');
});
it('blocks authentication, payment, paywall and active input',()=>{
 for(const markup of ['<input type="password">','<input autocomplete="cc-number">','<div data-paywall>Subscribe</div>']) {
  document.body.innerHTML=markup;expect(isExcludedPublicDocument(document)).toBe(true);
 }
 for(const text of ['010-1234-5678','person@example.org','api_key=abc123','환자 진단명','bearer secrettoken']) expect(publicText(text)).toBe(false);
});
it('keeps raw search text separately from HMAC and distinguishes SPA/query routes',async()=>{
 const key=new Uint8Array(32).fill(42);
 const describe=(raw:string)=>describeMetadataUrl(raw,[],key,session,true,true);
 const a=(await describe('https://www.google.com/search?q=Python+venv'))!;
 expect(a.searchQuery).toBe('Python venv');expect(a.normalizedUrl).not.toMatch(/[?#]/);
 expect((await describe('https://www.google.com/search?q=Git'))!.identity).not.toBe(a.identity);
 expect((await describe('https://blog.python.org/#/public-one'))!.identity).not.toBe((await describe('https://blog.python.org/#/public-two'))!.identity);
 expect(validSnapshot({...a,title:'Python venv - Google Search',content:'Real result: Python documentation.',organicResultCount:1},session)).toBe(true);
 expect(await describe('https://www.google.com/search?q=one&q=two')).toBeNull();
});

it('excludes sensitive search intent even without direct personal identifiers',()=>{
 for(const query of ['우울증 증상','대출 신용 점수','cancer treatment','my password','HIV test']) expect(publicSearchQuery(query)).toBe(false);
 expect(publicSearchQuery('Python venv documentation')).toBe(true);
});

it('masks public contacts before selecting a body candidate', () => {
 document.body.innerHTML = '<main>reporter@example.org 연락처 010-0000-0000</main><article>other@example.org</article>';
 expect(extractMainContent(document,true,true)).toBe('[EMAIL] 연락처 [PHONE]');
});

it('keeps HMAC identity while redacting the query in the page description', async () => {
 const raw = 'https://www.google.com/search?q=desk%40example.org';
 const key = new Uint8Array(32);
 const old = await describeMetadataUrl(raw, [], key, session, true, true);
 const next = await describeMetadataUrl(raw, [], key, session, true, true, true);
 expect(next?.identity).toBe(old?.identity);
 expect(next?.searchQuery).toBe('[EMAIL]');
 expect(publicText('session_id=synthetic-only')).toBe(false);
});

it('excludes unclassified telephone formats and prioritizes credentials across all candidates', () => {
 document.body.innerHTML = '<article>Tel (202) 555-0100</article>';
 expect(()=>extractMainContent(document,true,true)).toThrow('CONTACT_EXCLUDED');
 document.body.innerHTML += '<main>session_token=synthetic-value</main>';
 expect(()=>extractMainContent(document,true,true)).toThrow('SENSITIVE_CONTENT');
});

it.each(['se-main-container','contents_style','blog-content'])('extracts a public %s blog article without semantic HTML', className=>{
 document.body.innerHTML=`<div class="${className}"><p>Public article about ordinary software development.</p><p>Another complete paragraph explains the public example in detail.</p></div>`;
 expect(extractMainContent(document,true,true)?.includes('ordinary software')).toBe(true);
});
it('recognizes a coherent generic paragraph container without collecting surrounding page chrome',()=>{
 document.body.innerHTML='<nav>NOT_ARTICLE</nav><div class="unknown-layout"><p>Public software documentation explains ordinary browser navigation.</p><p>A second complete paragraph describes reliable observation and storage.</p></div><footer>NOT_ARTICLE</footer>';
 const body=extractMainContent(document,true,true);expect(!!body).toBe(true);expect(body).not.toContain('NOT_ARTICLE');
});
it('does not turn a navigation link list into a generic article',()=>{
 document.body.innerHTML='<div><p><a href="/one">A complete link to the first public document in this navigation directory</a></p><p><a href="/two">Another complete link to the second public document in this navigation directory</a></p></div>';
 expect(extractMainContent(document,true,true)).toBeNull();
});
it('collects a public article with a passive newsletter email field without inspecting the field value',()=>{
 document.body.innerHTML='<article>Public browser documentation about reliable observations and durable storage.</article><form><input type="email" autocomplete="email" value="PRIVATE_NEWSLETTER_VALUE"></form>';
 const input=document.querySelector('input')!;
 Object.defineProperty(input,'value',{get(){throw new Error('Input value must never be read');}});
 const content=extractMainContent(document,true,true);expect(content?.includes('Public browser documentation')).toBe(true);expect(content).not.toContain('PRIVATE_NEWSLETTER_VALUE');
 input.focus();expect(extractMainContent(document,true,true)).toBeNull();
});
it('supports coherent legacy table-cell articles without reading the whole page',()=>{
 document.body.innerHTML='<nav>NOT_ARTICLE</nav><table><tr><td><p>A complete public paragraph about ordinary browser navigation and document rendering.</p><p>A second public paragraph explains reliable observation and durable storage.</p></td></tr></table>';
 const content=extractMainContent(document,true,true);expect(content?.includes('document rendering')).toBe(true);expect(content).not.toContain('NOT_ARTICLE');
});
it('recognizes a coherent legacy essay with line breaks in a table cell',()=>{
 document.body.innerHTML='<table><tr><td><font>'+Array.from({length:12},(_,i)=>`Public essay paragraph ${i} explains the design of ordinary web documents in detail.<br><br>`).join('')+'</font></td></tr></table>';
 expect(extractMainContent(document,true,true)?.includes('Public essay paragraph')).toBe(true);
});
it('omits inactive anonymous-comment password controls from a separate public article',()=>{
 document.body.innerHTML='<div class="contents_style"><p>Public article content describes ordinary web development and reliable browser behavior.</p></div><div class="tt-comment-cont"><form><input type="password" name="password" value="PRIVATE_COMMENT_PASSWORD"><textarea>PRIVATE_COMMENT_DRAFT</textarea></form></div>';
 const field=document.querySelector('input')!;Object.defineProperty(field,'value',{get(){throw new Error('Password value must never be read');}});
 const content=extractMainContent(document,true,true);expect(content?.includes('Public article content')).toBe(true);expect(content).not.toContain('PRIVATE_COMMENT');
 field.focus();expect(isExcludedPublicDocument(document)).toBe(true);
});
it.each(['<input type="password">','<input name="token">','<input autocomplete="cc-number">'])('keeps authentication/high-risk markers blocked around public comment widgets: %s',markup=>{
 document.body.innerHTML='<article>Public article with ordinary public technical information.</article><div class="tt-comment-cont"><form>'+markup+'</form></div>';
 expect(isExcludedPublicDocument(document)).toBe(true);
});
it('omits the known nameless Tistory anonymous-comment password field without weakening other password markers',()=>{
 document.body.innerHTML='<article><div class="contents_style"><p>Public article content describes ordinary development and reliable browser observations.</p></div><div class="tt-comment-cont"><form><div class="tt-box-account"><input type="password"></div><textarea>PRIVATE_DRAFT</textarea></form></div></article>';
 const input=document.querySelector('input')!;Object.defineProperty(input,'value',{get(){throw new Error('Input value must never be read');}});
 expect(extractMainContent(document,true,true)?.includes('Public article content')).toBe(true);
 input.focus();expect(isExcludedPublicDocument(document)).toBe(true);
});
it('omits closed known comment-management password forms while blocking an opened credential control',()=>{
 document.body.innerHTML='<article><div class="contents_style"><p>Public article content explains ordinary browser documents and reliable observations.</p></div><div class="tt-area-reply"><form class="tt_form_pwd"><div class="tt_box_pwd" style="display:none"><input type="password" value="PRIVATE_COMMENT_PASSWORD"></div></form><p>PRIVATE_COMMENT_TEXT</p></div></article>';
 expect(extractMainContent(document,true,true)?.includes('Public article content')).toBe(true);
 expect(extractMainContent(document,true,true)).not.toContain('PRIVATE_COMMENT');
 (document.querySelector('.tt_box_pwd') as HTMLElement).style.display='block';expect(isExcludedPublicDocument(document)).toBe(true);
});

it('does not rescan the whole document for every anonymous-comment password field',()=>{
 document.body.innerHTML='<div class="contents_style"><p>Public article content with enough ordinary text for safe article recognition.</p></div><div class="tt-comment-cont">'+'<form><input type="password" name="password"></form>'.repeat(300)+'</div>';
 const queries=vi.spyOn(document,'querySelectorAll');
 try {expect(isSensitivePublicDocument(document)).toBe(false);expect(queries.mock.calls.length).toBeLessThan(10);}
 finally{queries.mockRestore();}
});
it('prefers the actual blog article over a larger page wrapper while retaining risk checks',()=>{
 document.body.innerHTML='<main>PUBLIC_WRAPPER_ONLY'.repeat(1)+'<div class="se-main-container"><p>Public article paragraphs describe reliable browser observations and durable local storage.</p></div><div>PUBLIC_WRAPPER_ONLY</div></main>';
 const content=extractMainContent(document,true,true);expect(content?.includes('Public article paragraphs')).toBe(true);expect(content).not.toContain('PUBLIC_WRAPPER_ONLY');
 document.querySelector('main')!.insertAdjacentHTML('beforeend','<p>Bearer synthetic-fixture-only</p>');
 expect(()=>extractMainContent(document,true,true)).toThrow('SENSITIVE_CONTENT');
});
it('does not replace a delayed empty blog body with unrelated wrapper text',()=>{
 document.body.innerHTML='<main><div class="se-main-container"></div><div>Unrelated wrapper description that is long enough to resemble article text.</div></main>';
 expect(extractMainContent(document,true,true)).toBeNull();
});
