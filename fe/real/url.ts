import { maskPublicContacts, publicSearchQuery, safeSearchIntent } from '../src/shared/privacy';
import { inspectUrl, searchEngine } from '../src/shared/url';
import { PAGE_MARKER, METADATA_TITLE, METADATA_CONTENT, OMITTED_QUERY } from '../src/shared/metadata';
import type { Site } from './policy';

const privateHost = /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|private|test|invalid|example|onion|admin|mail|webmail|outlook|gmail|whatsapp|telegram|chat|messages|messenger|slack|discord|teams|bank|banking|finance|paypal|stripe|health|medical|hospital|clinic)(?:\.|$)/i;
const sensitive = /(?:^|[\/_.-])(?:login|logon|signin|sign-in|signup|register|password|auth|oauth|callback|sso|accounts|account|myaccount|profile|settings|private|direct|calendar|documents|admin|dashboard|console|inbox|mail|chat|messages|checkout|payment|payments|billing|orders|receipt|invoice|verify|verification|bank|banking|wallet|finance|financial|medical|health|patient|prescription|records)(?:[\/_.-]|$)/i;
export function publicWebUrl(raw: string): URL | null {
  try {
    if (raw.length > 8192) return null;
    const u = new URL(raw);
    // Reject IP literals, private host names and nonstandard service ports.
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || u.hostname.length > 253
      || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(u.hostname)
      || privateHost.test(u.hostname) || sensitive.test(u.hostname) || /^(?:(?:docs|drive|calendar|contacts)\.google\.com|.*\.sharepoint\.com|onedrive\.live\.com)$/.test(u.hostname)) return null;
    if ([...u.searchParams.keys()].some(k => /token|password|secret|credential|authorization|^(code|session|sessionid|sid|email|phone|address|card)$/.test(k.toLowerCase()))) return null;
    if (/(?:^|[?&#])(?:access_token|id_token|token|password|authorization|code)=/i.test(u.hash)) return null;
    for (const component of [u.pathname,u.hash.slice(1)]) {
      let path = component;
      for (let i = 0; i < 3; i++) { const decoded = decodeURIComponent(path); if (decoded === path) break; path = decoded; }
      if (/%|[\\@\u0000-\u001f\u007f]/.test(path) || sensitive.test(path)
        || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\d{6}-[1-4]\d{6}/i.test(path)
        || /\.(?:pdf|mp4|webm|mp3|wav|ogg|m4a)$/i.test(path)) return null;
    }
    // Only the sanitized URL feeds HMAC and durable data.
    u.search = ''; u.hash = '';
    return u;
  } catch { return null; }
}

export function inspectPublicUrl(raw: string, sites: Site[], publicWeb = false) {
  if (publicWeb) {
    const url = publicWebUrl(raw);
    if (!url || url.pathname.includes(PAGE_MARKER)) return null;
    if (/(?:^|\.)wikipedia\.org$/.test(url.hostname) && /^\/wiki\/(?:Special|User|User_talk|Talk|Wikipedia|File|Help|특수|사용자|사용자토론|토론|위키백과|파일|도움말):/i.test(decodeURIComponent(url.pathname))) return null;
    const search = searchEngine(url);
    const site = {origin:url.origin,pathPrefix:search ? url.pathname : '/'};
    return {url,site,isSearchResultPage:search !== null,searchQuery:null,canonical:url.href};
  }
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

export async function describeMetadataUrl(raw: string, sites: Site[], keyBytes: Uint8Array<ArrayBuffer>, session: string, publicWeb = false, pageContent = false, maskContacts = false) {
  const p = inspectPublicUrl(raw, sites, publicWeb);
  if (!p) return null;
  const inspected = pageContent ? inspectUrl(raw) : null;
  if (pageContent && (!inspected || inspected.isSearchResultPage && !inspected.searchQuery)) return null;
  let query = inspected?.searchQuery ?? null;
  if (maskContacts && query) {
    try {
      const masked = maskPublicContacts(query);
      // Preserve sensitive intent in the transient description for the content guard.
      if (safeSearchIntent(query) && publicSearchQuery(masked)) query = masked;
    } catch { /* The content guard quarantines sensitive search intent. */ }
  }
  // Raw route/query affects only the keyed identifier; never persisted or logged.
  const canonical = pageContent ? new URL(raw).href : p.canonical;
  const key = await crypto.subtle.importKey('raw', keyBytes, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const hash = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(session + '\n' + canonical));
  const identity = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,'0')).join('');
  const prefix = p.site.pathPrefix.replace(/\/$/, '');
  return { normalizedUrl: p.url.origin + prefix + PAGE_MARKER + identity, domain: p.url.hostname, identity,
    isSearchResultPage:p.isSearchResultPage, searchQuery:p.isSearchResultPage ? (pageContent ? query : OMITTED_QUERY) : null,
    title:METADATA_TITLE, content:METADATA_CONTENT };
}
