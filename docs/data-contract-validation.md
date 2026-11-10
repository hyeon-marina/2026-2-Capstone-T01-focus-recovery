# 데이터 수집·분석 계약 검증 — Issue #83

## #89 Backend 연동 실제 구현·검증

공식 main `4f9b4fb570d0b0594b453a0a67b1f180d6411fb8`에서 #85 저장 기반과 #87 AI API를 연결했다. [BE–AI v2 구현 검증](be-ai-v2-integration-validation.md)에 Git/파일/트랜잭션/실제 명령/미구현·미검증 범위와 제출 정보를 기록한다. 아래 #87/#85/#83/#81은 당시 기록이다.

- 수정 전 Backend `./gradlew test --console=plain` 성공. JUnit XML430건(404실행/26환경 skip), 실패/오류0. MySQL/live 환경변수 없이 실행한 baseline이며 기존 보고의 MySQL 포함436건과 다르다.
- 최종 Backend: `FOCUS85_MYSQL_URL='jdbc:mysql://127.0.0.1:3389/focus85?serverTimezone=UTC' FOCUS89_MYSQL_URL='jdbc:mysql://127.0.0.1:3389/focus89?serverTimezone=UTC' FOCUS89_AI_URL=http://127.0.0.1:8897 ./gradlew test --console=plain` → **757건, 실패0/오류0/skip0**.
- 기존436건 보존+신규321건: 규칙217(216조합+누락), v2 Client7, H2/MySQL 공통 통합 각46, 실제 Spring 재시작1, 실제 BE/FastAPI HTTP1, v2 고정주기1, V12 이관2. 기존 v1 기대값은 변경하지 않았다.
- 실제 MySQL8.4.9의 격리 loopback 합성 DB에서 V1~V12 빈 DB, V10→V11→V12 기존 행 보존·재migrate0/validate·FK/UNIQUE/CHECK·동시 Worker/rollback을 확인했다. 운영 DB에는 접근하지 않았다.
- Mock HTTP 통합과 실제 HTTP를 구분한다. 실제 BE HTTP 서버↔Uvicorn FastAPI에서 AI의 모델 독립 구성·Registry/Schema·분석 처리 경로를 실행했으며 **Embedding/LLM만 합성 Mock**이다. HTTP 산출물10개를 `be/src/test/python/validate_http_evidence.py`로 Schema/hash/구성/페이지 pairing/상태 hash 재검증했다.
- 기존 AI pytest220건 통과(경고1). 실제 모델 `smoke_v2.py` preflight는 SKIPPED: 런타임 의존성/로컬 Qwen 모델 없음, modelLoaded=false/inferenceExecuted=false. 다운로드·실제 모델 로드·추론·품질 평가는 하지 않았다.
- 실제 Spring 재시작은 같은 H2 파일 DB를 다시 여는 검증이다. OS kill/MySQL 프로세스 재시작·다중 서버·고부하·GPU hang·원격 캐시 회수/실제 삭제·실제 FE 표시 race는 미검증이다.

정확히 test 프로필+storage flag와 별도 dispatch flag(둘 다 기본false)를 유지한다. v2 HTTP130초/Lease180초/여유15초·Worker2/큐0·구성3claims/1초·2초 backoff는 합성 개발 한도이며 운영 승인값이 아니다. 분석 자동 재호출/v1 fallback은 없다. P1~P6 PROPOSED/P2·P6 BLOCKED, 운영·실사용자 처리 금지, 전체 삭제/PURGED 미구현을 유지한다.

## #87 AI v2 실제 구현·검증

공식 main `37706428`에서 모델 독립 구성 API와 실제 페이지 LLM 생성 호출을 사용하는 v2 분석 경로를 구현했다. v1 5방문/확률 응답·모델·학습 산출물은 보존한다. 공통 Schema/Fixture 기대값과 BE·FE 제품 코드는 변경하지 않았다. 상세 파일·명령·제약·후속 작업은 [AI v2 구현 검증 보고](ai-v2-window-analysis-validation.md)를 따른다.

- 수정 전 AI pytest 수집 결과는 테스트0건(exit5)이었다. 수정 전 reference validator는 Schema80·시나리오139·규칙216·κ4 통과였다.
- `/private/tmp/focus87-ai/bin/python -m pytest ai/tests -q --tb=short --junitxml=/private/tmp/focus87-ai-results.xml`: **220 passed**, 실패0, Starlette의 httpx 사용 deprecation 경고1건. 공통 Schema80건·요청 reference17건과 API/모델 Mock/캐시/오류·v1 회귀123건을 구분한다. 실제 모델 정확도 평가는 아니다.
- `cd be && ./gradlew test --tests '*AnalysisIntegrationTest' --tests '*V2GateAndFingerprintTest'`: **46건, 실패0/오류0/skip0**. 기존 BE v1 모의 HTTP 통합38건과 기존 v2 gate/Java-Python fingerprint8건이며 이번에 변경하지 않은 테스트다. 새 Python 서버와 BE를 함께 띄운 E2E 검증은 아니다.
- `/private/tmp/focus87-ai/bin/python ai/smoke_v2.py`: **SKIPPED**. torch/transformers/sentence-transformers 및 Qwen 로컬 모델 파일 부재. 다운로드·학습·실제 모델 로드·추론은 수행하지 않았다. 장치 선택·메모리/응답시간·품질 수치는 없다.
- Python 별도 프로세스 두 번 실행으로 Registry ID 기억 소실을 확인했다. 실행 중 캐시 invalidation과 늦은 결과의 generation barrier는 Mock/가짜 encoder로 검사했다. 영속 멱등·분산 회수·실제 보안 삭제는 검증하지 않았다.

P1~P6 PROPOSED/P2·P6 BLOCKED 유지. AI v2는 기본 비활성이고 합성 전용 profile+flag만 허용한다. API 구현/PR은 정책 승인·운영 준비·개인정보 회수 완료가 아니다. 아래 #85/#83/#81 기록의 미실행 설명은 각 당시 범위이며 이번 실행 결과와 분리한다.

## #85 Backend 실제 구현·검증

공식 main `4a71171`에서 Backend 저장 기반과 V11을 구현했다. 수정 전 기존 Gradle362건, 구현 후 기존362+신규74=436건이 H2/격리 MySQL 8.4를 포함해 실패0·skip0으로 통과했다. 추가 DB PK/FK/UNIQUE 검사 후 V2MigrationTest도 H2/MySQL에서 통과했다. [#85 상세 보고](be-v2-storage-foundation-validation.md)에 명령, 재시작·롤백·동시성 검증 및 미구현/미검증 한계를 구분한다.

아래 #83/#81의 제품 코드/DB 미실행 설명은 과거 작업 기록으로 보존한다. #85의 제품 검증과 정적 reference validator를 서로의 실행 근거로 대체하지 않는다. P1~P6 PROPOSED/P2·P6 BLOCKED, 기본 비활성·합성 테스트 전용·공개 회수 API/실삭제/PURGED 미구현은 유지한다.

## #83 기준과 실제 실행

2026-11-10 KST, 공식 main `a1a5d9701d45e0f7ce07b14ead27d67a53eec08c` 기준, 브랜치 `docs/83/v2-contract-approval`. 시작 detached HEAD `6e15dd3fa1789e96c42bc4f33250c4221d6d2616`, tracked 수정·미추적 파일 0. Git/Issue/PR·승인 근거 조사는 [승인 요청 대장](v2-contract-approval.md#1-기준과-승인-근거-조사)을 따른다. P1~P6 승인 0건, PROPOSED 유지. P2 조기 전송·P6 동의/보존/기관 확인의 BLOCKED 유지.

제품 소스·기존 테스트·의존성·Flyway는 변경하지 않았다. 이번 정적 계약 검증을 제품 테스트·회수 기능 완성·팀 승인으로 보고하지 않는다. 아래 #81 당시 기록은 과거 증거로 보존한다.

저장소의 기존 정확한 실행 방법은 `docs/contracts/v2/README.md`의 임시 venv + `jsonschema[format]==4.26.0` + `validate.py`다. 기본 `python3`에는 jsonschema가 없어 첫 환경 확인은 실패했다. 기존 임시 venv `/private/tmp/focus81-validator`의 jsonschema **4.26.0**을 확인하고 같은 인터프리터로 baseline과 최종본을 실행했다. 제품 의존성 설치·수정 없음.

```sh
# 새 환경에서 재현할 때만 생성/설치
python3 -m venv /private/tmp/focus83-validator
/private/tmp/focus83-validator/bin/python -m pip install 'jsonschema[format]==4.26.0'
/private/tmp/focus83-validator/bin/python docs/contracts/v2/validate.py

# 이번 실제 실행(이미 존재하는 임시 venv 재사용)
/private/tmp/focus81-validator/bin/python docs/contracts/v2/validate.py
git diff --check
```

baseline(수정 전) 실제 결과: Draft 2020-12 / 30정의 / Schema74 / 시나리오82 / 규칙216조합 / κ4건 PASS.

최종 실행 결과:

```text
PASS: 10 Markdown documents, 156 relative links/anchors, code fences
PASS: Draft 2020-12, 30 definitions, 80 schema cases, 139 reference scenarios, 216 rule combinations, 4 kappa checks
LIMIT: reference contract checks only; no FE/BE/AI product, DB, Chrome, or model execution.
```

| #83 검증 대상 | 실제 검사 | 한계·남은 검증 |
| --- | --- | --- |
| Draft2020-12·UUID·timestamp·필수/null | check_schema + 모든30정의, FormatChecker, 기존 정상/오류74건 보존 | API 런타임에서 같은 검증을 쓰는지는 제품 구현 후 확인 |
| 5초/4초/5분·sequence | 기존 경계·버전/중복/stale/누적감소, 추가 commit abort·지연 A/B·동시 직렬 순서 | 실제 Chrome 시간·IDB transaction/ACK 실패 주입 아님 |
| Schema 보완6건 | 성공 snapshot4999/0 거절, 구성 중복 visitId·회수 중복 Window ID 거절, PURGED 모양 정상·알 수 없는 완료 상태 거절 | PURGED 모양 통과는 삭제 증명 아님 |
| AI 구성 size3/stride1·커서 | 기존1~5개·tail·번호공백/실제누락·response 멤버/끝/커서 검증, 추가 append 허용·privacy revision/CAS 충돌·receipt replay | DB UNIQUE/FK/트랜잭션/lease·네트워크 호출은 미실행 |
| AI visitId/position 관계 | 요청 관계검사와 응답 pairing 결합. 요청 자체 중복 visit/sequence를 함께 거절 | 실제 AI 추론·모델/검색어 경로 미실행 |
| BE 규칙·stateVersion | 216조합 독립 조건식, 새 전체3개 snapshot의 ordered ID/analysis/fingerprint/state 검사, 동일 입력 replay·동일상태 새 입력·5분 새버전·stale commit 거절 | DB 잠금/CAS·동시 worker 검증은 후속 |
| 관련 Window 전체·AI 지연 | 공유 방문의 모든 기존 Window 선택(최대3), 각 위치 snapshot 검사, AI 완료 전 행동 갱신의 첫 성공값 | 실제 dirty outbox fanout·조회·알림 통합 미실행 |
| 개인정보 회수 | 저장후/POST 유실/미존재ID 선회수/AI 진행중·결과저장/Window·이력/후보·shown/Export/모델/백업 잔존·늦은 재저장 차단. 회수 ID replay/conflict·완료상태 비회귀 | named inventory와 guard의 합성 모델일 뿐. HTTP·실제 삭제·캐시/수신자/모델 영향 제거 실행 안 함 |
| P6 분할·라벨 유출 | 기존 manifest12/4/4 goal 교집합 검사·κ4건, 새 nested blind projection의 예측/시나리오/자동 후보라벨 누출 거절 | 실제 JSONL/FK/checksum/rowCount·동의·라벨링 UI/사람 평가 미실행 |
| Markdown·정적 범위 | 검증기에10문서의 상대 파일/anchor·fence 검사 추가, diff --check, 기존 Fixture/기능 ID 보존 및 docs 경로만 변경 확인 | 외부 URL 가용성/기관 승인·모든 Markdown 문법 검증 아님 |

추가 시나리오는 **57건**이며 기존82건의 입력과 기대값을 그대로 유지한다. 단순 설명을 실행 PASS로 세지 않는다. `state-history`의 STALE_INPUT/STATE_VERSION_CONFLICT와 blind LABEL_LEAK는 reference 내부 진단이며 새로운 운영 HTTP 코드로 Schema enum에 추가하지 않았다.

검증 중 새 Fixture 생성 코드가 PURGED 정상 예시 객체를 재사용하여 COMPLETE로 바꾼 오류를 검출했다. 정상 입력을 PURGED로 복원하고 별도 오류 예시를 보존했다. 신규 승인 문서의 중간점이 들어간 잘못된 anchor 두 개도 링크 검사에서 검출하여 수정했다. 기존 제품 테스트·기존74/82 기대값은 변경하지 않았다.

추가 검토 근거: FE collector/active-time/index/delivery/durable/end 및 보호/검색 경로, BE WorkSession/PageVisit/Window/AnalysisRequest·Executor/Recovery/Query/AI DTO·Alert/Display/Task, AI main/pipeline/embedding/context/classifier/training/compare와 V1~V10 SQL·기존 회귀 테스트를 읽었다. 현행 1초·5개·10초·확률 API와 v2 목표를 구분했다. 소스·심볼별 충돌은 [코드 근거표](v2-contract-approval.md#3-현행-코드와-충돌을-재확인한-근거)에 기록했다.

## #83 실행하지 않은 항목과 gate

FE Vitest/typecheck/build/Playwright·실제 Chrome/Windows, BE Gradle/MySQL/API 통합·Flyway/이관, AI 모델 로드/추론/benchmark/학습, 실제 개인정보 수집·삭제·Export 회수·백업 복원·모델 영향 제거를 실행하지 않았다. 이번 변경은 docs13파일이며 project-plan은 검토·링크 검사만 하고 수정하지 않았다. 과거 제품 테스트 PASS를 이번 실행 결과로 전용하지 않는다.

승인 주체·일시·URL이 없어 APPROVED로 승격한 정책은 없다. 기술 승인 후 합성 구현과 운영 활성화 gate를 구분한다. 회수/소유권/END 예외·파생 회수의 실제 구현·검증 및 보존/동의/기관 확인 전 조기 전송·실데이터 수집/공유/학습은 BLOCKED다. 해제 조건과 독립 후속 Issue 초안은 [승인 요청 §5~8](v2-contract-approval.md#8-후속-구현-issue-초안과-의존성)에 기록했고 GitHub Issue는 생성하지 않았다.

---


# Issue #81 당시 검증 기록 (보존)

## 기준과 결과의 의미

2026-11-10 KST, 공식 main `6e15dd3fa1789e96c42bc4f33250c4221d6d2616`을 기준으로 문서·Schema·Fixture를 작성했다. 제품 코드는 변경하지 않았다. #79의 이전 검증 기록은 [PR #80 당시 문서](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/blob/6e15dd3fa1789e96c42bc4f33250c4221d6d2616/docs/data-contract-validation.md)에 남아 있으며, 그 PASS를 이번 실행 결과로 사용하지 않는다.

P1~P6는 **모두 PROPOSED**다. 상위 요구 #79/#80과 세부 제안의 차이, 승인 근거 부재, 개인정보 보존·동의 및 조기 배포 선결의 BLOCKED는 [결정안](v2-contract-decisions.md)에 기록했다. 본 검증 PASS는 정책 승인·제품 구현·모델 품질·배포 준비 완료를 뜻하지 않는다.

## #81 요구사항 추적

| 요구 | 검토·산출물 | 검증/한계 |
| --- | --- | --- |
| Git 준비·실제Issue/댓글·PR80·최신main | 결정안 §1, Git fetch/ls-remote, GitHub API | detached/clean 시작, 동일 작업브랜치 없음, PR80 merged/Issue81 open·댓글0 확인 |
| P1 leftAt/returnedAt·4초·탭/reload/SPA·창·재시작/시계·다른내용 | 결정안 §2~3, FE 보충 | revisit3999/4000·다른탭/대상/세대·음수시간 oracle. 실제 Chrome 미실행 |
| P2 A/B/C·열린후보·추출지연·순서/BE제약/라벨 | 결정안 §4, 공통 계약 §5 | 유효화 순 권장·v2 수신 watermark, replay/conflict/gap/역순 oracle. 현재 collector/IDB와 다른 동작 명시 |
| 전송후 민감·정정/삭제/무효화·파생처리 | 결정안 §4.1, PrivacyRetraction/RetractionAck | 회수 wire/늦은응답 차단 reference. 실제 저장소·캐시·Export·학습모델/백업 삭제 검증은 미실행 |
| P3 5초·최초5분·최종갱신·중복/지연/ACK/Worker·장기저장 | 결정안 §5, BehaviorPatch/Ack, FE/BE 보충 | 4999/5000,299999/300000, 늦은crossing·중복/stale/version 충돌·누적감소. 실제 타이머·quota 미실행 |
| P4 AI 구성/BE ID/저장·A/B/C·FK·cursor·복구 | 결정안 §6/9, CompositionRequest/Response | 1~5 입력·빈구간·tail·batch·번호공백·실제누락·역순·잘못된구성응답 oracle. DB transaction/CAS는 설계 검토 |
| AI request/response v2·누락/실패/중복·모델캐시 | 결정안 §2/6, AnalysisRequest/Response | positions/ID/hash pairing, request중복/순서·실패. 실제 추론/학습·재시작 미실행 |
| P5 우선순위/suffix·state 이력/재판단·알림 | 결정안 §7, WindowState/CurrentDecision/StatusResponse | 216조합·최신관련 우선·같은Window변경/중복·역순/과거DRIFT/종료후/FAILED후응답·알림최신성/간격 reference |
| P6 20목표·10명·160/시나리오40·>=10방문·>=1200Window·자연20~40·3인·12/4/4 | 결정안 §8, Manifest, 수집규격 §9 | 목표 유지·분할교집합 검증. 실제 수집량/품질 미측정 |
| 라벨/정적기준/UNJUDGEABLE·독립/합의·κ·유출방지/가명/동의 | 결정안 §8 | manifest형식·κ 산술4건. 실라벨·동의 승인·학교 규정 확인 미실행/BLOCKED |
| 공통API 타입·필수/null·UUID/timestamp/int/enum·오류진단 | contracts/v2/README 및 v2.schema.json | Draft2020-12+FormatChecker, 명명된30정의·74사례. schema-only와 관계검사를 분리 |
| API/DB·v1호환·신규migration 필요 | 결정안 §9, 공통 계약 §8, BE 보충 | V1~V10 FK/UNIQUE 읽기 대조. migration 적용·이관 미실행 |
| 승인·후속 구현 분리 | 결정안 각표·§10~11, 각기능 보충 | P1~P6 담당/상태·승인링크 없음 확인, 후속Issue 자동 생성 없음 |
| 변경 범위·링크·정합성 | 아래 정적 검사 | 문서/계약자료만, 기존 기능ID 보존, 링크/fence 검사 |

## 실제 실행한 검증

실행 환경: macOS, Python 3.11 임시 venv, `jsonschema[format]==4.26.0`. 제품 requirements/package/Gradle 의존성을 변경하지 않았다.

```sh
python3 -m venv /private/tmp/focus81-validator
/private/tmp/focus81-validator/bin/python -m pip install 'jsonschema[format]==4.26.0'
/private/tmp/focus81-validator/bin/python docs/contracts/v2/validate.py
```

최종 결과:

```text
PASS: Draft 2020-12, 30 definitions, 74 schema cases, 82 reference scenarios, 216 rule combinations, 4 kappa checks
LIMIT: reference contract checks only; no FE/BE/AI product, DB, Chrome, or model execution.
```

- Schema 자체와 30개 `$defs`에 meta-schema 검증. uuid/date-time FormatChecker를 활성화하고 UTC millisecond pattern을 별도 검사했다.
- 74개 schema-cases는 expected.valid/keyword와 실제 validation 결과를 대조했다. 정상뿐 아니라 필수 누락·null 오류·UUID 버전·존재하지 않는 날짜·timezone/정밀도·문자열 숫자/bool/소수·음수·safe integer/int32 상한·본문 5000/5001 Unicode code points·추가필드·정확한 EXTRACTION_FAILED를 검증했다. invalid Fixture가 거절되면 의도대로 통과한 것이다.
- 82개 scenarios는 실제 executable reference model의 반환값을 expected와 비교했다. 1~2개 대기,3~5개 sliding size3/stride1, 번호공백과 방문누락 차이, 구성 replay/ID충돌·tail·잘못된구성응답, POST 원본/행동분리, PATCH stale/중복/버전충돌, AI ID/hash/position 관계, 같은Window NORMAL→DRIFT, 역순/종료후/무효화후/실패확정후 응답, 기존 알림 최소간격과 연속DRIFT, goal split 유출을 포함한다.
- state flow oracle의 alertEligible는 모델 내 현재상태 자격만 검사한다. 별도 alert-policy 시나리오에서 최신Window/version·ACTIVE·shown·뒤Window 복귀·간격 경계를 검사한다. 간격 Fixture의60000은 **합성 설정 입력**이며 운영 최소간격의 권장값이 아니다.
- 216개 판단 규칙 조합은 세 페이지 라벨27가지×5분 경계8가지다. 규칙 구현과 독립 조건식으로 비교했다. κ는 완전일치·불일치·표본0·분모0 네 건을 검사한다.
- 초기 검증에서 nullable union 오류 keyword가 type 대신 anyOf로 보고되는 Fixture 기대 오류를 발견했다. 새 문서용 Fixture의 keyword를 실제 Draft2020-12 구조에 맞춰 수정했고 전체를 재실행했다. 기존 제품 테스트 기대값은 변경하지 않았다.

Schema만으로 동적 cursor/ID pairing·DB FK·권한·삭제 완료·실제 Chrome 타이머를 검증할 수 없다. `validate.py`는 제안 정책의 oracle이며 제품 서비스와 비교한 통합테스트가 아니다. 주석·설명만 있는 후속 체크리스트를 실행 PASS에 포함하지 않는다.

## 실제 실행한 정적·교차 검사

- `git diff --check`: 공백 오류 없음.
- 기준 main과 변경 경로를 대조: 기존 문서 7개 수정, 결정 문서1개와 계약 패키지5개 신규, 총13개. 경로는 모두 docs 아래다. 제품 소스·기존 테스트·의존성·Flyway 변경 없음.
- 임시 Python 검사로 변경 Markdown의 상대 파일/anchor 링크, code fence 짝, FE-001~010/BE-001~009/AI-001~003 보존 확인. project-plan의 기존 PDF 링크는 대상 파일이 저장소에 없어 '원문 미포함' 설명으로 바꿨다. 없는 파일을 정상 링크로 보고하지 않는다.
- 각 기능 명세가 같은 Schema 패키지를 참조하는지, v2 분석에 행동값/사람 정답이 섞이지 않는지, searchQuery의 null/검색 분기·상태실패 null·진단오탈자가 일치하는지 검토했다. status/alert Schema는 기존 DTO 전체가 아니라 v2 projection이라는 적용 범위를 명시했다.
- V3 Window 멤버 FK와 session/index·size/end UNIQUE, V4 Window NOT NULL FK·Window당 분석 UNIQUE, V6/V7 analysisId 중심 알림키, V8~V10 보존 대상을 원문과 대조했다. 현재 불가능한 Window 전 분석행 저장·단순 visit 삭제·같은analysis의 여러state 후보를 구현된 기능으로 쓰지 않았다.

## 실행하지 않은 검증과 승인 선결

FE Vitest·typecheck·build·Playwright·실제 Chrome/Windows, BE Gradle·API/MySQL 통합, AI 모델 로드·추론·학습·benchmark, Flyway 적용·데이터 이관, 실제 개인정보/동의·삭제·백업·Export 회수를 실행하지 않았다. 제품 코드 변경이 없어 기존 전체 테스트를 반복하지 않았다. 과거 검증 보고서의 Google CAPTCHA/서비스 DOM/권한 전체행렬 한계도 이번에 해결했다고 주장하지 않는다.

팀은 P1 대상 동일성/시계, P2 순서/조기 회수, P3 checkpoint·정리, P4 batch·lease·timeout/두 단계, P5 이력·알림 reset, P6 reference snapshot·κ·보존/동의 절차를 승인해야 한다. 특히 개인정보 처리 수단 없는 조기 전송과 근거 없는 보존기간 확정은 활성화할 수 없다. 구현/수집 승인과 PR 문서 검토를 구분한다.
