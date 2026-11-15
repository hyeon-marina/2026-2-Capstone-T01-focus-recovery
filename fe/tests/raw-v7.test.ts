// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { extractMainContent } from '../src/content/extraction';
import { credentialText } from '../src/shared/privacy';
import { describeMetadataUrl, publicWebUrl } from '../real/url';
import { extractSearchContent } from '../src/content/search';
import { V2Collector } from '../src/v2/collector';
import { activeState, observation, time } from './v2-fixture';
beforeEach(() => { document.title='공개 의료·금융 문서'; document.body.innerHTML=''; });
it.each(['일반 공개 문서', '환자 diagnosis 계좌번호 주민등록', 'fiction@example.org 010-0000-0000 02-000-0000 000000-1000000'])('keeps consented public text unchanged: %s', text => {
  document.body.innerHTML=`<article>${text.repeat(4)}<form><input type="password" value="NEVER_READ"><textarea>NEVER_READ</textarea></form></article>`;
  expect(extractMainContent(document,true,false,true)).toBe(text.repeat(4));
  expect(extractMainContent(document,true,false,true)).not.toContain('NEVER_READ');
});
it('pauses focused input without reading a value and resumes the same public article', () => {
  document.body.innerHTML=`<article>${'공개 문서 내용입니다. '.repeat(8)}</article><input type="password" value="NEVER_READ">`;
  const input=document.querySelector('input')!; input.focus();
  expect(extractMainContent(document,true,false,true)).toBeNull();input.blur();
  expect(extractMainContent(document,true,false,true)).toContain('공개 문서');
});
it.each(['password=fictional-secret','Bearer fictional-token','api_key=fictional-key','비밀번호: fictional-value'])('protects credential-shaped values %s without semantic PII filtering', text => {
  document.body.innerHTML=`<article>${'public '.repeat(10)}${text}</article>`;
  expect(credentialText(text)).toBe(true);
  expect(() => extractMainContent(document,true,false,true)).toThrow('CREDENTIAL_CONTENT');
});
it.each(['google','naver'])('keeps virtual contact query and organic results for %s', async engine => {
  const query='의료 fictional@example.org 010-0000-0000';
  const url=engine==='google'?'https://www.google.com/search?q='+encodeURIComponent(query):'https://search.naver.com/search.naver?query='+encodeURIComponent(query);
  document.body.innerHTML=engine==='google'?'<div id="search"><div id="rso"><div class="MjjYud"><a href="https://public.org/article"><h3>의료 공개 문서</h3></a><div class="VwiC3b">fictional@example.org</div></div></div></div>':'<div id="main_pack"><div data-block-id="web/test"><a href="https://public.org/article"><span class="sds-comps-text-type-headline1">의료 공개 문서</span></a></div></div>';
  const description=await describeMetadataUrl(url,[],new Uint8Array(32),'test-session',true,true,false,true);
  expect(description?.searchQuery).toBe(query);expect(description?.normalizedUrl).not.toContain('@');
  expect(extractSearchContent(document,url,false,true)?.content).toContain(query);
});
it('permits public semantic health URLs while keeping auth/private/credential URL boundaries', () => {
  expect(publicWebUrl('https://health.public.org/medical/article',true)).not.toBeNull();
  for(const u of ['https://public.org/login','https://mail.public.org/article','https://public.org/article?access_token=fictional','http://127.0.0.1/article'])expect(publicWebUrl(u,true)).toBeNull();
});
it('sums 3 active seconds + 30 inactive seconds + 3 active seconds into one incomplete Visit', () => {
  const c=new V2Collector(activeState(),undefined,true);c.foreground(1,time(0));
  for(let t=0;t<=3000;t+=1000)c.observe(observation(t));
  const id=c.current(1)!.id;c.foreground(null,time(3000));c.expire(time(33000));
  c.foreground(1,time(33000));for(let t=33000;t<=36000;t+=1000)c.observe(observation(t));
  expect(c.current(1)?.id).toBe(id);expect(c.current(1)?.behavior.activeDurationMs).toBe(6000);expect(c.ready()).toHaveLength(1);
});
it('retains the four-second revisit boundary for already valid Visits', () => {
  const c=new V2Collector(activeState(),undefined,true);c.foreground(1,time(0));
  for(let t=0;t<=5000;t+=1000)c.observe(observation(t));
  const id=c.current(1)!.id;c.foreground(null,time(5000));c.expire(time(35000));c.foreground(1,time(35000));
  expect(c.observe(observation(35000))?.id).not.toBe(id);expect(c.ready()).toHaveLength(1);
});
it.each(['article-view','area_view'])('extracts a Tistory skin %s and omits the comments', cls=>{
  document.body.innerHTML=`<main></main><div class="${cls}">${'실제 공개 본문입니다. '.repeat(10)}</div><div class="comments">COMMENT</div>`;
  expect(extractMainContent(document,true,false,true)).toBe('실제 공개 본문입니다. '.repeat(10).trim());
});
it('falls back to coherent paragraphs when an empty semantic root exists',()=>{
  document.body.innerHTML=`<main></main><div><p>${'첫 문단입니다. '.repeat(10)}</p><p>둘째 문단입니다.</p></div>`;
  expect(extractMainContent(document,true,false,true)).toContain('둘째 문단');
});
it('keeps organic public medical destinations in v7 search results',()=>{
  document.title='Public search';document.body.innerHTML='<div id="search"><div id="rso"><div class="MjjYud"><a href="https://public.org/medical/article"><h3>의료 공개 문서</h3></a><div class="VwiC3b">Public evidence</div></div></div></div>';
  expect(extractSearchContent(document,'https://www.google.com/search?q=medical',false,true)?.organicResultCount).toBe(1);
});
