import { afterEach, expect, it, vi } from 'vitest';
import synthetic from '../vite.synthetic.config';
import production from '../vite.config';
import type { ConfigEnv, UserConfigFnObject } from 'vite';
const config = (mode: string): ConfigEnv => ({ command: 'build', mode });
afterEach(() => vi.unstubAllEnvs());
it('does not expose a v2 entry point through production mode or an environment setting', () => {
  vi.stubEnv('VITE_V2_ENABLED', 'true');
  const c = (production as UserConfigFnObject)(config('production'));
  expect(JSON.stringify(c.build?.rollupOptions?.input)).not.toContain('synthetic');
  expect(JSON.stringify(c.build?.rollupOptions?.input)).toContain('src/background/index.ts');
  expect(() => (synthetic as UserConfigFnObject)(config('production'))).toThrow('synthetic-test');
});
it('requires dedicated build mode AND loopback, regardless of activation flags', () => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://production.example.org');
  expect(() => (synthetic as UserConfigFnObject)(config('synthetic-test'))).toThrow('loopback');
  vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8912');
  expect(() => (synthetic as UserConfigFnObject)(config('synthetic-test'))).not.toThrow();
});
