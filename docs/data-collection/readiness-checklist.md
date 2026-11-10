# 수집 개시 Readiness

2026-11-11 KST, Issue #97. **실제 참여자 수집: BLOCKED.** P1~P6는 PROPOSED, P2/P6 개인정보 선결은 BLOCKED를 유지한다. 코드·PR·합성 동의·테스트 성공은 운영 승인 기록이 아니다. 이 문서는 임의의 승인자·보존기간·기관 판단을 만들지 않는다.

상태는 `VERIFIED`(적힌 좁은 범위의 실행 증거 존재), `BLOCKED`(필수 조건 미충족), `NOT_TESTED`(실행 증거 없음)만 쓴다. VERIFIED가 있는 행도 실제 운영 전체를 승인한다는 뜻이 아니다. 상세 명령/한계는 [검증 보고](environment-validation.md), 조치는 [운영 가이드](operator-guide.md)에 있다.

| 확인 항목 | 상태 | 근거 또는 충족 조건 |
| --- | --- | --- |
| 최초 관리자 기본 계정/Token 없음 | VERIFIED | V15 Seed0건, non-web bootstrap·신규mode600 파일·감사·중복/웹실행 거절 테스트 |
| 관리자 권한 검증·발급 이력 | VERIFIED | H2/격리 MySQL에서 role403·폐기·TTL·재발급·감사 검증. 설정만으로 권한 획득 불가 |
| 실제 등록 담당자·학교/기관 위임 | BLOCKED | 신뢰된 실제 담당자/authorityRef·위임 기록 미제공. OS/DB 초기화 경계 구현은 실제 위임 확보와 다름 |
| 실제 참여자3명 등록·식별 연결표 | BLOCKED | 합성 계정만 생성. 실제 명단·별도 보호 연결표·참여 절차 필요 |
| 실제 Credential 발급·안전 전달·인수 확인 | BLOCKED | 발급 코드/합성 검증은 존재. 실제 참여자에게 발급/전달하지 않음 |
| 인증·소유권·계정/Queue 분리 | VERIFIED | #97 보안·FK, 기존 FE access/Runtime 및 BE AuthConsent 회귀. Chrome 재인증·타인404 |
| 확정 목표20개 원문 | BLOCKED | 문서/Fixture에 확정 목록 없음. 공개 템플릿은 description=null, DRAFT20. 근거 있는 원문 검토 필요 |
| 160개 계획·초기54/53/53·시나리오각2회 | VERIFIED | 실행 생성기와 plan.draft.json 일치, 총수/중복/분포/revision/실적 잠금 테스트 |
| 참여자별 진행률·민감 원문 비노출 | VERIFIED | 본인 조회·관리자403/감사·source 분리, 실제 Chrome/MySQL의10 Visit/8 Window 합성 집계 |
| 정상 종료와 품질 완료 구분 | VERIFIED | 최소10·ordered Window·AI/상태/dirty·전송 영수증·privacy 우선 검증 |
| 실제 동의서 목적·항목·학습/제공 범위 확정 | BLOCKED | 합성 정책만 있음. 실제 정책 책임자 검토·승인 참조 필요 |
| 승인된 보존기간·삭제/최소 감사/Tombstone 범위 | BLOCKED | 기간·삭제 기한·감사 범위 미확정. 기술 TTL/lease는 보존기간이 아님 |
| 실제 참여자3명의 명시적 동의 | BLOCKED | 실제 동의 기록 없음. SYNTHETIC 동의는 대체 불가 |
| 학교·기관 절차 | BLOCKED | 실제 담당자 확인/기록 없음 |
| 연구심의 적용/비적용 판단 | BLOCKED | 공식 판단 근거 없음. 팀원3명이라는 이유로 생략 불가 |
| 허용 사이트·민감 URL/DOM 정책 확정 | BLOCKED | 파일럿은 닫힌 catalog만 허용. 실제 사이트 허용목록·변경 검토/안전성 검증 필요 |
| 승인 전 일반 웹페이지 수집 차단 | VERIFIED | locked build의수집flag 강제false, 최소권한/Content Script없음. pilot도loopback 고정DOM/catalog재검사 |
| 실제 일반 HTML·Google/Naver v2 수집 | NOT_TESTED | 기존 v1/추출 단위·합성 검색 회귀와 다름. 일반 사이트용 승인 실행 adapter/권한 연결도 후속 검토 필요 |
| Chrome MV3·IndexedDB·Worker/전체브라우저 재시작 | VERIFIED | macOS arm64 Chrome for Testing151.0.7922.34, 합성 catalog. Windows·실제사용자 프로필 아님 |
| 네트워크·ACK 유실·POST/PATCH/END·회수 replay | VERIFIED | 기존 Runtime/Chrome Mock HTTP 회귀, #97 실제 HTTP 정상전송. 실인터넷 장애/장기운영은 별도 |
| FE→실제Spring→MySQL→FastAPI→BE상태 | VERIFIED | #97 합성10 Visit/8 Window E2E. 모델 의존성은 FakeEmbedding/FakeContext |
| 기존 v1/v2 회귀 | VERIFIED | FE/AI 전체·BE 전체 실행분, 실제 v1/v2 Chrome 합성 회귀. 환경 Skip 목록은 보고서 참조 |
| Windows Chrome | NOT_TESTED | 실제 Windows 실행 환경 없음 |
| macOS 네이티브 다중창·최소화·다른앱/OS sleep | NOT_TESTED | headless 검증과 단위 가상시계는 네이티브 OS 증거가 아님 |
| 실제 모델 파일·모델 로딩·추론 Smoke | NOT_TESTED | torch/transformers/sentence_transformers·로컬 Qwen 가중치 없음. smoke SKIPPED, loaded/inference=false |
| 실제 모델 정확도·처리량·지연/p95 | NOT_TESTED | Mock 경로 latency는 실모델 성능 근거 아님 |
| 실사용 FE/BE/AI 공용 서버 연결 | BLOCKED | 실제 공용 주소/호스트·허용 출처·배포·가용성 검증 미제공. loopback 파일럿은 공용 운영 서버가 아님 |
| 운영 TLS·Secret 저장·교체·proxy/방화벽 | BLOCKED | 준비 profile은 TLS 필수·직접 TLS·기본 Gate닫힘. 실제 인증서·secret manager·배포 검증 없음 |
| 신규 MySQL V1~V15·V14보존·재migrate0 | VERIFIED | 빈 신규 MySQL8.4.9 및 H2. 운영 DB 미접근 |
| 관리 메타데이터·인증·배정 Spring 재시작 | VERIFIED | 새 Spring context의 등록·Credential·배정·감사 복구 및 실제 Spring 프로세스 재시작 후10 Visit/8 Window 후처리·Chrome 재인증 검증 |
| 실제 MySQL daemon/OS kill·디스크full·복원훈련 | NOT_TESTED | Spring context 재시작과 구분 |
| 전체 동의 철회·세션/파생 격리·늦은재유입 차단 | VERIFIED | 합성 환경에서 기존 #93/#95 경계와 #97 Chrome/MySQL 철회. 전체 삭제 완료 아님 |
| 제품 v1 Payload·FE 원본/archive 안전폐기 | BLOCKED | 실제 보존/폐기 승인·확인 절차 미완료 |
| AI 전Worker·다중호스트·GPU/모델 영향 제거 | BLOCKED | 로컬 Journal/캐시 격리만 검증. 물리 삭제/학습 영향 증거 없음 |
| Export·학습·수신자·로그·백업 전체회수 | BLOCKED | 사본 대장·삭제/복원 후tombstone 재적용·영향 검증 미완료 |
| 수집 중지·철회 실행 절차 | VERIFIED | 실제 화면/Queue와 참여자·관리자 가이드 제공. 운영 책임자 연락망·훈련은 별도 필요 |
| 실제 문의·사고 대응 담당자·배포 인수 | BLOCKED | 실제 담당자와 비공개 연락/Secret 전달 경로 미지정 |
| 후속 Export/라벨링 인계 | BLOCKED | DB↔JSONL 대응·source/consent/privacy 식별관계 준비. 전체 Export·라벨 UI·재학습은 별도 작업 |
| 최종 수집 개시 승인 | BLOCKED | 명명된 승인자·시간대 포함 일시·배포 Commit/범위/사이트·정책 버전·증거 URL 없음 |

## 승인 기록에 필요한 내용

담당자는 실제 참여자 범위, 확정 목표 원문, 동의 정책/버전·수집/학습/제공 목적, 사이트 범위, 보존/회수·사본/백업 처리, 기관/심의 판단, 운영 인증/TLS/Secret·실모델·플랫폼 검증, 중단 책임자, 배포 Commit과 패키지 체크섬을 검토해야 한다. 승인자·위임 근거·승인 일시(KST 또는 UTC 명시)·증거 URL을 실제 기록으로 연결한다. 이 문서에 체크만 하거나 DB policy status를 APPROVED로 바꾸어 실제 수집을 열 수 없다.

운영 활성화에는 별도 검토된 Gate/일반 페이지 실행·권한 연결 변경과 새 배포 검증이 필요하다. 이번 구현을 “승인만 입력하면 개발 없이 실제 모든 사이트 수집이 가능”한 상태라고 보고하지 않는다. 승인 조건이 없는 현재는 그 경로를 제공하지 않아 실사용자 데이터가 저장·전송되지 않는다.
