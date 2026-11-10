# Issue #89 — BE–AI v2 연동 구현·검증

2026-11-10 KST. 합성 데이터 전용 Backend 구현이다. **P1~P6 PROPOSED, P2/P6 BLOCKED 유지.** 실제 모델 품질·운영 활성화·개인정보 전체 회수를 완료했다는 보고가 아니다.

## 1. 작업 전 Git 상태

시작은 detached HEAD `6e15dd3fa1789e96c42bc4f33250c4221d6d2616`, tracked 수정·미추적 파일 0건이었다. origin(fetch/push)은 개인 Fork `hyeon-marina/2026-2-Capstone-T01-focus-recovery`, upstream(fetch/push)은 공식 `SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery`다. 기존 동일 작업 브랜치가 없었고 다른 worktree/브랜치를 보존했다. 공식 main 직접 Commit/Push, hard reset, clean, 강제 Push, 자동 Merge는 하지 않는다.

저장소 및 적용 경로에 AGENTS.md/CONTRIBUTING 가이드는 없으며 `/Users/hyeon/.codex/AGENTS.md`는 빈 파일이다. README·BE/AI README·PR 템플릿·명세/Schema/Fixture/기존 검증 보고를 읽었다. 프로젝트 계획의 develop 설명보다 사용자가 명시한 공식 main 대상 PR 지시를 따른다.

## 2. 최신 공식 main과 원격 조사

`git ls-remote upstream refs/heads/main`과 fetch로 확인한 main은 **`4f9b4fb570d0b0594b453a0a67b1f180d6411fb8`**다. 이 SHA에서 `feat/89/be-ai-v2-integration`을 생성했다. 시작 당시 열린 Issue는 #89, 열린 PR은 없었다. #89 본문·댓글(0), 닫힌 #85/#87, 병합된 PR #86/#88을 GitHub 연결 도구로 확인했다. Fork의 같은 이름 원격 브랜치도 없었다.

## 3. #89 요구사항 분석

핵심은 유효 방문 저장→영속 구성 작업→AI의 실제 Window 구성→BE 원자 저장→분석 Outbox→AI 페이지 결과→최신 행동 기반 BE 판단→append-only 이력→최신 조회/알림이다. size3/stride1, collectionSpecVersion=2.0, apiContractVersion=2, 입력별 stateVersion을 유지한다. 행동 PATCH/finalBehaviors는 기존 Window만 재판단하고 AI/Window를 늘리지 않는다.

공통 계약은 구성의 bounded retry와 **분석 자동 재호출 없음**을 구분한다. 분석 장애를 새 추론이나 v1 결과로 대체하지 않았다. P1~P6의 제안 구현과 정책 승인/운영 허가는 별개다.

## 4. 기존 BE·AI 분석과 재사용

#85의 CompositionService/ComposeRequest는 ordered identity stream, privacy revision, cursor CAS, session당 활성 작업 UNIQUE, token/lease, Window·분석·Outbox·Receipt 원자 저장을 이미 제공했다. V2AnalysisOutboxService의 검증/완료·중단 복구와 WindowStateHistoryService의 잠금·Fingerprint·최신 snapshot 검사를 재사용했다. 새 저장 프레임워크나 중복 AI 결과 테이블을 만들지 않았다.

v1 AiAnalysisClient/Executor/Recovery/Request, size5 Window, 확률 결과, 분석 조회, AlertService/TaskProcessor/Display의 고정 주기·표시 ACK·첫 선택·최소 간격/뒤 Window 복귀 정책을 확인했다. v1 작업기는 이미 apiContractVersion=1로 분리되어 있다.

#87 AI의 main.py, v2/contracts.py/model.py/service.py, smoke_v2.py와 tests를 확인했다. 실제 구성은 모델 독립이며, 분석은 공유 Schema·canonical SHA256·페이지 LLM 경로를 사용한다. Registry는 프로세스 메모리이고 추론 제한은 soft limit이다. AI 제품 코드/테스트 설정의 계약 결함을 감추는 수정은 하지 않았다.

문서의 초기 예시 ruleVersion `be-rule-2.0`과 Schema/저장 서비스의 `suffix3-v2-proposed.1` 불일치는 BE가 사용하는 후자로 문서에서 정리했다. 과거 보고의 '미구현'과 현재 #89의 구현 범위를 분리했다. Java modelVersions 길이가 UTF-16 수였던 점은 계약의 code point 수로 바로잡았다.

## 5. 수정 파일

전체 경로는 이 문서 끝의 목록을 따른다. 변경 범위는 BE 제품·테스트와 요청된 문서다. FE/AI 제품, 모델 가중치, 학습 코드, 공통 Schema/Fixture, V1~V11은 변경하지 않았다. 신규 Migration은 V12 하나다.

## 6. BE–AI Client

V2AiClient는 v1 Client를 그대로 두고 HTTP/1.1로 두 endpoint를 호출한다. 구성 요청은 ID/sequence 방문만 전송한다. 분석 요청은 position/visitId/sequence/title/content/searchQuery/isSearchResultPage/visitedAt의 정확한3방문이며 행동/사람 정답은 없다.

응답의 필수·추가필드·중복 JSON key·타입·UUID v4·version·요청 ID/Fingerprint echo·구성 전체 멤버/끝/커서·페이지 position/ID 일대일 대응·Enum·finite[-1,1]·필수 근거·4종 모델 버전·실제 UTC millisecond 날짜를 검사한다. 누락 점수를 DTO의0으로 받거나 숫자 문자열을 조용히 강제 변환하지 않는다. 저장 경계에서도 재검증한다. 오류 원문/페이지 본문/모델 예외를 로그에 복제하지 않는다.

## 7. Window 구성 Dispatcher

방문 INSERT와 composition_dirty/watermark는 같은 기존 트랜잭션이다. Scheduler가 대상 세션을 찾아 prepareDirty로 frozen job을 만들고 별도 Worker에서 claim한다. claim 후 트랜잭션을 끝내고 AI 호출→검증→기존 complete 트랜잭션으로 연결한다. BE는 AI 입력에 미리 만든 triples를 넣지 않는다.

세션당 active job UNIQUE와 session 잠금, token/lease로 중복 실행을 막는다. 1~2방문 windows=[]도 cursor를 전진시키며 tail 최대2+신규 prefix로 이어간다. sequence 공백은 산술 연속성으로 채우지 않는다. Append/PATCH는 frozen prefix를 무효화하지 않는다. 개인정보/CAS 불일치는 응답을 저장하지 않는다. Receipt replay는 기존 ID/index/analysisId를 재사용한다.

구성3claims 소진 시 FAILED를 자동으로 새 ID로 우회하지 않는다. dirty는 보존하며 원인 확인 후 내부 prepareNext로 새 작업을 명시해야 한다. 실패/진행 중 세션이 discovery 첫 페이지를 독점하지 않도록 후보 조회에서 제외한다.

## 8. 분석 Outbox Dispatcher

PENDING Outbox를 bounded 목록으로 찾고 Worker 진입 후 원자적으로 claim한다. 큐에서 기다리는 동안 Lease가 소진되지 않게 claim 전에는 작업을 소유하지 않는다. HTTP는 DB 트랜잭션 밖이며 같은 토큰·Lease·privacy revision·원래 Window/분석 소속으로만 완료한다. 잘못된 응답/통신 실패는 코드와 FAILED를 영속 기록한다.

중복 Worker는 claim에서 종료한다. 서버 중단으로 만료된 RUNNING은 기존 정책대로 ANALYSIS_INTERRUPTED/FAILED이며 늦은 결과가 덮지 못한다. 미실행 PENDING은 재시작 후 발견한다. Window·분석·Outbox는 기존 원자 저장으로 누락을 방지하고 PK로 중복을 거절한다. 임의 DB 행 삭제를 자동으로 복원하는 범용 복구 도구는 추가하지 않았다.

## 9. Timeout·Lease·Retry

| 항목 | 구현/기본 개발 설정 | 구분 |
| --- | --- | --- |
| 연결 | 기존 AiProperties connect-timeout 2초 | v1 설정 보존 |
| v1 전체 응답 | 기존10초 | 변경 없음 |
| v2 전체 응답 | 130초, 본문 수신 포함 future deadline/취소 | 합성 개발 한도 |
| v2 Job Lease | 180초 | 응답+commit margin15초보다 반드시 큼 |
| Lease 검사 | 시작 시 설정 검증, 완료 시 RUNNING/token/유효 Lease 검사 | 늦은 소유권 결과 폐기 |
| HTTP Worker | 2개, 메모리 대기큐0 | 거절된 작업은 unclaimed PENDING 유지 |
| Admission | 구성/분석 우선순위 교대 | 구성 유입이 분석을 굶기지 않음 |
| 구성 재시도 | 최대3claims(최초+최대2회), 일반 일시 실패1초·2초 backoff/next_attempt_at 영속 | 같은 ID/body 유지, recovery는 만료 후 bounded 재claim |
| 분석 재시도 | 0회 | 실패/중단 확정, 새 추론 없음 |
| 복구 주기 | 기존 storage recovery 기본30초 | 테스트는1시간+직접 호출로 결정적 검증 |

AI는 기본 잠금 대기 최대60초+추론 soft60초다. 130초는 해당 구조를 검토한 개발 deadline이며 실제 GPU hang/연산 취소나 p95 보장이 아니다. HTTP가 끝나도 AI 서버 연산/캐시가 남을 수 있다. 분석을 자동 재시도하지 않는 이유 중 하나다. JVM 장기 정지·DB 장기 잠금 때는 Lease가 만료될 수 있으며 token fencing과 session 잠금이 늦은 commit을 차단한다. 운영 수치·동시성·AI hard cancellation은 실측/승인이 필요하다.

## 10. 최종 상태 판단

FinalStateRules는 `suffix3-v2-proposed.1`을 사용한다. 먼저 완전한3개 결과/행동 pairing을 요구하고 최신 페이지부터 UNRELATED suffix만 센다. 최신 DIRECT/JUSTIFIED_DETOUR=NORMAL, suffix1/짧음=NORMAL, suffix2/모두짧음=TRANSITION, suffix1~2 중 >=300000ms 또는 suffix3=DRIFT다. 앞쪽 긴 체류가 최신 관련 페이지를 덮지 않는다. semanticRelevance/확률로 규칙을 대체하지 않는다. 분석 실패/누락/격리에는 성공 상태 이력을 만들지 않는다.

## 11. 상태 이력과 버전

WindowDecisionService는 session WRITE→Window WRITE 잠금 안에서 최신3행동을 읽고 계산하여 기존 WindowStateHistoryService.save를 호출한다. 계산·저장·dirty 해제·후보 저장이 한 트랜잭션이다. 기존 PK/입력 UNIQUE/분석 소속 복합 FK와 Window 카운터를 사용한다. 최초1, 동일 입력 기존 버전, 상태가 같아도 다른 입력 새 버전이다. 이전 이력은 수정하지 않는다.

오래된 외부 snapshot은 기존 저장 서비스에서 거절한다. 실제 Worker는 잠금 안에서 계산하므로 unlocked 판단과 저장 사이의 역전이 없다. 후보 저장/commit 실패는 상태 이력도 rollback하고 dirty를 남긴다.

## 12. Behavior PATCH·finalBehaviors

기존 session SHARE→visit WRITE 순서를 유지한다. 적용된 PATCH만 관련 모든 Window(index 순)를 dirty로 표시하고 미표시 후보를 무효화한다. finalBehaviors도 기존 원자 종료 트랜잭션 안에서 같은 fanout을 수행한다. 판단 session WRITE는 PATCH/종료와 직렬화된다.

AI 미완료 동안 dirty는 남고 완료 후 실제 최신 snapshot으로 첫 판단을 만든다. 중간 상태를 합성하지 않으며 실제 처리 사이의 여러 PATCH는 최신값으로 합칠 수 있다. 새 Window/분석/Outbox는 생성하지 않는다. 종료 후 기존 backlog/dirty 판단은 평가용 저장 가능하지만 알림은 없다.

## 13. 조회 API

`GET /api/sessions/{sessionId}/analysis-status`는 v1 응답을 유지하고 v2에서 apiContractVersion/currentDecision/lastSuccessfulState를 추가한다. currentDecision은 최신 구성 Window이며 dirty/미완료는 PENDING·finalState=null, 실패/무효화는 해당 상태다. 과거 성공은 참고만 제공한다. 기존 latestAnalysis/latestCompletedAnalysis는 AI 원본 정보다.

`GET /api/sessions/{sessionId}/windows/{windowId}/states?page=0&size=20`은 stateVersion 내림차순, page>=0/size1~100/총건수/총페이지를 제공한다. 다른 세션 소속도404 WINDOW_NOT_FOUND다. v2 분석 목록/상세는 기존 필드에 currentDecision과 페이지 결과를 확장한다. 조회는 판단/후보/AI를 생성하지 않는다. session SHARE 잠금으로 격리/종료 쓰기와 조회를 직렬화한다.

## 14. v2 알림 정책

v1 analysisId UNIQUE와 AlertTaskProcessor는 보존한다. v2는 상태 이력과 dirty 작업을 후보의 영속 처리 근거로 사용하며, 별도 중복 task 테이블 없이 판단 트랜잭션에 후보 생성을 포함한다. V2AlertService는 최신 Window/상태 COMPLETED DRIFT·ACTIVE·AI 모드·비격리·기존 최소 간격/뒤 Window 정상 복귀를 검사한다.

미표시 후보는 windowId+stateVersion UNIQUE, AI 근거는 state_analysis_id, 실제 표시/첫 선택은 기존 alertId로 연결한다. 새 입력/Window/종료/격리는 이전 미표시 후보의 invalidated_at만 기록하며 실제 shown 이력은 수정하지 않는다. 같은 Window의 새 NORMAL 버전만으로 재알림을 허용하지 않는다. 마지막 표시 뒤의 더 뒤 Window의 최신 유효 NORMAL/TRANSITION과 shownAt 최소 간격이 필요하다.

후보 조회는 현재 조건을 재검사한다. shown/response는 실제 표시 감사 ACK다. 이미 표시된 과거 후보의 늦은 ACK는 생성/무효화/종료/현재 시각을 검사하며 새로운 UI 표시 허가로 취급하지 않는다. v2 종료 이후 표시/무효화 이후 표시는 차단하고 개인정보 격리는 replay보다 우선한다. 기존 v1 시각 허용오차/고정 주기·응답 정책은 유지한다. 실제 FE 표시 직전 네트워크 race를 완전히 없애는 승인 토큰은 범위 밖이다.

## 15. 개인정보 격리·늦은 결과

기존 내부 quarantine/tombstone/revision/전체 세션 분석 무효화를 유지하고 v2 미표시 후보도 무효화한다. 구성/분석 완료, 판단, 후보 생성/조회, 이력/분석/알림 조회와 표시·응답 replay에 Gate를 적용한다. 격리 status는 INVALIDATED 메타데이터와 null 참고/알림을 제공하고 원문 분석은 노출하지 않는다. 서버 재시작 후에도 DB 격리를 우선한다.

공개 회수 Controller·서비스 인증/소유권, 실제 삭제, AI 캐시/메모리·Export·학습·백업 회수는 구현하지 않았다. QUARANTINED를 삭제 완료나 PURGED로 반환하지 않는다.

## 16. v1 호환성

5방문·확률 응답·10초 준비/응답·기존 분석 복구·조회·고정 주기/분석 기반 알림·표시 ACK·선택·기존 데이터의 회귀 테스트를 유지했다. v1 테스트 기대값은 변경하지 않았다. 기존 V2StorageContract의 격리 status 기대만 새 null projection으로 갱신했고 V2MigrationTest는 본래 V11까지의 검증 범위로 고정했다. V12는 별도 테스트다. v2 실패→v1 fallback은 없다.

## 17. Migration·DB

V12는 compose_request.next_attempt_at와 due 인덱스, analysis_window.decision_dirty/decision_error_code 및 탐색 인덱스, notification의 window/state/근거/FK/UNIQUE/invalidated_at를 추가한다. 기존 notification.analysis_id UNIQUE를 없애지 않고 v2 state_analysis_id를 별도로 둔다. 상태 참조는 (window_id,state_version,analysis_id)의 복합 FK/CHECK로 보호한다.

macOS arm64, Temurin toolchain21.0.10/launcher25.0.2, Gradle9.7.1, Spring Boot4.1.1, H2 MySQL mode, 별도 Docker MySQL8.4.9를 사용했다. 테스트 컨테이너 focus89-mysql-synthetic, loopback3389의 focus89/focus85와 무작위 Migration DB만 사용했다. 운영 DB에 접근하지 않았다. V10→V11→V12 기존 합성 행 보존, 빈 DB 전체 적용, 재migrate0건/validate, PK/FK/UNIQUE/CHECK·동시성/rollback을 확인했다.

## 18. 실제 명령·결과

수정 전 `cd be && ./gradlew test --console=plain`은 성공했다. 당시 JUnit XML 집계는430건(404 실행,26 환경 조건 skip), 실패/오류0이었다. 기존 보고서의 MySQL 포함436건과 이번 환경변수 없는 baseline을 혼동하지 않는다.

```sh
# 저장소 루트에서 AI 모델 로더/다운로드 없는 실제 FastAPI 테스트 서버
AI_V2_PROFILE=synthetic-test AI_V2_ENABLED=1 \
  /private/tmp/focus87-ai/bin/python be/src/test/python/v2_http_fixture.py --port 8897

# 별도 shell, be 디렉터리
FOCUS85_MYSQL_URL='jdbc:mysql://127.0.0.1:3389/focus85?serverTimezone=UTC' \
FOCUS89_MYSQL_URL='jdbc:mysql://127.0.0.1:3389/focus89?serverTimezone=UTC' \
FOCUS89_AI_URL=http://127.0.0.1:8897 ./gradlew test --console=plain

# 저장소 루트
/private/tmp/focus87-ai/bin/python -m pytest ai/tests -q --tb=short
/private/tmp/focus87-ai/bin/python ai/smoke_v2.py
/private/tmp/focus87-ai/bin/python be/src/test/python/validate_http_evidence.py
/private/tmp/focus81-validator/bin/python docs/contracts/v2/validate.py
git diff --check
```

최종 수치는 검증 실행 후 아래에 기록한다. MySQL/live URL이 없으면 해당 테스트는 skip되므로 전체 실행과 구분한다. 새 환경의 Python 의존성은 `ai/requirements-test.txt`, 모델 불필요 환경은 기존 AI README의 임시 venv 절차를 따른다. 실제 inference 라이브러리를 설치/모델을 다운로드하지 않았다.

## 19. Mock·실제 HTTP·실제 모델 구분

| 증거 | 실제 실행 | Mock/한계 |
| --- | --- | --- |
| V2IntegrationTest/V2MySqlIntegrationTest | Spring 서비스·실제 H2/MySQL 트랜잭션·JDK HTTP Client·Mock HTTP server | AI 구성/페이지 응답은 합성 Mock |
| V2AiClientTest | 실제 JDK HTTP/timeout/연결 거부/strict parser | 서버 응답은 Mock,100ms timeout은 테스트값 |
| FinalStateRulesTest | 216개 라벨27×시간8 조합+누락 검사 | AI 품질 평가 아님 |
| V2DispatcherRestartTest/기존 V2RestartTest | 같은 H2 파일 DB로 실제 Spring 컨텍스트 재시작, PENDING/dirty/Receipt/token/격리 복구 | OS kill/다중 서버/MySQL 프로세스 재시작 아님 |
| V2LiveHttpTest | 실제 BE HTTP 서버↔별도 Uvicorn FastAPI, 실제 AI 계약/Registry/구성·PageAnalysisModel 경로 | Embedding/LLM은 기존 FakeEmbedding/FakeContext, 실제 모델 추론 아님 |
| HTTP 증거 재검증 | 실제 HTTP 산출물10개: Schema/hash/구성·분석 pairing/상태 hash | 합성 자료만 |
| AI 기존 pytest | 220건, 실패0, deprecation 경고1 | Mock 모델/가짜 encoder/tokenizer/generate |
| smoke_v2.py | preflight 실행, SKIPPED | torch/transformers/sentence_transformers 및 Qwen 로컬 모델 없음; modelLoaded=false/inferenceExecuted=false |

실제 HTTP에서는 방문1/2의 빈 구성·cursor 진행→3방문 구성/AI 결과→NORMAL→PATCH300000/동일 Window v2 DRIFT→후보→종료 null alert와 잘못된 AI fingerprint422를 확인했다. 초기 테스트 요청의 visitedAt이 `.SSS` 없이 직렬화되어400인 문제는 합성 HTTP harness만 고쳤다. 실제 AI 서버/계약을 수정하지 않았다.

## 20. 미구현·미검증

범위 밖 미구현: FE 제품/IndexedDB/측정 전환, 모델 학습·가중치/페이지 라벨 재설계, 실제 사용자 처리, 전체 삭제·동의/보존·소유권/외부 회수·Export/백업/모델 영향 제거, 운영 배포/운영 DB 적용, PURGED 전이.

미검증 장애: OS 강제 종료·JVM 장기 정지/clock jump, MySQL 프로세스 강제 종료/DDL 중간 실패, 다중 BE/AI 서버·고부하/장시간·GPU hang/연산 취소, 원격 AI 캐시/재시작 전파·실제 보안 삭제, 실제 Chrome 표시 race/권한/네트워크 지연. 두 Worker/DB 잠금·rollback·HTTP timeout·소유권 만료·Spring 재시작 검증을 이 장애 전체의 PASS로 확대하지 않는다.

## 21. 운영 활성화 선결

기존 storage Gate와 별도 dispatch flag는 기본false이고 정확히 test 프로필에서만 v2를 허용한다. 운영 우회 옵션은 추가하지 않았다. P1~P6 승인자/일시/근거 URL 확보, P2/P6 소유권·회수/보존·동의·기관 절차와 실제 삭제/분산 회수 증거, FE 전환, 실제 모델/시간·자원·품질 검증과 파일럿/활성화 승인이 필요하다. 합성 테스트/PR 병합만으로 해제하지 않는다.

## 22. 후속 Issue 제안 — 자동 생성 없음

1. 인증·소유권·동의·보존/기관 확인과 개인정보 전파 회수/삭제 증거·복구 훈련.
2. FE v2 수집/IndexedDB/측정·회수 예외와 실제 Chrome 통합.
3. 준비된 로컬 모델로 합성 실제 추론/페이지 라벨 품질·latency/자원·hard cancellation 평가.
4. 다중 서버·OS/DB 중단·부하/장시간·DDL 실패 훈련 및 승인된 timeout/lease/동시성 수치 결정.
5. P1~P6 정책 승인 기록과 최종 운영 활성화 심사.

## 23. Commit·Fork Push

개인 Fork의 `feat/89/be-ai-v2-integration`에 한국어 Commit으로만 제출한다. Commit SHA·Push 결과는 최종 답변과 PR에 기록하며 이 문서 자신의 최종 SHA를 자기 참조로 고정하지 않는다.

## 24. PR

공식 main 대상 제목은 `[Feat/#89] BE–AI v2 연동 및 최종 상태 판단·알림 구현`이며 저장소 PR 템플릿을 사용한다. PR URL 또는 권한 오류/Compare URL은 최종 답변에서 보고한다. 자동 Merge/후속 Issue 생성은 하지 않는다.

## 최종 실행 수치

Backend 전체 **757건, failures0/errors0/skipped0**, BUILD SUCCESSFUL(28초). 기존436+신규321이다. 신규는 규칙217, HTTP Client7, H2/MySQL 각46, 재시작1, 실제 HTTP1, v2 고정주기1, V12 이관2다. AI220 passed/경고1, 실제 모델 preflight SKIPPED, HTTP 증거10개 PASS다. 정적 계약은 Markdown10/상대링크171, Schema30정의/80사례/reference139/규칙216/κ4 PASS이며 diff --check도 통과했다. V1~V11/Schema/Fixture의 바이트 동일성과 FE/AI 제품 변경 없음도 검사했다.

## 변경 경로 전체

- `be/src/main/java/com/focusrecovery/domain/alert/dto/AlertHistoryItem.java`
- `be/src/main/java/com/focusrecovery/domain/alert/dto/AlertHistoryRow.java`
- `be/src/main/java/com/focusrecovery/domain/alert/dto/AlertResponse.java`
- `be/src/main/java/com/focusrecovery/domain/alert/dto/V2AlertResponse.java`
- `be/src/main/java/com/focusrecovery/domain/alert/entity/Notification.java`
- `be/src/main/java/com/focusrecovery/domain/alert/repository/NotificationRepository.java`
- `be/src/main/java/com/focusrecovery/domain/alert/service/AlertDisplayService.java`
- `be/src/main/java/com/focusrecovery/domain/alert/service/AlertHistoryService.java`
- `be/src/main/java/com/focusrecovery/domain/alert/service/AlertService.java`
- `be/src/main/java/com/focusrecovery/domain/alert/service/V2AlertService.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/client/V2AiClient.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/client/V2AiException.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/controller/AnalysisController.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/dto/V2AnalysisCompletion.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/dto/V2AnalysisStatusResponse.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/entity/AnalysisOutbox.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisExecutor.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisQueryService.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/service/V2AnalysisOutboxService.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/service/V2AnalysisQueryService.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/service/V2DispatchProperties.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/service/V2Dispatcher.java`
- `be/src/main/java/com/focusrecovery/domain/composition/dto/Composition.java`
- `be/src/main/java/com/focusrecovery/domain/composition/entity/ComposeRequest.java`
- `be/src/main/java/com/focusrecovery/domain/composition/repository/ComposeRequestRepository.java`
- `be/src/main/java/com/focusrecovery/domain/composition/service/CompositionService.java`
- `be/src/main/java/com/focusrecovery/domain/composition/service/V2StorageRecovery.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/service/PrivacyRetractionService.java`
- `be/src/main/java/com/focusrecovery/domain/session/repository/WorkSessionRepository.java`
- `be/src/main/java/com/focusrecovery/domain/session/service/WorkSessionService.java`
- `be/src/main/java/com/focusrecovery/domain/visit/service/PageVisitService.java`
- `be/src/main/java/com/focusrecovery/domain/window/dto/WindowStatePage.java`
- `be/src/main/java/com/focusrecovery/domain/window/entity/AnalysisWindow.java`
- `be/src/main/java/com/focusrecovery/domain/window/exception/WindowNotFoundException.java`
- `be/src/main/java/com/focusrecovery/domain/window/repository/AnalysisWindowRepository.java`
- `be/src/main/java/com/focusrecovery/domain/window/repository/WindowStateHistoryRepository.java`
- `be/src/main/java/com/focusrecovery/domain/window/service/FinalStateRules.java`
- `be/src/main/java/com/focusrecovery/domain/window/service/WindowDecisionService.java`
- `be/src/main/java/com/focusrecovery/global/config/AsyncConfig.java`
- `be/src/main/java/com/focusrecovery/global/exception/GlobalExceptionHandler.java`
- `be/src/main/resources/application.properties`
- `be/src/main/resources/db/migration/V12__v2_dispatch_decision_alert.sql`
- `be/src/test/java/com/focusrecovery/domain/integration/FinalStateRulesTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2AiClientTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2DispatcherRestartTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2FixedIntervalTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2IntegrationContract.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2IntegrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2LiveHttpTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2MySqlIntegrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V12MigrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2MigrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2StorageContract.java`
- `be/src/test/java/com/focusrecovery/support/MockV2AiServer.java`
- `be/src/test/python/v2_http_fixture.py`
- `be/src/test/python/validate_http_evidence.py`
- `docs/be-ai-v2-integration-validation.md`
- `docs/be-spec.md`
- `docs/contracts/v2/README.md`
- `docs/data-analysis-contract.md`
- `docs/data-contract-validation.md`
- `docs/v2-contract-approval.md`
