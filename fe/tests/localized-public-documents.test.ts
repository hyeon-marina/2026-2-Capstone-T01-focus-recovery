// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://docs.github.com/en/pages"}
import { beforeEach, expect, it } from 'vitest';
import { extractMainContent, isExcludedMetadataDocument, isSensitivePublicDocument } from '../src/content/extraction';

beforeEach(() => {
  history.replaceState({}, '', '/en/pages');
  document.title = 'Public GitHub Pages documentation';
  document.body.innerHTML = '<input name="survey-token" type="hidden"><main><p>Public instructions explain static website publishing, custom domains and HTTPS configuration.</p></main>';
  // DOM marker decisions must never access the survey or any other input value.
  Object.defineProperty(document.querySelector('input'), 'value', { get() { throw new Error('INPUT_VALUE_READ'); } });
});

it.each(['en', 'es', 'ja', 'pt', 'zh', 'ru', 'fr', 'ko', 'de'])('collects the reviewed Pages survey layout in the official %s locale', locale => {
  history.replaceState({}, '', `/${locale}/pages/getting-started-with-github-pages/what-is-github-pages`);
  expect(isSensitivePublicDocument(document)).toBe(false);
  expect(isExcludedMetadataDocument(document)).toBe(false);
  expect(extractMainContent(document, true, true)).toContain('Public instructions');
});

it.each(['/ko/pagesevil', '/ko/pages-private/', '/ko/login', '/unknown/pages', '/pages/ko', '/en/account'])('keeps the survey marker blocked outside reviewed Pages paths: %s', path => {
  history.replaceState({}, '', path);
  expect(isSensitivePublicDocument(document)).toBe(true);
});

it.each(['access_token', 'csrf-token', 'password', 'card_number', 'ssn'])('still blocks a real risk marker alongside the localized survey: %s', name => {
  history.replaceState({}, '', '/ko/pages/getting-started-with-github-pages/what-is-github-pages');
  const input = document.createElement('input');
  input.name = name;
  input.type = 'hidden';
  Object.defineProperty(input, 'value', { get() { throw new Error('INPUT_VALUE_READ'); } });
  document.body.append(input);
  expect(isSensitivePublicDocument(document)).toBe(true);
});
