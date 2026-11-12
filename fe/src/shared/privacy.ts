// Conservative public-text filter. Site review remains necessary; this is not a complete PII detector.
export function publicText(...texts: string[]) { return texts.every(t => !/(?:bearer\s+[a-z0-9._-]+|(?:password|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+|\b(?:diagnosis|prescription|patient|bank account|credit card)\b|주민등록|계좌번호|진단명|처방전|비밀번호)/i.test(t) && !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\d{6}-[1-4]\d{6}\b|(?:01[016789])[- .]?\d{3,4}[- .]?\d{4}/i.test(t)); }
// Queries expose intent directly, so health/financial/personal searches are excluded even without identifiers.
export function publicSearchQuery(query: string) {
  return publicText(query) && !/\b(?:medical|diagnosis|patient|prescription|symptoms?|treatment|cancer|hiv|aids|depression|banking|finance|loan|credit|insurance|password|cookie|token)\b|의료|진료|환자|질병|증상|치료|처방|우울|암 검사|대출|신용|계좌|금융|주민|비밀번호/i.test(query);
}
