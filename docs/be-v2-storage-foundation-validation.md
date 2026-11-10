# Issue #85 — BE v2 저장 기반 구현·검증

## 작업 기준

2026-11-10 KST. 시작 detached HEAD `6e15dd3fa1789e96c42bc4f33250c4221d6d2616`, tracked 수정·미추적 파일 0건. origin은 개인 Fork `hyeon-marina/2026-2-Capstone-T01-focus-recovery`, upstream은 공식 `SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery`다. fetch 후 공식 main `4a71171bd861266cfe6ca9dbd636864f41b2ea41`에서 `feat/85/be-v2-storage-foundation`을 생성했다. 기존 브랜치/다른 worktree를 덮어쓰지 않았다. 저장소와 적용 경로에 별도 AGENTS.md/CONTRIBUTING 없음. project-plan의 develop 방침보다 이번 공식 main 대상 제출 지시를 따른다. PR 템플릿은 `.github/pull_request_template.md`다.

Issue #85 본문·댓글(0), #79/#81/#83 본문, #83 댓글(0), PR #84 본문·리뷰(0)를 GitHub 연결 도구로 확인했다. main의 #80/#82/#84 merge와 관련 BE #24/#35/#37/#40/#42/#49 병합 이력을 대조했다. #84는 문서·계약 패키지 변경이며 정책 승인이 아니다. 지정된 10개 명세/승인/Schema/Fixture/검증 문서를 구현 기준으로 사용했다.

환경은 macOS arm64, Gradle wrapper 9.7.1, Spring Boot 4.1.1, Java toolchain Temurin 21.0.10, Gradle launcher Temurin 25.0.2다. H2 MySQL mode 및 별도 Docker `mysql:8.4`(실제 SELECT VERSION: 8.4.9)를 사용했다. 테스트 DB는 loopback `127.0.0.1:3385/focus85`, 이관 검증은 임시 `focus85_migration_<uuid>` DB다. 운영 DB·실사용자 데이터·AI 모델에는 접근하지 않았다.

## 실제 코드에서 확인한 v1 동작

- WorkSessionService는 strip한 목표만으로 Idempotency-Key를 비교했다. 세션 종료는 세션 쓰기잠금과 finalBehaviors 원자 반영, 이미 ENDED면 기존 응답이었다.
- PageVisitService는 1,000ms·nullable 본문과 기존 누적값 기본값을 받았다. 원본 비교는 행동값 제외, replay는 ENDED 검사보다 앞이었다. PATCH는 세션 공유잠금 → 방문 쓰기잠금이었다.
- AnalysisWindowService는 BE가 size5/stride1을 구성하고 sparse sequence를 허용했다. 첫 Window 전 신규 역순 방문을 허용했다.
- AnalysisRequestService는 마지막 방문 10,000ms 또는 세션 종료에 분석을 등록했다. AnalysisResult는 Window당 1행이었다.
- AI Client는 HTTP/1.1, 5방문과 확률/최종 분류/ID/시각을 검증했다. Executor는 commit 후 실행, AI 통신은 DB 트랜잭션 밖이었다. Recovery는 stale PENDING/RUNNING을 FAILED로 확정하고 AI를 자동 재호출하지 않았다.
- Query는 windowIndex 중심으로 기존 분석행을 조회했다. 알림과 후보 작업은 analysisId 중심이었다. V3 Window/멤버 FK·UNIQUE, V4 window NOT NULL/FK/UNIQUE, V6/V7/V9 알림 종속 FK를 직접 확인했다.

위 동작의 기존 기대값은 변경하지 않았다. 신규 서비스 때문에 기존 호출 경로가 v2 스냅샷을 v1 실행기에 넘기지 않게 버전을 검사한다.

## 구현 및 트랜잭션 경계

| 영역 | 실제 구현 | 미구현/격리 경계 |
| --- | --- | --- |
| 세션 | `collection_spec_version` 기본1.0·불변, 2.0만 신규 v2, 목표+버전 키 비교, 미지원 버전 거절 | 기본 비활성, 정확히 test 프로필+명시 flag에서만 허용. prod/local 또는 복합 프로필은 true라도 차단 |
| 방문 | v2 >=5000·SUCCESS·본문/검색 분기·필수/길이/카운터/UUID 검증, HTTP 필드 생략·타입·추가필드·UTC millis 검사, sparse 순서 | FE 보호·민감 DOM의 실제 안전성까지 BE가 증명하지 않음. 기존 DTO의 v1 문자열 상한도 유지 |
| watermark | 세션 쓰기잠금 안에서 `incoming > lastAcceptedSequence`, Visit INSERT와 함께 commit, 동일 원본 replay는 순서 검사 앞 | v1 첫 Window 전 순서 정책은 유지. sequence 재번호 없음 |
| compose | identity stream의 tail 최대2+신규 prefix(최대256), ID/hash/불변 snapshot·privacy revision·상태·lease·token·시도수 저장 | Backend가 AI 입력으로 triples를 만들지 않음. HTTP/모델/자동 dispatcher 없음 |
| compose 완료 | ID/hash/전체 인접3개/순서/멤버/끝/through 검증, session cursor CAS, Window/index+멤버+분석 PENDING+Outbox+cursor+응답 snapshot+Receipt 같은 tx | 새 append/PATCH는 무효화 사유 아님. 잘못된 응답은 rollback, 호출 어댑터가 fail 또는 lease 복구로 종결 |
| compose 복구 | 일시 오류를 허용 코드로 명시 재시도하거나 만료 RUNNING의 token을 회수해 동일 ID/body로 PENDING, 최대3 claims 후 FAILED. PENDING·dirty 세션·Receipt는 DB 유지 | lease60초·최대3회는 테스트용 기술값이며 운영 승인값 아님. 터미널 실패는 새 작업 필요 |
| 분석 | v2 입력 snapshot/fingerprint·page_results/response/model_versions 저장 공간, 내부 결과 저장 DTO 검증, PENDING Outbox와 token claim/완료 | 실제 AI 응답 변환·HTTP 연동·최종 탐색 판단·새 알림 없음 |
| Outbox | PK analysis_id로 중복 방지, DB commit 뒤에도 PENDING 조회 가능. 완료 재처리 동일 결과 멱등, 다른 결과 충돌. 만료 RUNNING은 FAILED/ANALYSIS_INTERRUPTED, 늦은 결과 거절 | 분석 자동 재호출 없음. 후속 dispatcher가 pending→claim→tx 밖 호출→complete를 연결해야 실제 전달됨 |
| 상태 | session 쓰기잠금 → Window 쓰기잠금, 성공 v2 분석/소속/규칙ID/hash·최신 행동 벡터 검사, Window 카운터 원자 증가, PK/입력 UNIQUE | 계산 규칙·행동 dirty fanout/재판단 worker·v2 상태 조회/알림은 후속. 같은 상태 새 입력도 저장 |
| 개인정보 | 내부 quarantine 서비스, 전역 visitId tombstone(미존재 방문도 허용), session 별도 privacyStatus/revision, 포함 Window 식별·전체 세션 분석/job 무효화, 원본·파생·외부 inventory와 실패/선결 저장 | 공개 회수 Controller 없음. 소유권/동의/END_PENDING·실제 삭제·외부 사본 증거 미구현. QUARANTINED 유지, PURGED API/전이 없음 |
| 조회/알림 | v1 기존 조회 유지. v2 legacy 분석 조회·알림 경로는 명시 거절, 격리 시 세션/방문/분석/알림 조회·replay 차단 | v2 currentDecision projection 및 새 알림 정책은 구현 완료가 아님 |

잠금 순서는 세션 → 작업/Window/분석이다. 행동 PATCH의 공유잠금은 상태 저장의 세션 쓰기잠금과 경합하므로 오래된 snapshot이 최신 버전을 발급하지 못한다. 동일 fingerprint replay는 기존 버전만 반환하고 새 이력을 발급하지 않는다. 네트워크 호출은 신규 코드에 없다. 후속 어댑터도 Claim 반환 후 트랜잭션 밖에서 수행해야 한다.

수신 watermark / AI 구성 완료 cursor / privacyRevision은 독립이다. 성공한 prefix까지만 구성 커서를 전진시키며 전체 요청의 부분 성공은 허용하지 않는다. DB commit 뒤 응답 유실은 저장된 Receipt의 기존 Window/index/analysisId를 반환한다. privacy gate는 Receipt 및 Visit 원본 replay보다 앞선다.

## 신규 Java 경계

- Entity: ComposeRequest, AnalysisOutbox, WindowStateHistory/WindowStateId, PrivacyRetraction, VisitTombstone, RetractionTarget/RetractionTargetId.
- Repository: ComposeRequestRepository, AnalysisOutboxRepository, WindowStateHistoryRepository, PrivacyRetractionRepository, VisitTombstoneRepository, RetractionTargetRepository.
- Service: CompositionService, V2StorageRecovery, V2AnalysisOutboxService, WindowStateHistoryService, PrivacyRetractionService.
- DTO: Composition.Input/Visit/Output/Window/StoredWindow/Receipt/Claim, V2AnalysisInput/Visit, V2AnalysisCompletion/Page, SaveWindowState/Behavior, Retraction.Request/Receipt.
- 공통 경계: V2StorageGate, CanonicalJson, VisitJsonCapture(HTTP 원본 모양 검증용 request advice, Entity 아님).
- 기존 WorkSession/PageVisit/AnalysisWindow/AnalysisResult 및 요청·응답 DTO/Service/Repository는 버전별 분기와 nullable/additive 필드로 확장했다.

Canonical fingerprint는 키 재귀 정렬·배열 순서 보존·UTF-8·Unicode 비정규화 SHA256다. 계약 패키지 Python golden 분석 요청/구성 요청을 Java에서 동일 hash로 확인했다. 원본 콘텐츠를 신규 로그에 출력하는 코드는 없다.

## V11 Migration

`be/src/main/resources/db/migration/V11__v2_storage_foundation.sql` 하나다. V1~V10 원문은 변경하지 않았다.

- work_session: 규격버전 기본1.0, 수신/구성 cursor 기본0, privacyRevision0/CLEAR, composition_dirty=false.
- page_visit: nullable extraction_status. 기존 NULL은 legacy이며 성공 추출로 backfill하지 않는다.
- analysis_window: api_contract_version=1, last_state_version=0, invalidated=false. 기존 size5/index/end UNIQUE와 FK 유지.
- analysis_result: api_contract_version=1, nullable CHAR64 fingerprint 및 JSON page_results/response_snapshot. 기존 Window당1개/FK·nullable 확률 유지, 이력용 `(window_id,analysis_id)` UNIQUE 추가.
- compose_request: PK compose ID, session FK, nullable active_session_id UNIQUE로 세션당 활성 작업1개. snapshot/response/receipt JSON, cursor/revision/token/lease/timestamps/상태·오류.
- analysis_outbox: PK/FK analysisId, session FK, revision·token·lease·상태/시각/오류 및 pending/recovery 인덱스.
- window_state_history: PK(window_id,state_version), UNIQUE(window_id,input_fingerprint), Window FK와 복합 `(window_id,analysis_id)` FK.
- privacy_retraction: immutable ID/대상/이유/관측시각/hash, QUARANTINED·선결·시도/오류. visit FK가 없는 visit_tombstone은 retraction/session FK를 사용해 선회수를 보존한다.
- retraction_target: PK(retraction_id,target_type,target_id), 회수 FK, BLOCKED/FAILED·오류·시도. 실제 삭제 완료를 합성하지 않는다.

테스트에서 빈 H2/MySQL DB의 V1~V11 적용·Hibernate validate/Entity 저장 조회, V10 합성 세션/5방문/Window/확률 결과/알림/작업/선택 보존 후 V11 이관, Flyway migrate 재호출0건과 validate를 확인했다. Outbox PK/FK, 이력 PK/입력 UNIQUE/다른 Window 분석 참조 FK, 활성 구성 세션 UNIQUE의 실제 위반을 거절하는지 검사했다.

## 실제 실행 및 결과

```sh
cd be
./gradlew test
# 수정 전 baseline: 362 tests, 실패0

# Docker mysql:8.4, loopback3385, 합성 전용 focus85 DB를 따로 시작한 뒤
FOCUS85_MYSQL_URL='jdbc:mysql://127.0.0.1:3385/focus85?serverTimezone=UTC' ./gradlew test
# 전체: 436 tests, failures0, errors0, skipped0 (기존362+신규74)

# DB 제약 검사를 추가한 뒤 해당 테스트 재검증
FOCUS85_MYSQL_URL='jdbc:mysql://127.0.0.1:3385/focus85?serverTimezone=UTC' ./gradlew test --tests '*V2MigrationTest'
# H2·실제 MySQL 각1건, 실패0

./gradlew -q javaToolchains
cd ..
/private/tmp/focus81-validator/bin/python docs/contracts/v2/validate.py
git diff --check
```

정적 계약 검증 최종 결과: Markdown10문서/상대링크161, Schema30정의/80사례, reference 시나리오139, 규칙216조합, κ4건 PASS. 이는 별도 Java 제품 테스트436건과 구분한다.

MySQL 테스트는 환경변수 미지정 시 명시적으로 skip된다. URL은 `jdbc:mysql://127.0.0.1:<port>/focus85...`만 허용하고 이관용 DB는 무작위 이름으로 생성/제거한다. 재현용 컨테이너는 `mysql:8.4`, root 암호 `synthetic-test-only`이며 운영 자격증명이 아니다. `docker run --name focus85-mysql --detach --publish 127.0.0.1:3385:3306 --env MYSQL_ROOT_PASSWORD=synthetic-test-only --env MYSQL_DATABASE=focus85 mysql:8.4`로 재현할 수 있다. 데이터 볼륨을 운영 DB와 공유하지 않는다.

새 테스트 파일: V2StorageContract(공통31사례, H2/MySQL 각각 실행), V2StorageTest, V2MySqlStorageTest, V2MigrationTest(2), V2DisabledTest(1), V2GateAndFingerprintTest(8), V2RestartTest(1).

검증 중 실제로 발견해 수정한 문제: 방문 INSERT 실패 후 같은 Entity를 재저장하면 기존 v1 오류 의미를 바꾸는 점을 기존 회귀 테스트가 검출했다. 원본 replay만 확인하는 기존 복구 경로를 유지하고 그 앞에 v2 privacy 검사를 넣었다. 신규 테스트의 JDBC Timestamp 시간대와 JSON byte[] 비교·golden fixture 이름 오류도 수정했다. 테스트의 정책 기대값을 v2에 맞춰 기존 v1 테스트에서 바꾸지 않았다.

## 실행 한계·후속 및 승인

서버 재시작 검증은 실제 Spring 컨텍스트를 닫고 같은 H2 파일 DB로 다시 시작한다. 이전 Receipt 재사용, 미등록 PENDING Outbox 발견, 만료 compose token 재발급, 만료 분석 FAILED, tombstone/격리 재전송 차단을 확인한다. OS 강제 종료·MySQL 프로세스 재시작·분산 다중 서버/고부하·네트워크 장애 주입·AI 원격 캐시는 검증하지 않았다. 롤백은 제품 저장 완료 후 commit 전 예외 주입으로 Window/분석/Outbox/cursor/Receipt 전체가 남지 않음을 확인한다. 운영 규모 성능·DDL 중간 실패 복구는 미검증이다.

FE 변경·AI 제품 코드/실제 추론/학습·최종 NORMAL/TRANSITION/DRIFT 규칙·자동 dirty fanout/상태 판단 worker·v2 조회 projection·stateVersion 알림·실제 삭제/Export/백업/모델 영향 제거·인증/소유권 API·END_PENDING 예외 처리는 구현하지 않았다. 사용자가 제공한 전체 기능이 운영 가능한 완성품이라고 보고하지 않는다.

후속 작업 제안(자동 Issue 생성 없음): AI 구성/페이지 결과 API와 BE dispatcher 연결, BE 최종 판단 및 dirty fanout/조회, 상태 버전 알림 키 이관, 인증/소유권 및 개인정보 전파 삭제/END 예외, FE 수집·영속 형식 전환, 승인된 통합 파일럿/운영 활성화다. 각각 기존 #83 승인 대장의 A~H 의존성을 따른다.

P1~P6는 PROPOSED, P2/P6 BLOCKED 유지. storage flag는 운영 활성화 방법이 아니다. 기술 저장 구현이나 PR 병합만으로 정책 승인·소유권 검증·삭제 완료·실데이터 수집 승인으로 승격하지 않는다.

## 변경 파일·제출

변경 파일 목록은 아래에 기록한다. Commit/Push/PR 식별자는 최종 작업 보고와 PR 본문에서 확인한다.

- `be/src/main/java/com/focusrecovery/domain/alert/service/AlertDisplayService.java`
- `be/src/main/java/com/focusrecovery/domain/alert/service/AlertHistoryService.java`
- `be/src/main/java/com/focusrecovery/domain/alert/service/AlertService.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/dto/V2AnalysisCompletion.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/dto/V2AnalysisInput.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/entity/AnalysisOutbox.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/entity/AnalysisResult.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/entity/AnalysisStatus.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/repository/AnalysisOutboxRepository.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/repository/AnalysisResultRepository.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisExecutor.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisQueryService.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisRequestService.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/service/V2AnalysisOutboxService.java`
- `be/src/main/java/com/focusrecovery/domain/composition/dto/Composition.java`
- `be/src/main/java/com/focusrecovery/domain/composition/entity/ComposeRequest.java`
- `be/src/main/java/com/focusrecovery/domain/composition/repository/ComposeRequestRepository.java`
- `be/src/main/java/com/focusrecovery/domain/composition/service/CompositionService.java`
- `be/src/main/java/com/focusrecovery/domain/composition/service/V2StorageRecovery.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/dto/Retraction.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/entity/PrivacyRetraction.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/entity/RetractionTarget.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/entity/RetractionTargetId.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/entity/VisitTombstone.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/repository/PrivacyRetractionRepository.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/repository/RetractionTargetRepository.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/repository/VisitTombstoneRepository.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/service/PrivacyRetractionService.java`
- `be/src/main/java/com/focusrecovery/domain/session/controller/WorkSessionController.java`
- `be/src/main/java/com/focusrecovery/domain/session/dto/CreateWorkSessionRequest.java`
- `be/src/main/java/com/focusrecovery/domain/session/dto/WorkSessionResponse.java`
- `be/src/main/java/com/focusrecovery/domain/session/entity/WorkSession.java`
- `be/src/main/java/com/focusrecovery/domain/session/service/WorkSessionService.java`
- `be/src/main/java/com/focusrecovery/domain/visit/dto/CreatePageVisitRequest.java`
- `be/src/main/java/com/focusrecovery/domain/visit/dto/PageVisitResponse.java`
- `be/src/main/java/com/focusrecovery/domain/visit/dto/VisitJsonCapture.java`
- `be/src/main/java/com/focusrecovery/domain/visit/entity/PageVisit.java`
- `be/src/main/java/com/focusrecovery/domain/visit/repository/PageVisitRepository.java`
- `be/src/main/java/com/focusrecovery/domain/visit/service/PageVisitService.java`
- `be/src/main/java/com/focusrecovery/domain/window/dto/SaveWindowState.java`
- `be/src/main/java/com/focusrecovery/domain/window/entity/AnalysisWindow.java`
- `be/src/main/java/com/focusrecovery/domain/window/entity/WindowStateHistory.java`
- `be/src/main/java/com/focusrecovery/domain/window/entity/WindowStateId.java`
- `be/src/main/java/com/focusrecovery/domain/window/repository/AnalysisWindowRepository.java`
- `be/src/main/java/com/focusrecovery/domain/window/repository/WindowStateHistoryRepository.java`
- `be/src/main/java/com/focusrecovery/domain/window/service/WindowStateHistoryService.java`
- `be/src/main/java/com/focusrecovery/global/config/V2StorageGate.java`
- `be/src/main/java/com/focusrecovery/global/util/CanonicalJson.java`
- `be/src/main/resources/application.properties`
- `be/src/main/resources/db/migration/V11__v2_storage_foundation.sql`
- `be/src/test/java/com/focusrecovery/domain/storage/V2DisabledTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2GateAndFingerprintTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2MigrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2MySqlStorageTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2RestartTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2StorageContract.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2StorageTest.java`
- `docs/be-spec.md`
- `docs/be-v2-storage-foundation-validation.md`
- `docs/contracts/v2/README.md`
- `docs/data-analysis-contract.md`
- `docs/data-contract-validation.md`
- `docs/v2-contract-approval.md`
