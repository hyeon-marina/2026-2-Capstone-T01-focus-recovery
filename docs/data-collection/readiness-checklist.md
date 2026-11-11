# 수집 개시 Readiness

## #103 최신 판정

- 기술 기능: 로컬 소유자 전용 setup/회전·공통 정책 설치·슬롯 자동 배정·로컬 상태/파일 로그인·본인 재수집/최신 privacy 조회. 실행 근거와 플랫폼별 PASS/NOT_TESTED는 [새 검증 보고](local-self-setup-validation.md)를 따른다.
- 실제 개시: **BLOCKED**. 팀의 실제 확정 정책·목표20·사이트·보존/삭제·명시적 동의·기관 판단·회수 담당/연락 경로·실제 HTTPS Chrome 파일럿이 필요하다. DRAFT 또는 합성 근거를 실제 승인으로 바꾸지 않는다.
- 개인 PC 원본 모드: 운영자 Credential/등록/수동 DB Release/모델 추론은 필수가 아니다. `setup --slot`과 공통 확정 RAW_ONLY 정책을 사용한다. 본인 Credential·실제 동의·사이트·Build/Session Scope·privacy 검사는 유지한다.
- AI 활성 real-collection: 아래 기존 독립 승인·모델 증거·운영 서버 검증이 그대로 적용된다.
- Windows/NTFS·OS 인증서 신뢰·신규 OS 설치부터 사람의 수동 재현은 NOT_TESTED다. 합성 테스트 결과를 실제160세션으로 계산하지 않는다.

아래 #101/#99 표는 당시 검증 기록이다.


## #101 로컬 원본 전용 판정

**실제 참여자 수집 BLOCKED 유지.** AI/FastAPI·공용 서버는 개인 PC 원본 모드의 런타임 필수가 아닙니다. 아래 #99 표의 공용 인프라/실모델 행은 AI 활성 운영 경로의 항목입니다. 원본 수집을 위해 모델 실행을 강제하지 않지만, 기존 승인 Artifact의 참조를 임의 생략/승인하지도 않습니다.

| 항목 | 현재 상태 | 근거/남은 일 |
| --- | --- | --- |
| macOS loopback MySQL + individual-local HTTPS | PASS | 신규 볼륨·Flyway17·자체 공개 인증서 pin으로 health200·원문 없는 verify·암호화 백업 |
| 실제 Chrome 원본 수집 | PASS (SYNTHETIC) | 독립 MySQL3/Spring3/임시 Chrome3, A/B/C각10실측 Visit·POST/END/ACK·RAW_COLLECTED/AI NOT_RUN |
| 개인정보·전송·재시작 | PASS (SYNTHETIC) | 타인404, Worker/Chrome·Spring/MySQL 재시작, Queue 재전송, 철회·격리/오래된 privacy 거절 |
| Export/통합 | PASS (SYNTHETIC) | age·해시·Schema/FK/분포·중복·충돌·부분/160판정·철회 제외. 원문/키는 Git 밖 |
| 설치·팀원·관리자 매뉴얼 | PASS 범위 명시 | 실행 명령과 실제 합성 캡처. OS 신규 설치부터 사람의 수동 Chrome 로드/키체인 신뢰는 NOT_TESTED |
| Windows 전체 실행/ACL/인증서 | NOT_TESTED | PowerShell 명령·ACL 경로 제공, 실제 Windows 장비 필요 |
| Chrome OS 인증서 신뢰 설치/승인된 실제 HTTPS 수집 | NOT_TESTED / BLOCKED | Python pin 검증과 합성 HTTP Chrome을 구분. 실제 인증서 신뢰/승인 환경 파일럿 필요 |
| 실제 참여자3명 등록·Credential 전달/본인 동의 | BLOCKED | 실사용자 조치/위임 근거 없음. 합성 계정 대체 불가 |
| 목표20/사이트/기관·심의/보존·전체 회수/시작 승인 | BLOCKED | 기존 승인 상태 변경 없음. 별도 실수집 범위 검토와 독립 Release 필요 |
| 전체 개인정보 사본/백업/후속 학습 회수 | BLOCKED | 자동 삭제/전체 PURGED 아님. 실제 담당자·사본 대장/증거 필요 |

실행 세부와 최신 테스트 수는 [#101 검증 보고](individual-local-validation.md)에 있습니다. 아래 기존 #99 표/날짜는 해당 AI 활성 배포 기준의 기록으로 보존합니다.


2026-11-11 KST, Issue #99. **실제 참여자 수집: BLOCKED.** P1~P6는 PROPOSED, P2/P6 개인정보 선결은 BLOCKED를 유지한다. 코드·PR·합성 동의·테스트 성공은 운영 승인 기록이 아니다. 이 문서는 임의의 승인자·보존기간·기관 판단을 만들지 않는다.

상태는 `VERIFIED`(적힌 좁은 범위의 실행 증거 존재), `BLOCKED`(필수 조건 미충족), `NOT_TESTED`(실행 증거 없음)만 쓴다. VERIFIED가 있는 행도 실제 운영 전체를 승인한다는 뜻이 아니다. 상세 명령/한계는 [최신 검증 보고](real-collection-validation.md), 조치는 [운영 가이드](operator-guide.md)에 있다.

| 확인 항목 | 상태 | 근거 또는 충족 조건 |
| --- | --- | --- |
| 일반 HTML 수집 빌드·빈 사이트 DRAFT 설치 | VERIFIED | #99 실제 Chrome 설치·일반 HTML/SPA·승인 정책 차단·build/site 검증. 실제 인터넷 수집 승인 아님 |
| 신규 Secret·내부 TLS·배포 문법 | VERIFIED | mode600/신규파일·OpenSSL verify·Compose config PASS. 공용 TLS/전체 이미지 부팅은 NOT_TESTED |
| 최초 관리자 기본 계정/Token 없음 | VERIFIED | V15 Seed0건, non-web bootstrap·신규mode600 파일·감사·중복/웹실행 거절 테스트 |
| 관리자 권한 검증·발급 이력 | VERIFIED | H2/격리 MySQL에서 role403·폐기·TTL·재발급·감사 검증. 설정만으로 권한 획득 불가 |
| 실제 등록 담당자·학교/기관 위임 | BLOCKED | 신뢰된 실제 담당자/authorityRef·위임 기록 미제공. OS/DB 초기화 경계 구현은 실제 위임 확보와 다름 |
| 실제 참여자3명 등록·식별 연결표 | BLOCKED | 합성 계정만 생성. 실제 명단·별도 보호 연결표·참여 절차 필요 |
| 실제 Credential 발급·안전 전달·인수 확인 | BLOCKED | 발급 코드/합성 검증은 존재. 실제 참여자에게 발급/전달하지 않음 |
| 인증·소유권·계정/Queue 분리 | VERIFIED | #97 보안·FK, 기존 FE access/Runtime 및 BE AuthConsent 회귀. Chrome 재인증·타인404 |
| 확정 목표20개 원문 | BLOCKED | 문서/Fixture에 확정 목록 없음. 4영역×5개 구체 후보·시나리오/종료 기준을 작성했지만 DRAFT20. 실제 팀 승인 근거 필요 |
| 160개 계획·초기54/53/53·시나리오각2회 | VERIFIED | 실행 생성기와 plan.draft.json 일치, 총수/중복/분포/revision/실적 잠금 테스트 |
| 참여자별 진행률·민감 원문 비노출 | VERIFIED | 본인 조회·관리자403/감사·source 분리, 실제 Chrome/MySQL의10 Visit/8 Window 합성 집계 |
| 정상 종료와 품질 완료 구분 | VERIFIED | 최소10·ordered Window·AI/상태/dirty·전송 영수증·privacy 우선 검증 |
| 실제 동의서 목적·항목·학습/제공 범위 확정 | BLOCKED | 합성 정책만 있음. 실제 정책 책임자 검토·승인 참조 필요 |
| 승인된 보존기간·삭제/최소 감사/Tombstone 범위 | BLOCKED | 기간·삭제 기한·감사 범위 미확정. 기술 TTL/lease는 보존기간이 아님 |
| 실제 참여자3명의 명시적 동의 | BLOCKED | 실제 동의 기록 없음. SYNTHETIC 동의는 대체 불가 |
| 학교·기관 절차 | BLOCKED | 실제 담당자 확인/기록 없음 |
| 연구심의 적용/비적용 판단 | BLOCKED | 공식 판단 근거 없음. 팀원3명이라는 이유로 생략 불가 |
| 허용 사이트·민감 URL/DOM 정책 확정 | BLOCKED | 실제 빌드·서버 digest/build/세션scope/DBrelease 검증 구현. 실제 승인 허용 목록·사이트별 안전성 검증 필요 |
| 승인 전 일반 웹페이지 수집 차단 | VERIFIED | locked build의수집flag 강제false, 최소권한/Content Script없음. pilot도loopback 고정DOM/catalog재검사 |
| 일반 HTML Adapter·SPA·Chrome 합성 E2E | VERIFIED | #99 통제 일반 HTML10 Visit/8 Window, 실제 Chrome/Spring/MySQL/FastAPI·Mock 모델. 실제 인터넷 사이트 및 Google/Naver live는 NOT_TESTED |
| Chrome MV3·IndexedDB·Worker/전체브라우저 재시작 | VERIFIED | macOS arm64 Chrome for Testing151.0.7922.34, 합성 catalog. Windows·실제사용자 프로필 아님 |
| 네트워크·ACK 유실·POST/PATCH/END·회수 replay | VERIFIED | 기존 Runtime/Chrome Mock HTTP 회귀, #97 실제 HTTP 정상전송. 실인터넷 장애/장기운영은 별도 |
| FE→실제Spring→MySQL→FastAPI→BE상태 | VERIFIED | #97 합성10 Visit/8 Window E2E. 모델 의존성은 FakeEmbedding/FakeContext |
| 기존 v1/v2 회귀 | VERIFIED | FE/AI 전체·BE 전체 실행분, 실제 v1/v2 Chrome 합성 회귀. 환경 Skip 목록은 보고서 참조 |
| Windows Chrome | NOT_TESTED | 실제 Windows 실행 환경 없음 |
| macOS 네이티브 다중창·최소화·다른앱/OS sleep | NOT_TESTED | headless 검증과 단위 가상시계는 네이티브 OS 증거가 아님 |
| 실제 모델 파일·모델 로딩·추론 Smoke | NOT_TESTED | torch/transformers/sentence_transformers·로컬 Qwen 가중치 없음. strict smoke exit2, SKIPPED, loaded/inference=false. immutable revision 준비 도구 제공 |
| 실제 모델 정확도·처리량·지연/p95 | NOT_TESTED | Mock 경로 latency는 실모델 성능 근거 아님 |
| 실사용 FE/BE/AI 공용 서버 연결 | BLOCKED | 실제 공용 주소/호스트·허용 출처·배포·가용성 검증 미제공. loopback 파일럿은 공용 운영 서버가 아님 |
| 운영 TLS·Secret 저장·교체·proxy/방화벽 | BLOCKED | 준비 profile은 TLS 필수·직접 TLS·기본 Gate닫힘. 실제 인증서·secret manager·배포 검증 없음 |
| 신규 MySQL V1~V16·기존행보존·재migrate0 | VERIFIED | 새 합성 MySQL8.4.9/H2, V16 no seed·재migrate0. 운영 DB 미접근 |
| 관리 메타데이터·인증·배정 Spring 재시작 | VERIFIED | 새 Spring context의 등록·Credential·배정·감사 복구 및 실제 Spring 프로세스 재시작 후10 Visit/8 Window 후처리·Chrome 재인증 검증 |
| 합성 DB 복사본 복원·철회원장 재적용 | VERIFIED | 신규 스키마에서 release전부폐기·격리/Tombstone 유지. 별도 신규 합성 MySQL daemon 재시작 후 철회/격리/Tombstone 유지도 확인. 운영 복원·OS kill·디스크full은 NOT_TESTED |
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

일반 페이지 Adapter와 승인 배포 경로는 구현했지만 모든 사이트의 안전성·실제 모델·공용 TLS·참여자 파일럿을 검증한 상태는 아니다. 운영 활성화에는 실제 계약·기관·보존·사이트·배포/모델 검증·시작 승인 근거를 갖춘 read-only 정책 파일, 독립 DBrelease, 현재 승인 동의·확정 배정과 일치하는 새 빌드가 필요하다. 현재 승인 기록이 없어 경로는 fail-closed다. 빈 DRAFT 패키지는 사이트 권한 없이 설치만 검증한다. 코드/PR 병합으로 P1~P6를 승인하지 않는다.
