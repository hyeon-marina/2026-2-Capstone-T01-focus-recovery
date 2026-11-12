// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { extractMainContent, isExcludedPublicDocument } from '../src/content/extraction';
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
