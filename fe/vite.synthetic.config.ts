import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
export default defineConfig(({ mode }) => {
  if (mode !== 'synthetic-test') throw new Error('Use synthetic-test mode');
  const api = loadEnv(mode, import.meta.dirname, 'VITE_').VITE_API_BASE_URL || 'http://localhost:8080';
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(api)) throw new Error('Synthetic BE must be an explicit loopback origin');
  return {
    publicDir: false, define: { __SYNTHETIC_V2__: true },
    plugins: [{ name: 'synthetic-manifest', generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify({
        manifest_version: 3, name: 'Focus Recovery v2 SYNTHETIC ONLY', version: '0.1.0', minimum_chrome_version: '106',
        permissions: ['storage', 'alarms', 'webNavigation'], host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'],
        background: { service_worker: 'background.js', type: 'module' },
        content_scripts: [{ matches: ['http://127.0.0.1/__focus_synthetic__/*'], js: ['content.js'], run_at: 'document_idle' }],
      }) });
    } }],
    build: { outDir: 'dist-synthetic', rollupOptions: {
      input: { background: resolve(import.meta.dirname, 'synthetic/background.ts'), harness: resolve(import.meta.dirname, 'synthetic/harness.html') },
      output: { entryFileNames: '[name].js' },
    } },
  };
});
