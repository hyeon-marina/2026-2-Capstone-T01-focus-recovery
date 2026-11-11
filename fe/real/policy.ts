import { inspectPublicUrl } from './url';
import { inspectUrl } from '../src/shared/url';
export interface Site { origin: string; pathPrefix: string }
export function contentMatches(s: Site) { return s.pathPrefix.endsWith('/') ? [`${s.origin}${s.pathPrefix}*`] : [`${s.origin}${s.pathPrefix}`,`${s.origin}${s.pathPrefix}?*`,`${s.origin}${s.pathPrefix}/*`]; }
export interface SitePolicy { digest: string; buildId: string; expiresAt: string; sites: Site[]; status: string }
export function allowedSite(raw: string, sites: Site[], metadataOnly = false): boolean {
  const u = metadataOnly ? inspectPublicUrl(raw, sites)?.url : inspectUrl(raw)?.url;
  return !!u && sites.some(s => u.origin === s.origin && (s.pathPrefix === '/' || u.pathname === s.pathPrefix || u.pathname.startsWith(s.pathPrefix.endsWith('/') ? s.pathPrefix : s.pathPrefix + '/')));
}
export function validPolicy(p: SitePolicy, build: { policyDigest: string; buildId: string; sites: Site[] }, synthetic: boolean): boolean {
  return !!p && p.digest === build.policyDigest && p.buildId === build.buildId && Number.isFinite(Date.parse(p.expiresAt)) && Date.parse(p.expiresAt) > Date.now()
    && p.status === (synthetic ? 'SYNTHETIC' : 'APPROVED') && Array.isArray(p.sites) && p.sites.length === build.sites.length && p.sites.every((s,i) => s.origin === build.sites[i].origin && s.pathPrefix === build.sites[i].pathPrefix);
}
// Conservative public-text filter. Site review remains necessary; this is not a complete PII detector.
export function publicText(...texts: string[]) { return texts.every(t => !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\d{6}-[1-4]\d{6}\b|(?:01[016789])[- .]?\d{3,4}[- .]?\d{4}/i.test(t)); }
