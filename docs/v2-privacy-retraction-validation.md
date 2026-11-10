# Issue #93 — v2 개인정보 회수·삭제 전파 검증

2026-11-10 KST. 이 보고서는 **합성 데이터 기술 구현**과 **전체 개인정보 삭제 완료/실사용 수집 승인**을 구분한다. 운영 사용자 인증·기관 정책·외부 삭제 증거는 미충족이며, P1~P6 PROPOSED와 P2/P6 BLOCKED를 유지한다. PURGED 전이를 제공하지 않는다.

## 1. 작업 전 Git 상태

시작은 detached HEAD `6e15dd3fa1789e96c42bc4f33250c4221d6d2616`, 수정·미추적 파일 0건이었다. origin은 개인 Fork `hyeon-marina/2026-2-Capstone-T01-focus-recovery`, upstream은 공식 `SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery`다. 저장소 내 AGENTS.md/별도 CONTRIBUTING·Git 가이드는 발견되지 않았다. project-plan의 develop 통합 설명보다 사용자의 명시적 main 대상 PR 지시를 적용한다. `.github/pull_request_template.md`를 읽었다.

공식 main/기존 사용자 데이터·다른 브랜치·Worktree는 수정하지 않았다. reset --hard, clean -fd, 강제 Push, 자동 Merge, 후속 Issue 생성은 하지 않는다.

## 2. 공식 최신 main

작업 직전 `git fetch upstream main`과 `git ls-remote upstream refs/heads/main`으로 확인한 SHA는 `7924ad26ef4b7778eaf40b41e204bc2854da0968`이다. 이 커밋에서 `feat/93/v2-privacy-retraction`을 생성했다. Git 메타데이터가 공유 저장소 경로에 있어 브랜치 전환·Commit에는 sandbox 승인이 필요하다.

## 3. Issue #93 요구사항 분석

GitHub 연결 도구로 #93 본문·댓글(0), #85/#87/#89/#91 본문 및 PR #86/#88/#90/#92의 병합 상태·본문을 확인했다. #93의 핵심은 기존 격리 기반을 FE→BE→AI 영속 제어 작업으로 연결하고 원본/파생/외부 사본의 증거를 구분하는 것이다. 요청된 계약·승인·Schema/Fixture·각 영역 명세와 이전 검증 보고를 대조했다.

구현 범위: FE 회수 Queue/복구, 기본 거절 API와 합성 인증·소유권 검증, Tombstone 우선·Revision·무효화 재사용, 대상별 작업/증거/Lease/Retry, 합성 DB Payload 제거와 잔존 검사, 인증된 내부 합성 AI 전파/영속 Tombstone/공유 Worker 검사, 전체 완료 fail-closed. 운영 인증/동의 관리·FE 원문 폐기·외부 사본/학습/백업 삭제는 완료하지 않았다.

## 4. 기존 FE·BE·AI 개인정보 구조

| 영역 | 기존 구현 | 기존 한계와 이번 연결 |
| --- | --- | --- |
| FE | 별도 합성 v2 진입점, IDB v2 aggregate/receipt·CAS, 불변 POST/ACK·PATCH·END_PENDING, RETRACTION_REQUIRED | 원격 회수 없음 → 독립 RetractionEntry를 같은 원자 저장 경계에 추가 |
| BE | PrivacyRetraction/VisitTombstone/RetractionTarget, 세션 격리·privacyRevision, Window/분석/Outbox/구성 무효화, 조회·알림 차단 | 공개 회수·실제 Payload 제거·AI 전달 없음 → 기본 거절 API·대상 작업·합성 삭제·전파 구현 |
| AI | invalidate_visits, process-local Registry·blocked_visits·generation, shared embedding LRU 무효화 | 재시작·다른 Worker에 전파 안 됨 → 명시적 공유 Journal 주입 시 영속 격리·사용 전 재검사 |

V1 FE의 1초 수집·기존 IndexedDB 값, BE 5개 Window/확률 및 알림, AI v1 Registry·학습 파이프라인은 보존한다. 기존 V2Dispatcher·CompositionService·V2AnalysisOutboxService·WindowDecisionService의 session→작업/Window 잠금과 privacy revision/claim token 검증을 재사용한다.

## 5. 변경 파일

아래 파일 목록은 보고서 말미의 전체 경로를 따른다. 공통 Schema/Fixture와 V1~V12 SQL 원문은 변경하지 않았다. 기존 v2 테스트의 endpoint 미존재404 기대는 기본 인증거절401로 바꾸고, V12 이관 테스트는 target12로 고정했다. 기존 v1의 제품 테스트 기대값은 바꾸지 않았다.

## 6. 인증·소유권 검증

현재 work_session에는 사용자/참여자/소유자 FK가 없고 Spring Security/JWT·검증된 Principal 기반도 없다. UUID·Idempotency-Key를 권한으로 사용하지 않는다.

- 제품 `RetractionAuthorization.authorize()`는 항상401을 반환한다. 환경변수·test 프로필·storage flag로 이 거절을 해제할 수 없다. **운영 인증·소유권 기능은 미구현/BLOCKED**다.
- `SyntheticRetractionConfiguration`은 `src/test`에만 존재한다. 두 합성 Basic 인증 주체와 **테스트 DB의 소유권 매핑**을 대조한다. 미인증401, 타 소유자403, 다른 세션 Visit404를 확인한다. 매핑은 프로덕션 데이터 모델이 아니며 production JAR에 포함되지 않는다.
- ENDED에서도 같은 소유자 검증을 적용한다. 미존재 Visit 역시 인증된 합성 소유자가 소유한 세션에 대해서만 Tombstone을 만들 수 있다. 전체 참여 철회를 허용하는 권한으로 확대하지 않는다.
- 오류 본문은 고정 일반 메시지/빈 fieldErrors다. 기존 Schema에 인증 전용 Enum이 없으므로 실패 code는 기존 INVALID_REQUEST를 사용하며 새 Enum을 추가하지 않는다.

## 7. 회수 API

`POST /api/sessions/{sessionId}/visit-retractions`의 요청은 기존 retractionId/visitId/observedAt/reasonCode, 응답은 retractionId/visitId/status/invalidatedWindowIds 그대로다. strict JSON 중복키·추가필드·누락/null/타입, lowercase UUID v4 RFC variant, 정확한 UTC 밀리초/실제 달력 날짜와 두 reasonCode를 검사한다. 정상 최초202 QUARANTINED, 동일 ID·동일 입력200 현재 저장 상태, 다른 입력409 RETRACTION_ID_CONFLICT다.

세션 잠금으로 신규/Replay 판정을 직렬화한다. 다른 세션에서 같은 전역 ID를 경합하여 UNIQUE 충돌한 경우 롤백 뒤 새 트랜잭션에서 기존 요청/소속을 다시 검사한다. 포함 Window 목록은 target 복합 PK·UUID 정렬로 중복 없이 반환한다. 서버 재시작 후 DB 요청 fingerprint/receipt 상태를 재사용한다. PURGED를 만드는 경로는 없다.

## 8. FE 회수 Queue·IndexedDB

`retractions.ts`, V2Runtime, V2Repository, V2State에 독립 회수 경계를 추가했다. retractionId/visitId/observedAt/reasonCode를 최초 Commit에서 동결한다. 일반 원본 POST는 이미 있는 immutable 후보/Queue에 유지하며 회수 Queue에 민감 본문을 다시 복제하지 않는다. compacted 영수증의 Visit ID도 회수하고, 새 세션 시작 때 이전 ID 목록을 비운다.

일반 POST/PATCH/END 및 알림 Gate는 즉시 닫는다. POST ACK를 기다리지 않고 회수를 전송한다. sending Commit→HTTP→엄격한 ACK 검사→ACK Commit, 실패 시 동일 요청/ID와 시도수·다음 시각을 보존한다. 2~60초 backoff와 기존 alarm wake/명시 retry를 사용한다. 이 숫자는 합성 구현값이며 운영 SLA가 아니다. Worker의 sending은 pending으로 복구한다. 원문/요청·기존 ACK를 바꾸거나 지우는 stale Writer는 CAS로 거절한다.

ACK의 QUARANTINED는 원격 격리 접수다. PURGED 문자열을 받더라도 FE는 로컬 hold를 해제하거나 원문을 자동 삭제하지 않는다. FE 원문 폐기·정책 승인·서버 확인이 없어서 CLIENT_LOCAL_COPIES는 BLOCKED다. 무제한 정상 수집으로 원문을 계속 쌓지 않으며 격리 시 신규 수집이 멈춘다. 이 미완료 hold에 운영용 무기한 보존정책을 부여한 것은 아니다. 승인된 보존기간·안전 폐기/최소 영수증·책임자 복구 절차가 후속 선결이다.

기존 DB_VERSION2의 v2 aggregate에 optional 필드를 추가하여 이전 저장값도 읽는다. v1 state/current나 기존 IDB 데이터를 마이그레이션/삭제하지 않는다.

## 9. BE Tombstone·격리·Revision

인증 경계 다음 세션 쓰기잠금에서 멱등/소속 확인→회수행/Tombstone→세션 quarantine/Revision→Window·분석·Outbox·구성·미표시 알림 무효화→Inventory를 한 트랜잭션으로 저장한다. 원본 POST Replay와 PATCH보다 privacy gate/Tombstone이 우선한다. 미존재 Visit의 Tombstone에는 Visit FK가 없어 선회수를 보존한다.

같은 Visit의 Tombstone을 재사용하면 Revision을 다시 올리지 않고 새 Visit의 Tombstone은 Revision을 증가시킨다. 세션 ACTIVE/ENDED와 privacy status는 별개다. 실패한 API 트랜잭션은 원자 롤백하며, 이후 삭제 실패가 이미 Commit된 격리/Tombstone을 해제하지 않는다.

## 10. 실제 Payload 처리와 남은 데이터 Inventory

**아래 제거를 실제 수행한 곳은 이번 실행의 합성 H2/MySQL뿐이다. 운영 데이터는 접근·삭제하지 않았다.** SQL UPDATE로 해당 열의 값/JSON을 비운 것이며 행의 종속 물리 DELETE·디스크/백업의 보안 삭제를 뜻하지 않는다.

| 저장 위치·연결 | 이번 수행 | 유지/미완료·책임 |
| --- | --- | --- |
| page_visit(visit_id/session_id) | 대상 title/content/search_query=NULL, normalized_url/domain/browser_tab_key=빈문자; DB 잔존 검사 | ID·sequence·visited_at·행동 등 FK skeleton은 유지. 최소 보존 범위 미승인; BE |
| work_session | 격리 세션 goal_text=빈문자 | 세션 ID/상태/시각/멱등키·Revision 유지; BE |
| compose_request(session_id) | 전체 격리 세션 input_snapshot={}, response_snapshot/receipt=NULL | ID/hash/claim 무효화 메타 유지; BE |
| analysis_result→analysis_window→session | input/feature/context/page_results(rationale 포함)/response/model_versions=NULL, 확률/result/context_used=NULL | 분석 ID/hash/상태·시각 유지; BE |
| window_state_history→window/session | behavior_snapshot=[] | final_state/rule/hash/ID/버전·시각은 격리 유지. 전체 상태행 삭제 아님; BE |
| notification(session_id) | message=빈문자 | 실제 shown_at·선택 notification_response·ID/참조를 보존. 표시 사실 재작성 안 함; BE |
| analysis_window/window_visit | 기존 전체 세션 INVALIDATED, 멤버 유지 | 과거 Window 재구성 없음. 논리 격리; BE |
| analysis_outbox/alert_candidate_task | 고정 상태/오류·ID 메타; 기존 작업 무효화 | 본문 Payload 열 없음. 삭제 완료로 해석하지 않음; BE |
| privacy_retraction/visit_tombstone/retraction_target | 요청 ID/이유/시각/hash·대상·역할·증거·시도/실패 저장 | 연결 가능한 가명 메타이며 익명이라고 주장하지 않음. 보존기간 미정; BE/정책 담당 |
| FE 후보/POST/PATCH/END/IDB receipt | 전송 차단, 원본·영수증 보존, 회수 요청 영속 | 안전 폐기 정책/확인 미구현. CLIENT_LOCAL_COPIES BLOCKED; FE |
| AI v2 Registry/embedding LRU | 호출 Worker 전체 무효화; generation/Journal로 늦은 저장·재사용 차단 | 다른 Worker는 다음 사용 때 비움, 즉각 전 Worker 물리 삭제 증거 없음; AI |
| 로그 | 신규 오류의 원문/원격 예외 저장 방지, StoredDataException traceback 로깅 제거 | 기존 로그 사본 탐색/삭제 안 함. v1의 다른 traceback 로그도 별도 감사 필요; 운영/데이터 담당 |

삭제 검증과 증거 기록은 같은 DB 트랜잭션이다. FK/UNIQUE를 제거하지 않고 skeleton을 유지하므로 notification→state→analysis→window→visit 관계가 보존된다. 순수 무효화의 증거는 `INVALIDATED_METADATA_RETAINED`, 합성 DB 값 부재는 `SYNTHETIC_DB_PAYLOAD_ABSENCE_VERIFIED`, AI 접수는 `AI_DURABLE_QUARANTINE_ACK_ONLY`로 구분한다. target VERIFIED는 **해당 코드가 명시한 좁은 작업의 확인**이며 전체 개인정보 삭제 완료가 아니다.

## 11. V13 Migration·DB 영향

V13은 retraction_target에 owner_role/evidence_code/verified_at/claim_token/lease_until/next_attempt_at과 due index만 추가한다. 기존 행은 UNASSIGNED·증거 없음이고 삭제하지 않는다. 기존 V1~V12 원문·PK/FK/UNIQUE는 불변이다. 기존 v2 격리행을 자동 PURGED나 자동 삭제대상으로 backfill하지 않는다.

빈 H2/MySQL의 V1~V13 적용·Hibernate validate와 V10→11→12→13 합성 행 보존, V13 재migrate0/validate를 확인한다. MySQL 이관 검증은 **새 focus93 합성 컨테이너 안의 무작위 테스트 Schema만 생성/제거**한다. 운영 DB Migration은 수행하지 않았다.

## 12. Window·상태·알림 무효화

기존 전체 세션 격리 경계를 재사용한다. 직접 영향 Window는 응답 Inventory에, 나머지 Window도 세션 격리/INVALIDATED에 둔다. currentDecision은 INVALIDATED(없으면null), lastSuccessfulState/alert는null, 상태 이력·분석·방문·알림 조회/새 후보/표시 요청은 차단한다. 이미 표시된 알림의 shown_at와 선택 사실은 변경하지 않는다. 늦은 표시 ACK를 새 표시 허가로 사용하지 않는다. 철회 방문을 뺀 과거 Window의 재구성은 하지 않는다.

## 13. AI 캐시·Registry 무효화

`v2/retractions.py`의 RetractionJournal은 본문 없이 request ID/session/visit와 monotonic revision을 SQLite FULL 동기화 트랜잭션으로 저장한다. 멱등 Replay/동일 ID 상충409를 제공한다. DB 접근 실패는 AI_NOT_READY로 닫는다. 같은 파일을 공유하는 Worker는 요청/receipt replay·추론 시작·결과 저장 전 Journal을 확인한다. revision 변화는 기존 invalidate_visits를 호출하여 로컬 Registry/embedding을 비우고 generation을 올린다. 진행 중 결과는 저장하지 않는다.

내부 `/internal/v2/visit-retractions`는 **제품 main에 등록되지 않는다**. test fixture가 명시적 Journal·32자 이상 서비스 secret으로 설치할 때만 존재하며 Bearer를 상수시간 비교한다. env 변경만으로 제품 main에 route를 열 수 없다. BE 전파도 기본 실행정책=false이며 합성 정책에서만 수행하고, HTTP loopback·redirect 없음·고정 타임아웃으로 제한한다. 운영 서비스 인증/mTLS·배포 구조는 후속이다.

Context 온라인 생성은 요청 내 임시 텐서를 사용하고 별도 영속 Context 캐시는 사용하지 않는다. 기존 학습 Context JSONL 캐시는 별도 경로다. 이 구현은 GPU allocator·이미 시작된 연산·Python 참조의 보안 소거, v1 Registry/다른 Worker 캐시의 즉각 삭제, 모델 가중치 영향 제거를 증명하지 않는다. 모델 가중치는 바꾸지 않았다.

## 14. 전파 실패·재시작 복구

대상별 PENDING/RUNNING/FAILED/BLOCKED/VERIFIED, 시도수·고정 오류·다음 시각·claim token/30초 lease를 영속화한다. 세션잠금에서 claim하고 DB 트랜잭션을 종료한 뒤 HTTP를 보낸다. HTTP5초/연결2초, 실패 backoff 최대300초는 합성 기술값이다. 전파 실패는 PROPAGATION_UNCONFIRMED, Payload 처리 실패는 PAYLOAD_DELETE_FAILED를 기록한다. 작업별 오류는 다른 대상을 중단시키지 않는다.

만료 claim은 재발급하며 오래된 token/lease 완료를 거절한다. 전달 응답 유실은 같은 retraction ID로 재시도한다. BE 실제 Spring 종료·동일 파일 H2 재시작에서 Tombstone·원본 요청 Replay·만료 작업·삭제/전파 미완료를 복구했다. AI는 새 서비스 인스턴스 및 별도 spawned process가 같은 Journal의 차단을 확인했다. SQLite 공유 범위는 같은 로컬 파일이며 **분리된 호스트/볼륨의 Worker 전파는 미구현/BLOCKED**다. OS kill/디스크 장애/실제 MySQL 서버 프로세스 재시작 훈련은 미검증이다.

## 15. Export·학습·백업 Inventory

| 실제 코드가 지원하는 위치 | 연결/영향 추적 현황 | 처리·담당 |
| --- | --- | --- |
| ai/data 하위 sessions*.jsonl/windows*.jsonl, 입력 zip | training/dataset.py의 sessionId/visitIds/windowId; 입력 zip 경로는 CLI 지정 | 이번 Worktree에서 실제 사용자 파일 확인/삭제 안 함. 데이터 관리자/수신자 확인 전 BLOCKED |
| ai/artifacts/context_cache.jsonl(또는 --context-cache) | training/train.py의 모델/입력 hash key; 완전한 Visit 역색인·배포 사본 대장 없음 | 원본 영향 자동 열거/삭제 미구현. AI/데이터 담당 BLOCKED |
| ai/artifacts/drift_classifier.joblib, training_report_*.json(또는 --output/report) | 학습 코드·메타/제외 Window 지원, 완전한 원본→가중치 lineage 없음 | 재학습·이전 Artifact 폐기/대체 증거 필요. 파일/가중치 변경 안 함 |
| ai/models/saved_models, MODEL/CONTEXT 경로, Compose ai-models 볼륨 | 다운로드된 기초 모델 경로; 이번 환경에는 로컬 Qwen 파일 없음 | 참여자 데이터 반영 여부를 가정하지 않음. 모델 영향 미확인 시 PURGED 금지; AI |
| Compose mysql-data 볼륨/운영 DB·서버 캐시 | 배포 설정에 존재하나 이번 작업은 접근하지 않음 | 백업 위치/관리자/복원 정책 확인 필요; 운영 담당 |
| Export JSONL/manifest·라벨링·공유 사본 | v2 문서/Schema 설계는 존재; 제품 Export/수신자/사본·참여자 관리 시스템은 없음 | 가짜 시스템을 만들지 않음. EXPORT_COPIES의 미확인 증거 BLOCKED; 데이터 담당 |
| /private/tmp/focus93-* 및 이번 Chrome 임시 프로필 | 이번 합성 wire/테스트 산출물만, 실제 사용자 데이터 아님 | 테스트 증거이며 운영 삭제 증거로 사용하지 않음 |
| 파일/DB 백업·외부 공유 | 제품 백업/수신자 프로토콜·Tombstone 복원 도구 없음 | BACKUPS/LOG_COPIES BLOCKED. 외부 미응답·위치 미확정도 미완료 |

복원 절차 선결: 복원 서비스의 읽기·분석·Export를 닫고, 백업과 별도로 보존/검증된 최신 Tombstone·privacy revision/회수 작업 대장을 재적용한 다음 원본 재유입·늦은 결과 차단 및 미완료 작업 복구를 검증해야 한다. **이 절차의 제품 도구/백업 복원 실증은 이번 구현에 없으며 통과라고 보고하지 않는다.** 과거 백업만 복원하면 Tombstone도 사라질 수 있다. 백업·모델 영향 확인 없이 PURGED는 불가능하다.

## 16. PURGED 판정과 미충족 항목

`RetractionWorkService.completion()`은 항상 QUARANTINED와 미충족 목록을 반환한다. 승인된 범위/보존 정책·책임 검증자·전체 삭제 증거·AI GPU/모델 영향은 코드에서 미충족으로 고정한다. 미확인 대상도 별도로 열거한다. 모든 Mock 대상 상태를 VERIFIED로 바꿔도 운영 PURGED 전이는 없다.

미충족: 운영 소유권/인증, 승인 범위, BE skeleton/감사 메타 보존 범위, FE 원문 폐기, 전 Worker/메모리, 로그, Export 수신자, 라벨/학습 캐시/Artifact 영향, 백업/복원, 실명 담당자 및 외부 삭제 확인이다. 기관/개인정보 담당의 정책·동의·보존/연구심의 적용 근거와 팀 활성화 결정이 필요하다.

## 17. 실제 테스트 명령·결과

환경: macOS arm64, Node25.9.0/npm, Vitest3.2.7/Vite7.3.7, Gradle9.7.1, launcher Temurin25.0.2/toolchain21.0.10, Spring Boot4.1.1, Python3.11 테스트 venv, H2 MySQL mode, **별도 Docker MySQL8.4.9 loopback3393**. 운영 DB/기존 컨테이너 데이터·실사용자 자료를 쓰지 않았다.

수정 전 Baseline: FE34파일/877 passed; AI220 passed·경고1; BE JUnit726건/실패0/오류0/환경 skip49(실행677). MySQL/별도 AI가 없는 baseline을 최종 전체 실행과 혼동하지 않는다.

최종 실행 집계:

| 검증 | 결과 | 증거/범위 |
| --- | --- | --- |
| FE 일반 Vitest | 886 passed, 1 skipped, 실패0 | 새 HTTP E2E는 별도 BE 실행이 없으면 skip; 기존877 포함 |
| FE 실제 HTTP E2E | 별도1 passed | JUnit이 실제 Spring을 띄우고 FE Runtime/테스트 IDB를 호출 |
| FE typecheck·production/synthetic build | PASS | v1 제품 entry와 별도 합성 build 유지 |
| Chrome v2 합성 | PASS | 실제 MV3·IDB, Worker/완전 브라우저 재시작·손상 ACK·동일 회수 ID replay·격리 지속. HTTP는 Mock |
| Chrome v1 합성 | PASS, native multi-window 1 skip | 기존 세션 생성·응답 유실·Worker 복구·같은 키 replay·종료 순서 |
| BE 전체 | 892건, 실패0/오류0/skip0 | H2/MySQL 각 회수65건(기존 공통46 재실행+신규19), 재시작·실제 HTTP·V13 이관·기본 거절 포함 |
| AI 전체 | 233 passed, 경고1, skip0 | 기존220+신규13. 모델 독립 구성/Mock 추론·Journal/별도 프로세스 |
| 실제 Qwen 스모크 | SKIPPED | torch/transformers/sentence-transformers·로컬 가중치 없음; modelLoaded=false/inferenceExecuted=false |
| 계약 | Schema30정의/80사례/reference139/규칙216/κ4·Markdown10/링크186 PASS | 문서 reference 검증은 제품/외부삭제 증거 아님 |

재현 명령(저장소 루트; DB와 fixture 서버 준비 필요):

```sh
npm ci --prefix fe
npm --prefix fe test -- --reporter=dot
npm --prefix fe run build
npm --prefix fe run build:synthetic
/private/tmp/focus87-ai/bin/python -m pytest ai/tests -q --tb=short \
  --junitxml=/private/tmp/focus93-ai-final.xml
/private/tmp/focus87-ai/bin/python docs/contracts/v2/validate.py
/private/tmp/focus87-ai/bin/python ai/smoke_v2.py
# HTTP/Chrome 테스트 산출물 생성 후 실행
/private/tmp/focus87-ai/bin/python be/src/test/python/validate_retraction_evidence.py
# 새 격리 컨테이너: 운영/기존 볼륨을 연결하지 않는다.
docker run --name focus93-mysql-synthetic --detach \
  --publish 127.0.0.1:3393:3306 \
  --env MYSQL_ROOT_PASSWORD=synthetic-test-only --env MYSQL_DATABASE=focus93 mysql:8.4
docker exec focus93-mysql-synthetic mysql -uroot -psynthetic-test-only \
  -e 'CREATE DATABASE IF NOT EXISTS focus85; CREATE DATABASE IF NOT EXISTS focus89; SELECT VERSION();'
AI_V2_PROFILE=synthetic-test AI_V2_ENABLED=1 \
  /private/tmp/focus87-ai/bin/python be/src/test/python/v2_http_fixture.py \
  --port 8893 --retraction-journal /private/tmp/focus93-ai-live-journal.sqlite \
  --retraction-secret synthetic-service-only-secret-93-0123456789
# 별도 셸, be 디렉터리
JAVA_HOME=/Users/hyeon/Library/Java/JavaVirtualMachines/temurin-25.0.2/Contents/Home \
FOCUS85_MYSQL_URL='jdbc:mysql://127.0.0.1:3393/focus85?serverTimezone=UTC' \
FOCUS89_MYSQL_URL='jdbc:mysql://127.0.0.1:3393/focus89?serverTimezone=UTC' \
FOCUS93_MYSQL_URL='jdbc:mysql://127.0.0.1:3393/focus93?serverTimezone=UTC' \
FOCUS89_AI_URL=http://127.0.0.1:8893 FOCUS93_AI_URL=http://127.0.0.1:8893 \
./gradlew test bootJar --console=plain
# fe 디렉터리: 설치된 Chrome for Testing 실행 파일 지정
CHROMIUM_PATH='<Chrome executable>' npm run test:browser
CHROMIUM_PATH='<Chrome executable>' npm run test:v2:browser
# 루트
git diff --check
```

초기 실패도 구분한다. FE의 저장 abort 테스트에서 처리되지 않은 Promise 오류를 발견해 catch 경계와 storage fail-closed를 수정했다. BE 신규 알림 테스트의 DRIFT/표시 시각 입력 오류를 수정했다. 첫 실제 HTTP는 sandbox bind 차단으로 AI 서버가 없어서 실패했고 서버 준비 후 재실행했다. 전체 테스트 중 기존 v2의 endpoint 없음404 기대 두 건은 새 기본 거절401로 수정했다. Chrome의 socket-drop은 브라우저 자체 replay 때문에 실패 상태 관측이 불안정하여, 첫 요청의 ACK 필드를 손상시키고 복구 시점까지 고정하는 Mock으로 변경했다. 실제 ACK 유실/멱등성은 단위/실제 3계층 HTTP에서도 별도 확인했다. sandbox 권한 실패 및 자동 승인 검토 사용량 제한으로 실행되지 않은 첫 v1 Chrome 시도는 PASS에 포함하지 않았으며 이후 재실행했다.

## 18. Mock·합성·실제 DB 검증 구분

실제 FE Runtime→HTTP Spring/H2→HTTP FastAPI→SQLite 전파와 BE 합성 Payload 제거/접근 차단을 검증했다. FE의 이 통합 실행은 fake-indexeddb이며 실제 Chrome 검증과 별개다. 실제 Chrome 검증은 Mock HTTP이고, 실제 MySQL 검증은 Spring 서비스/MockMvc와 합성 AI HTTP 응답을 사용한다. FastAPI의 Composition/Schema/Registry/PageAnalysisModel 코드는 실제지만 Embedding/Context는 FakeEmbedding/FakeContext다. 실제 모델·외부 저장소 삭제·운영 개인정보 삭제를 검증하지 않았다.

HTTP 합성 증거는 `/private/tmp/focus93-http-evidence/fe.json`, `be-targets.json`; Chrome 회수 증거는 `/private/tmp/focus91-mock-evidence/retractions.json`이다. 테스트 로그/JUnit은 `/private/tmp/focus93-*` 및 `be/build/test-results/test`다. `validate_retraction_evidence.py`로 실제 HTTP 요청3개/ACK4개와 실제 Chrome 회수5개를 공통 Schema에 재검증하고 외부 대상 BLOCKED를 확인했다. production JAR에 테스트 인증/삭제 설정이 없음을 검사했다. Git에는 테스트 원본/명령만 포함하며 이 임시 증거를 실제 사용자 삭제 증빙으로 제출하지 않는다.

## 19. 기존 v1/v2 회귀

FE 기존877·AI 기존220·BE 기존 공통 계약과 v1 테스트를 유지했다. 기존 v2 async pipeline/dirty 판단·표시 ACK·상태 조회·MySQL 제약·재시작 테스트도 전체 실행에 포함했다. 공통 Fixture·Schema·V1~V12는 원문 불변이다. v1 IDB 보존 테스트 및 v1 Chrome 세션 회귀를 재실행했다. 기존 데이터 재해석·v2 오류의 v1 fallback은 없다.

## 20. 실제 사용자 수집 BLOCKED인 이유

운영 세션 소유권/인증, 참여자 동의·연결표, 보존기간/최소 Tombstone 범위, 기관 절차/연구심의 적용 근거, FE 삭제, 외부 사본·학습 영향·백업 복원 증거가 없다. 이 PR은 합성 환경의 기술 연결이며 실제 사용자 수집/공유/학습/배포 승인이 아니다. production FE v2 진입점·삭제 정책·공개 인증 우회·PURGED 활성화를 제공하지 않는다.

## 21. 후속 작업·승인 선결

운영 인증/세션 소유자 모델과 철회 권한 승인, 책임자·승인 범위/보존 정책, FE 안전 폐기·최소 영수증·완료 확인 계약, AI 다중 호스트 조정/전 Worker 증거·GPU/메모리 한계 검토, Export 수신자/라벨/학습/Artifact lineage, 백업 대장·격리 복원/Tombstone 재적용 훈련이 필요하다.

전체 동의 철회는 개별 Visit reasonCode=CONSENT_WITHDRAWN과 다르다. 현재 참여자/동의/세션 연결이 없어 운영용 가짜 참여자 ID·전체 삭제 API를 만들지 않았다. 후속에서는 인증된 참여자→모든 세션/Visit→Window/분석/라벨/Export/학습/사본을 열거하고 부모 철회 작업+자식 Visit 작업의 영속 멱등·부분 실패 격리·전체 증거 집계를 설계해야 한다. 현재 경계는 개별 Visit/현재 로컬 세션의 보수적 격리다.

미검증: 실 Qwen/GPU 연산 취소·메모리 소거, 다중 호스트, OS kill/실디스크 full, 실제 MySQL daemon 재시작, 운영 백업 복원/수신자 응답/모델 재학습, 네이티브 플랫폼별 수집 안전성·일반 사이트 DLP 완전성이다. 별도 후속 Issue는 자동 생성하지 않았다.

## 22. Commit

한국어 Commit 메시지로 요청 브랜치에만 기록한다. 최종 Commit SHA는 최종 채팅 보고와 PR의 head commit이 기준이다. 자기 자신의 SHA를 이 문서에 넣어 재귀 Commit을 만들지 않는다.

## 23. Fork Push

개인 Fork origin의 `feat/93/v2-privacy-retraction`에만 일반 Push한다. 확정 결과와 SHA는 최종 채팅 보고를 따른다. upstream/main에는 Push하지 않는다.

## 24. PR

공식 Repository main 대상, 제목 `[Feat/#93] v2 개인정보 회수·삭제 전파 및 안전성 검증`, 저장소 템플릿으로 제출한다. 권한 문제가 있으면 Fork Push 후 Compare URL과 본문을 제공한다. 자동 Merge하지 않는다. 확정 URL은 최종 채팅 보고를 따른다.

## 변경 경로 전체

- `ai/tests/test_retraction_journal.py`
- `ai/v2/retractions.py`
- `ai/v2/service.py`
- `be/src/main/java/com/focusrecovery/domain/privacy/controller/PrivacyRetractionController.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/entity/RetractionTarget.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/repository/RetractionTargetRepository.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/service/PrivacyRetractionService.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/service/RetractionAuthorization.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/service/RetractionDispatcher.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/service/RetractionExecutionPolicy.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/service/RetractionWorkService.java`
- `be/src/main/java/com/focusrecovery/global/exception/GlobalExceptionHandler.java`
- `be/src/main/resources/db/migration/V13__privacy_retraction_evidence.sql`
- `be/src/test/java/com/focusrecovery/domain/integration/V2RetractionContract.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2RetractionMySqlTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2RetractionTest.java`
- `be/src/test/java/com/focusrecovery/domain/privacy/RetractionLiveHttpTest.java`
- `be/src/test/java/com/focusrecovery/domain/privacy/RetractionRestartTest.java`
- `be/src/test/java/com/focusrecovery/domain/privacy/SyntheticRetractionConfiguration.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V12MigrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V13MigrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2DisabledTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2StorageContract.java`
- `be/src/test/python/v2_http_fixture.py`
- `be/src/test/python/validate_retraction_evidence.py`
- `docs/ai-spec.md`
- `docs/be-spec.md`
- `docs/contracts/v2/README.md`
- `docs/data-analysis-contract.md`
- `docs/data-collection-spec.md`
- `docs/data-contract-validation.md`
- `docs/fe-spec.md`
- `docs/v2-contract-approval.md`
- `docs/v2-contract-decisions.md`
- `docs/v2-privacy-retraction-validation.md`
- `fe/scripts/v2-browser-test.mjs`
- `fe/src/v2/repository.ts`
- `fe/src/v2/retractions.ts`
- `fe/src/v2/runtime.ts`
- `fe/src/v2/state.ts`
- `fe/tests/v2-contract.test.ts`
- `fe/tests/v2-retraction-http.test.ts`
- `fe/tests/v2-runtime.test.ts`
