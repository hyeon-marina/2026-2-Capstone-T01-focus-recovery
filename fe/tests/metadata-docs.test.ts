// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://docs.github.com/en/pages"}
import { expect, it } from 'vitest';
import { isExcludedMetadataDocument } from '../src/content/extraction';
it('allows only the reviewed public docs survey marker without reading its value',()=>{
  document.title='GitHub Pages documentation';
  document.body.innerHTML='<input name="survey-token" type="hidden" value="MUST_NOT_BE_READ">';
  expect(isExcludedMetadataDocument(document)).toBe(false);
  history.replaceState({},'','/en/pagesevil');
  expect(isExcludedMetadataDocument(document)).toBe(true);
  history.replaceState({},'','/en/pages');
  document.body.innerHTML='<input name="access_token" type="hidden">';
  expect(isExcludedMetadataDocument(document)).toBe(true);
});
