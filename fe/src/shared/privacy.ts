// Conservative public-text filter. Site review remains necessary; this is not a complete PII detector.
const highRisk = /(?:bearer\s+[a-z0-9._-]+|(?:password|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?(?:id|token|key|credential)|cookie|passwd|secret)\s*[:=]\s*\S+|\b(?:diagnosis|prescription|patient|bank account|credit card)\b|주민등록|계좌번호|진단명|처방전|비밀번호)/i;
const nationalId = /\d{6}-[1-4]\d{6}/;
const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const phone = /(?:01[016789]|\+82[- .]?1[016789])[- .]?\d{3,4}[- .]?\d{4}/g;
const otherPhone = /(?:\+\d{1,3}[- .])?(?:\(\d{2,4}\)[- .]?|\b\d{2,4}[- .])\d{3,4}[- .]\d{4}\b/;
export function highRiskText(text: string) {
  return highRisk.test(text) || nationalId.test(text);
}
export function maskPublicContacts(text: string): string {
  if (highRiskText(text)) throw new Error('SENSITIVE_CONTENT');
  const masked = text.replace(email, '[EMAIL]').replace(phone, '[PHONE]');
  if (otherPhone.test(masked)) throw new Error('CONTACT_EXCLUDED');
  return masked;
}
export function publicText(...texts: string[]) {
  return texts.every(text => !highRisk.test(text) && !nationalId.test(text) && !otherPhone.test(text) && text.replace(email, '').replace(phone, '') === text);
}
// Queries expose intent directly, so health/financial/personal searches are excluded even without identifiers.
export function publicSearchQuery(query: string) {
  return publicText(query) && safeSearchIntent(query);
}
export function safeSearchIntent(query: string) {
  return !/\b(?:medical|diagnosis|patient|prescription|symptoms?|treatment|cancer|hiv|aids|depression|banking|finance|loan|credit|insurance|password|cookie|token)\b|의료|진료|환자|질병|증상|치료|처방|우울|암 검사|대출|신용|계좌|금융|주민|비밀번호/i.test(query);
}
