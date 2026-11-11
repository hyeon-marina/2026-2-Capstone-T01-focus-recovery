// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { allowedSite, validPolicy, publicText, contentMatches } from '../real/policy';
import { extractMainContent, isExcludedDocument } from '../src/content/extraction';

const sites=[{origin:'https://docs.example.org',pathPrefix:'/guide'}];
describe('reviewed web collection boundary',()=>{
  it('injects exact search routes with queries as well as allowed child paths',()=>{
    expect(contentMatches({origin:'https://www.google.com',pathPrefix:'/search'})).toEqual(['https://www.google.com/search','https://www.google.com/search?*','https://www.google.com/search/*']);
    expect(contentMatches({origin:'https://search.naver.com',pathPrefix:'/search.naver'})).toContain('https://search.naver.com/search.naver?*');
  });
  it('rejects unrelated origins, sibling paths, secrets and sensitive routes',()=>{
    for(const raw of ['https://docs.example.org.evil/guide/a','https://docs.example.org/guides','http://docs.example.org/guide/a','https://docs.example.org/guide/account','https://docs.example.org/guide/a?token=private']) expect(allowedSite(raw,sites)).toBe(false);
    expect(allowedSite('https://docs.example.org/guide/a?utm_source=test#section',sites)).toBe(true);
  });
  it('requires same deployment, digest, exact sites and unexpired approval',()=>{
    const build={buildId:'release-test',policyDigest:'a'.repeat(64),sites};
    const policy={digest:build.policyDigest,buildId:build.buildId,sites,status:'APPROVED',expiresAt:new Date(Date.now()+60000).toISOString()};
    expect(validPolicy(policy,build,false)).toBe(true);
    expect(validPolicy({...policy,sites:[{pathPrefix:'/guide',origin:'https://docs.example.org'}]},build,false)).toBe(true);
    for(const patch of [{buildId:'other'},{digest:'b'.repeat(64)},{sites:[]},{status:'DRAFT'},{expiresAt:'2000-01-01T00:00:00Z'}]) expect(validPolicy({...policy,...patch},build,false)).toBe(false);
    expect(validPolicy({...policy,status:'SYNTHETIC'},build,false)).toBe(false);
  });
  it('excludes private DOM and obvious identifiers, extracts only public article',()=>{
    const doc=document;doc.body.innerHTML='<article><h1>Public title</h1><p>A controlled public article with information about reusable containers.</p><nav>navigation</nav></article>';
    expect(extractMainContent(doc)).toContain('controlled public');
    expect(extractMainContent(doc)).not.toContain('navigation');
    doc.body.insertAdjacentHTML('beforeend','<input type="password" hidden>');
    expect(isExcludedDocument(doc)).toBe(true);
    expect(publicText('user@example.org')).toBe(false);expect(publicText('010-1234-5678')).toBe(false);
  });
});
