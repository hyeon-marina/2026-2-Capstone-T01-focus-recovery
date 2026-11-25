import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { assertMockOrigin, MOCK_ORIGIN, USER_POPUP } from './user/mock-config';

export default defineConfig(({ mode }) => {
  if (mode !== 'user-mock') throw new Error('Use user-mock mode');
  const configuredOrigin = loadEnv(mode, import.meta.dirname, 'VITE_').VITE_API_BASE_URL;
  if (configuredOrigin !== undefined) assertMockOrigin(configuredOrigin);
  return {
    base: './',
    publicDir: false,
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(MOCK_ORIGIN) },
    plugins: [{ name: 'user-mock-manifest', generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify({
        manifest_version: 3, name: 'Focus Recovery · 사용자 합성 테스트', version: '0.1.0',
        minimum_chrome_version: '106',
        permissions: ['storage', 'alarms', 'webNavigation'],
        host_permissions: ['http://127.0.0.1/*'],
        background: { service_worker: 'background.js', type: 'module' },
        action: { default_popup: USER_POPUP },
        content_scripts: [{ matches: ['http://127.0.0.1/__focus_synthetic__/*'], js: ['content.js'], run_at: 'document_idle' }],
        content_security_policy: { extension_pages: `script-src 'self'; object-src 'none'; connect-src ${MOCK_ORIGIN}` },
      }, null, 2) });
    } }],
    build: { outDir: 'dist-user', rollupOptions: {
      input: { background: resolve(import.meta.dirname, 'user/background.ts'), popup: resolve(import.meta.dirname, USER_POPUP) },
      output: { entryFileNames: '[name].js' },
    } },
  };
});
