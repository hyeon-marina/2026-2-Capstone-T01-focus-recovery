// @vitest-environment jsdom
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {articleFrame,currentArticleFrame} from '../src/content/article-frame';
const raw='https://example.org/wrapper';
function add(url='https://example.org/article',id='mainFrame') {
 const f=document.createElement('iframe');f.src=url;f.id=id;document.body.append(f);
 vi.spyOn(f,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:1000,bottom:700,width:1000,height:700,toJSON(){}});
 return f;
}
beforeEach(()=>{document.body.innerHTML='';document.title='Public article';});
afterEach(()=>vi.restoreAllMocks());
it('prefers a readable top article over embedded frames',()=>{add();document.body.insertAdjacentHTML('afterbegin','<article>'+ 'Public article text. '.repeat(6)+'</article>');expect(articleFrame(document,raw)).toEqual({});});
it('finds a dominant same-origin document and detects detachment',()=>{const f=add();const result=articleFrame(document,raw);expect(result.frame?.element).toBe(f);expect(currentArticleFrame(result.frame!)).toBe(true);f.remove();expect(currentArticleFrame(result.frame!)).toBe(false);});
it.each(['adFrame','advertisement','comment-frame','widget'])('does not select the %s frame',id=>{add(undefined,id);expect(articleFrame(document,raw)).toEqual({});});
it('excludes small or hidden frames',()=>{const f=add();f.hidden=true;expect(articleFrame(document,raw)).toEqual({});f.hidden=false;(f.getBoundingClientRect as any).mockReturnValue({left:0,top:0,right:10,bottom:10,width:10,height:10});expect(articleFrame(document,raw)).toEqual({});});
it('does not guess between multiple main frames',()=>{add();add();expect(articleFrame(document,raw).diagnostic).toBe('FRAME_AMBIGUOUS');});
it('does not traverse a cross-origin, sandboxed or srcdoc frame',()=>{
 for(const kind of ['cross','sandbox','srcdoc']){
  document.body.innerHTML='';const f=add(kind==='cross'?'https://elsewhere.org/article':undefined);
  if(kind==='sandbox')f.setAttribute('sandbox','allow-same-origin');if(kind==='srcdoc')f.setAttribute('srcdoc','<article>Unbound document</article>');
  expect(articleFrame(document,raw).diagnostic).toBe('FRAME_UNSUPPORTED');
 }
});

it('ignores advertising frames marked on the frame itself',()=>{const f=add();f.className='ads';expect(articleFrame(document,raw)).toEqual({});});
