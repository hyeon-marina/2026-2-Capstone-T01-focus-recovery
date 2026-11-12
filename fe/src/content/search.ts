import { highRiskText, maskPublicContacts } from '../shared/privacy';
import { inspectUrl, normalizeUrl, searchEngine } from '../shared/url';
import { cleanText, isExcludedDocument, isVisible, textFrom } from './extraction';

const UNSAFE = 'form,input,textarea,select,[contenteditable],nav,header,footer,aside,[role="navigation"],[role="menu"],[role="dialog"],[data-ad],[data-text-ad],[data-sponsored],.ad,.ads,.advertisement,#tads,#tadsb,#bottomads,.commercial-unit-desktop-top,.ad_section,#power_link,[data-block-id^="ad/"]';
const AD_LABEL = /^(?:광고|스폰서|스폰서 제공|sponsored|ads?|advertisement|promoted)$/i;
function safe(element: Element): boolean {
  return !element.closest(UNSAFE) && isVisible(element);
}
function organic(container: Element): boolean {
  if (!safe(container) || container.querySelector('form,input[type="password"],[contenteditable]')) return false;
  // Inspect labels, never the whole result text: an article about ads is still organic.
  const scope = container.closest('.MjjYud,[data-block-id]') ?? container;
  return ![scope, ...scope.querySelectorAll('span,button,[aria-label]')].some(label => isVisible(label) && (AD_LABEL.test(cleanText(label.textContent ?? '')) || AD_LABEL.test(label.getAttribute('aria-label') ?? '')));
}
function result(container: Element, titleElement: Element | null, snippetElement: Element | null, base: URL) {
  if (!titleElement || !organic(container) || !safe(titleElement)) return null;
  const link = titleElement.closest('a[href]');
  if (!link || !container.contains(link)) return null;
  let target: string | null;
  try { target = normalizeUrl(new URL(link.getAttribute('href')!, base).href); }
  catch { return null; }
  if (!target || searchEngine(new URL(target)) || /(?:^|\.)(?:googleadservices\.com|doubleclick\.net|adcr\.naver\.com|ads\.naver\.com|ader\.naver\.com)$/.test(new URL(target).hostname)) return null;
  const title = cleanText(textFrom(titleElement));
  if (!title) return null;
  const description = snippetElement && safe(snippetElement) ? cleanText(textFrom(snippetElement)) : '';
  return { title, description };
}
function googleResults(doc: Document, base: URL) {
  // shortcut: Google live DOM was blocked during verification; validate these conservative structures manually before broadening support.
  const titles = new Set<Element>();
  return [...doc.querySelectorAll('#search #rso .MjjYud, #search #rso .g')].flatMap(container => {
    const title = container.querySelector('a[href] h3');
    if (!title || titles.has(title)) return [];
    titles.add(title);
    const entry = result(container, title, container.querySelector('[data-sncf],.VwiC3b,.IsZvec'), base);
    return entry ? [entry] : [];
  });
}
const NAVER_WEB_CARD = '.fds-web-doc-root.fds-web-normal-doc-root';
function naverResults(doc: Document, base: URL) {
  // Live desktop 2026-10-19: semantic web/list/normal-card boundaries; never all headlines.
  const titles = new Set<Element>();
  return [...doc.querySelectorAll(`#main_pack [data-block-id^="web/"], #main_pack [data-template-id="ugcItem"][data-template-type="searchBasic"], #main_pack .fds-web-root .fds-web-list-root > ${NAVER_WEB_CARD}`)].flatMap(container => {
    const modern = container.matches(NAVER_WEB_CARD);
    // Empty block IDs occur on real web collections. Unknown nonempty sections fail closed.
    const otherSection = modern
      ? '[data-block-id]:not([data-block-id=""]):not([data-block-id^="web/"])'
      : '[data-block-id]:not([data-block-id=""]):not([data-block-id^="web/"]):not([data-block-id^="ugc/"])';
    if (container.closest(otherSection + ',[data-template-id="aipickItem"]') || !modern && container.querySelector(NAVER_WEB_CARD)) return [];
    const headings = [...container.querySelectorAll(modern ? 'a[href] .sds-comps-text-type-headline1' : 'a[href] [class*="sds-comps-text-type-headline"]')];
    if (modern && (headings.length !== 1 || headings[0].closest(NAVER_WEB_CARD) !== container)) return [];
    const title = headings[0];
    if (!title || titles.has(title)) return [];
    const descriptions = [...container.querySelectorAll('a[href] .sds-comps-text-type-body1')].filter(element => {
      if (element.closest('[data-template-id="reply"],[data-template-id="articleSource"]')) return false;
      if (!modern) return true;
      if (element.closest(NAVER_WEB_CARD) !== container) return false;
      try { return new URL(element.closest('a')!.getAttribute('href')!, base).href === new URL(title.closest('a')!.getAttribute('href')!, base).href; }
      catch { return false; }
    });
    // Multiple matching snippets are ambiguous; do not guess which belongs to the title.
    if (modern && descriptions.length > 1) return [];
    const description = descriptions[0] ?? null;
    const entry = result(container, title, description, base);
    if (entry) titles.add(title);
    return entry ? [entry] : [];
  });
}
export function extractSearchContent(doc: Document, raw: string, maskContacts = false): { content: string; organicResultCount: number } | null {
  const inspected = inspectUrl(raw);
  if (!inspected?.isSearchResultPage || !inspected.searchQuery || isExcludedDocument(doc, inspected.url)) return null;
  const entries = searchEngine(inspected.url) === 'google' ? googleResults(doc, inspected.url) : naverResults(doc, inspected.url);
  if (maskContacts && entries.some(entry => highRiskText(entry.title) || highRiskText(entry.description))) throw new Error('SENSITIVE_CONTENT');
  const seen = new Set<string>();
  const blocks: string[] = [];
  const query = maskContacts ? maskPublicContacts(inspected.searchQuery) : inspected.searchQuery;
  let length = [...`검색어: ${query}`].length;
  for (const entry of entries) {
    if (maskContacts) {
      entry.title = maskPublicContacts(entry.title);
      entry.description = maskPublicContacts(entry.description);
    }
    const key = `${entry.title}\n${entry.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const heading = `\n\n검색 결과 ${blocks.length + 1}\n제목: ${entry.title}`;
    // A result must retain its complete title; never count one beyond the content bound.
    if (length + [...heading].length > 5000) break;
    const block = [...`${heading}${entry.description ? `\n설명: ${entry.description}` : ''}`].slice(0, 5000 - length).join('');
    blocks.push(block);
    length += [...block].length;
    if (blocks.length === 100 || length === 5000) break;
  }
  return blocks.length ? { content: `검색어: ${query}${blocks.join('')}`, organicResultCount: blocks.length } : null;
}
