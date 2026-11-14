import { highRiskText, maskPublicContacts, safeSearchIntent } from '../src/shared/privacy';
import { articleFrame, currentArticleFrame } from '../src/content/article-frame';
import { topicTitle } from '../src/shared/metadata';
import { cleanText, excludedPublicLayout, extractMainContent, hasFocusedEditable, isSensitivePublicDocument, isExcludedDocument, isExcludedMetadataDocument } from '../src/content/extraction';
import { extractSearchContent } from '../src/content/search';
import { describeUrl, inspectUrl } from '../src/shared/url';
import { publicText, publicSearchQuery } from './policy';
let busy = false;
let cached: {document:Document; sourceRaw:string; raw:string; identity:string | undefined; started:number; next:number; snapshot:unknown; safe:boolean; failureReason:string} | undefined;
let timer: ReturnType<typeof setInterval>;
function activate() {
  clearInterval(timer);
  if (document.visibilityState === 'visible') timer = setInterval(() => void pulse(), 1000);
  void pulse();
}
async function pulse() {
  if (busy) return;
  busy = true;
  const pulseTimer = timer;
  try {
    // Background documents cannot contribute content or quarantine the active session.
    if (document.visibilityState !== 'visible' || !document.hasFocus()) {
      await chrome.runtime.sendMessage({ type: 'v2-leave' });
      return;
    }
    const raw = location.href;
    let context = await chrome.runtime.sendMessage({ type: 'v2-context', raw });
    // No title, DOM or search-query extraction before server policy + session authorization.
    if (context?.collecting !== true) {
      // An older response must not cancel the timer installed by a newer tab activation.
      if (context?.collecting === false && timer === pulseTimer) clearInterval(timer);
      return;
    }
    if (location.href !== raw) return;
    if (document.visibilityState !== 'visible' || !document.hasFocus()) {
      await chrome.runtime.sendMessage({ type: 'v2-leave' });
      return;
    }
    const pageContent = context.pageContent === true;
    // Outer-document privacy is checked even when the article lives inside a frame.
    if (pageContent && (isSensitivePublicDocument(document) || highRiskText(cleanText(document.title)))) {
      await chrome.runtime.sendMessage({type:'v2-observation',raw,safe:false,sensitive:true,visible:true}); return;
    }
    if (pageContent && hasFocusedEditable(document)) {
      await chrome.runtime.sendMessage({type:'v2-observation',raw,safe:false,sensitive:false,failureReason:'INPUT_FOCUSED',visible:true}); return;
    }
    const outerLayout = pageContent && excludedPublicLayout(document);
    if (pageContent && (document.contentType !== 'text/html' || outerLayout || /^(?:40[134]|5\d\d|error\b|page not found|not found|access denied|forbidden|unauthorized|접근 거부|페이지를 찾을 수)/i.test(document.title.trim()))) {
      cached = undefined;
      await chrome.runtime.sendMessage({type:'v2-observation',raw,safe:true,snapshot:null,visible:true,extractionFailed:true,failureReason:'EXTRACTION_ACCESS_DENIED'});return;
    }
    let contentDocument = document;
    let contentRaw = raw;
    let source: {url:string;frameId:number;documentId:string} | undefined;
    const selected = pageContent ? articleFrame(document, raw) : {};
    if (selected.diagnostic) {
      cached = undefined;
      await chrome.runtime.sendMessage({type:'v2-observation',raw,safe:true,snapshot:null,visible:true,extractionFailed:selected.diagnostic !== 'FRAME_UNAVAILABLE',failureReason:'EXTRACTION_ACCESS_DENIED',diagnosticCode:selected.diagnostic}); return;
    }
    if (selected.frame) {
      contentRaw = selected.frame.url;
      const granted = await chrome.runtime.sendMessage({type:'v2-context',raw,contentRaw});
      if (!currentArticleFrame(selected.frame) || location.href !== raw || document.visibilityState !== 'visible' || !document.hasFocus()) return;
      if (granted?.collecting !== true || granted.source?.url !== contentRaw) {
        cached = undefined;
        await chrome.runtime.sendMessage({type:'v2-observation',raw,safe:false,sensitive:false,visible:true,failureReason:'POLICY',diagnosticCode:'FRAME_POLICY_BLOCKED'});return;
      }
      context = granted; source = granted.source; contentDocument = selected.frame.document;
    }
    const emit = (message: Record<string,unknown>) => chrome.runtime.sendMessage({...message,...(source?{source}:{})});
    const inspected = inspectUrl(contentRaw, context.metadataOnly === true);
    const excludedDocument = contentDocument === document && pageContent ? false : !!inspected && (pageContent || context.metadataOnly === true ? isExcludedMetadataDocument(contentDocument) : isExcludedDocument(contentDocument, inspected.isSearchResultPage ? inspected.url : undefined));
    const excludedLayout = contentDocument !== document && !!inspected && pageContent && !excludedDocument && excludedPublicLayout(contentDocument);
    const safe = !!inspected && !excludedDocument && !excludedLayout;
    const denied = /^(?:40[134]|5\d\d|error\b|page not found|not found|access denied|forbidden|unauthorized|접근 거부|페이지를 찾을 수)/i.test(contentDocument.title.trim());
    if (pageContent && highRiskText(cleanText(contentDocument.title))) {
      await emit({type:'v2-observation',raw,safe:false,sensitive:true,visible:document.visibilityState === 'visible'});
      return;
    }
    if (pageContent && (contentDocument.contentType !== 'text/html' || denied || excludedLayout)) {
      await emit({type:'v2-observation',raw,safe:true,snapshot:null,visible:document.visibilityState === 'visible',extractionFailed:true,failureReason:'EXTRACTION_ACCESS_DENIED'});return;
    }
    if (!safe) {
      cached = undefined;
      await emit({ type: 'v2-observation', raw, safe: false,
        sensitive: pageContent && isSensitivePublicDocument(contentDocument),
        failureReason: hasFocusedEditable(contentDocument) ? 'INPUT_FOCUSED' : 'POLICY', visible:document.visibilityState === 'visible' });
      return;
    }
    if (context.metadataOnly === true && !pageContent) {
      // Only fixed metadata leaves the document. No body, title, query, video, captions or comments.
      await emit({ type:'v2-observation', raw, safe:true, snapshot:context.description ? {...context.description, title:topicTitle(contentDocument.title)} : null,
        visible:document.visibilityState === 'visible', extractionFailed:!context.description });
      return;
    }
    if (cached && (cached.raw !== raw || cached.document !== contentDocument || cached.sourceRaw !== contentRaw || cached.identity !== context.description?.identity)) cached = undefined;
    if (pageContent && cached && Date.now() < cached.next) {
      await emit({type:'v2-observation',raw,safe:cached.safe,sensitive:!cached.safe,snapshot:cached.snapshot,failureReason:cached.failureReason,visible:document.visibilityState === 'visible',extractionFailed:!cached.snapshot && Date.now()-cached.started >= 20000});
      return;
    }
    const description = pageContent ? context.description : await describeUrl(raw);
    let search: ReturnType<typeof extractSearchContent> = null;
    let content: string | null = null;
    let sensitive = false;
    let domError = false;
    let contactExcluded = false;
    try { search = inspected!.isSearchResultPage ? extractSearchContent(contentDocument, contentRaw, context.maskContacts) : null; content = inspected!.isSearchResultPage ? search?.content ?? null : extractMainContent(contentDocument, pageContent, context.maskContacts); }
    catch (error) { if (error instanceof Error && error.message === 'SENSITIVE_CONTENT') sensitive = true; else if (error instanceof Error && error.message === 'CONTACT_EXCLUDED') contactExcluded = true; else domError = true; }
    if (content) content = cleanText(content);
    let rawTitle = contentDocument.title || contentDocument.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
    if (context.maskContacts) {
      try { rawTitle = maskPublicContacts(rawTitle); }
      catch (error) { if (error instanceof Error && error.message === 'CONTACT_EXCLUDED') contactExcluded = true; else sensitive = true; }
    }
    if (inspected?.searchQuery && (highRiskText(inspected.searchQuery) || !safeSearchIntent(inspected.searchQuery))) sensitive = true;
    if (contactExcluded && !sensitive) {
      await emit({type:'v2-observation',raw,safe:true,snapshot:null,visible:document.visibilityState === 'visible',extractionFailed:true,failureReason:'POLICY'});
      return;
    }
    const title = [...cleanText(rawTitle).replace(/\s+/g,' ')].slice(0, 500).join('');
    const snapshot = !/^loading(?:\.{0,3})?$|^로딩(?: 중)?[. ]*$/i.test(title) && content && [...content].length >= (inspected!.isSearchResultPage ? 1 : 50) && title && description ? { ...description, title, content, ...(search ? { organicResultCount: search.organicResultCount } : {}) } : null;
    if (location.href !== raw || selected.frame && !currentArticleFrame(selected.frame) || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    const failureReason = domError ? 'EXTRACTION_DOM_ERROR' : contentDocument.querySelector('main,article,[role="main"],.post-body,.document,#hnmain') ? 'EXTRACTION_RENDER_TIMEOUT' : 'EXTRACTION_NO_CONTENT';
    const safeText = !sensitive && (!inspected!.isSearchResultPage || !!description?.searchQuery && publicSearchQuery(description.searchQuery)) && publicText(rawTitle, content ?? '', description?.searchQuery ?? '');
    if (pageContent) {
      const previous = cached?.raw === raw ? cached : undefined;
      cached = {document:contentDocument,sourceRaw:contentRaw,raw,identity:context.description?.identity,started:previous?.started ?? Date.now(),next:Date.now()+5000,snapshot:safeText?snapshot:null,safe:safeText,failureReason};
    }
    const result = await emit({ type: 'v2-observation', raw, safe: safeText, sensitive: !safeText, failureReason,
      snapshot: safeText ? snapshot : null, visible: document.visibilityState === 'visible', extractionFailed: !snapshot && (!pageContent || !!cached && Date.now()-cached.started >= 20000) });
    if (result?.collecting === false && timer === pulseTimer) clearInterval(timer);
  } catch { /* Retry the authorization handshake on the next pulse after a worker restart. */ }
  finally { busy = false; }
}
chrome.runtime.onMessage.addListener(m => { if (m?.type === 'v2-capture') activate(); });
document.addEventListener('visibilitychange', activate);
window.addEventListener('focus', activate);
window.addEventListener('pageshow',activate);
window.addEventListener('popstate',activate);
window.addEventListener('pagehide', () => { void chrome.runtime.sendMessage({ type: 'v2-leave' }).catch(() => {}); });
activate();
