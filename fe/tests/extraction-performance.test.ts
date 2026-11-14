// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { textFrom, extractMainContent } from '../src/content/extraction';

afterEach(()=>vi.restoreAllMocks());
it('checks visibility once per descendant, keeping ancestor checks at the root',()=>{
  document.body.innerHTML='<article>'+ '<section>'.repeat(12)+'<p><span>Public documentation.</span></p>'.repeat(60)+'</section>'.repeat(12)+'</article>';
  const styles=vi.spyOn(window,'getComputedStyle');
  expect(textFrom(document.querySelector('article')!)).toContain('Public documentation.');
  expect(styles.mock.calls.length).toBeLessThanOrEqual(document.querySelectorAll('*').length+3);
});
it('rechecks changed ancestor styles on the next extraction without reading form values',()=>{
  document.title='Public documentation';
  document.body.innerHTML='<div id="wrapper"><article><p>'+ 'Ordinary public documentation. '.repeat(5)+'</p><form><textarea>UNSUBMITTED_DRAFT</textarea></form></article></div>';
  const wrapper=document.querySelector<HTMLElement>('#wrapper')!;
  for(const property of ['display','visibility','opacity'] as const){
    wrapper.style[property]=property==='display'?'none':property==='visibility'?'hidden':'0';
    expect(extractMainContent(document,true,true)).toBeNull();
    wrapper.removeAttribute('style');
    const text=extractMainContent(document,true,true);
    expect(text).toContain('Ordinary public documentation.');
    expect(text).not.toContain('UNSUBMITTED_DRAFT');
  }
});
