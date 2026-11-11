import { inspectUrl } from '../src/shared/url';
import { PAGE_MARKER, METADATA_TITLE, METADATA_CONTENT, OMITTED_QUERY } from '../src/shared/metadata';
import type { Site } from './policy';

export function inspectPublicUrl(raw: string, sites: Site[]) {
  if (raw.length > 8192 || /[\\\s\u0000-\u001f\u007f]/.test(raw) || /%(?:2f|5c|25)/i.test(raw.split(/[?#]/)[0])) return null;
  const inspected = inspectUrl(raw, true);
  if (!inspected) return null;
  const u = inspected.url;
  const path = decodeURIComponent(u.pathname);
  if (/(?:^|\/)health|의료|진료|환자|비밀번호|로그인|결제|금융/i.test(path)) return null;
  if (/(?:^|\.)wikipedia\.org$/.test(u.hostname) && /^\/wiki\/(?:Special|User|User_talk|Talk|Wikipedia|File|Help|특수|사용자|사용자토론|토론|위키백과|파일|도움말):/i.test(path)) return null;
  if (u.pathname.includes(PAGE_MARKER) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decodeURIComponent(raw.split(/[?#]/)[0].replace(/^https?:\/\/[^/]+/, '')))) return null;
  const site = sites.filter(s => s.origin === u.origin && (s.pathPrefix === '/' || u.pathname === s.pathPrefix || u.pathname.startsWith(s.pathPrefix.endsWith('/') ? s.pathPrefix : s.pathPrefix + '/'))).sort((a,b) => b.pathPrefix.length - a.pathPrefix.length)[0];
  if (/(?:^|[.-])(?:medical|health|clinic|hospital|mail|bank|finance)(?:[.-]|$)/i.test(u.hostname)) return null;
  if (!site || /(?:^|[/_.-])(?:mail|inbox|messages|private|medical|health|patient|records|history|orders)(?:[/_.-]|$)/i.test(decodeURIComponent(u.pathname))) return null;
  // Hash routes need a separately reviewed route policy. Ordinary anchors identify the same page.
  if (u.hash) {
    let anchor: string;
    try { anchor = decodeURIComponent(u.hash.slice(1)); } catch { return null; }
    if (!/^[\p{L}\p{N}_][\p{L}\p{N}_.-]{0,100}$/u.test(anchor)) return null;
  }
  const functional = new URLSearchParams();
  for (const [key,value] of u.searchParams) {
    if (/^(?:utm_(?:source|medium|campaign|term|content)|fbclid|gclid|si|feature)$/.test(key)) continue;
    const permitted = inspected.isSearchResultPage ? key === (u.hostname.includes('naver') ? 'query' : 'q') || /^(?:start|page)$/.test(key) && /^\d{1,4}$/.test(value)
      : u.hostname === 'www.youtube.com' ? key === 'v' && /^[A-Za-z0-9_-]{11}$/.test(value) || key === 't' && /^\d{1,6}s?$/.test(value)
      : u.hostname === 'blog.naver.com' && u.pathname === '/PostView.naver' ? key === 'blogId' && /^[A-Za-z0-9_-]{1,50}$/.test(value) || key === 'logNo' && /^\d{1,20}$/.test(value)
      : /^(?:page|p)$/.test(key) && /^\d{1,4}$/.test(value);
    if (!permitted || functional.has(key) || /[\u0000-\u001f\u007f@]|(?:01[016789])[- .]?\d{3,4}[- .]?\d{4}|\d{6}-[1-4]\d{6}/.test(value)) return null;
    if (key !== 't') functional.set(key, value);
  }
  if (inspected.isSearchResultPage && !inspected.searchQuery || u.hostname === 'www.youtube.com' && (u.pathname !== '/watch' || !functional.has('v'))) return null;
  functional.sort();
  return { ...inspected, site, canonical: u.origin + u.pathname + '?' + functional.toString() };
}

export async function describeMetadataUrl(raw: string, sites: Site[], keyBytes: Uint8Array<ArrayBuffer>, session: string) {
  const p = inspectPublicUrl(raw, sites);
  if (!p) return null;
  const key = await crypto.subtle.importKey('raw', keyBytes, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const hash = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(session + '\n' + p.canonical));
  const identity = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,'0')).join('');
  const prefix = p.site.pathPrefix.replace(/\/$/, '');
  return { normalizedUrl: p.url.origin + prefix + PAGE_MARKER + identity, domain: p.url.hostname, identity,
    isSearchResultPage:p.isSearchResultPage, searchQuery:p.isSearchResultPage ? OMITTED_QUERY : null,
    title:METADATA_TITLE, content:METADATA_CONTENT };
}
