import { highRiskText, maskPublicContacts, publicText } from '../shared/privacy';
const OMIT = 'script,style,noscript,nav,header,footer,aside,form,input,textarea,select,button,option,iframe,canvas,svg,video,audio,[contenteditable],[hidden],[inert],[aria-hidden="true"],[role="navigation"],[role="menu"],[role="dialog"],[role="alert"],[role="banner"],[role="contentinfo"],[role="complementary"],.ad,.ads,.advertisement,[data-ad],[id*="google_ads"],.comments,.comment-list,.social-share,.menu,.navigation,.navbar,.sidebar,.cookie-banner,.sr-only';
const PRIVATE_INPUT = 'input[type="password"],input[type="email"],input[type="tel"],input[autocomplete^="cc-"],input[autocomplete="street-address"],input[autocomplete="one-time-code"],input[autocomplete="given-name"],input[autocomplete="family-name"],input[name*="password" i],input[name*="token" i],input[name*="ssn" i],input[name*="card" i]';
export function isVisible(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = current.ownerDocument.defaultView!.getComputedStyle(current);
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
  }
  return true;
}
function isSearchForm(form: Element, searchUrl: URL): boolean {
  if (form.tagName !== 'FORM') return false;
  let action: URL;
  try { action = new URL(form.getAttribute('action') || searchUrl.href, searchUrl); }
  catch { return false; }
  if (action.origin !== searchUrl.origin || action.pathname !== searchUrl.pathname) return false;
  const inputs = [...form.querySelectorAll('input')];
  if (form.querySelector('textarea,select,[contenteditable],[role="textbox"]')) return false;
  if (inputs.length && inputs.every(input => input.type === 'hidden')) return true;
  const parameter = searchUrl.hostname.endsWith('naver.com') ? 'query' : 'q';
  return (form.getAttribute('role') === 'search' || form.id === 'nx_search_form') && inputs.some(input => input.name === parameter && ['text', 'search'].includes(input.type)) && inputs.every(input => input.type === 'hidden' || ['submit', 'button'].includes(input.type) || (input.name === parameter && ['text', 'search'].includes(input.type)));
}
export function isExcludedDocument(doc: Document, searchUrl?: URL): boolean {
  if (doc.contentType !== 'text/html') return true;
  // Even hidden auth inputs indicate an unsafe document. Never inspect their values.
  if (doc.querySelector(PRIVATE_INPUT)) return true;
  if ([...doc.querySelectorAll('form,[contenteditable="true"],[role="textbox"]')].some(element => isVisible(element) && !(searchUrl && isSearchForm(element, searchUrl)))) return true;
  const errorHeading = /^(?:error|404|403|500|access denied|page not found|not found|오류|접근 거부|페이지를 찾을 수)/i;
  if (errorHeading.test(doc.title.trim()) || [...doc.querySelectorAll('h1')].some(heading => isVisible(heading) && errorHeading.test(heading.textContent?.trim() ?? ''))) return true;
  return false;
}
export function isExcludedMetadataDocument(doc: Document): boolean {
  if (doc.contentType !== 'text/html' || doc.querySelector('input[type="password"],input[autocomplete^="cc-"],input[autocomplete="street-address"],input[autocomplete="one-time-code"],input[name*="password" i],input[name*="ssn" i],input[name*="card" i]')) return true;
  // GitHub's public docs include an unsubmitted survey field. Never read it; other token fields block.
  if ([...doc.querySelectorAll('input[name*="token" i]')].some(input => !(input.getAttribute('name') === 'survey-token' && doc.location?.origin === 'https://docs.github.com' && (doc.location.pathname === '/en/pages' || doc.location.pathname.startsWith('/en/pages/'))))) return true;
  if (/login|sign in|로그인|결제|환자|진료|의료|medical|patient|diagnosis|password|^error|^404|^403|access denied/i.test(doc.title)) return true;
  // Passive search/newsletter/comment controls cannot leak: this mode never reads their values or body text.
  // Interacting with any editable control still stops the visit/session; auth/payment markers always block.
  return !!doc.activeElement?.matches('input:not([type="hidden"]),textarea,select,[contenteditable="true"],[role="textbox"]');
}
export function cleanText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[\t\u00a0 ]+/g, ' ').trim()).filter(Boolean).join('\n').trim();
}
export function textFrom(element: Element): string {
  if (element.matches(OMIT) || !isVisible(element)) return '';
  const pieces: string[] = [];
  for (const node of element.childNodes) {
    if (node.nodeType === 3) pieces.push(node.textContent ?? '');
    else if (node.nodeType === 1) {
      const child = node as Element;
      const text = textFrom(child);
      const block = /^(P|DIV|SECTION|ARTICLE|MAIN|H[1-6]|LI|PRE|BR|TR)$/.test(child.tagName);
      pieces.push(block ? `\n${text}\n` : text);
    }
  }
  return pieces.join('');
}
export function extractMainContent(doc: Document, publicPage = false, maskContacts = false): string | null {
  if (publicPage ? isExcludedPublicDocument(doc) : isExcludedDocument(doc)) return null;
  const explicit = [...doc.querySelectorAll('article,main,[role="main"],.post-content,.entry-content,.article-body,.document,.post-body,.story-body,#main,#hnmain')];
  // Unknown layouts fail closed; only a coherent section can serve as fallback.
  const roots = explicit.length ? explicit : [...doc.querySelectorAll('section')].filter(el => el.querySelectorAll('p,pre').length >= 2);
  const texts = roots.map(textFrom).map(cleanText).filter(Boolean);
  if (publicPage && texts.some(highRiskText)) throw new Error('SENSITIVE_CONTENT');
  if (publicPage && !maskContacts && texts.some(t => !publicText(t))) throw new Error('SENSITIVE_CONTENT');
  if (!texts.length) return null;
  // FE/BE contract: at most 5,000 Unicode code points, preserving surrogate pairs.
  const selected = texts.sort((a, b) => b.length - a.length)[0];
  const main = maskContacts ? maskPublicContacts(selected) : selected;
  const text = publicPage ? [...new Set(main.split('\n'))].join('\n') : main;
  return [...text].slice(0, 5000).join('');
}

// Page-level signals supplement URL and text checks; no input values are inspected.
export function isExcludedPublicDocument(doc: Document): boolean {
  return isExcludedMetadataDocument(doc) || excludedPublicLayout(doc);
}
export function excludedPublicLayout(doc: Document): boolean {
  return !!doc.querySelector('meta[content="noai"],meta[content="noindex"], [data-paywall],.paywall,[itemprop="isAccessibleForFree"][content="false"],input[autocomplete="email"]')
    || /subscribe to (?:continue|read)|subscription required|구독 후 열람|유료 기사|access denied/i.test(doc.body?.textContent ?? '');
}
