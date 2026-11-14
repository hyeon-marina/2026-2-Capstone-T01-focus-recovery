import { expect, it } from 'vitest';
import cases from '../../docs/contracts/v2/fixtures/privacy-text.json';
import { publicText } from '../src/shared/privacy';

it.each(cases)('agrees with BE/AI privacy fixture $id', c => {
  expect(publicText(c.text)).toBe(c.public);
});
