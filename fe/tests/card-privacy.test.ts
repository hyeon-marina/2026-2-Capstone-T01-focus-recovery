// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { highRiskText, maskPublicContacts, publicText, publicSearchQuery } from '../src/shared/privacy';
import { extractMainContent, isExcludedPublicDocument } from '../src/content/extraction';

const explanation = 'Public HTTPS documentation explains credit card data protection without disclosing cardholder information.';
// Public payment-test fixtures only; never use a participant's financial data.
const cards = ['4111111111111111', '5555555555554444', '378282246310005', '4222222222222', '4000000000000000006',
  '4111 1111 1111 1111', '4111-1111-1111-1111', '４１１１１１１１１１１１１１１１',
  '4111\n1111\n1111\n1111', '4111\u00a01111\u00a01111\u00a01111'];
beforeEach(() => { document.title = 'Public HTTPS documentation'; document.body.innerHTML = ''; });

it('accepts a financial term in a public explanation without treating it as a disclosed value', () => {
  expect(highRiskText('credit card')).toBe(false);
  expect(publicText(explanation)).toBe(true);
  expect(maskPublicContacts(explanation)).toBe(explanation);
  document.body.innerHTML = `<article>${explanation}</article>`;
  expect(extractMainContent(document, true, true)).toBe(explanation);
});
it.each(cards.map((value, id) => ({ value, id })))('rejects synthetic payment number case $id with or without a label', ({ value }) => {
  for (const text of [value, `credit card: ${value}`]) {
    expect(highRiskText(text)).toBe(true);
    expect(publicText(text)).toBe(false);
    expect(() => maskPublicContacts(text)).toThrow('SENSITIVE_CONTENT');
  }
});
it('keeps labelled card-like values blocked even when their checksum is damaged', () => {
  for (const label of ['credit card', 'credit card number', 'card number', 'PAN']) {
    expect(highRiskText(`${label}: 4111111111111112`)).toBe(true);
  }
});
it('keeps ordinary documentation numbers outside the payment-number detector', () => {
  for (const text of ['A build identifier is 1234567890123456.', 'The placeholder is 0000000000000000.', 'Use 185.199.108.153 for DNS.']) {
    expect(highRiskText(text)).toBe(false); expect(publicText(text)).toBe(true);
  }
});
it('checks all body candidates before truncating a public document', () => {
  document.body.innerHTML = `<article>${'a'.repeat(5100)} ${cards[0]}</article>`;
  expect(() => extractMainContent(document, true, true)).toThrow('SENSITIVE_CONTENT');
  document.body.innerHTML = `<article>${explanation}</article><main>${cards[0]}</main>`;
  expect(() => extractMainContent(document, true, true)).toThrow('SENSITIVE_CONTENT');
});
it('retains contact masking, credential detection and payment-form exclusion', () => {
  expect(maskPublicContacts(`${explanation} desk@example.org 010-0000-0000`)).toBe(`${explanation} [EMAIL] [PHONE]`);
  for (const text of ['Bearer synthetic-only', 'api_key=synthetic-only', 'session_token=synthetic-only', '900101-1234567']) {
    expect(highRiskText(text)).toBe(true);
  }
  document.body.innerHTML = `<article>${explanation}</article><input autocomplete="cc-number" value="UNSUBMITTED">`;
  expect(isExcludedPublicDocument(document)).toBe(true);
  expect(extractMainContent(document, true, true)).toBeNull();
});
it('does not change the separate sensitive-search-intent rule', () => {
  expect(publicSearchQuery('credit card')).toBe(false);
  expect(publicSearchQuery('GitHub Pages HTTPS')).toBe(true);
});
