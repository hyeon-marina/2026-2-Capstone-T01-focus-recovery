// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { extractSearchContent } from '../src/content/search';
import { extractMainContent, isExcludedDocument } from '../src/content/extraction';
const googleUrl = 'https://www.google.com/search?q=JWT';
const naverUrl = 'https://search.naver.com/search.naver?query=JWT';
const googleCard = (title = '인증 문서', description = 'JWT 검증 방법', attributes = '') => `<div class="MjjYud" ${attributes}><a href="https://example.com/docs"><h3>${title}</h3></a><div data-sncf>${description}</div></div>`;
const naverCard = (attributes = 'data-block-id="web/prs_template_v2_web_basic_desk.ts"') => `<div ${attributes}><a href="https://example.com/docs"><span class="sds-comps-text sds-comps-text-type-headline1">인증 문서</span></a><a href="https://example.com/docs"><span class="sds-comps-text-type-body1">JWT 검증 방법</span></a></div>`;
beforeEach(() => { document.title = '공개 검색'; document.body.innerHTML = ''; });
describe('organic search extraction', () => {
  it('extracts Google result title and snippet under the search result root', () => {
    document.body.innerHTML = `<div id="search"><div id="rso">${googleCard()}</div></div>`;
    expect(extractSearchContent(document, googleUrl)).toEqual({ content: '검색어: JWT\n\n검색 결과 1\n제목: 인증 문서\n설명: JWT 검증 방법', organicResultCount: 1 });
  });
  it('masks a query, organic title and snippet before formatting or truncating', () => {
    document.body.innerHTML = `<div id="search"><div id="rso">${googleCard('desk@example.org','Phone 010-0000-0000')}</div></div>`;
    const page = extractSearchContent(document,'https://www.google.com/search?q=info%40example.org',true);
    expect(page?.content).toBe('검색어: [EMAIL]\n\n검색 결과 1\n제목: [EMAIL]\n설명: Phone [PHONE]');
  });
  it.each(['data-block-id="web/prs_template_v2_web_basic_desk.ts"', 'data-template-id="ugcItem" data-template-type="searchBasic"'])('extracts observed Naver structures: %s', attributes => {
    document.body.innerHTML = `<div id="main_pack">${naverCard(attributes)}</div>`;
    expect(extractSearchContent(document, naverUrl)?.organicResultCount).toBe(1);
    expect(extractSearchContent(document, naverUrl)?.content).toContain('설명: JWT 검증 방법');
  });
  it.each(['data-ad', 'data-text-ad', 'data-sponsored', 'id="tads"', 'aria-label="Sponsored"'])('excludes structured advertisements: %s', attributes => {
    document.body.innerHTML = `<div id="search"><div id="rso">${googleCard('광고 문서', 'PRIVATE_AD', attributes)}${googleCard()}</div></div>`;
    const result = extractSearchContent(document, googleUrl)!;
    expect(result.organicResultCount).toBe(1); expect(result.content).not.toContain('PRIVATE_AD');
  });
  it.each(['광고', 'Sponsored', '스폰서 제공'])('excludes sponsored labels: %s', label => {
    document.body.innerHTML = `<div id="search"><div id="rso">${googleCard('광고 문서', `<span>${label}</span>PRIVATE_AD`)}${googleCard()}</div></div>`;
    expect(extractSearchContent(document, googleUrl)?.organicResultCount).toBe(1);
  });
  it('requires containers, real title links and safe destinations; ignores navigation, recommendations and AI briefing', () => {
    document.body.innerHTML = `<div id="main_pack"><div data-block-id="ai-briefing/example">${naverCard('')}</div><nav>${naverCard()}</nav><div data-block-id="web/example"><span class="sds-comps-text-type-headline1">unlinked</span></div>${naverCard().replace('https://example.com/docs', 'javascript:alert(1)')}${naverCard().replace('https://example.com/docs', 'https://adcr.naver.com/ad')}</div>`;
    expect(extractSearchContent(document, naverUrl)).toBeNull();
  });
  it('excludes a nested Google card whose sponsor label is on the result wrapper', () => {
    document.body.innerHTML = `<div id="search"><div id="rso"><div class="MjjYud"><span>Sponsored</span><div class="g"><a href="https://example.com/ad"><h3>PRIVATE_AD</h3></a></div></div>${googleCard()}</div></div>`;
    const result = extractSearchContent(document, googleUrl)!;
    expect(result.organicResultCount).toBe(1); expect(result.content).not.toContain('PRIVATE_AD');
  });
  it('skips malformed destinations without aborting valid results', () => {
    document.body.innerHTML = `<div id="search"><div id="rso">${googleCard('不正', 'bad').replace('https://example.com/docs', 'http://[')}${googleCard()}</div></div>`;
    expect(extractSearchContent(document, googleUrl)?.organicResultCount).toBe(1);
  });
  it('counts a Google title only once when wrappers are nested', () => {
    document.body.innerHTML = `<div id="search"><div id="rso"><div class="MjjYud"><div class="g"><a href="https://example.com/docs"><h3>인증</h3></a><div data-sncf>요약</div></div></div></div></div>`;
    expect(extractSearchContent(document, googleUrl)?.organicResultCount).toBe(1);
  });
  it('does not count search-only UI or zero results, missing queries or unsupported engines', () => {
    document.body.innerHTML = '<div id="search"><div id="rso"><input value="PRIVATE_INPUT"><a href="/search?q=x"><h3>추천 검색어</h3></a></div></div>';
    expect(extractSearchContent(document, googleUrl)).toBeNull();
    expect(extractSearchContent(document, 'https://www.google.com/search')).toBeNull();
    expect(extractSearchContent(document, 'https://bing.com/search?q=JWT')).toBeNull();
  });
  it('allows only the supported search form without reading its values; ordinary HTML stays excluded', () => {
    document.body.innerHTML = `<form role="search" action="https://www.google.com/search"><input name="q" value="PRIVATE_INPUT"><input type="hidden" name="other" value="PRIVATE_HIDDEN"></form><div id="search"><div id="rso">${googleCard()}</div></div>`;
    expect(isExcludedDocument(document)).toBe(true);
    expect(extractMainContent(document)).toBeNull();
    expect(extractSearchContent(document, googleUrl)?.content).not.toContain('PRIVATE_');
    expect(extractSearchContent(document, googleUrl)?.organicResultCount).toBe(1);
  });
  it.each(['<form action="https://www.google.com/search"><input name="email" type="email"></form>', '<form role="search" action="https://evil.example/search"><input name="q"></form>', '<form><textarea>PRIVATE</textarea></form>', '<input type="password" hidden>', '<div contenteditable="true">PRIVATE</div>'])('fails closed on sensitive search documents: %s', html => {
    document.body.innerHTML = `${html}<div id="search"><div id="rso">${googleCard()}</div></div>`;
    expect(extractSearchContent(document, googleUrl)).toBeNull();
  });
  it('omits hidden, form and advertising descendants from snippets', () => {
    document.body.innerHTML = `<div id="search"><div id="rso">${googleCard('인증', '공개<span hidden>PRIVATE_HIDDEN</span><input value="PRIVATE_INPUT"><span class="ad">PRIVATE_AD</span> 본문')}</div></div>`;
    expect(extractSearchContent(document, googleUrl)?.content).toContain('공개 본문');
    expect(extractSearchContent(document, googleUrl)?.content).not.toContain('PRIVATE_');
  });
  it('deduplicates nested result structures and caps complete content at 5,000 Unicode code points', () => {
    document.body.innerHTML = `<div id="search"><div id="rso">${googleCard('인증', `<div class="g"><a href="https://example.com/docs"><h3>인증</h3></a></div>${'한🙂'.repeat(3000)}`)}</div></div>`;
    const result = extractSearchContent(document, googleUrl)!;
    expect([...result.content]).toHaveLength(5000);
    expect(result.content).not.toMatch(/[\uD800-\uDBFF]$/);
  });
  it('never counts a hidden result or an unverified layout', () => {
    document.body.innerHTML = `<div id="search"><div id="rso"><div hidden>${googleCard()}</div></div></div>${googleCard()}`;
    expect(extractSearchContent(document, googleUrl)).toBeNull();
  });
});
