import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
export default defineConfig(({ mode }) => {
  if (!['participant', 'collection-pilot'].includes(mode)) throw new Error('Unknown collection mode');
  const pilot = mode === 'collection-pilot';
  const api = loadEnv(mode, import.meta.dirname, 'VITE_').VITE_API_BASE_URL;
  if (!api || !(pilot ? /^http:\/\/127\.0\.0\.1:\d+$/.test(api) : /^https:\/\/[^/?#@:]+(?::\d+)?$/.test(api))) throw new Error('Explicit HTTPS participant API or loopback-only pilot API is required');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  const version = '0.2.0';
  const metadata = { version, sourceCommit: sha, dirty, mode, apiOrigin: api, actualCollection: 'BLOCKED' };
  return { base: './', publicDir: false,
    define: { __COLLECTION_PILOT__: pilot, __COLLECTION_BUILD__: JSON.stringify(metadata) },
    plugins: [{ name: 'collection-manifest', generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(metadata, null, 2) });
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify({
        manifest_version: 3, name: `Focus Recovery v2 ${pilot ? 'PILOT — SYNTHETIC' : 'PARTICIPANT — BLOCKED'}`, version,
        minimum_chrome_version: '106', action: { default_title: '수집 준비 상태 열기' },
        permissions: pilot ? ['storage', 'alarms', 'webNavigation'] : ['storage', 'alarms'],
        host_permissions: pilot ? ['http://127.0.0.1/*'] : [`${new URL(api).protocol}//${new URL(api).hostname}/*`],
        background: { service_worker: 'background.js', type: 'module' },
        ...(pilot ? { content_scripts: [{ matches: ['http://127.0.0.1/__focus_synthetic__/*'], js: ['content.js'], run_at: 'document_idle' }] } : {}),
      }, null, 2) });
    } }], build: { outDir: pilot ? 'dist-pilot' : 'dist-participant', sourcemap: false, rollupOptions: {
      input: { background: resolve(import.meta.dirname, 'participant/background.ts'), participant: resolve(import.meta.dirname, 'participant/index.html') },
      output: { entryFileNames: '[name].js' },
    } },
  };
});
