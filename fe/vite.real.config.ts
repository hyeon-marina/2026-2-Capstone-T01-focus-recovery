import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { contentMatches } from './real/policy';
export default defineConfig(({ mode }) => {
  const synthetic = mode === 'controlled-web';
  if (!synthetic && mode !== 'real-collection') throw new Error('Unknown real adapter mode');
  const env = { ...loadEnv(mode, import.meta.dirname, ''), ...process.env };
  const api = env.VITE_API_BASE_URL;
  if (!api || !(synthetic ? /^http:\/\/127\.0\.0\.1:\d+$/.test(api) : /^https:\/\/[^/?#@:]+(?::\d+)?$/.test(api))) throw new Error('Explicit API origin required');
  const bytes = readFileSync(env.COLLECTION_SITE_POLICY_FILE || '');
  const policy = JSON.parse(bytes.toString());
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(policy.buildId) || !Array.isArray(policy.sites) || !policy.sites.length && policy.status !== 'DRAFT' || policy.sites.length > 30) throw new Error('Build ID and exact sites required');
  const matches = policy.sites.flatMap((s: {origin: string;pathPrefix: string}) => {
    const u = new URL(s.origin);
    if (u.origin !== s.origin || !(u.protocol === 'https:' || synthetic && u.protocol === 'http:' && u.hostname === '127.0.0.1') || s.origin.includes('*') || !/^\/[a-zA-Z0-9_./-]*$/.test(s.pathPrefix) || s.pathPrefix.includes('..')) throw new Error('Exact public origin and path required');
    return contentMatches(s);
  });
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  const metadata = { version: '0.3.0', sourceCommit, dirty, mode, apiOrigin: api, actualCollection: 'REQUIRES_SERVER_APPROVAL',
    buildId: policy.buildId, policyDigest: createHash('sha256').update(bytes).digest('hex'), sites: policy.sites };
  return { base: './', publicDir: false, define: { __COLLECTION_PILOT__: false, __COLLECTION_REAL__: true, __COLLECTION_BUILD__: JSON.stringify(metadata) },
    plugins: [{ name: 'real-manifest', generateBundle() {
      this.emitFile({type:'asset',fileName:'build-info.json',source:JSON.stringify(metadata,null,2)});
      this.emitFile({type:'asset',fileName:'manifest.json',source:JSON.stringify({ manifest_version:3, name: synthetic ? 'Focus v2 Controlled HTML — SYNTHETIC' : 'Focus Recovery v2 — 승인 사이트 수집', version:metadata.version,
        minimum_chrome_version:'106', permissions:['storage','alarms','webNavigation'], host_permissions:[...new Set([`${api}/*`,...policy.sites.map((s:{origin:string})=>`${s.origin}/*`)])],
        action:{default_title:'수집 상태 열기'}, background:{service_worker:'background.js',type:'module'},
        ...(matches.length ? {content_scripts:[{matches:[...new Set(matches)],js:['content.js'],run_at:'document_idle',all_frames:false}]} : {})
      },null,2)});
    }}], build:{outDir:'dist-real',sourcemap:false,rollupOptions:{input:{background:resolve(import.meta.dirname,'participant/background.ts'),participant:resolve(import.meta.dirname,'participant/index.html')},output:{entryFileNames:'[name].js'}}} };
});
