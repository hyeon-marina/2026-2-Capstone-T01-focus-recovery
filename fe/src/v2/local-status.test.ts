import { describe, it, expect } from 'vitest';
import { localBlocker } from './local-status';
describe('local setup recovery messages', () => {
  it('gives a next action for missing setup and never treats unknown conditions as ready', () => {
    expect(localBlocker('LOCAL_SETUP_REQUIRED')).toContain('setup --slot');
    expect(localBlocker('PRIVACY_WITHDRAWN')).toContain('재개할 수 없습니다');
    expect(localBlocker('unrecognized')).toContain('미충족');
  });
});
