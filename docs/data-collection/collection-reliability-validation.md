# 실제 웹 데이터 수집 안정성 검증

대상: [Issue #119](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/119). 2026-11-13 KST. 운영 적용 전 기술 검증 기록이다. 운영 C의 직접 수집 성공을 의미하지 않는다. Issue는 완료 처리하지 않는다.

## 기준과 보존 범위

- 작업 디렉터리: `/Users/hyeon/.codex/worktrees/60b4/2026-2-Capstone-T01-focus-recovery`. 시작 시 detached `e088f03`, 미커밋·미추적 파일 없음.
- 공식 upstream을 fetch한 최신 main `ff15a90bb9ce389b32a75dd57806ed7e215ddb48`에서 `fix/119/collection-reliability` 생성. fork의 오래된 main을 기준으로 삼지 않았다.
- C 운영 워크트리는 `/Users/hyeon/Project/2026-2-Capstone-T01-focus-recovery`, 브랜치 `ops/c-foreground-rollout-20261113`, 커밋 `432959e810ac6b7af1f928e7d3164e695fd44070`. 읽기 전용 Git 상태 확인 당시 미추적 `team-data-collection-manual.pdf`가 존재했다. 이 파일과 운영 설정을 열어 수정하거나 이동하지 않았다. 다른 기존 작업 브랜치도 변경하지 않았다.
- 정책 `focus-team-raw-v2/6`, SHA `31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982`, RAW_ONLY, Plan revision 1은 그대로 유지한다. Gate, 체류 5초, 복귀 4초, 본문 50 code point, 불변 Visit ID/sequence/멱등 계약을 완화하지 않았다.
- Issue #112, PR #113의 영속 저장·격리 마감·재수집·동의 전환·종료 안정화, PR #118의 전경 보호와 카드 용어 수정을 재사용한다. 기존 보고서의 PASS는 해당 테스트 환경의 증거이며 실제 C 사용자의 성공으로 확대 해석하지 않는다.

## 재현한 원인과 수정

|문제|수정 전 증거|코드 원인과 수정|
|---|---|---|
|일반 입력 포커스가 조기 격리를 유발|실제 `real/content.ts`를 import한 DOM 회귀 FAIL. 기존 테스트 자체도 미입력 검색창 포커스에 `sensitive:true`를 기대하고 있었다.|`isExcludedMetadataDocument()`가 editable 포커스를 제외하고 `real/content.ts`가 모든 제외를 `sensitive:pageContent`로 보냈다. 고위험 마커 검사와 포커스 제외를 분리한다. 입력 포커스는 snapshot 없이 `INPUT_FOCUSED`, `sensitive:false`를 전송한다. Browser는 해당 방문 관찰을 중지하고 다른 페이지/blur 후 계속한다. 비밀번호·카드 필드·고위험 본문은 계속 세션 격리한다.|
|Visit 0에서 관찰 코드 연결 실패를 알 수 없음|`tabs.sendMessage` reject 및 권한 제한 재현 테스트 2 FAIL.|capture 실패를 빈 catch로 버렸다. 고정된 진단 코드, 새로고침·권한 조치 안내와 재전송 시 재연결을 추가한다. 기존 탭에 임의 코드를 주입하지 않는다.|
|제외 검사에서 미전송 textarea의 문구를 판독|합성 textarea의 `subscription required` 문구로 정상 본문이 제외되는 테스트 FAIL.|`excludedPublicLayout()`의 `body.textContent`가 폼 내부 텍스트까지 읽었다. 기존 입력·폼·숨김 제외 트리 순회를 사용한다. 폼 값을 읽는 우회는 추가하지 않았다.|
|FE/BE와 AI 카드 판정 불일치|AI 회귀 4 FAIL: 공개 설명문 거절, 라벨 없는 카드번호·fullwidth 카드·PAN 손상 checksum 누락.|AI의 오래된 `credit card` 단어 차단을 실제 값 검출로 교체한다. FE/BE와 같은 NFKC, 13~19자리, Luhn 및 라벨이 붙은 손상 checksum 차단을 적용한다. 이메일·전화·인증정보·주민번호 규칙은 유지한다. 목표 원문에도 같은 검사를 적용한다.|
|신규 MySQL setup의 준비 완료 경쟁|신규 v6 테스트 DB에서 setup 실패. Spring 접속 실패 20:11:25.383, MySQL 실제 TCP ready 20:11:25.424. 직전 Docker 로그에 temporary server shutdown이 있다.|`mysqladmin ping`이 이미지 초기화 중 socket-only 임시 서버를 healthy로 판단했다. 앱 계정으로 TCP `SELECT 1`과 DB 접근을 확인하는 healthcheck로 변경한다. 스키마·Volume·계정은 그대로다.|

과거 PLAN-003의 약 69/101ms 격리와 ENDED/QUARANTINED·Visit 0·PENDING은 Issue의 운영 기록이다. 당시 DOM·검사 단계 증거가 없으므로 위 입력 포커스 결함이 과거 트리거였다고 확정하지 않는다. 이 작업에서 실제 C 세션을 열거나 원본 데이터로 재현하지 않았다.

1초 pulse 사이가 1.5초를 초과하거나 worker epoch/시계가 바뀌면 수집기는 확인할 수 없는 시간을 버린다. 이 보호는 유지한다. `OBSERVATION_GAP`으로 지연을 표시하고, 이후 정상 pulse의 실제 시간만 누적한다. 지연 구간을 임의 체류시간으로 채우지 않는다. 외부 Google의 현재 DOM 지원은 별도 실사이트 검증이 필요하다.

## 전체 경로와 실패 결과

|단계와 구현|조건 및 실제 결과|
|---|---|
|1 인증·명시적 동의 — `api/auth-fetch.ts`, `v2/access.ts`, BE Authentication/Consent|만료·철회·정책 동의 누락 시 시작/전송 차단. Credential은 trusted session storage에 두며 브라우저 재시작 후 재인증한다.|
|2 정책·빌드·배정 — `real/policy.ts`, `CollectionSitePolicy`, `CollectionPlanService`|SHA/build/site scope/기간/배정 소유권·확정 목표 불일치 시 시작 거절. Gate 유효와 ACTIVE는 별개다.|
|3 세션 — `v2/runtime.ts`|IDLE→START_PENDING을 먼저 영속화하고 같은 idempotency key로 시작 재시도. ACTIVE 응답 검증 후 관찰 허용.|
|4 Content Script — `real/content.ts`, `v2/browser.ts`|업데이트 전 탭에 script가 없으면 서버 Visit 0 가능. 이제 연결 실패와 새로고침 조치를 표시한다. Worker 부팅·탭/창 활성화·재전송에서 capture를 재시도한다.|
|5 전경·문서·URL — `v2/browser.ts`, `real/url.ts`|Chrome 전경 창/탭, frame documentId/URL, navigation revision, permission을 검증한다. 비활성/늦은 응답은 Visit·격리를 만들지 않는다. `document.hasFocus()` 거짓이면 추출하지 않는다.|
|6 제외·민감정보 — `content/extraction.ts`, `shared/privacy.ts`|일반 editable 포커스, 제외 URL, paywall/접근 오류/연락처 처리 실패는 snapshot 없이 관찰 중지/실패. 고위험 DOM/제목/본문·검색 의도는 전송 전에 격리한다.|
|7 추출 — `content/extraction.ts`, `content/search.ts`|제목·본문·지원된 검색 결과만 추출. 폼·입력값·광고·숨김을 제외하고 연락처 마스킹 후 재검사. 지원되지 않는 DOM은 가짜 본문 없이 실패, 이후 정상 페이지에서 계속한다.|
|8 실제 시간 — `v2/collector.ts`|전경의 독립 관찰만 누적. 4999ms 미확정, 5000ms 확정. 3999/4000ms 복귀 경계, SPA/document/generation 분리, 알 수 없는 gap 제외.|
|9 Visit 생성 — `collector.freeze()`|안전 snapshot+5초를 만족한 확정 순서로 불변 post와 sequence 생성. 관찰만 있고 길이/추출/시간 부족이면 Visit은 없다.|
|10 IndexedDB — `v2/repository.ts`, runtime.mutate|strict transaction·revision CAS 후 committed 상태로 인정. 저장 실패 시 원본 committed 보존·storageFailed·안전 중지. 영속화 전 전송하지 않는다.|
|11 POST/PATCH ACK — `background/visit-delivery.ts`, `behavior-delivery.ts`|POST 원본 고정, PATCH는 POST ACK 후 진행. retry/ACK 유실/worker restart에서 같은 요청 복구. 로컬 저장 수와 서버 POST ACK 수를 구분한다. ACK가 없으면 서버에 있어도 화면의 수신 수가 낮을 수 있다.|
|12 BE 유효성 — `PageVisitService`, `MetadataPage`|인증/소유권/동의/세션/정책·본문·시간·검색어·sequence/행동 버전 검증. 잘못된 입력을 성공 표시하지 않는다.|
|13 MySQL·멱등 — `PageVisitService.saveOrReplay()`|세션 write lock, 불변 Visit replay, 중복 ID/sequence 충돌 거절, 마지막 수락 sequence 단조 증가. gaps는 허용하되 순서 역행은 거절한다.|
|14 종료 — `SessionEndDelivery`, runtime.stop|ACTIVE→END_PENDING, candidate 확정·POST/PATCH drain 후 END. ACK 및 서버 상태 확인 후 ENDED. 격리 시 일반 전송 중단·회수·별도 마감 ACK.|
|15 품질·재수집 — `CollectionProgressService`, `LocalCollectionStatus`|RAW_COLLECTED는 최소10·유효참조·ENDED/CLEAR·전송확인·동의/회수 검증 필요. RAW_ONLY는 AI NOT_RUN/실제 Window 0. PENDING 또는 ACTIVE Attempt는 같은 배정의 시작을 차단한다. ENDED 후 사유 기록→RECOLLECT_REQUIRED로 새 Session/Attempt 허용. 과거 행은 보존한다.|
|16 Export/Import·검수 — `CollectionExportService`, `tools/individual-local/dataset.py`, `raw_review.py`|최신 privacy revision/철회/tombstone, source-qualified ID·checksum·중복/충돌·순서/참조 검증. v2 Window3/Stride1의 무라벨 검수 레코드 생성. scenario는 정답 라벨이 아니다.|

진단에는 고정 코드·시각·수량·확인된 체류시간만 포함한다. 원 URL·검색어·본문·입력값·Credential을 추가로 저장/로그/Export하지 않는다. 진단은 Worker 메모리에만 있으며 재시작 후 초기화된다. 현재 상태와 코드 확인 시각을 함께 표시한다. Chrome UI/omnibox 포커스로 content 자체가 pulse를 보내지 못하는 구간은 과거 OBSERVING 코드만으로 현재 체류를 보장할 수 없다.

## 검증 계획과 증거

실행 전 `/private/tmp/focus119-evidence/plan.txt`에 3회 독립 환경·각10 Visit·실제5초·장애 복구·실패 보존 계획을 기록했다. 증거 디렉터리는 0700이다. 신규 프로필·Extension 경로·Source/Participant/Credential/동의·MySQL DB/Volume만 쓴다. 자동화 합성 동의는 실제 참여자 동의/연구 실적이 아니다. 실패 디렉터리는 성공 실행으로 덮어쓰지 않는다.

원본/키/토큰/DB 로그/Export bundle은 Git에 넣지 않는다.

|검증|실행과 결과|
|---|---|
|수정 전 재현|`red-fe.log`: 포커스 분리 1 FAIL. `red-browser.log`: 연결/권한 진단 2 FAIL. `red-layout.log`: textarea 오판 1 FAIL. `red-ai.log`: 공개 용어·카드값 4 FAIL. 수정 후 같은 사례 PASS.|
|FE 단위·타입·실제 패키지|`npm run typecheck`, `npm test`, 공식 v6로 `npm run build:real`. 최종 998 PASS, HTTP opt-in 2 SKIP. 아래 BE 통합에서 두 HTTP 사례는 실제 실행 PASS. 관찰 gap 이후 실제 시간 누적 복구 회귀도 포함한다.|
|BE 전체·실제 MySQL|`run-regression.py --mysql-fixture .../synthetic-initial/A/fixture.json ...` → Gradle XML 58 classes / 1,148 PASS, FAIL/ERROR/SKIP 0. 새 스키마로 storage/sequence/patch/end/quarantine/consent/plan/migrations 검증. 실제 HTTP·Chrome·FastAPI fixture도 실행(모델은 MOCK, 수집 성공 증거와 구분).|
|AI|`/private/tmp/focus-content-ai-venv/bin/python -m pytest -q ai` → 276 PASS, SKIP 0. FastAPI testclient deprecation 경고 1. FE/BE/AI 공통 19개 개인정보 사례 PASS.|
|로컬·데이터셋·회수 도구|`python3 -m unittest discover -s tools/individual-local` → 42 PASS. `tools/collection` → 5 PASS.|
|기존 실제 MV3 RAW 흐름 3회|`run-synthetic-e2e.py`, `synthetic-initial/validation.json`: 독립 MySQL3/프로필3, 각10 실제 Visit, 총30. 네트워크 단절·Worker/브라우저 재시작·재인증·MySQL/서버 재시작 후 보존 PASS. RAW_ONLY/AI NOT_RUN, 실제 Window0/이론24, 중복 Import3 거부·ID/Plan 충돌 거부. 철회 후 2세션20 Visit/1세션 제외 PASS. 이 실행은 기존 비-metadata controlled adapter이며 공식 public-text 경로 검증과 구분한다.|
|공식 v6 실제 공개 사이트 3회|`run-external-site-e2e.py --automated-test-only --test-subnet-prefix 10.252.119 --tls-port-base 19843 ...` → `external-isolated/summary.json` PASS. 신규 A/B/C 각각10 Visit, Python Docs/Blog·Hacker News·Books to Scrape·Naver의 실제 응답. MV3+Content Script+Spring+MySQL, 실제 활성 시간 ≥5000ms, ENDED/CLEAR·pending0·END ACK acked·RAW_COLLECTED/AI NOT_RUN. 재시작·재인증·탭 전환·제외 URL 이후 정상 종료. 암호화 Export/중복 Import/검수3세션30 Visit24 Window PASS. OS 인증서 신뢰 설치는 NOT_TESTED(테스트 인증서 SPKI pin과 잘못된 pin 거부를 검증).|
|v5→v6 보존·실제 격리·재수집|`run-quarantine-upgrade-e2e.py --test-subnet 10.252.120.0/28 ...`, `quarantine-upgrade.log` PASS. 0/N Visit 격리, 회수·마감 ACK, paywall 제외 후 다른 페이지 수집, 부족 Attempt/사유 중복 재전송/새 Attempt, 공개 기사 이메일 마스킹. v5 원본10행 보존, 최종5 Session/5 Attempt/23 Visit/2 Consent/2 Retraction/2 Tombstone, Export21 Visit(격리2 제외), 적격 학습 검수2세션20 Visit16 Window.|
|실제 검색 DOM probe|신규 독립 프로필에서 현재 추출기를 적용. Naver HTTP200/14 organic results PASS. Google HTTP200이지만 CAPTCHA 존재, #search/#rso/h3 각각0: 정상 결과 구조와 실제 수집은 NOT_TESTED_ACCESS_CHALLENGE. 우회/가짜 검색 결과를 사용하지 않았다.|

공식 정책 성공 실행은 `external-isolated`이다. 사전 시도 `external-initial`은 JDK25 선택으로 setup 전 FAIL, `external-jdk21`은 위 실제 DB readiness 경쟁으로 FAIL, `external-tcp-ready`는 기존 Docker subnet과 겹쳐 DB 생성 전 FAIL이다. 모두 보존했고 최초 실패를 성공으로 바꾸지 않았다. 수정 후 새 subnet의 3개 신규 Volume은 초기화부터 한 번씩 통과했다.

추가 `--page-content` 장애 실행의 사전 시도도 별도 경로에 보존한다. `synthetic-content`는 BE 회귀와의 전용 포트 충돌로 FAIL, `synthetic-content-isolated`는 재로드로 닫힌 UI 탭을 재사용해 FAIL, `synthetic-content-reload`는 요청 전 worker 이벤트 대기로 FAIL, `synthetic-content-ui-wake`는 종료 후 TIME_WAIT를 활성 listener로 오인한 preflight FAIL, `synthetic-content-recovery`는 이 unpacked headless 설정의 프로그램식 reload 후 접근 차단으로 FAIL, `synthetic-content-manager`는 실제 확장 관리자 reload 후 credential 재인증을 생략해 FAIL이었다. 수집 성공을 가정한 테스트 준비의 잘못을 고쳤으며 인증을 우회하지 않는다. 최종 재실행 결과를 별도로 기록한다.

## 변경 범위와 호환성

- FE: `real/content.ts`, `src/content/extraction.ts`, `src/v2/browser.ts`, `src/v2/local-status.ts`, `participant/index.tsx`. 제외/격리 분리·연결/추출 진단·재연결·상태 안내. IndexedDB schema, 저장 envelope, immutable post, sequence, 서버 wire 계약은 바꾸지 않는다.
- AI: `training/raw_review.py`. 공개 용어와 실제 카드값을 구별한다. `tests/test_raw_review.py`, FE `privacy-parity.test.ts`, BE `MetadataPageTest`가 동일 `docs/contracts/v2/fixtures/privacy-text.json` 19개 사례를 읽는다.
- 운영 도구: `deploy/individual-local/compose.yml`의 DB readiness만 수정. 데이터 마이그레이션 추가/변경 없음.
- FE 회귀: `real-content-lifecycle.test.ts`, `real-browser-foreground.test.ts`. 합성 브라우저 검증: `raw-browser-test.mjs`, `local-https-browser-test.mjs`, `run-synthetic-e2e.py`의 opt-in 공개 본문/장애 검증 모드. 기존 metadata 모드 검증을 대체하지 않는다.
- BE production Java는 수정하지 않는다. 최신 BE는 PR #118의 카드값 검출을 이미 포함한다. C 운영 커밋→최신 main 차이에는 FE와 BE의 카드 검출 수정이 있으므로 C에 FE만 교체하면 판정 불일치가 남을 수 있다.
- legacy `ai/training/dataset.py`/`models/context.py`는 Window5와 사람 검토 라벨을 전제로 한다. v2 review는 Window3/Stride1·UNLABELLED이고 legacy 학습기에 바로 입력할 수 없다. 후속 v2 학습 로더·사람 라벨링·평가 split·모델 학습/검증은 이번 수정에서 만들거나 자동 생성하지 않았다.

## 운영 적용 계획과 승인 범위

아래는 실행하지 않은 절차다. 실제 C Chrome 세션 시작/재수집/동의/Export/DB 쓰기/확장 재설치/Backend 재시작/배포는 별도 승인이 필요하다.

1. 승인 시점에 C 커밋 `432959e`와 PR 최종 커밋의 diff, 실행 중 BE build-info, 운영 정책 SHA/build ID/API origin을 다시 대조한다. FE 공개 본문/진단과 BE 카드값 검사, AI offline 검수, Compose readiness가 교체 대상이다. 정책 파일·Manifest scope·build Gate를 임의로 변경하지 않는다.
2. 사용자 수집 중지와 모든 전송 상태를 확인한다. 미전송 Queue가 있으면 삭제/재설치하지 않는다. ACK 상태가 불명확하면 백업과 원인 확인을 먼저 하고 재수집하지 않는다.
3. DB는 기존 프로젝트/Volume을 정확히 확인한 후 일관된 암호화 백업과 SHA/복구용 키의 별도 보관을 준비한다. 운영 설정·정책/인증서·Source/Participant/Credential/Consent, Session/Attempt/Retraction/Tombstone 및 기존 extension 폴더와 Chrome Default 프로필/IndexedDB/Queue를 함께 보호한다. 프로필 파일 복사는 Chrome 종료와 잠금 해제 후 진행한다. 관련 앱을 자동 종료하지 않는다.
4. 복구 검증은 별도 새 Volume/새 경로에서만 수행한다. 운영 Volume에 restore를 시험하지 않는다. `tools/individual-local/verify-restore.py`, 백업 도구의 암호화·checksum·일관된 행 수 검증을 사용하되 운영 Export/백업 실행도 승인 대상에 명시한다.
5. 기존 절대 extension 로드 경로와 ID, Chrome Default 프로필, trusted Credential 소유권을 유지한다. 새 로드 경로에 병렬 설치하거나 확장을 삭제하지 않는다. 기존 경로를 백업한 뒤 동일 경로의 번들을 교체하는 정확한 절차를 리뷰한다. 페이지 새로고침 안내와 사이트 접근 권한을 확인한다.
6. 기존 BE 프로세스의 실제 커밋/실행 JAR를 확인하고 승인된 순서로 FE/BE를 함께 정합화한다. MySQL Volume 이름과 스키마 18 migrations를 유지한다. Compose healthcheck 변경을 기존 DB 컨테이너에 반영할 때 재생성이 필요한지도 별도 확인한다. 운영 DB/Backend를 자동 restart하지 않는다.
7. 사용자 직접 동의/시작 후 ACTIVE와 관찰 응답·로컬/서버 Visit·pending을 비교하고 최소10 Visit→ENDED/CLEAR→END ACK acked/pending0→RAW_COLLECTED/AI NOT_RUN을 확인한다. 이 단계는 실제 참여자 데이터 수집 승인을 받은 뒤 수행한다.
8. 저장 오류·격리·정책 불일치·ACK 정체·sequence 충돌이면 즉시 수집을 중지하고 원본 Queue/격리 이력을 보존한다. 확장/BE 바이너리는 백업 버전으로 되돌릴 수 있지만, 이미 수신된 Visit·동의·회수 기록은 버전 롤백으로 취소되지 않는다. DB/profile 복원은 새 데이터 손실/서버와 로컬 상태 불일치를 만들 수 있으므로 자동 롤백하지 않는다. 재인증과 같은 ID 재전송으로 정합성을 먼저 확인한다.

## 남은 검증 범위

실제 C Default/headful Chrome·사용자 직접 동의·운영 인증서 OS 신뢰·운영 배포는 NOT_TESTED이며 사용자 승인 전 실행하지 않는다. 다른 OS/Chrome 버전과 모든 공개 사이트를 보장하지 않는다. 외부 Google/Naver 구조, 접근 차단 및 지연 렌더링 변화는 지속 검증 대상이다. 과거 PLAN-003 트리거는 미확정이다. 정규식은 완전한 개인정보 탐지기가 아니며 학습 전 사람 검수와 철회 snapshot 재확인이 필요하다.
