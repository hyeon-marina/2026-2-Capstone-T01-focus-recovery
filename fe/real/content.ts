import { topicTitle } from '../src/shared/metadata';
import { cleanText, extractMainContent, isExcludedDocument, isExcludedMetadataDocument, isExcludedPublicDocument } from '../src/content/extraction';
import { extractSearchContent } from '../src/content/search';
import { describeUrl, inspectUrl } from '../src/shared/url';
import { publicText, publicSearchQuery } from './policy';
let busy = false;
let cached: {raw:string; started:number; next:number; snapshot:unknown; safe:boolean; failureReason:string} | undefined;
let timer: ReturnType<typeof setInterval>;
function activate() { clearInterval(timer); timer = setInterval(() => void pulse(), 1000); void pulse(); }
async function pulse() {
  if (busy) return;
  busy = true;
  try {
    const raw = location.href;
    const context = await chrome.runtime.sendMessage({ type: 'v2-context', raw });
    // No title, DOM or search-query extraction before server policy + session authorization.
    if (context?.collecting !== true) { clearInterval(timer); return; }
    if (location.href !== raw) return;
    const inspected = inspectUrl(raw, context.metadataOnly === true);
    const pageContent = context.pageContent === true;
    const safe = !!inspected && !(pageContent ? isExcludedPublicDocument(document) : context.metadataOnly === true ? isExcludedMetadataDocument(document) : isExcludedDocument(document, inspected.isSearchResultPage ? inspected.url : undefined));
    if (pageContent && /^(?:403|401|access denied|forbidden|unauthorized|접근 거부)/i.test(document.title.trim())) {
      await chrome.runtime.sendMessage({type:'v2-observation',raw,safe:true,snapshot:null,visible:document.visibilityState === 'visible',extractionFailed:true,failureReason:'EXTRACTION_ACCESS_DENIED'});return;
    }
    if (!safe) { await chrome.runtime.sendMessage({ type: 'v2-observation', raw, safe: false, sensitive: pageContent }); return; }
    if (context.metadataOnly === true && !pageContent) {
      // Only fixed metadata leaves the document. No body, title, query, video, captions or comments.
      await chrome.runtime.sendMessage({ type:'v2-observation', raw, safe:true, snapshot:context.description ? {...context.description, title:topicTitle(document.title)} : null,
        visible:document.visibilityState === 'visible', extractionFailed:!context.description });
      return;
    }
    if (pageContent && cached?.raw === raw && Date.now() < cached.next) {
      await chrome.runtime.sendMessage({type:'v2-observation',raw,safe:cached.safe,sensitive:!cached.safe,snapshot:cached.snapshot,failureReason:cached.failureReason,visible:document.visibilityState === 'visible',extractionFailed:!cached.snapshot && Date.now()-cached.started >= 20000});
      return;
    }
    const description = pageContent ? context.description : await describeUrl(raw);
    const search = inspected!.isSearchResultPage ? extractSearchContent(document, raw) : null;
    let content: string | null = null;
    let sensitive = false;
    let domError = false;
    try { content = inspected!.isSearchResultPage ? search?.content ?? null : extractMainContent(document, pageContent); }
    catch (error) { if (error instanceof Error && error.message === 'SENSITIVE_CONTENT') sensitive = true; else domError = true; }
    if (content) content = cleanText(content);
    const rawTitle = document.title || document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
    const title = [...cleanText(rawTitle).replace(/\s+/g,' ')].slice(0, 500).join('');
    const snapshot = !/^loading(?:\.{0,3})?$|^로딩(?: 중)?[. ]*$/i.test(title) && content && [...content].length >= (inspected!.isSearchResultPage ? 1 : 50) && title && description ? { ...description, title, content, ...(search ? { organicResultCount: search.organicResultCount } : {}) } : null;
    if (location.href !== raw) return;
    const failureReason = domError ? 'EXTRACTION_DOM_ERROR' : document.querySelector('main,article,[role="main"],.post-body,.document,#hnmain') ? 'EXTRACTION_RENDER_TIMEOUT' : 'EXTRACTION_NO_CONTENT';
    const safeText = !sensitive && (!inspected!.isSearchResultPage || !!description?.searchQuery && publicSearchQuery(description.searchQuery)) && publicText(rawTitle, content ?? '', description?.searchQuery ?? '');
    if (pageContent) {
      const previous = cached?.raw === raw ? cached : undefined;
      cached = {raw,started:previous?.started ?? Date.now(),next:Date.now()+5000,snapshot:safeText?snapshot:null,safe:safeText,failureReason};
    }
    const result = await chrome.runtime.sendMessage({ type: 'v2-observation', raw, safe: safeText, sensitive: !safeText, failureReason,
      snapshot: safeText ? snapshot : null, visible: document.visibilityState === 'visible', extractionFailed: !snapshot && (!pageContent || !!cached && Date.now()-cached.started >= 20000) });
    if (result?.collecting !== true) clearInterval(timer);
  } catch { clearInterval(timer); }
  finally { busy = false; }
}
chrome.runtime.onMessage.addListener(m => { if (m?.type === 'v2-capture') activate(); });
document.addEventListener('visibilitychange', () => void pulse());
window.addEventListener('pageshow',activate);
window.addEventListener('popstate',activate);
window.addEventListener('pagehide', () => { void chrome.runtime.sendMessage({ type: 'v2-leave' }).catch(() => {}); });
activate();
