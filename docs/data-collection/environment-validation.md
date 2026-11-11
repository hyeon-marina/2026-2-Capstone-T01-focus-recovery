> 최신 Issue #99의 일반 HTML Adapter·배포·모델 준비·검증 결과는 [실수집 통합 검증](real-collection-validation.md)을 따릅니다. 아래는 #97 당시 증거이며 실제 수집 승인으로 확대하지 않습니다.

# Issue #97 실행·검증 보고

2026-11-11 KST. **실제 사용자 수집 BLOCKED**. 실행 가능한 관리 API/CLI·참여 준비/합성 파일럿 패키지·격리 DB/서버 도구를 구현했다. 승인·보존·기관·운영 서버·실모델·일반 사이트 실행 경로까지 모두 준비되어 추가 개발 없이 실제 수집할 수 있는 상태라고 주장하지 않는다.

## 1. 작업 전 Git 상태와 기준

시작은 detached HEAD `6e15dd3fa1789e96c42bc4f33250c4221d6d2616`, tracked 수정0/미추적0이었다. 개인 Fork origin=`https://github.com/hyeon-marina/2026-2-Capstone-T01-focus-recovery.git`, 공식 upstream=`https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery.git`였다. 원격 `ls-remote`와 fetch로 공식 최신 main **`251344d6287cba569436ee9f8ea7493a72df7ec7`**을 확인하고 해당 main에서 `feat/97/v2-data-collection-environment`를 만들었다. 기존 다른 브랜치·worktree·데이터를 삭제하지 않았다. main 직접 Commit/Push·hard reset·clean·force Push·자동 Merge는 하지 않는다.

저장소/적용 경로의 AGENTS.md는 없고 `/Users/hyeon/.codex/AGENTS.md`는 빈 파일이었다. `.github/pull_request_template.md`를 확인했다. Git 공용 메타데이터가 worktree 밖에 있어 브랜치/Commit에는 sandbox 권한이 필요했고, 네트워크/Docker/Chrome/Gradle도 필요한 범위에서 실행 권한을 사용했다.

## 2. Issue·선행 PR 분석

GitHub 연결 도구로 [Issue #97](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/97)의 본문/댓글0건을 직접 읽었다. #85/#87/#89/#91/#93/#95 본문/댓글(각0), 병합된 #86/#88/#90/#92/#94/#96의 본문·병합 SHA·discussion(각0)을 확인했다. 병합/Issue 종료를 정책 승인으로 간주하지 않았다.

요구사항은 (1) 기존 파이프라인 재사용, (2) 설치/실행/등록·발급, (3) 20목표·160배정·품질/진행률, (4) 실제 Chrome/서버/DB 검증, (5) 사용/운영/승인 문서다. 실제 데이터 무단 수집·임의 목표/승인/보존기간·합성 실적 혼입·모델 변경·Wire/기존 Migration 수정은 금지 경계다.

요청된 data-collection-spec/data-analysis-contract, v2-contract-decisions/approval, contracts/v2 README·Schema·Fixture, auth-consent-api, FE/BE/AI명세와 #91/#89/#93/#95 검증 보고를 실제 코드와 대조했다. 확정 목표20개 원문은 찾지 못했다. project-plan의4영역×5개 계획과 Fixture의 합성 목표를 실제 확정 원문으로 대체하지 않았다.

## 3. 기존 구현 재사용

| 영역 | 재사용과 이번 연결 |
| --- | --- |
| FE | V2Collector/Runtime, IndexedDB V2Repository·receipt, POST/PATCH/END·Retraction/Withdrawal Queue, AuthConsentPanel, trusted session Credential, 상태/알림·shown/selection ACK |
| 브라우저 | 기존 synthetic/background의 실제 탭·창·navigation/SPA·document/권한·catalog 검사를 `src/v2/browser.ts`로 이동. 기존 synthetic 진입점은 동일한 adapter를 호출 |
| BE | AuthenticationService/Filter, ConsentService/OwnedSessionService/WithdrawalService, WorkSessionService, PageVisitService, V2StorageGate, CompositionService, 분석 Outbox/Query·판단/이력·Alert, PrivacyRetraction 파이프라인 |
| AI | 실제 FastAPI·공통 계약/구성·분석 서비스·인증, 기존 모델 로딩/캐시 구조와 SQLite RetractionJournal. 테스트만 기존 FakeEmbedding/FakeContext 주입 |
| DB | V1~V14 원문 보존, 신규 additive V15만 추가. 기존 데이터 소유권 backfill이나 기본 관리자/동의 승인 Seed 없음 |

별도 분석/세션 저장 시스템을 만들지 않았다. 신규 표는 관리자 역할·감사·목표/슬롯/배정·기존 세션에 연결되는 시도·고정 코드 실패 telemetry다. 시나리오/출처를 기존 AI Wire에 추가하지 않았다.

## 4. Extension 빌드·설치 구조

| 명령/출력 | 목적 | Gate/권한 |
| --- | --- | --- |
| 기존 `build` → dist | v1 유지 | 기존 빌드/코드 보존 |
| 기존 `build:synthetic` → dist-synthetic | 기존 v2 harness 회귀 | 고정loopback/DOM/catalog |
| `build:participant` → dist-participant | 설치 가능한 참여 준비 화면 | 명시적HTTPS API, storage/alarms, 일반 Content Script 없음, 수집 강제false |
| `build:pilot` → dist-pilot | 배정/등록/품질을 연결한 합성 파일럿 | 명시적loopback API, 고정 catalog만 수집 |
| `package:collection -- participant|pilot` | ZIP 배포 | build-info·Commit·dirty·mode·파일 checksum, HEAD 변경 시 재빌드 요구 |

실제 화면은 `participant/index.html`이다. 인증/동의 상태, 배정 목표/시나리오, 시작/종료, 서버 수신 Visit/미완료 Queue, 재전송/복구, 본인 서버 품질·전체 철회가 연결된다. 잠긴 패키지는 인증·배정 준비용이고 실제 사이트 수집용 배포가 아니다. 준비 API origin은 관리자 입력을 요구하며 운영 주소를 임의 생성하지 않는다. 빌드/Chrome 잠금 검증의127.0.0.1:9443은 준비 profile이 정의한 로컬 TLS 포트일 뿐 운영 서버 접속 성공 증거가 아니다.

실제 macOS Chrome에서 두 패키지를 MV3로 로드했다. 잠긴 패키지는 최소 권한/Content Script 없음·강제 시작 메시지 거절·수집0을 확인했다. UI 캡처는 `images/`에 있으며 합성 테스트 화면만 포함한다. 진행 화면은 실제 UI에서10 Visit/8 Window 품질 통과를 확인한 캡처다. 서버 프로세스 재시작·Credential 재발급/보존 프로필 복구 증거는 별도 실행 로그에도 있다.

## 5. Backend·DB·AI 실행 환경

기존 Dockerfiles/Compose를 분석하고 `compose.collection.yml`에서 독립 project/볼륨·loopback 노출·기본 v2 차단을 준비했다. 전체 Compose 빌드/실모델 배포는 NOT_TESTED다. Docker NAT의 HTTP를 loopback 인증으로 간주하지 않으며 인증 예외를 넓히지 않았다.

`start-synthetic-db.py`가 새 컨테이너/DB/무작위 Secret 파일을 만들고, `runCollectionPilot`은 test classpath의 실제 Spring 서버를127.0.0.1:8097에 실행한다. 실제 제품 JAR에는 이 test 서버/합성 삭제 정책/Mock 모델/고정 테스트 Credential을 포함하지 않는다. `collection-preparation`은 명시적 DB·PKCS12/TLS·Secret 설정을 요구하고 v2 Gate는 false다. 운영 DB·실사용자 계정·원문에는 접근하지 않았다.

AI fixture는 실제 FastAPI·구성/Schema/분석 처리·인증·Journal 경로이며 모델 의존성만 Mock이다. BE–AI 서비스 Token은 사용자 Token과 별개다. 일반 제품 AI 로딩/가중치/학습 산출물은 변경하지 않았다. offline `smoke_v2.py`는 의존성/가중치 부재로 SKIPPED였다.

사용한 합성 컨테이너는 focus97-mysql-synthetic → focus97-mysql-final → 수동 실행 검증용 focus97-mysql-pilot이다. 이전 두 컨테이너는 데이터/볼륨을 보존한 채 중지했다. 같은3397 포트를 동시에 사용하지 않았다. V15 개발 중 이전 checksum의 DB를 repair/삭제하지 않고 최종 빈 DB에서 검증했다. 실제 MySQL 버전은8.4.9다.

## 6. 참여자 등록·Credential 경계

기본 관리자/Secret 없이 `CollectionOperatorBootstrap`의 OS/DB 신뢰 경계 → DB role → 기존 서버 Bearer 검증으로 이어진다. bootstrap은 non-web·POSIX mode600·새 파일·DB 잠금·기존 관리자 존재 거절을 검사한다. 실제 위임을 서버가 자동 증명하는 것은 아니므로 실운영 authority/등록 담당자는 BLOCKED다.

역할이 있는 현재 관리자는 가명 연결표 참조 해시로 등록하고 고유 participantId를 발급한다. 서버 SecureRandom Token은 해시·FK·만료/폐기로 검증하고 평문은 일회 발급 응답/보호 파일에만 남긴다. 재발급은 이전 Credential을 원자 폐기하고 감사 이벤트를 기록한다. 관리자 본인 갱신, 만료·폐기·철회/비활성 발급 거절, 일반 참여자의관리 API403을 검증했다. Token/실명은 모델 입력이나 공개 문서·스크린샷·Commit에 없다.

운영 콘솔은 `tools/collection/manage.py`다. HTTPS·no redirect·외부 Credential 파일·일회 보호 출력·고정 명령을 사용한다. 실제 합성 MySQL에 제품 JAR bootstrap을 실행하고 CLI init을 통해 배정표를 만들었다. 실제 사용자3명을 등록하거나 Credential을 발급하지 않았다.

## 7. 20목표·160배정

공개 [plan.draft.json](plan.draft.json)은 GOAL-001~020/description=null/status=DRAFT다. 임의20개 원문은 확정하지 않았다. 실행 생성기와 파일이 같음을 테스트한다. 실제 확정에는 원문·CONFIRMED·근거와 현재 revision이 필요하다.

| 슬롯 | 세션 | 목표 유지 | 합리적인 우회 | 점진적인 이탈 | 명확한 이탈 |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 54 | 14 | 13 | 13 | 14 |
| B | 53 | 13 | 13 | 14 | 13 |
| C | 53 | 13 | 14 | 13 | 13 |
| 합계 | 160 | 40 | 40 | 40 | 40 |

각 목표에 네유형×2회=8세션이다. 전체수/유일한ID·조합·슬롯/goal·분포를 검사하고 stale revision·실적 있는 배정/목표/슬롯참여자 변경을 거절한다. 다른 소유자의 세션을 붙이는 API는 없으며 DB복합FK도 막는다. 재수집은 기존 시도·실패사유를 보존하고 신규 시도를 만든다. 시나리오는 예측 입력/사람 정답이 아니다.

## 8. 진행률·품질

계획, 실제 생성, 종료, 구조/전송 품질 통과, 격리/철회, 실패/재수집, 합성을 구분한다. 관리자 역할/조회 감사, 참여자의 본인 범위, 목표/시나리오별 집계가 동작한다. 같은 PLAN의 재시도로 실적을 중복 계산하지 않는다. 요약의 유효 Visit/Window는 품질을 통과한 최신 실제 시도만 합산하고 모든 시도는 별도 진단에 보존한다.

유효 Visit는 실제 활성5000ms 이상·추출SUCCESS·콘텐츠 존재·tombstone 없음을 검사한다. 고유ID/sequence, 순서 공백 허용, size3/stride1, 정확한 n−2 Window, 소속/membership/position/start/end, AI 완료·최신 상태 이력, dirty/error 없음, END, 전송 개수/lastSequence·CLEAR가 완료 조건이다. 종료만으로 완료하지 않는다. 개인정보 격리가 최우선이고 SYNTHETIC은 실제160세션 실적에서 항상 제외한다.

실패 기록은 고정 Enum과 UUID/시각만 받는다. 미확인 후보는 보고 ACK 전에 정리하지 않는다. 진행률은 고정 개수의 메타데이터 쿼리로 조회하며 본문/검색어/URL/rationale을 반환하지 않는다. 사람 라벨·모델 정확도와 구조적 수집 품질은 별개다.

## 9. 실제 Chrome–Spring–MySQL–FastAPI

`CollectionLiveHttpTest`는 실제 Spring 랜덤 포트와 새 MySQL을 사용한다. 관리자 Fixture만 준비하고 Node/Playwright가 제품 API로 참여자 등록·발급/배정을 수행한다. Chrome은 새 임시 프로필의 MV3/IndexedDB를 사용하며 응답 Mock이나 가상 체류시간 없이 catalog에서10방문을 실측했다. 첫5초 POST, 이탈 행동 PATCH, Worker 재시작, 전체 브라우저 재시작 후 재인증, 종료 drain/ACK, 8 Window/AI 처리/BE 상태/서버 품질·전송 확인, 타인404, 전체 철회·격리를 assert했다.

카탈로그 밖 loopback 경로에서6초 대기해도0 Visit임을 확인했다. 실사용자 프로필은 사용하지 않았다. 모델은 FakeEmbedding/FakeContext다. 실제300초 대기는 실행하지 않았으며5분 경계는 기존 Runtime 가상 시계/BE 규칙 테스트에 해당한다.

독립 운영 절차도 실행했다. 제품 JAR의 non-web bootstrap → 실제 관리 CLI → test-only 파일럿 서버 → 같은 Chrome 시나리오를 연결했다. 이 실행에서 END 뒤 마지막 Window가 남는 기존 BE 결함을 발견했다. CompositionService와 V2AnalysisOutboxService가 ENDED 세션의 저장된 작업까지 거절하던 ACTIVE 검사를 제거했다. 기존 개인정보/동의/소유권·revision·claim/lease 검사는 유지하고 신규 Visit와 새 알림은 계속 차단한다.

종료 전 저장된10 Visit의 backlog를 같은 MySQL에서 실제 Spring 프로세스 종료·재시작 후 처리하여8 Window 완료를 확인했다. 같은 합성 참여자의 Credential을 관리 CLI로 재발급하고 보존한 Chrome 테스트 프로필에서 재인증·품질 통과·전체 철회를 마쳤다. 종료 전/구성 HTTP 중/분석 HTTP 중의 세 가지 경합 회귀 테스트도 추가했다.

추가 합성 실행에서는 FastAPI test fixture의 명시적 `--drift-pages` 라벨을 사용하여 실제 BE의 DRIFT 알림 생성 → Chrome 렌더 → 표시 ACK → 선택 ACK를 검증했다. Worker 중단 전에 선택 ACK의 영속화를 기다리고 DB notification/notification_response를 확인했다. 참여자 화면의 미전송 알림 영수증도 표시하며 영수증이 미확인인 동안 완료 보고를 보류한다. 이는 실제 모델 예측의 품질 검증이 아니다.

Mock 모델 경로의 BE 분석 작업(requested_at→completed_at, 큐 대기 포함)은8개에서 평균1029.6ms, 최대1060.0ms였다. 이는 한 합성 실행의 지연이며 실제 모델 추론 시간/처리량/p95가 아니다. 실모델 성능은 NOT_TESTED다.

기존 v2 Chrome Mock HTTP 회귀는 SPA 지연·동일 URL 본문 변경·reload·Worker/브라우저·회수 ACK 유실·알림 렌더/ACK/선택을 확인했다. 기존 v1 Chrome 회귀의 Google/Naver도 합성 검색 HTML이다. 실제 검색 서비스 수집은 아니다. headless 네이티브 다중 창/최소화1항목은 Skip이며 Windows/실사용자 프로필/OS sleep은 NOT_TESTED다.

## 10. DB·Migration·복구·개인정보

V1~V14 SQL과 공통 Schema/Fixture 원문은 공식 main과 동일하다. 신규 V15는 관리자 역할·감사·배정·시도·실패와 세션/소유자 복합 FK를 추가한다. H2/실제 MySQL에서 빈 DB15개 Migration, V14 기존 모든 행 보존, 새 권한 Seed 없음, FK, 재migrate0/validate를 검증했다. 기존 V14MigrationTest는 target14로 고정해 당시 검증을 보존했다.

같은 H2파일/실제 MySQL을 새 Spring context로 열어 등록·Credential·배정 revision·감사 복구를 확인했다. 독립 Spring 프로세스 재시작도 실제 MySQL에서 검증했다. 기존 Queue discovery·lease/token/revision 검사를 재사용한다. MySQL daemon crash/OS kill·디스크full·운영 백업 복원 훈련은 NOT_TESTED다.

전체 철회는 ACTIVE/ENDED 세션과 파생 자료를 격리하고 분석/알림/신규 수집을 차단한다. 합성 test 삭제 정책에서만 Payload 정리·AI Journal 전파를 검증한다. 제품 정책은 기본 거절이다. FE/v1 Payload·외부 Export/학습/로그/백업·전 Worker/GPU/모델 영향의 증거가 없어 PURGED를 제공하지 않는다. 보존기간·삭제 완료 기한을 임의로 정하지 않았다.

## 11. DB↔후속 JSONL 대응

| 후속 파일 | 현재 저장 근거/후속 조건 |
| --- | --- |
| sessions.jsonl | work_session + collection_attempt/assignment/goal/slot + consent_record. source·원래시도·배정revision추적 필요 |
| visits.jsonl | page_visit/누적behavior + visit_tombstone. 현재BE판단용실측행동을보존 |
| windows.jsonl | analysis_window/window_visit + compose_request receipt. size3/ordered참조 |
| window_states.jsonl | append-only window_state_history·behavior snapshot·stateVersion |
| ai_predictions.jsonl | analysis_result/apiContractVersion2/page_results/model_versions. 사람정답과분리 |
| human_labels.jsonl | 이번미구현. 독립3인·합의·blind/UNJUDGEABLE/목표분할후속 |
| collection_failures.jsonl | collection_failure + compose/outbox/analysis/decision 오류의관계정리후후속Export |
| manifest.json | 이번미구현. checksum/rowCount/goal split·sourceCommit/consent/source/privacy revision검증필요 |

전체Export·라벨링UI·모델재학습으로범위를늘리지않았다. 실제수집 source의활성화도없다. 실제/GPT자료혼합이나승인없는원문Export를하지않았다.

## 12. 실행 결과와 명령

실행환경: macOS27.2 arm64, Chrome for Testing151.0.7922.34, Node25.9.0, Java21toolchain, Gradle9.7.1, Python3.11테스트venv, MySQL8.4.9. 각증거는합성자료다.

| 검증 | 결과 | 범위/제한 |
| --- | --- | --- |
| FE전체 | 903 passed / 2 skipped | fake-IDB/Mock transport포함, 외부HTTP선택2개Skip |
| FEtypecheck·v1/synthetic/pilot/participant빌드·ZIP | PASS | 실제운영서버접속성검증과별개 |
| BE전체 | 957건,실행837/Skip120,실패0/오류0 | 새#97실제MySQL/ChromeE2E포함. 선행선택MySQL/HTTP테스트환경조건Skip |
| 신규최종로직집중회귀 | PASS | UTC/JDBC시각·등록잠금·배정/품질·발급/권한 |
| 실제잠긴참여패키지Chrome | PASS | 최소권한/Content Script없음·강제시작차단·수집0. TLS서버접속은NOT_TESTED |
| 실제pilotChrome→Spring/MySQL/FastAPI | PASS | 10 Visit/8 Window·등록/발급·재시작/격리·BE DRIFT 알림 표시/선택 ACK. 모델 Mock |
| 기존v2 Chrome | PASS | Mock HTTP·실제알림UI/ACK·회수replay·SPA/IDB |
| 기존v1 Chrome | PASS / 네이티브창1Skip | 합성HTML/API, 실제검색서비스아님 |
| AI전체 | 241 passed / 경고1 | Mock모델, Starlettehttpx deprecation |
| 실모델Smoke | SKIPPED | modelLoaded=false/inferenceExecuted=false, 의존성/로컬Qwen없음 |
| 공통계약 | PASS | Schema30정의/80사례/reference139/규칙216/κ4·Markdown링크 |
| 관리CLI보호파일self-check | PASS | 신규mode600/덮어쓰기거절 |
| 제품JAR비웹bootstrap→실제MySQL/CLIinit | PASS | 새합성DB·무작위Token·일회보호파일. 실제기관위임검증아님 |

전체 BE의120 Skip은#85/#89/#93/#95가각각고정된다른DB/포트환경변수를요구하는선택테스트다. #97의3397DB를타IssueDB인것처럼주입하지않았다. 실제로 수행하지 않은 선행 MySQL/HTTP 테스트를 PASS로 부르지 않는다. 집중 테스트는 Gradle XML을 덮어쓰므로 전체 실행 로그·집계·`/private/tmp/focus97-full-junit` 보존본도 함께 확인한다.

주요명령(상세입력/순서는운영가이드):

```sh
npm ci --prefix fe
npm --prefix fe test -- --reporter=dot
npm --prefix fe run typecheck
npm --prefix fe run build
npm --prefix fe run build:synthetic
VITE_API_BASE_URL=http://127.0.0.1:8097 npm --prefix fe run build:pilot
npm --prefix fe run package:collection -- pilot
# participant는검증된HTTPS origin을명시해야함
VITE_API_BASE_URL="$COLLECTION_VERIFIED_API_ORIGIN" npm --prefix fe run build:participant
npm --prefix fe run package:collection -- participant
python3 tools/collection/run-validation.py --db-file <신규합성DB보호파일> --chrome <Chrome실행파일> --all
# fe디렉터리, CHROMIUM_PATH를지정하고실행
npm run test:participant:browser
npm run test:v2:browser
npm run test:browser
# 모델없는테스트venv
python -m pytest ai/tests -q --tb=short
python docs/contracts/v2/validate.py
python ai/smoke_v2.py
python3 -m unittest discover -s tools/collection -p 'test_*.py'
git diff --check
```

증거위치: `/private/tmp/focus97-be-final.log`, `focus97-be-counts.json`, `focus97-last-logic-tests.log`, `focus97-fe-final.log`, `focus97-ai-tests.log`, `focus97-model-smoke.json`, `focus97-chrome-http.log`, `focus97-chrome-evidence/`, `focus97-synthetic-browser.log`, `focus97-v1-browser.log`, `focus97-locked-browser.log`, `focus97-bootstrap-mysql.log`, `focus97-manual-chrome.log`, `focus97-recovery-chrome.log`, `focus97-alert-e2e.log`。Secret 파일은 별도로 보호하며 본문/Token을 검증 보고에 복사하지 않는다.

## 13. 실패·수정과 남은 조건

첫 실제 E2E에서 void 응답200을 FE가 JSON으로 읽어 전송 보고를 확인하지 못했다. void ACK를204로 수정했다. MySQL DATETIME의 getObject가 LocalDateTime을 반환해 실패 replay 비교가 깨졌으므로 ResultSet.getTimestamp로 정규화했다. 수집 시각은 UTC로 내보낸다. H2만 통과한 것을 MySQL 통과로 대체하지 않았다.

독립 파일럿에서 END 이후 마지막 compose/analysis backlog가 차단되는 기존 BE 결함을 발견하고 저장된 작업의 후처리를 허용하도록 수정했다. 신규 Visit·알림 차단과 개인정보·동의·소유권·revision/token/lease 검사는 유지했다. 실제 서버 프로세스 재시작 후 같은 MySQL의10 Visit→8 Window 완료·재발급/Chrome 복구·철회까지 확인했다. 새 DB 준비 직후 bootstrap 첫 실행은 MySQL 초기화 중 연결 종료로 실패했고 ready 상태 후 재실행했다. 이 결과를 운영 장애 복구 훈련 전체의 통과로 확대하지 않는다.

미완료 항목은 실제20목표 원문, 등록 담당자/위임·실제3명 등록/안전 전달·동의, 기관/심의·보존/삭제/사본 관리, 공용 운영 주소/TLS/Secret/가용성, 일반 사이트용 v2 adapter/허용 권한 연결과 검증, 실제 Qwen 모델/성능, Windows/네이티브 창·OS/DB crash·복원 훈련이다. 승인 후 일반 페이지 실행 경계의 별도 변경/검증이 필요하므로 “추가 개발 없이 실제 사용자 수집 가능” 상태는 아니다. [Readiness](readiness-checklist.md)의 BLOCKED/NOT_TESTED를 해결한 후 운영 활성화 변경을 별도로 검토해야 한다.

참여자 안내서·관리자 도구·합성 기술 환경 준비와 실제 사용자 수집 허용은 별개다. 실제 참여자 수집 개시는 불가능하다. 한국어 Commit으로 개인 Fork 브랜치에 Push하고 공식 main 대상 PR을 생성한다. 확정 SHA/URL은 PR head와 최종 채팅을 기준으로 한다.

## 14. 실제 변경 파일

이번 작업의 tracked 변경/신규 파일 전체다. ZIP·Credential·DB/Journal·테스트 프로필은 Git에 포함하지 않는다.

- `.gitignore`
- `README.md`
- `be/build.gradle`
- `be/src/main/java/com/focusrecovery/domain/analysis/service/V2AnalysisOutboxService.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionAdministration.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionController.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionOperatorBootstrap.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionPlanService.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionProgressService.java`
- `be/src/main/java/com/focusrecovery/domain/composition/service/CompositionService.java`
- `be/src/main/resources/application-collection-preparation.properties`
- `be/src/main/resources/application.properties`
- `be/src/main/resources/db/migration/V15__collection_operations.sql`
- `be/src/test/java/com/focusrecovery/domain/collection/CollectionBootstrapTest.java`
- `be/src/test/java/com/focusrecovery/domain/collection/CollectionLiveHttpTest.java`
- `be/src/test/java/com/focusrecovery/domain/collection/CollectionMySqlTest.java`
- `be/src/test/java/com/focusrecovery/domain/collection/CollectionOperationsTest.java`
- `be/src/test/java/com/focusrecovery/domain/collection/CollectionPilotServer.java`
- `be/src/test/java/com/focusrecovery/domain/collection/CollectionRestartTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2IntegrationContract.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V14MigrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V15MigrationTest.java`
- `be/src/test/python/v2_http_fixture.py`
- `compose.collection.yml`
- `docs/ai-spec.md`
- `docs/be-spec.md`
- `docs/contracts/auth-consent-api.md`
- `docs/contracts/collection-operations-api.md`
- `docs/data-analysis-contract.md`
- `docs/data-collection-spec.md`
- `docs/data-collection/environment-validation.md`
- `docs/data-collection/images/participant-locked.png`
- `docs/data-collection/images/participant-pilot-login.png`
- `docs/data-collection/images/participant-pilot-progress.png`
- `docs/data-collection/images/participant-pilot-withdrawal.png`
- `docs/data-collection/operator-guide.md`
- `docs/data-collection/participant-guide.md`
- `docs/data-collection/plan.draft.json`
- `docs/data-collection/readiness-checklist.md`
- `docs/fe-spec.md`
- `fe/.gitignore`
- `fe/package.json`
- `fe/participant/background.ts`
- `fe/participant/index.html`
- `fe/participant/index.tsx`
- `fe/participant/style.css`
- `fe/scripts/collection-browser-test.mjs`
- `fe/scripts/collection-recovery-browser-test.mjs`
- `fe/scripts/package-collection.mjs`
- `fe/scripts/participant-locked-browser-test.mjs`
- `fe/src/v2/AuthConsentPanel.tsx`
- `fe/src/v2/browser.ts`
- `fe/src/v2/runtime.ts`
- `fe/synthetic/background.ts`
- `fe/tests/collection-gate.test.ts`
- `fe/tsconfig.json`
- `fe/vite.participant.config.ts`
- `tools/collection/bootstrap-synthetic-operator.py`
- `tools/collection/catalog-server.py`
- `tools/collection/manage.py`
- `tools/collection/run-validation.py`
- `tools/collection/start-synthetic-ai.py`
- `tools/collection/start-synthetic-db.py`
- `tools/collection/test_manage.py`
