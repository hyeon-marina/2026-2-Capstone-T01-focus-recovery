# #103 로컬 셀프 초기화 검증

2026-11-11 KST. **실제 참여자 수집 개시: BLOCKED / 실제 수집 실적: 0.** 이 보고서의 실행 데이터·정책 근거·동의는 모두 격리된 SYNTHETIC/TEST fixture다. 팀의 실제 승인·개인정보/기관 판단·사람의 동의를 대신하지 않는다.

## 1. 작업 전 Git 상태

전용 Worktree `e660`, detached HEAD `6e15dd3fa1789e96c42bc4f33250c4221d6d2616`. `git status --short` 출력 없음(수정/미추적0). origin은 개인 Fork hyeon-marina, upstream은 SKHU-AI-Projects-Archive 공식 저장소. 다른 Worktree 목록을 확인했으며 수정하지 않았다. repo 내 AGENTS.md 없음, 상위 Codex AGENTS.md는 빈 파일. `.github/pull_request_template.md` 확인.

## 2. 공식 main과 브랜치

`git ls-remote upstream refs/heads/main`과 fetch로 확인한 시작 main: `a24591a422a60064bace3a9e5012c587d2b757dc`. 이 SHA에서 `feat/103/v2-local-self-setup` 생성. 공식 main 직접 Push·reset --hard·clean·force Push·기존 볼륨 삭제·자동 Merge는 하지 않는다.

## 3. Issue·선행 구현 확인

GitHub Issue #103 본문과 댓글0건, #99/#101 본문, PR #100/#102 설명 및 전체 patch를 조회했다. 선행 코드의 local.py/dataset.py/test_local.py/test_dataset.py/manage.py, individual-local Profile/Compose, CollectionOperatorBootstrap/SitePolicy/Plan/Progress/Controller, ConsentService, participant UI 및 지정 가이드·계약·Plan/목표 후보를 분석했다. #102에서 원본 RAW_COLLECTED와 AI NOT_RUN·Export/Import를 분리했지만 관리자 등록/발급과 기존 운영 Artifact/Release를 그대로 요구했다.

## 4. 기존 차단 원인과 분류

| 분류 | 기존 조건/오류 | #103 처리 |
| --- | --- | --- |
| A 기술 운영 | bootstrap→운영자→enroll/issue→slot 수동 연결 | OS 소유자 전용 offline setup, 운영자 역할 생성0 |
| A 기술 운영 | Artifact마다 별도 DB collection_release | 공통 확정 정책/hash 검증 후 로컬 설치 트랜잭션에서 자동 연결 |
| B 인증/소유권 | Credential 없음/만료/폐기401, 타인 세션404 | 유지, owner-only 발급/회전·재로그인 안내 |
| B 동의/privacy | CONSENT_REQUIRED, CONSENT_POLICY_UNAVAILABLE, PRIVACY_RETRACTED | 본인 직접 동의·철회/격리 유지 |
| B 범위 | V2_STORAGE_DISABLED, COLLECTION_POLICY_BLOCKED, PARTICIPANT_COLLECTION_BLOCKED | build/session digest·기간·정확한 사이트·scope 유지 |
| C 팀 정책 | DRAFT 목표→GOAL_UNCONFIRMED, 목적/항목/보존/허용 사이트/개시 범위 | 실제 확정 공통 파일과 Plan/hash를 각 PC에 동일 적용 |
| D 기관 판단 | institutionRef 등 실제 판단 필요 | REQUIRED_SATISFIED/NOT_REQUIRED와 실제 evidenceRef 요구; UNRESOLVED 차단 |
| AI 활성 모드 | modelEvidenceRef 등 운영 Artifact | real-collection 계약 유지 |
| 원본 전용 | 모델을 실행하지 않음 | RAW_ONLY 계약에 모델 증거 필드 없음. 가짜 문자열로 채우지 않음 |

이전 `init --slot`은 설정·Secret·TLS·DRAFT만 생성했다. #103의 `setup`은 준비 기능까지 연결하며 수집 정책이나 명시적 동의를 자동 창작하지 않는다.

## 5. 셀프 초기화

`python3 tools/individual-local/local.py setup --slot A`(B/C 동일). 도구/JDK21·Docker/Compose·JAR 확인 → 신규 전용 디렉터리/TLS → 자기 MySQL → non-web Java 초기화 → HTTPS 서버 → 인증서 pin 검증. 기존 디렉터리는 OS 소유자/권한/symlink를 확인하고 같은 슬롯만 재사용한다. 기존 참여자/세션/계획/정책이 있는 DB를 새 소유자가 인수할 수 없다.

V18은 단일 collection_local_owner의 owner hash/slot/participant/policy·Plan hash만 추가한다. 최초 owner secret을 DB와 별도로 보호해 실패 후 재실행을 허용한다. 기존 V1~V17 원문은 변경하지 않았다. 실행 JAR 사본을 고정해 작업 폴더의 재빌드가 실행 중 JVM의 nested JAR를 교체하지 않도록 했다.

## 6. Credential

SecureRandom32bytes opaque Token, DB에는 SHA-256만 저장. participant/source UUID는 PC별 생성하며 숫자 내부ID를 전역ID로 사용하지 않는다. participant.json은 POSIX600 또는 Windows owner ACL. 로그/화면에 Token을 출력하지 않는다. 같은 슬롯 재실행은 유효 Credential/UUID를 유지한다. 유실/만료/폐기 또는 `--rotate-credential`은 기존 Token을 원자 폐기하고 최대24시간 Credential을 발급한다.

철회 후 회전은 최신 privacy 조회용 인증만 제공한다. withdrawn_at·동의·격리 상태를 되살리지 않고 정책 재적용도 거절한다. 소유자 키 유실이나 다른 PC의 키/Token으로 DB를 인수할 수 없다.

## 7. 공통 정책 설치

`focus-local-policy/1`, RAW_ONLY, CONFIRMED, 실제 teamDecisionRef·기관 판단 근거·수집/활용·보존/삭제·민감 페이지/검색어/본문 처리·변경/기간·명시적 개시 범위·정확한 HTTPS 사이트·공통 확정 Plan을 검사한다. 정책 전체 bytes SHA-256을 별도 신뢰 경로로 받은 hash와 대조하고 정렬 compact UTF-8 Plan hash를 확인한다. SHA-256 자체가 사람의 승인을 증명하지는 않는다.

자동 설치는 DB consent_policy와 collection_release, 자기 슬롯 배정 연결만 수행한다. 동의 record는 만들지 않는다. 새 정책 버전/notBefore는 이전 이후여야 하고, 활성 세션 중 변경·기존 정책ID/version의 다른 bytes·실적 있는 Plan 변경을 거절한다. 적용 후 새 Extension digest/재동의가 필요하다. 복원으로 폐기된 Release를 같은 파일로 되살리지 않는다.

## 8. 준비 상태·오류 안내

인증된 본인 `/api/collection/local-status`는 슬롯·정책 hash·Plan revision/Plan/Goal/Assignment checksum·방침 원문·blockers를 돌려준다. LOCAL_SETUP_REQUIRED, LOCAL_POLICY_MISSING/DRAFT/EXPIRED/MISMATCH, GOAL_UNCONFIRMED, CONSENT_REQUIRED, PRIVACY_WITHDRAWN을 구분한다. 인증 없음/만료·폐기는 기존401을 유지해 Credential 존재 여부를 노출하지 않는다. Chrome TypeError로 네트워크와 TLS 원인을 구분할 수 없을 때 `status`와 인증서 신뢰/만료 점검을 함께 안내한다.

빌드/정책 digest 불일치는 UI에서 재빌드 안내와 시작 비활성으로 처리한다. 허용 사이트·민감 DOM/URL은 기존 Collector/Runtime 및 BE 범위 검사로 계속 차단한다. BE의 민감 경로/호스트 검사도 로그인·금융·결제 용어를 포함한다.

## 9. Extension UI

기존 AuthConsentPanel·participant·Collector/Runtime/IndexedDB/Queue/ACK를 재사용했다. 본인 participant.json 파일 선택으로 로그인하며 파일을 서버로 업로드하지 않는다. Token은 trusted-context chrome.storage.session만 사용하고 정적 Extension/local/sync/콘텐츠 스크립트에 넣지 않는다. Chrome 완전 종료 후 재로그인한다.

슬롯·연결·Credential·정책/방침·차단 이유·목표/시나리오·Visit/Queue/END ACK·RAW_COLLECTED/NOT_RUN·철회를 표시한다. 본인 ENDED/CLEAR 시도에 정해진 사유를 남기는 로컬 재수집 API/UI를 추가했다. 타인/활성/격리 시도는 허용하지 않는다. real-collection에는 본인 review API를 노출하지 않는다.

## 10. A/B/C 배정

공통 Plan은20목표×4시나리오×2회=160, A54/B53/C53. 기존 PLAN/goal/type/repetition/slot 조합과 공통 revision/hash를 검증한다. 공통 입력에는 로컬 UUID를 넣지 않으며 자기 PC의 한 슬롯만 owner UUID에 연결한다. 기존 시도/재수집 잠금·최신 시도 집계·중복 완료 방지·SYNTHETIC 구분은 유지한다. 저장소 목표20/사이트 정책은 DRAFT를 유지한다.

## 11. AI 비의존 원본

FastAPI/Qwen을 실행하지 않은 Chrome E2E에서 각자10실측 Visit, 실제 IndexedDB→Spring→MySQL·END/전송 ACK, RAW_COLLECTED, NOT_RUN, Window/Analysis0을 확인했다. 기존5초/4초복귀/최초5분 PATCH/10 Visit/size3-stride1 유지. API 통합 테스트는300000ms Behavior PATCH도 검증한다. QUALITY_PASSED의 AI 완료 조건은 바꾸지 않았다. AI 활성 경로는 별도 Mock 모델 FastAPI 회귀에서 검증했다.

## 12. Export/Import

focus-raw-export/1·JSONL·Manifest·SHA-256·age·source/participant·공통 Plan·감사·멱등·충돌/FK·최신 privacy/rollback을 보존한다. 새 `/export-privacy`와 dataset.py privacy의 --participant 생략으로 자기 상태를 조회한다. 기존 admin 타인 조회는 운영자 검사를 유지한다. 파일 schema 버전 변경/원문 migration 변경 없음.

실제 Chrome A/B/C 암호화3개 통합은3세션/30 Visit/이론상24 Window·생성0/AI0/PARTIAL. 중복 Import3건·ID충돌·Plan불일치·오래된 privacy 재유입 차단. A철회 후2세션/20 Visit, privacyExcluded1. 전체160 합성 Fixture는160세션/1600 Visit/이론상1280/COMPLETE이며 실제 Chrome160세션 수집 결과가 아니다.

## 13. 보안·개인정보

loopback MySQL/Backend·HTTPS/pin·owner-only·오프라인 소유권·타인404·다른PC Token401·관리자API403·명시적 동의·정책/사이트/빌드/scope·철회/격리·암호화/최신 privacy 검사를 유지한다. 실제 개인정보·Credential·Secret·개인키·Export 원문은 Git에 포함하지 않는다. QUARANTINED는 외부 사본 전체 삭제/PURGED가 아니다.

## 14. macOS

macOS27.2 arm64, JDK21.0.10, Docker29.2.0/MySQL8.4.9, Node25.9.0, Python3.11.16, Chrome for Testing151, age1.3.2. 새 전용 볼륨/프로필에서 검증했다. 사용자 키체인을 변경하지 않고 Python 공개 인증서 pin을 검증했으며, Chrome의 미신뢰 인증서 차단도 확인했다.

## 15. Windows

**NOT_TESTED**: Windows 장비가 없어 PowerShell/NTFS ACL·인증서 현재 사용자 신뢰·Docker/Java 종료·전체 설치/수집은 실행하지 않았다. OS별 명령/ACL 경로를 제공한 것과 실행 성공을 구분한다. Linux도 NOT_TESTED다.

## 16. Chrome 실제 실행

[실행 증거 JSON](evidence/issue103-chrome-summary.json): 신규 MySQL3/Spring3/임시 Chrome3, 정확한 test Profile·통제 HTTP 페이지·SYNTHETIC 출처. Worker/Chrome·Spring/MySQL 재시작, 전송 장애/재시도, 타인404, 동의 철회·격리, Export/통합을 실제 실행했다.

개인 로컬 self-setup 경로는 [별도 실행 증거](evidence/issue103-self-setup-summary.json)의 신규 DB3개 **실제 individual-local HTTPS API**에서 검증했다. DB별 participant1/운영자0/로컬 소유자1/Flyway18, UI 상태의 Goal/Assignment checksum과 암호화 Manifest 일치도 확인했다. 이 경로의 fixture는 운영 Profile 동작을 모사하므로 내부 source=PARTICIPANT이나 **전부 SYNTHETIC TEST이며 실제 팀 실적0**이다. 테스트 정책/원문/암호화 파일은 `.collection` 격리 경로에서 보존하며 실제 수집/통합에 사용하지 않는다. Chrome HTTP 결과와 로컬 HTTPS API 결과를 하나의 HTTPS Chrome E2E 성공으로 합치지 않는다. 실제 OS 신뢰 설치 후 HTTPS Chrome 수집은 NOT_TESTED다.

## 17. 실제 캡처

기존 #101 Chrome 캡처9장을 확인하고 원본을 보존했다. 새 캡처는 실행한 Chrome 화면이며 생성형 이미지/가짜 프로그램 화면을 쓰지 않았다. 파일 입력/Token 값은 비웠다.

| 파일(images/team-guide/) | 내용/판정 |
| --- | --- |
| [self103-local-login.png](images/team-guide/self103-local-login.png) | 실제 로컬 DRAFT Extension의 파일 로그인 UI, TEST |
| [self103-tls-blocked.png](images/team-guide/self103-tls-blocked.png) | 실제 미신뢰 로컬 인증서 로그인 차단, TEST |
| [self103-extension-login.png](images/team-guide/self103-extension-login.png) | SYNTHETIC Chrome 로그인 전 |
| [self103-consent.png](images/team-guide/self103-consent.png) | SYNTHETIC 정책·명시적 동의 |
| [self103-collection-goal.png](images/team-guide/self103-collection-goal.png) | SYNTHETIC 자기 목표·시나리오 |
| [self103-collection-start.png](images/team-guide/self103-collection-start.png) | SYNTHETIC 수집 시작 |
| [self103-collection-progress.png](images/team-guide/self103-collection-progress.png) | SYNTHETIC 실측 Visit 진행 |
| [self103-collection-complete.png](images/team-guide/self103-collection-complete.png) | SYNTHETIC RAW_COLLECTED/NOT_RUN/END ACK |
| [self103-withdrawal.png](images/team-guide/self103-withdrawal.png) | SYNTHETIC 전체 동의 철회/격리 |

**NOT_CAPTURED**: 네이티브 터미널의 setup/슬롯/발급·재발급 완료 화면은 명령 로그만 확보했고 화면 촬영은 실행하지 않았다. 로컬 슬롯/공통 hash/확정 로컬 정책·재발급 후 로그인 성공 화면은 Chrome OS 인증서 신뢰를 설치하지 않아 미캡처다. API 결과를 화면처럼 합성하지 않았다. 실행 시점 build-info에는 base SHA와 dirty=true가 표시되며 최종 Commit의 clean 패키지 캡처라고 주장하지 않는다.

## 18. 매뉴얼 재현

[설치/초기화](individual-local-setup.md), [참여자](participant-guide.md), [절차](collection-procedure.md), [운영](operator-guide.md), [Readiness](readiness-checklist.md), [통합](merge-guide.md)를 갱신했다. macOS에서 실제 setup/정책 적용/회전/로그인 UI/build/수집/Export 명령을 실행했다. 신규 OS 설치부터 사람이 수동으로 전체25단계를 재현한 사용성 시험은 NOT_TESTED다. 실제 팀 정책·기관 판단을 입력하는 단계는 BLOCKED다.

## 19. 회귀·실행 명령과 결과

| 검증 | 결과 |
| --- | --- |
| FE typecheck·전체 Vitest | PASS: 909 / 환경 의존2 SKIPPED |
| BE 전체·실제 MySQL/Mock FastAPI/Chrome 연동 | PASS: 1028 중950 PASS·78 SKIPPED·failure/error0. 후속 정책/민감 사이트·V18·인증·원본 focused65건 추가 PASS(중복 합산하지 않음) |
| AI 기존 테스트 | PASS: 244, 실제 Qwen 실행은 SKIPPED(이번 원본 모드 필수 아님) |
| Python local/dataset | PASS: 32(local/dataset), age 실제 암복호화 포함 |
| 기존 collection 도구 | PASS: 5 |
| 공통 계약 | PASS: 30defs/80schema/139reference/216규칙/κ4, 문서 links/fences |
| 실제 A/B/C Chrome 원본·회수·통합 | PASS(SYNTHETIC), 상세는16절 |
| 새 self-setup HTTPS API E2E | PASS(SYNTHETIC): A54/B53/C53·고유 UUID/중복 방지·회전/폐기·소유자 실패 복구·정책 hash/만료·10 Visit/PATCH/END/ACK/RAW_COLLECTED/NOT_RUN·재시작·본인 재수집·정책 변경/재동의·철회 후 조회·통합/rollback |
| v1/v2 Chrome·participant/pilot/real 빌드 | PASS: v1/v2 실제 Chrome(Mock HTTP), v1/synthetic/participant/pilot/real 빌드. Native multi-window는 HEADED 미실행 SKIPPED |
| V1~V17 원문·새 V18 보존 | PASS: 기존 bytes 그대로, H2 additive/무Seed/멱등 및 신규 MySQL18 적용 |

```sh
python3 -m unittest discover -s tools/individual-local -v
python3 -m unittest discover -s tools/collection -p 'test_*.py' -v
# jsonschema를 설치한 테스트 Python으로:
python docs/contracts/v2/validate.py
npm --prefix fe run typecheck
npm --prefix fe test
# be 디렉터리:
./gradlew test bootJar
# 저장소 루트, JDK21 JAVA_HOME/PATH 설정 후 NEW_OUTPUT으로 매번 새 경로:
python3 tools/individual-local/run-self-setup-validation.py --output NEW_OUTPUT --synthetic-only
python3 tools/individual-local/run-synthetic-e2e.py --output NEW_CHROME_OUTPUT --chrome CHROME_EXECUTABLE
python3 tools/individual-local/run-regression.py --mysql-fixture CHROME_OUTPUT/A/fixture.json --output NEW_REGRESSION_OUTPUT --ai-python TEST_VENV_PYTHON --chrome CHROME_EXECUTABLE
```

실패 이력도 보존한다. 초기 전체 BE는 V17 테스트가 최신 migration을17로 고정 가정해1 FAILED→target17 및 새 V18 테스트로 수정. 신규 API fixture는 UTC millisecond `Z` 계약을 맞추지 못해2회 FAILED→fixture만 수정. 세 번째는 A/B/C 수집·통합 이후 병행 bootJar가 실행 중 JAR를 바꿔 철회 timeout FAILED→실행용 JAR 고정 및 최종 신규 환경 재실행 PASS. Python 기본 환경의 jsonschema 미설치는 테스트 venv로 실행했다. participant 빌드는 명시적 API 주소 누락으로1회 FAILED→VITE_API_BASE_URL=https://localhost:9443을 지정해 PASS, pilot은 loopback HTTP 주소를 지정해 PASS. 실패 환경의 DB/파일/볼륨은 삭제하지 않았다.

## 20. 미검증·외부 BLOCKED

- BLOCKED: 실제 공통 정책·목표20·사이트·기관 필요 여부 판단/근거·보존/삭제·개시 범위·사고/회수 담당·실제 본인 동의·3명 실제 파일럿.
- NOT_TESTED: Windows/Linux, OS 신뢰 후 실제 HTTPS Chrome self-setup 통합, 신규 OS 수동 설치 사용성, 실제 외부 Google/Naver 탐색, 실제 외부 사본 전체 회수.
- SKIPPED: 선택형 BE 환경78, FE 환경2, 실제 Qwen 추론. skip을 PASS에 합산하지 않는다.
- 기존 npm dev 의존성 audit3건(moderate1/critical2)은 이번에 major 강제 업그레이드하지 않았다.

## 21. 실제 개시 조건

팀이 실제 공통 내용과 최종 목표를 확정하고 필요한 기관 판단 근거·보존/회수/사고 경로를 갖춘다. A/B/C 각자는 자기 전용 PC/DB/Chrome 프로필에서 setup, 동일 확정 policy/hash·Plan, 실제 TLS 신뢰, 파일 로그인, 정책 확인 후 명시적 동의, 자기 배정, 실제 HTTPS 파일럿을 완료해야 한다. 실제160세션은 이후 별도로 수행한다. 합성 consent/approval/institution 값과 테스트 정책을 실제 환경에 복사하지 않는다.

## 22. 변경 파일·Commit

브랜치 `feat/103/v2-local-self-setup`. 한국어 Commit으로 구현·문서·실제 캡처를 제출하며 구체 SHA/Push/PR URL은 최종 보고와 PR에 기록한다. 아래 변경 목록은 이 보고서가 포함된 Commit의 `git show --stat`와 함께 확인한다.

변경 경로:

- `be/src/main/java/com/focusrecovery/domain/collection/CollectionExportController.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionExportService.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionSitePolicy.java`
- `be/src/main/java/com/focusrecovery/domain/collection/LocalCollectionPolicy.java`
- `be/src/main/java/com/focusrecovery/domain/collection/LocalCollectionSetup.java`
- `be/src/main/java/com/focusrecovery/domain/collection/LocalCollectionStatus.java`
- `be/src/main/java/com/focusrecovery/domain/identity/AuthenticationController.java`
- `be/src/main/resources/application-individual-local.properties`
- `be/src/main/resources/db/migration/V18__individual_local_owner.sql`
- `be/src/test/java/com/focusrecovery/domain/collection/LocalCollectionPolicyTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V17MigrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V18MigrationTest.java`
- `docs/contracts/collection-operations-api.md`
- `docs/data-collection/collection-procedure.md`
- `docs/data-collection/evidence/issue103-chrome-summary.json`
- `docs/data-collection/evidence/issue103-regression-summary.json`
- `docs/data-collection/evidence/issue103-self-setup-summary.json`
- `docs/data-collection/images/team-guide/self103-collection-complete.png`
- `docs/data-collection/images/team-guide/self103-collection-goal.png`
- `docs/data-collection/images/team-guide/self103-collection-progress.png`
- `docs/data-collection/images/team-guide/self103-collection-start.png`
- `docs/data-collection/images/team-guide/self103-consent.png`
- `docs/data-collection/images/team-guide/self103-extension-login.png`
- `docs/data-collection/images/team-guide/self103-local-login.png`
- `docs/data-collection/images/team-guide/self103-tls-blocked.png`
- `docs/data-collection/images/team-guide/self103-withdrawal.png`
- `docs/data-collection/individual-local-setup.md`
- `docs/data-collection/local-policy.draft.json`
- `docs/data-collection/local-self-setup-validation.md`
- `docs/data-collection/merge-guide.md`
- `docs/data-collection/operator-guide.md`
- `docs/data-collection/participant-guide.md`
- `docs/data-collection/readiness-checklist.md`
- `fe/participant/index.tsx`
- `fe/src/v2/AuthConsentPanel.tsx`
- `fe/src/v2/access.ts`
- `fe/src/v2/browser.ts`
- `fe/src/v2/local-status.test.ts`
- `fe/src/v2/local-status.ts`
- `tools/individual-local/dataset.py`
- `tools/individual-local/local.py`
- `tools/individual-local/run-self-setup-validation.py`
- `tools/individual-local/run-synthetic-e2e.py`
- `tools/individual-local/test_dataset.py`
- `tools/individual-local/test_local.py`
