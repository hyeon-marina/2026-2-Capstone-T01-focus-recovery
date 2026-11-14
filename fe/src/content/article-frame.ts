import { hasMainContent, isVisible, OMIT } from './extraction';

const OMIT_FRAME = OMIT.split(',').filter(selector => selector !== 'iframe').join(',');

export interface ArticleFrame { element: HTMLIFrameElement; document: Document; url: string }
export function currentArticleFrame(frame: ArticleFrame): boolean {
  try { return frame.element.isConnected && frame.element.contentDocument === frame.document && frame.document.location.href === frame.url && isVisible(frame.element); }
  catch { return false; }
}
export function articleFrame(doc: Document, raw: string): { frame?: ArticleFrame; diagnostic?: string } {
  if (hasMainContent(doc)) return {};
  const viewport = doc.defaultView!;
  const candidates = [...doc.querySelectorAll('iframe')].filter(frame => {
    if (!isVisible(frame) || frame.closest(OMIT_FRAME) || /(?:^|[-_\s])(?:ad(?:vert(?:isement)?)?|ads|comment|widget)(?:frame|[-_\s]|$)/i.test(frame.id+' '+frame.name)) return false;
    const r = frame.getBoundingClientRect();
    const width = Math.max(0, Math.min(r.right, viewport.innerWidth) - Math.max(r.left, 0));
    const height = Math.max(0, Math.min(r.bottom, viewport.innerHeight) - Math.max(r.top, 0));
    return width >= 320 && height >= 160 && width * height >= viewport.innerWidth * viewport.innerHeight * 0.2;
  });
  if (!candidates.length) return {};
  if (candidates.length !== 1) return { diagnostic: 'FRAME_AMBIGUOUS' };
  const element = candidates[0];
  try {
    if (new URL(element.src, raw).origin !== new URL(raw).origin || element.hasAttribute('srcdoc') || element.hasAttribute('sandbox')) return { diagnostic:'FRAME_UNSUPPORTED' };
    const document = element.contentDocument;
    const url = document?.location.href;
    if (!document || !url || url === 'about:blank') return { diagnostic: 'FRAME_UNAVAILABLE' };
    if (new URL(url).origin !== new URL(raw).origin || element.hasAttribute('srcdoc') || element.hasAttribute('sandbox')) return { diagnostic: 'FRAME_UNSUPPORTED' };
    return { frame: {element, document, url} };
  } catch { return { diagnostic: 'FRAME_UNSUPPORTED' }; }
}
