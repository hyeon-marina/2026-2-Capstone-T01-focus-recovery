import { expect, it } from 'vitest';
import { inspectPublicUrl, describeMetadataUrl } from '../real/url';
import { validSnapshot, validPost } from '../src/v2/contract';
import { topicTitle } from '../src/shared/metadata';
import { allowedSite } from '../real/policy';
const sites = [
  {origin:'https://www.youtube.com',pathPrefix:'/watch'},
  {origin:'https://www.google.com',pathPrefix:'/search'},
  {origin:'https://search.naver.com',pathPrefix:'/search.naver'},
  {origin:'https://blog.naver.com',pathPrefix:'/PostView.naver'},
  {origin:'https://notice.tistory.com',pathPrefix:'/'},
  {origin:'https://docs.example.org',pathPrefix:'/guide'},
];
const key = new Uint8Array(32).fill(42);
const session = '11111111-1111-4111-8111-111111111111';
it('supports reviewed watch, search and blog URLs without raw query/title/body in durable fields', async () => {
  for (const raw of ['https://www.youtube.com/watch?v=abcdefghijk&t=20s','https://www.google.com/search?q=Git+merge','https://search.naver.com/search.naver?query=Git','https://blog.naver.com/PostView.naver?blogId=public_author&logNo=123','https://notice.tistory.com/123']) {
    const s = await describeMetadataUrl(raw,sites,key,session);
    expect(s).not.toBeNull();
    expect(s!.normalizedUrl).toMatch(/\/__focus_page__\/[a-f0-9]{64}$/);
    expect(JSON.stringify(s)).not.toMatch(/abcdefghijk|public_author|Git|\?|#/);
    expect(validSnapshot(s!,session)).toBe(true);
    const { identity, ...fields } = s!;
    expect(validPost({...fields,visitId:crypto.randomUUID(),sessionId:session,sequence:1,browserTabKey:'tab',visitedAt:new Date().toISOString(),activeDurationMs:5000,tabSwitchCount:0,behaviorVersion:0,extractionStatus:'SUCCESS'})).toBe(true);
  }
});
it('uses private keyed, session-bound identities and ignores only known tracking/anchors', async () => {
  const describe = (s:string,k=key,id=session) => describeMetadataUrl(s,sites,k,id);
  const a = await describe('https://www.google.com/search?q=git');
  expect(await describe('https://www.google.com/search?utm_source=demo&q=git#section')).toEqual(a);
  expect(await describe('https://www.google.com/search?q=git#한글_1')).toEqual(a);
  expect(await describe('https://www.google.com/search?q=git#%E0')).toBeNull();
  expect((await describe('https://www.google.com/search?q=python'))!.identity).not.toBe(a!.identity);
  expect((await describe('https://www.google.com/search?q=git',new Uint8Array(32).fill(2)))!.identity).not.toBe(a!.identity);
  expect((await describe('https://www.google.com/search?q=git',key,'other-session'))!.identity).not.toBe(a!.identity);
  expect((await describe('https://notice.tistory.com/1'))!.identity).not.toBe((await describe('https://notice.tistory.com/2'))!.identity);
});
it('rejects secrets, encoded traversal, scope bypass, duplicates, private/media routes and unreviewed query/hash routes', () => {
  for(const raw of ['https://www.google.com/search?q=user@example.org','https://www.google.com/search?q=010-1234-5678','https://www.google.com/search?q=a&q=b','https://www.google.com/search?q=git&token=secret','https://www.youtube.com/watch?v=bad','https://www.youtube.com/playlist?list=x','https://www.youtube.com/watch?v=abcdefghijk&unknown=secret','https://docs.example.org.evil/guide','https://user:pass@docs.example.org/guide','https://docs.example.org/guide/%61ccount','https://docs.example.org/guide/%252e%252e/private','https://docs.example.org/guide/../guide/a','https://docs.example.org/guide/%2fa','https://docs.example.org/guide/a?unknown=secret','https://docs.example.org/guide/a#/private','https://docs.example.org/guide/a#token=secret','https://docs.example.org/guide/a.pdf','https://docs.example.org/guide/medical','https://docs.example.org/guide/__focus_page__/'+'a'.repeat(64)]) expect(inspectPublicUrl(raw,sites),raw).toBeNull();
});
it('keeps only a bounded title-derived topic',()=>{
  expect(topicTitle('Git merge by person@example.org')).toBe('Topic: GIT');
  expect(topicTitle('name address contact data')).toBe('Topic: OTHER');
});
it('preserves the legacy adapter query boundary while minimizing the local metadata path',()=>{
  const raw='https://docs.example.org/guide/a?legacy_page=2';
  expect(allowedSite(raw,sites)).toBe(true);
  expect(allowedSite(raw,sites,true)).toBe(false);
  expect(allowedSite('https://www.youtube.com/watch?v=abcdefghijk',sites)).toBe(false);
  expect(allowedSite('https://www.youtube.com/watch?v=abcdefghijk',sites,true)).toBe(true);
});
it('excludes private/edit namespaces on reviewed encyclopedia origins',()=>{
  const wiki=[{origin:'https://ko.wikipedia.org',pathPrefix:'/wiki'}];
  for(const path of ['User:someone','Talk:Public_transport','특수:로그인','의료']) expect(inspectPublicUrl('https://ko.wikipedia.org/wiki/'+encodeURIComponent(path),wiki)).toBeNull();
});
it('collects general public HTTP/HTTPS domains using the unchanged session HMAC and Topic contract',async()=>{
  for(const raw of ['https://docs.python.org/3/','https://blog.python.org/','http://news.ycombinator.com/','https://books.toscrape.com/','https://www.google.com/search?q=private#section']){
    expect(allowedSite(raw,[],true,true)).toBe(true);
    const s=(await describeMetadataUrl(raw,[],key,session,true))!;
    expect(s).not.toBeNull();expect(validSnapshot({...s,title:topicTitle('Python tutorial')},session)).toBe(true);
    expect(s.content).toMatch(/^METADATA_ONLY:/);expect(s.normalizedUrl).not.toMatch(/[?#]/);
  }
  const a=await describeMetadataUrl('https://blog.python.org/a?q=secret#route',[],key,session,true);
  expect(a).toEqual(await describeMetadataUrl('https://blog.python.org/a?q=other#other',[],key,session,true));
});
it('fails closed for sensitive and private destinations in broad public scope',()=>{
  for(const raw of ['http://127.0.0.1/','http://192.168.1.1/','https://localhost/','https://[::1]/','https://internal/','https://site.local/','https://mail.google.com/','https://docs.google.com/','https://site.com/account','https://site.com/private','https://site.com/checkout','https://site.com/medical','https://site.com/?token=secret','https://site.com/%2561ccount']) expect(inspectPublicUrl(raw,[],true),raw).toBeNull();
});
