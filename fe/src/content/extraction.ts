import { highRiskText, maskPublicContacts, publicText } from '../shared/privacy';
export const OMIT = 'script,style,noscript,nav,header,footer,aside,form,input,textarea,select,button,option,iframe,canvas,svg,video,audio,[contenteditable],[hidden],[inert],[aria-hidden="true"],[role="navigation"],[role="menu"],[role="dialog"],[role="alert"],[role="banner"],[role="contentinfo"],[role="complementary"],.ad,.ads,.advertisement,[data-ad],[id*="google_ads"],.comments,.comment-list,#comments,#comment-area,.tt-comment-cont,.tt-area-reply,.social-share,.menu,.navigation,.navbar,.sidebar,.cookie-banner,.sr-only';
const COMMENT_AREA = '.comments,.comment-list,#comments,#comment-area,.tt-comment-cont,.tt-area-reply';
const PRIVATE_INPUT = 'input[type="password"],input[type="email"],input[type="tel"],input[autocomplete^="cc-"],input[autocomplete="street-address"],input[autocomplete="one-time-code"],input[autocomplete="given-name"],input[autocomplete="family-name"],input[name*="password" i],input[name*="token" i],input[name*="ssn" i],input[name*="card" i]';
export function isVisible(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (!locallyVisible(current)) return false;
  }
  return true;
}
function locallyVisible(element: Element): boolean {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  return !(element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden');
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
  return doc.contentType !== 'text/html' || isSensitivePublicDocument(doc) || hasFocusedEditable(doc);
}
export function hasFocusedEditable(doc: Document): boolean {
  return !!doc.activeElement?.matches('input:not([type="hidden"]),textarea,select,[contenteditable="true"],[role="textbox"]');
}
// Markers are high risk even when hidden. Never inspect form values.
export function isSensitivePublicDocument(doc: Document): boolean {
  const protectedInputs = doc.querySelectorAll('input[type="password"],input[autocomplete^="cc-"],input[autocomplete="street-address"],input[autocomplete="one-time-code"],input[name*="password" i],input[name*="ssn" i],input[name*="card" i]');
  const roots = protectedInputs.length ? [...doc.querySelectorAll(ARTICLE_ROOTS)] : [];
  const readable = new Map<Element, boolean>();
  if ([...protectedInputs].some(input => !inactivePublicCommentPassword(input, doc, roots, readable))) return true;
  // GitHub's public docs include an unsubmitted survey field. Never read it; other token fields block.
  if ([...doc.querySelectorAll('input[name*="token" i]')].some(input => !(input.getAttribute('name') === 'survey-token' && doc.location?.origin === 'https://docs.github.com' && /^\/(?:en|es|ja|pt|zh|ru|fr|ko|de)\/pages(?:\/|$)/.test(doc.location.pathname)))) return true;
  if (/login|sign in|로그인|결제|환자|진료|의료|medical|patient|diagnosis|password|^error|^404|^403|access denied/i.test(doc.title)) return true;
  return false;
}
function inactivePublicCommentPassword(input: Element, doc: Document, roots: Element[], readable: Map<Element, boolean>): boolean {
  // Never read a field value. Only known, omitted anonymous-comment controls qualify.
  const name = input.getAttribute('name');
  const creationControl = name === 'password' || !name && !!input.closest('.tt-comment-cont .tt-box-account');
  const closedManagement = !name && !!input.closest('form.tt_form_pwd') && !!input.closest('.tt_box_pwd') && !isVisible(input);
  const anonymousControl = creationControl || closedManagement;
  if (input.getAttribute('type')?.toLowerCase() !== 'password' || !anonymousControl || doc.activeElement === input
    || input.hasAttribute('autocomplete') || !input.closest('form')) return false;
  const comments = input.closest(COMMENT_AREA);
  if (!comments) return false;
  return roots.some(root => {
    if (root.contains(comments) || root.closest(COMMENT_AREA)) return false;
    if (!readable.has(root)) readable.set(root, hasMainText(root));
    return readable.get(root) === true;
  });
}
export function cleanText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[\t\u00a0 ]+/g, ' ').trim()).filter(Boolean).join('\n').trim();
}
export function textFrom(element: Element): string {
  if (element.matches(OMIT) || !isVisible(element)) return '';
  return visibleTextFrom(element);
}
// Ancestors are already checked in this synchronous traversal; nothing survives between scans.
function visibleTextFrom(element: Element): string {
  const pieces: string[] = [];
  for (const node of element.childNodes) {
    if (node.nodeType === 3) pieces.push(node.textContent ?? '');
    else if (node.nodeType === 1) {
      const child = node as Element;
      const text = child.matches(OMIT) || !locallyVisible(child) ? '' : visibleTextFrom(child);
      const block = /^(P|DIV|SECTION|ARTICLE|MAIN|H[1-6]|LI|PRE|BR|TR)$/.test(child.tagName);
      pieces.push(block ? `\n${text}\n` : text);
    }
  }
  return pieces.join('');
}
const ARTICLE_ROOTS = 'article,main,[role="main"],.post-content,.entry-content,.article-body,.document,.post-body,.story-body,#main,#hnmain,.se-main-container,.contents_style,.tt_article_useless_p_margin,.blog-content,[itemprop="articleBody"],#postViewArea';
export function mainContentRoots(doc: Document): Element[] {
  const explicit = [...doc.querySelectorAll(ARTICLE_ROOTS)];
  if (explicit.length) return explicit;
  const sections = [...doc.querySelectorAll('section')].filter(el => el.querySelectorAll('p,pre').length >= 2);
  if (sections.length) return sections;
  // Unknown blog themes: only nearby paragraph groups, never a whole-body fallback.
  const candidates = new Set<Element>();
  for (const paragraph of doc.querySelectorAll('p,pre')) {
    let parent = paragraph.parentElement;
    for (let depth = 0; parent && depth < 3 && !['BODY','HTML'].includes(parent.tagName); depth++, parent = parent.parentElement)
      if (['DIV','TD'].includes(parent.tagName)) candidates.add(parent);
  }
  for (const cell of doc.querySelectorAll('td')) if (cell.querySelectorAll('br').length >= 3) candidates.add(cell);
  return [...candidates].filter(el => {
    if (el.closest(OMIT)) return false;
    const paragraphs = el.querySelectorAll('p,pre').length;
    const legacy = el.tagName === 'TD' && el.querySelectorAll('br').length >= 3;
    if (paragraphs < 2 && !legacy) return false;
    const text = textFrom(el);
    if (paragraphs < 2 && text.trim().length < 500) return false;
    const links = [...el.querySelectorAll('a')].reduce((total,a) => total + textFrom(a).length, 0);
    return text.trim().length >= 50 && links < text.length * 0.5;
  });
}
// Bounded evidence for preferring the top article over embedded widgets/advertisements.
function hasMainText(root: Element): boolean {
  let size = 0;
  const read = (element: Element): boolean => {
    if (element.matches(OMIT) || !locallyVisible(element)) return false;
    for (const node of element.childNodes) {
      if (node.nodeType === 3) size += (node.textContent ?? '').trim().length;
      else if (node.nodeType === 1 && read(node as Element)) return true;
      if (size >= 50) return true;
    }
    return false;
  };
  return isVisible(root) && read(root);
}
export function hasMainContent(doc: Document): boolean {
  return mainContentRoots(doc).some(hasMainText);
}
export function extractMainContent(doc: Document, publicPage = false, maskContacts = false): string | null {
  if (publicPage ? isExcludedPublicDocument(doc) : isExcludedDocument(doc)) return null;
  const roots = mainContentRoots(doc);
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
  return !!doc.querySelector('meta[content="noai"],meta[content="noindex"], [data-paywall],.paywall,[itemprop="isAccessibleForFree"][content="false"]')
    || /subscribe to (?:continue|read)|subscription required|구독 후 열람|유료 기사|access denied/i.test(doc.body ? textFrom(doc.body) : '');
}
