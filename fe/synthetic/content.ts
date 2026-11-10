import { extractMainContent, isExcludedDocument } from '../src/content/extraction';
import { catalog, fixtureId } from './catalog';
let busy = false;
let timer: ReturnType<typeof setInterval>;
function activate() { clearInterval(timer); timer = setInterval(() => void pulse(), 1000); void pulse(); }
let lastRaw = '', previousContent: string | undefined, waitingForContent = false;
async function pulse() {
  if (busy) return;
  busy = true;
  try {
    const id = fixtureId(location.href);
    if (!id) return;
    const context = await chrome.runtime.sendMessage({ type: 'v2-context' });
    if (context?.collecting !== true) { clearInterval(timer); return; }
    const safe = document.documentElement.dataset.focusSynthetic === 'catalog-v1' && !isExcludedDocument(document);
    const content = safe ? extractMainContent(document) : null;
    const contentId = Object.keys(catalog).find(key => catalog[key] === content);
    if (location.href !== lastRaw) { waitingForContent = true; lastRaw = location.href; }
    const ready = !!contentId && (!waitingForContent || contentId !== previousContent || contentId === id);
    if (ready) { waitingForContent = false; previousContent = contentId; }
    const titleId = Object.keys(catalog).find(key => document.title === `Synthetic fixture ${key}`);
    const result = await chrome.runtime.sendMessage({ type: 'v2-observation', raw: location.href, id,
      safe: safe && !!titleId && (content === null || !!contentId), ready, contentId, titleId, visible: document.visibilityState === 'visible' });
    if (result?.collecting !== true) clearInterval(timer);
  } catch { clearInterval(timer); /* Reload or unavailable storage stops extraction. */ }
  finally { busy = false; }
}
chrome.runtime.onMessage.addListener(m => { if (m?.type === 'v2-capture') activate(); });
document.addEventListener('visibilitychange', () => void pulse());
window.addEventListener('pagehide', () => { void chrome.runtime.sendMessage({ type: 'v2-leave' }).catch(() => {}); });
activate();
