// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { isExcludedMetadataDocument, isExcludedDocument } from '../src/content/extraction';
it('allows passive public search controls only in metadata mode, but blocks interaction and auth fields',()=>{
  document.title='Public Git guide';
  document.body.innerHTML='<form><input name="q"><textarea>PRIVATE FORM VALUE</textarea></form><article>PRIVATE BODY</article>';
  expect(isExcludedMetadataDocument(document)).toBe(false);
  expect(isExcludedDocument(document)).toBe(true);
  document.querySelector('textarea')!.focus();
  expect(isExcludedMetadataDocument(document)).toBe(true);
  document.body.innerHTML='<input type="password" hidden>';
  expect(isExcludedMetadataDocument(document)).toBe(true);
  document.body.innerHTML='<input name="access_token" hidden>';
  expect(isExcludedMetadataDocument(document)).toBe(true);
  document.body.innerHTML='';document.title='Patient medical records';
  expect(isExcludedMetadataDocument(document)).toBe(true);
});
