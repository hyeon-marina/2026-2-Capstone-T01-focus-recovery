# Issue #99 실수집 통합 구축·검증 보고

2026-11-11 KST. **실제 참여자 데이터 수집 개시: BLOCKED.** A=구현, B=실행 증거, C=외부 조건을 구분합니다. 일반 HTML Adapter를 실제 Chrome·Spring·MySQL·FastAPI로 검증했으나 모델 의존성은 Mock입니다. 실제 Qwen 추론·공용 서버·실제 참여자 파일럿을 완료했다고 주장하지 않습니다. P1~P6 PROPOSED/P2·P6 BLOCKED를 바꾸지 않았습니다.

## 1. 작업 전 Git·공식 기준

작업 전 수정·미추적 파일0개, detached HEAD `6e15dd3fa1789e96c42bc4f33250c4221d6d2616`이었습니다. origin은 hyeon-marina fork, upstream은 SKHU-AI-Projects-Archive 공식 저장소입니다. 시작 직전 fetch/ls-remote로 공식 main `0b0cd7c5c15dbf2e2111789954add59ac588f710`을 재확인하고 그 커밋에서 `feat/99/v2-real-data-collection`을 생성했습니다. 기존 변경을 버리거나 다른 worktree/컨테이너/볼륨을 지우지 않았습니다. main 직접 commit/push·force push·자동 merge를 하지 않습니다.

Issue #99 원문·댓글0개, 선행 Issue #79/#81/#83/#85/#87/#89/#91/#93/#95/#97, merged PR #86/#88/#90/#92/#94/#96/#98, PR 템플릿을 GitHub 연결로 확인했습니다. 작업 경로/상위 경로에서 적용할 AGENTS.md는 발견하지 못했습니다. 제공된 명세·계약·정책/승인 문서·Schema/Fixture·기존 검증 보고와 FE/BE/AI/DB 구현을 대조했습니다.

## 2. 요구사항과 기존 구현 재사용 — A

| 범위 | 변경/재사용 |
| --- | --- |
| 실제 Extension | 신규 `build:real`, 기존 participant UI·v2 Browser/Runtime/Collector/IDB·POST/PATCH/END/ACK/회수/알림 재사용. 일반 HTML/Google·Naver 추출·URL 검사는 기존 v1 추출 함수를 공용 사용 |
| 권한·서버 Gate | exact real-collection + storage/dispatch 설정, 승인 파일·계약/기관/보존/모델/privacy/시작 근거·기간·sites, SHA-256에 대한 독립 revocable DBrelease, FE build/digest 및 세션 scope. 현재 승인 기록0건 |
| 서버 저장/AI/상태 | 기존 인증·동의/소유권·CompositionService·Outbox·WindowDecision·CollectionPlan/Progress·Retraction/Withdrawal을 연결. 실수집 배포의 generic/v1 생성 우회는 차단 |
| DB | V16 collection_release/session_collection_scope 추가. V1~V15 원문 byte 동일·기존 rows 유지. 운영 DB 미접근 |
| AI | 원래 Qwen Embedding0.6B/Context4B 유지. offline 모델 수집 엔트리·단일 Worker/영속 Journal·서비스 인증, immutable revision 다운로드/hash 준비 도구, strict smoke exit2 및 처리량 보고 추가 |
| 공용 환경 | 전용 새 Compose·private DB/AI·TLS proxy→TLS BE 검증·파일 Secret 최소 mount·non-root BE/AI·재시작/로그 회전. 실제 공용 호스트/주소/TLS는 없음 |
| 목표/배정 | 4영역×5개 구체 후보,20개 DRAFT description 및 목표별4시나리오 수행법·종료 기준. 기존160 PLAN·목표당8·각시나리오2·A54/B53/C53 유지. 후보 병합 도구는 승인하지 않음 |
| 관리/품질 | 기존 CLI/API/참여자 진행 UI 재사용. 최소10·ordered Window·AI/최신 상태/dirty·END·전달 보고·privacy 기준. source 실제/합성 분리 |
| 운영 도구 | 신규 Secret/TLS 준비·배포 preflight·read-only SQL·백업·최신 철회 원장·offline 복원 격리 SQL·새 합성 DB 복사 복원 검증 |

5,000ms/4,000ms/최초300,000ms·size3/stride1·AI 페이지 관련성/BE 최종 상태 경계는 유지했습니다. 관측하지 않은 체류시간을 생성하지 않았습니다. 실제 수집을 CSV 직접 제출 방식으로 바꾸지 않았으며 식별자/FK와 JSONL 후속 연결을 유지합니다. 전체 Export/라벨 UI/재학습은 구현하지 않았습니다.

## 3. 실제 실행 증거 — B

실행 호스트는 macOS27.2 arm64, Node25.9.0, JDK21.0.10, 새 Docker MySQL8.4.9, Chrome for Testing151.0.7922.34입니다. Windows/개인 Chrome 프로필/실제 사람의 원문은 사용하지 않았습니다. DB는 새 `focus97-issue99-synthetic`, loopback3397의 `focus97_synthetic` 및 새 migration/restore schema만 사용했습니다. 기존 운영 DB/볼륨에 연결하지 않았습니다.

- **일반 HTML E2E PASS**: 임시 실제 MV3 Extension·SYNTHETIC 배포 파일/DBrelease, 실제 Credential 발급·Chrome 로그인/명시 합성 동의·확정된 합성 목표 배정, 허용 경로 밖 차단, SPA pushState, 초기 추출 실패의 failure 기록(가짜 Visit 없음), 실제5초 이상 관측10 Visit, IndexedDB, 실제 POST→MySQL, size3/stride1 Window8·FastAPI 분석/BE 상태·품질 집계, 종료 ACK/Queue drain/전달 보고, Worker 중지/전체 브라우저 재시작·재인증, 타인404/관리403, 전체 철회/격리. 실수집 actualSessions/completed는0입니다.
- **알림 E2E PASS**: 별도 `FE97_EXPECT_DRIFT_ALERT=1` 실행에서 Mock의 명시 UNRELATED 출력으로 실제 BE DRIFT, 참여자 화면 표시·선택 및 ACK 영속을 확인했습니다. 사람 정답/실모델 결과가 아닙니다.
- **기존 catalog E2E PASS**: 기존 participant/pilot·v1/v2 회귀와 닫힌 합성 catalog의10 Visit/8 Window·재시작·철회 경로를 유지했습니다.
- **빈 사이트 실수집 빌드 설치 PASS**: DRAFT·사이트0·로컬 HTTPS 준비 origin 패키지를 실제 Chrome에 로드, 일반 사이트 권한0·content_scripts 없음·시작 disabled·collectionAllowed=false를 확인했습니다. 승인된 실제 팀 서버 패키지가 아닙니다.
- **DB PASS**: 전용 합성 MySQL daemon 재시작 후 철회/격리/Tombstone 개수와 V16 유지 확인. V16 신규 Migration/재실행0/validate·이전행 보존 H2 및 실제 MySQL, collection 운영·소유권·품질 실제 MySQL 테스트. V1~V15 원문 동일 비교 PASS.
- **복원 PASS(합성 복사본)**: 신규 schema에 dump 복원 후 최신 원장 기반 생성 SQL 적용. 활성 release0, 격리·Tombstone 보존. 원본 DB/행 삭제 없이 복사본만 수정했습니다. 전체 payload/외부 사본 삭제 증거는 아닙니다.
- **Secret/내부 TLS PASS**: 새 mode700 디렉터리/mode600 파일·재생성 거절, OpenSSL 내부 CA/`be` SAN certificate/PKCS12 생성 및 verify. 실제 공용 도메인 인증서·proxy 운영 부팅과 구분합니다.
- **Compose parse PASS / 배포 preflight 차단 PASS**: `config --quiet` 문법 검증. 미제공 설정에서 preflight는 BLOCKED exit2. 전체 이미지 build/up·공용 HTTPS는 NOT_TESTED입니다.

실제 화면: [합성10 Visit/8 Window](evidence/issue99-ten-visits.png), [전체 철회](evidence/issue99-withdrawal.png). 정책은 SYNTHETIC이고 Credential 입력은 비어 있습니다. 실행 중 발견한 정책 JSON 키 순서 비교 오류, SPA MessageSender 초기 URL과 현재 frame URL 혼동을 수정한 뒤 같은 E2E를 재실행했습니다. 새 정책 테스트의 미설정 DB mock은0으로 명시하여 수정했습니다. 초기 추출 실패를 Visit 없이 failure에 기록하고, 수집 정책 조회 실패 시에도 인증된 철회 UI를 유지합니다. 실제 Chrome에서 정책 조회409를 주입한 뒤 전체 철회가 성공하는 경로를 별도 실행해 PASS를 확인했습니다. 기존 v1 Chrome 저장 실패 테스트는 동시 관측이 주입 abort를 먼저 소비할 수 있어, 단일 status의 ok 값 대신 실제 failed 저장 상태를 기다려 동일한 fail-closed/복구 조건을 검증하도록 수정하고 통과했습니다. 실패 시도를 성공처럼 숨기지 않았습니다.

## 4. 실제 모델 결과와 외부 조건 — C

`ai/smoke_v2.py --require-models` 실행 결과: **SKIPPED/exit2**, missing torch/transformers/sentence_transformers 및 로컬 qwen3-embedding/qwen3-4b, modelLoaded=false, inferenceExecuted=false. 실제 처리량/지연/정확도/BE–AI 모델 HTTP·모델 재로딩은 **NOT_TESTED**입니다. 임의 모델 교체·가중치 변경·재학습은 없습니다. 모델 revision/파일 준비·offline smoke·배포 절차는 [실모델 준비](model-preparation.md)에 있습니다.

| 실제 수집 개시 조건 | 상태/정확한 남은 조치 |
| --- | --- |
| 신뢰된 실제 운영자·참여자3명 | BLOCKED. 실제 위임 확인 후 기존 non-web bootstrap/enroll/issue 도구, 별도 보호 연결표·Credential 안전 전달/인수 |
| 승인된 실제 동의·20목표 확정 | BLOCKED. 정책 책임자가 목적/항목/활용/보존/철회 검토, APPROVED 정책 등록, 본인의 명시 동의, 후보20개 실제 검토·evidenceRef/CONFIRMED |
| 공용 서버·DNS·TLS·Secret | BLOCKED. 실제 호스트/도메인/방화벽/공용 인증서·갱신, 새 전용 Compose/Secret·내부 TLS, HTTPS/소유권/health·중단 훈련 |
| 실제 모델 | BLOCKED. 검토된 원래 Qwen revision/의존성·가중치 준비, strict smoke/재로딩/처리량·통제 HTML 전체 HTTP 검증 |
| 허용 사이트·계약·기관/심의 | BLOCKED. 사이트별 공개 DOM·검색/SPA·민감정보 검토, P1~P6 실제 승인, 학교/연구심의 적용 판단 근거, 정책 artifact의 실제 참조 |
| 개인정보 전체 회수 | BLOCKED. FE current/archive·AI 전 Worker/GPU/모델 영향·Export/학습/로그/백업/수신자 사본 대장·보존/폐기/복원 근거. 전체 삭제 증거 없이 PURGED 없음 |
| 운영 Gate·최종 수집 승인 | BLOCKED. 실제 근거를 갖춘 artifact+독립 collection_release·현재 승인 동의·확정 배정·빌드/세션scope. 파일/DB 승인 기록을 이번 작업에서 생성하지 않음 |
| 참여자 A/B/C 각1세션 파일럿 | BLOCKED. 위 조건 충족 후 각10 Visit/8 Window·실모델/상태·종료/전송/품질/철회 안전성 확인. 그 뒤 별도 시작 승인으로160세션 개시 |
| 실제 Google/Naver·다중창/최소화/OS sleep·Windows | NOT_TESTED. 기존 검색 fixture/URL/포커스 단위 테스트와 통제 Chrome SPA 증거를 실제 인터넷/네이티브 OS 검증으로 확대하지 않음 |
| 운영 DB 장애/장기부하·공용 배포·실제 backup recovery | NOT_TESTED. 합성 DB/서버 재시작·복사본 복원과 구분 |

기존 Vitest3 개발 의존성의 npm audit 결과3건(moderate1/critical2)이 있습니다. tinypool/Vitest/mocker 관련이며 npm이 제시하는 수정은 Vitest4 major입니다. 제품 React/런타임 의존성을 추가한 작업은 아니며 무단 `audit fix --force`로 회귀 환경을 바꾸지 않았습니다. 신뢰된 테스트 코드만 실행한 현재 결과와 개발 도구 취약점 해소를 구분합니다.

## 5. 재현 명령

```sh
npm ci --prefix fe
npm run typecheck --prefix fe
npm test --prefix fe
npm run build --prefix fe
npm run build:synthetic --prefix fe
# VITE_API_BASE_URL은 모드에 맞는 명시적 HTTPS 또는 loopback API.
npm run build:participant --prefix fe
npm run build:pilot --prefix fe
# COLLECTION_SITE_POLICY_FILE + HTTPS API를 지정한 뒤:
npm run build:real --prefix fe
(cd fe && npm run package:collection -- real)
# CHROMIUM_PATH는 실제 설치된 Chrome for Testing 실행 파일 절대경로.
(cd fe && npm run test:real:locked)
python3 -m unittest discover -s tools/collection -p 'test_*.py' -v
python3 -m compileall -q ai tools/collection
```

AI Mock/공통 계약은 ai/requirements-test.txt를 설치한 Python으로 `python -m pytest ai/tests -q --tb=short`, `python docs/contracts/v2/validate.py`. 실모델은 별도 requirements.txt 환경에서 `python ai/smoke_v2.py --require-models`이며 SKIPPED를 PASS로 세지 않습니다.

아래는 **새 합성 DB 전용** 전체 BE/MySQL/Chrome/FastAPI 실행입니다. 기존 `start-synthetic-db.py`의 focus97 DB 경계와 run-validation을 재사용합니다. 고정 문자열은 테스트 소스의 합성 서비스 Token이며 운영용으로 쓰지 않습니다.

```sh
python3 tools/collection/start-synthetic-db.py \
  --name focus97-issue99-synthetic --output .collection/db99.json
# 별도 터미널, AI test venv Python 사용. 모델은 FakeEmbedding/FakeContext.
AI_V2_PROFILE=synthetic-test AI_V2_ENABLED=1 \
AI_V2_SERVICE_TOKEN=synthetic-internal-service-token-95-0123456789 \
AI_RETRACTION_SECRET=synthetic-service-only-secret-93-0123456789 \
  python be/src/test/python/v2_http_fixture.py --port 8897 --drift-pages \
  --retraction-journal .collection/issue99-journal.sqlite
# JDK21 사용. --all은 두 Chrome 테스트와 V16을 포함하며 환경별 skip을 숨기지 않음.
python3 tools/collection/run-validation.py --db-file .collection/db99.json \
  --chrome "$CHROMIUM_PATH" --all
# 알림까지 별도 확인 시 위 명령에 FE97_EXPECT_DRIFT_ALERT=1 환경변수 추가.
python3 tools/collection/test-synthetic-restore.py --db-file .collection/db99.json
```

## 6. 최종 테스트 집계

최종 실행 결과입니다. 원본 로그는 `/private/tmp/focus99-*`, JUnit은 `be/build/test-results/test`입니다. 원문/Secret은 Git에 포함하지 않습니다.

| 검증 | 결과 |
| --- | --- |
| FE | 908 PASS / 2 환경 skip, typecheck PASS |
| AI | 244 PASS, Starlette/httpx deprecation 경고1 |
| BE | 965건 중 845 PASS / 120 환경 skip / failure0·error0. H2 및 실제 MySQL·실제 Chrome2경로 포함 |
| CLI/준비/복원 단위 | 5 PASS |
| v2 공통 계약 | Schema30/사례80/reference139/규칙216/κ4 PASS |
| 빌드 | v1/synthetic/participant/pilot/real PASS; 실수집 실제 서버 승인 없음 |
| 실제 Chrome 회귀 | v1 PASS(네이티브 HEADED 제외), v2 Mock HTTP PASS(네트워크/ACK/회수·재시작), real HTML2경로 PASS |
| 실제 모델 | SKIPPED/strict exit2; 실제 추론0회 |

환경 skip은 선행 선택형 MySQL/HTTP suite의 전용 환경변수 미설정120건입니다. #99의 실제 MySQL·두 Chrome HTTP E2E·V16은 실행했고, 선행 모든 선택형 HTTP/MySQL suite를 실행했다고 확대하지 않습니다. 상세 suite별 skip은 evidence/issue99-summary.json을 봅니다.

## 7. 필수 인계 문서

[수집 절차](collection-procedure.md), [데이터 흐름/실제 Schema](data-flow-and-storage.md), [검증 API/SQL](data-verification.md), [참여자 안내](participant-guide.md), [관리자 운영/정확한 승인·배포·복원 명령](operator-guide.md), [Readiness](readiness-checklist.md), [원래 모델 준비](model-preparation.md), [목표 후보](goals.candidates.json), [160배정](plan.draft.json).

현재 판정은 **기술 구현과 통제된 일반 HTML E2E를 완료했지만, 실제 환경의 전체 기술 완료/수집 개시는 미완료**입니다. 공개 호스트·실모델·실제 승인/참여자 조치가 준비되면 위 절차로 검증하고 신규 승인 release·일치하는 clean 빌드를 배포해야 합니다. 문서/합성 테스트만으로 Issue의 실제 개시 기준을 충족했다고 표시하지 않습니다.

## 8. 변경 파일 전체

최종 변경 경로 목록입니다. Commit SHA/Push/PR URL은 최종 채팅 보고 및 PR에서 제공합니다. 해당 PR은 자동 병합하지 않습니다.

<!-- CHANGE_FILES -->
```text
ai/collection_main.py
ai/models/offline.py
ai/requirements.txt
ai/smoke_v2.py
ai/tests/test_collection_entrypoint.py
ai/tests/test_deployment.py
ai/v2/deployment.py
ai/v2/service.py
be/src/main/java/com/focusrecovery/domain/collection/CollectionController.java
be/src/main/java/com/focusrecovery/domain/collection/CollectionPlanService.java
be/src/main/java/com/focusrecovery/domain/collection/CollectionProgressService.java
be/src/main/java/com/focusrecovery/domain/collection/CollectionSitePolicy.java
be/src/main/java/com/focusrecovery/domain/consent/ConsentService.java
be/src/main/java/com/focusrecovery/domain/consent/OwnedSessionService.java
be/src/main/java/com/focusrecovery/domain/privacy/service/RetractionDispatcher.java
be/src/main/java/com/focusrecovery/domain/privacy/service/RetractionExecutionPolicy.java
be/src/main/java/com/focusrecovery/domain/session/service/WorkSessionService.java
be/src/main/java/com/focusrecovery/domain/visit/service/PageVisitService.java
be/src/main/java/com/focusrecovery/global/config/V2StorageGate.java
be/src/main/resources/application-real-collection.properties
be/src/main/resources/db/migration/V16__collection_release.sql
be/src/test/java/com/focusrecovery/domain/collection/CollectionLiveHttpTest.java
be/src/test/java/com/focusrecovery/domain/collection/CollectionOperationsTest.java
be/src/test/java/com/focusrecovery/domain/collection/CollectionRealHtmlHttpTest.java
be/src/test/java/com/focusrecovery/domain/collection/CollectionSitePolicyTest.java
be/src/test/java/com/focusrecovery/domain/identity/AuthConsentLiveHttpTest.java
be/src/test/java/com/focusrecovery/domain/identity/AuthConsentTest.java
be/src/test/java/com/focusrecovery/domain/privacy/SyntheticRetractionConfiguration.java
be/src/test/java/com/focusrecovery/domain/storage/V15MigrationTest.java
be/src/test/java/com/focusrecovery/domain/storage/V16MigrationTest.java
be/src/test/java/com/focusrecovery/domain/storage/V2GateAndFingerprintTest.java
deploy/collection/compose.yml
deploy/collection/environment.example
deploy/collection/nginx.conf
deploy/collection/site-policy.draft.json
docs/contracts/auth-consent-api.md
docs/contracts/collection-operations-api.md
docs/data-collection/collection-procedure.md
docs/data-collection/data-flow-and-storage.md
docs/data-collection/data-verification.md
docs/data-collection/environment-validation.md
docs/data-collection/evidence/issue99-summary.json
docs/data-collection/evidence/issue99-ten-visits.png
docs/data-collection/evidence/issue99-withdrawal.png
docs/data-collection/goals.candidates.json
docs/data-collection/model-preparation.md
docs/data-collection/operator-guide.md
docs/data-collection/participant-guide.md
docs/data-collection/plan.draft.json
docs/data-collection/readiness-checklist.md
docs/data-collection/real-collection-validation.md
fe/.gitignore
fe/package.json
fe/participant/background.ts
fe/participant/index.tsx
fe/real/content.ts
fe/real/policy.ts
fe/scripts/browser-test.mjs
fe/scripts/package-collection.mjs
fe/scripts/real-browser-test.mjs
fe/scripts/real-locked-browser-test.mjs
fe/src/api/auth-fetch.ts
fe/src/v2/AuthConsentPanel.tsx
fe/src/v2/browser.ts
fe/src/v2/collector.ts
fe/tests/real-policy.test.ts
fe/tests/v2-collector.test.ts
fe/vite.real.config.ts
fe/vite.real.content.config.ts
tools/collection/check-deployment.py
tools/collection/database-backup.sh
tools/collection/prepare-internal-tls.py
tools/collection/prepare-models.py
tools/collection/prepare-plan.py
tools/collection/prepare-secrets.py
tools/collection/restore-quarantine.py
tools/collection/retraction-ledger.sql
tools/collection/run-validation.py
tools/collection/test-synthetic-restore.py
tools/collection/test_preparation.py
tools/collection/test_restore_quarantine.py
tools/collection/verify.sql
```
