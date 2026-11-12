import { metadataPath } from './metadata';
const sensitivePath = /(?:^|[\/_.-])(login|logon|signin|sign-in|signup|sign-up|register|registration|password|reset-password|auth|oauth|callback|sso|checkout|payment|billing|banking|bank|wallet|account|profile|settings|myaccount|finance|financial|pay|verify|verification)(?:[\/_.-]|$)/i;
const sensitiveQuery = /^(?:.*token.*|code|password|passwd|secret|authorization|credential|session|sessionid|sid|email|phone|address|ssn|card.*)$/i;
const sensitiveHost = /(?:^|[.-])(bank|banking|paypal|stripe|accounts|login|auth|finance|wallet)(?:[.-]|$)/i;

export const MAX_SEARCH_QUERY = 500; // Local collection bound, not a server DTO contract.
export function searchEngine(url: URL): 'google' | 'naver' | null {
  if (/^(?:www\.)?google\.(?:com|co\.kr|co\.uk|co\.jp|[a-z]{2})$/i.test(url.hostname) && (url.pathname === '/search' || url.pathname.startsWith('/search/__focus_page__/') && metadataPath(url.pathname))) return 'google';
  if (/^(?:search|m\.search)\.naver\.com$/i.test(url.hostname) && (url.pathname === '/search.naver' || url.pathname.startsWith('/search.naver/__focus_page__/') && metadataPath(url.pathname))) return 'naver';
  return null;
}
export function validSearchQuery(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && [...value].length <= MAX_SEARCH_QUERY && value === value.replace(/\s+/g, ' ').trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
// Only this transient stage sees the complete query parameters.
export function inspectUrl(raw: string, allowVideo = false): { url: URL; isSearchResultPage: boolean; searchQuery: string | null } | null {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const path = decodeURIComponent(url.pathname);
    if (sensitivePath.test(path) || sensitiveHost.test(url.hostname) || /\.(pdf|mp4|webm|mp3|wav|ogg|m4a)$/i.test(path)) return null;
    if ([...url.searchParams.keys()].some(key => sensitiveQuery.test(key))) return null;
    if (/^(?:www\.|m\.)?(?:youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|soundcloud\.com|open\.spotify\.com)$/i.test(url.hostname) && !(metadataPath(url.pathname) || url.hostname === 'www.youtube.com' && allowVideo && url.pathname === '/watch')) return null;
    // Catch token-style fragments before discarding them.
    if (/(?:access_token|id_token|password|authorization|code)=/i.test(url.hash)) return null;
    const engine = searchEngine(url);
    const values = engine ? url.searchParams.getAll(engine === 'google' ? 'q' : 'query') : [];
    const query = values.length === 1 ? values[0].replace(/\s+/g, ' ').trim() : null;
    return { url, isSearchResultPage: engine !== null, searchQuery: validSearchQuery(query) ? query : null };
  } catch { return null; }
}
export function normalizeUrl(raw: string): string | null {
  const inspected = inspectUrl(raw);
  if (!inspected) return null;
  const { url } = inspected;
  url.search = '';
  url.hash = '';
  return url.href;
}
export async function describeUrl(raw: string) {
  const inspected = inspectUrl(raw);
  if (!inspected) return null;
  const { url, isSearchResultPage, searchQuery } = inspected;
  url.hash = '';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url.href));
  const identity = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { normalizedUrl: normalizeUrl(raw)!, domain: url.hostname, identity, isSearchResultPage, searchQuery };
}
