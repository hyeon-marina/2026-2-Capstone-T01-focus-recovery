const messages: Record<string, string> = {
  LOCAL_SETUP_REQUIRED: '로컬 참여자 초기화 미완료 · local.py setup --slot A/B/C를 실행하세요.',
  LOCAL_POLICY_MISSING: '공통 정책 없음 · 최신 main에서 local.py setup --slot A/B/C를 실행하세요.',
  INSTITUTION_BLOCKED: '공통 정책·목표 설치 완료 · 학교·기관의 적용 여부 판단 또는 필요한 승인 결과가 미등록되어 실제 수집 개시가 차단됩니다. 본인 동의와는 별도 조건입니다.',
  LOCAL_POLICY_DRAFT: '이전 DRAFT 정책 설치됨 · 저장소의 CONFIRMED 운영 정책으로 setup을 실행하세요.',
  LOCAL_POLICY_EXPIRED: '공통 정책 만료 · 수집을 중지하고 팀의 새 정책을 적용한 뒤 다시 동의하세요.',
  LOCAL_POLICY_MISMATCH: '정책 무결성·개시 조건 불일치 · 확정 파일·기간·SHA-256을 확인하고 setup을 다시 실행하세요.',
  GOAL_UNCONFIRMED: '작업 목표 미확정 · 공통 Plan revision과 20개 확정 원문을 적용하세요.',
  CONSENT_REQUIRED: '본인 동의 미완료 · 아래 목적·항목·보존 방침을 읽고 직접 동의하세요.',
  PRIVACY_WITHDRAWN: '전체 동의 철회·격리 상태 · 수집을 재개할 수 없습니다.',
};
export const localBlocker = (code: string) => messages[code] ?? '수집 조건 미충족 · 로컬 상태와 검증 가이드를 확인하세요.';

const observationMessages: Record<string, string> = {
  WAITING_OBSERVATION: '페이지 관찰 응답을 기다립니다. 공개 웹페이지로 돌아가세요.',
  CONTENT_SCRIPT_UNAVAILABLE: '페이지 관찰 코드에 연결하지 못했습니다. 확장 업데이트 전에 열었던 페이지라면 새로고침한 뒤 재전송 / 복구를 누르세요.',
  SITE_PERMISSION_REQUIRED: 'Chrome 확장 프로그램의 사이트 접근 권한을 허용한 뒤 페이지를 새로고침하세요.',
  NO_FOREGROUND_TAB: '전경 Chrome 창의 공개 웹페이지로 돌아가세요.',
  NOT_FOCUSED_OR_STALE: '포커스가 없거나 이전 탐색 응답입니다. 활성 웹페이지에서 다시 관찰합니다.',
  INPUT_FOCUSED: '입력 요소에 포커스가 있어 이 페이지 관찰을 중지했습니다. 입력값은 읽지 않습니다. 본문으로 포커스를 옮기면 다시 관찰합니다.',
  POLICY: '현재 페이지는 수집 제외 대상입니다. 다른 공개 문서에서 계속할 수 있습니다.',
  WAITING_CONTENT: '제목·본문이 준비되기를 기다립니다.',
  OBSERVING: '공개 페이지를 관찰 중입니다. 실제 활성 체류시간 5초부터 Visit을 생성합니다.',
  OBSERVATION_GAP: '관찰 응답이 지연되어 확인할 수 없는 시간은 체류시간에 포함하지 않았습니다.',
  EXTRACTION_NO_CONTENT: '추출 가능한 본문을 찾지 못했습니다. 다른 공개 문서에서 계속할 수 있습니다.',
  EXTRACTION_DOM_ERROR: '본문 추출 중 오류가 발생했습니다. 다른 공개 문서에서 계속할 수 있습니다.',
  EXTRACTION_RENDER_TIMEOUT: '본문 렌더링 대기시간을 초과했습니다. 페이지가 준비되면 다시 관찰합니다.',
  EXTRACTION_ACCESS_DENIED: 'HTML 본문에 접근할 수 없습니다. 다른 공개 문서에서 계속할 수 있습니다.',
  SENSITIVE_CONTENT: '고위험 개인정보 신호로 세션을 격리했습니다.',
};
export const observationStatus = (code: string) => observationMessages[code] ?? '관찰 상태 확인 중';
