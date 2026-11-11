const messages: Record<string, string> = {
  LOCAL_SETUP_REQUIRED: '로컬 참여자 초기화 미완료 · local.py setup --slot A/B/C를 실행하세요.',
  LOCAL_POLICY_MISSING: '공통 정책 없음 · 팀의 확정 정책 파일과 별도 SHA-256을 받아 적용하세요.',
  LOCAL_POLICY_DRAFT: '공통 정책 DRAFT · 팀이 목적·항목·사이트·보존·기관 판단을 실제 확정해야 합니다.',
  LOCAL_POLICY_EXPIRED: '공통 정책 만료 · 수집을 중지하고 팀의 새 정책을 적용한 뒤 다시 동의하세요.',
  LOCAL_POLICY_MISMATCH: '정책 무결성·개시 조건 불일치 · 확정 파일·기간·SHA-256을 확인하고 setup을 다시 실행하세요.',
  GOAL_UNCONFIRMED: '작업 목표 미확정 · 공통 Plan revision과 20개 확정 원문을 적용하세요.',
  CONSENT_REQUIRED: '본인 동의 미완료 · 아래 목적·항목·보존 방침을 읽고 직접 동의하세요.',
  PRIVACY_WITHDRAWN: '전체 동의 철회·격리 상태 · 수집을 재개할 수 없습니다.',
};
export const localBlocker = (code: string) => messages[code] ?? '수집 조건 미충족 · 로컬 상태와 검증 가이드를 확인하세요.';
