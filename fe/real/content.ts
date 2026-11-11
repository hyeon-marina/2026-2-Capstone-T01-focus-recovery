import { cleanText, extractMainContent, isExcludedDocument } from '../src/content/extraction';
import { extractSearchContent } from '../src/content/search';
import { describeUrl, inspectUrl } from '../src/shared/url';
import { publicText } from './policy';
let busy = false;
let timer: ReturnType<typeof setInterval>;
function activate() { clearInterval(timer); timer = setInterval(() => void pulse(), 1000); void pulse(); }
async function pulse() {
  if (busy) return;
  busy = true;
  try {
    const raw = location.href;
    const context = await chrome.runtime.sendMessage({ type: 'v2-context' });
    // No title, DOM or search-query extraction before server policy + session authorization.
    if (context?.collecting !== true) { clearInterval(timer); return; }
    const inspected = inspectUrl(raw);
    const safe = !!inspected && !isExcludedDocument(document, inspected.isSearchResultPage ? inspected.url : undefined);
    if (!safe) { await chrome.runtime.sendMessage({ type: 'v2-observation', raw, safe: false }); return; }
    const description = await describeUrl(raw);
    const search = inspected!.isSearchResultPage ? extractSearchContent(document, raw) : null;
    const content = inspected!.isSearchResultPage ? search?.content ?? null : extractMainContent(document);
    const title = [...cleanText(document.title)].slice(0, 500).join('');
    const snapshot = content && description ? { ...description, title, content, ...(search ? { organicResultCount: search.organicResultCount } : {}) } : null;
    if (location.href !== raw) return;
    const safeText = publicText(title, content ?? '', description?.searchQuery ?? '');
    const result = await chrome.runtime.sendMessage({ type: 'v2-observation', raw, safe: safeText,
      snapshot: safeText ? snapshot : null, visible: document.visibilityState === 'visible', extractionFailed: !snapshot });
    if (result?.collecting !== true) clearInterval(timer);
  } catch { clearInterval(timer); }
  finally { busy = false; }
}
chrome.runtime.onMessage.addListener(m => { if (m?.type === 'v2-capture') activate(); });
document.addEventListener('visibilitychange', () => void pulse());
window.addEventListener('pagehide', () => { void chrome.runtime.sendMessage({ type: 'v2-leave' }).catch(() => {}); });
activate();
