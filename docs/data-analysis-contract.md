# 데이터 수집·분석 공통 연동 계약 — Issue #79 / #81 / #83

> #81 검토 기준: 공식 main `6e15dd3fa1789e96c42bc4f33250c4221d6d2616` (2026-11-10 KST). **P1~P6와 아래 v2 API는 PROPOSED**, 승인 근거 없음. 세부 결정·대안·현행 코드 대조는 [v2 결정안](v2-contract-decisions.md), 기계 검증 타입은 [계약 패키지](contracts/v2/README.md)가 이 문서의 초안 타입보다 우선한다. 제품 코드·DB 변경 없음.

> #83: 공식 main `a1a5d97`에서 재대조했다. [승인 요청 대장](v2-contract-approval.md)의 P1~P6는 전부 PROPOSED, P2/P6 선결은 BLOCKED다. 과거 PR 병합을 정책 승인으로 해석하지 않는다.

## #85 저장 구현의 적용 범위

이 문서의 #79/#81/#83 기록은 당시 기준이다. #85에서 V11과 Java 저장 기반을 추가했다. 실제 범위는 [구현·검증 보고](be-v2-storage-foundation-validation.md)가 우선하며 아래 제안 전체의 완료를 뜻하지 않는다. collectionSpecVersion 미지정=1.0, 신규 v2=2.0, 같은 키의 목표+버전 비교, 세션 중 버전 변경 금지다. v2는 기본 false이며 정확히 test 프로필+명시 flag에서만 동작한다.

수신 watermark/구성 cursor/privacy revision을 분리했다. tail+신규 identity stream을 영속 job에 고정하고 AI 구성 결과를 검증해 Window·분석·Outbox·Receipt·cursor를 원자 저장한다. 상태 이력은 계산 결과만 저장하며 최신 행동 snapshot과 성공 분석의 소속을 잠금 안에서 확인한다. 회수는 내부 QUARANTINED/tombstone/inventory만이며 공개 API·실제 삭제·PURGED 전이는 없다. P1~P6 PROPOSED/P2·P6 BLOCKED를 유지한다.

기존 버전 없는 API/v1 data는 보존한다. v2 분석 조회 projection·알림·AI HTTP/결과 변환·자동 판단 worker는 후속이며 legacy 경로의 v2 사용은 명시 거절한다. v2 실패를 v1로 저장하지 않는다. extraction_status의 기존 NULL은 legacy 미확인으로 남긴다.

## 1. 기준·근거·변경 상태

### #87 AI 구현 적용 범위

공식 main `37706428`에서 `POST /api/ai/window-compositions`와 기존 analyses의 v2 분기를 합성 테스트 전용으로 구현했다. 공통 Schema/Fixture는 변경하지 않았다. [AI v2 검증 보고](ai-v2-window-analysis-validation.md)에 파일·모델 경로·명령·미검증 품질·BE 후속 작업을 기록한다. v1의 5방문/확률 DTO·학습 산출물은 유지한다.

AI는 Schema로 DTO를 검증하고 canonical SHA256을 재계산한다. ordered stream에서 인접3개를 직접 선택한다. BE의 Composition DTO·V2AnalysisInput/Completion과 필드가 일치하며, 실제 HTTP Client/dispatcher·소유권/회수 전파·최종 상태 계산은 후속이다. AI의 요청 내부 tail 개수/커서/순서 검사와 BE의 DB prefix 누락/진짜 tail 검사를 구분한다.

v2는 기본 비활성이다. `AI_V2_PROFILE=synthetic-test`와 `AI_V2_ENABLED=1` 조합만 허용하며 운영 활성화 옵션이 아니다. P1~P6 PROPOSED와 개인정보 BLOCKED는 그대로다. 내부 캐시 무효화 hook은 전체 회수/삭제 완료가 아니다. Registry와 격리 집합은 프로세스 메모리이며 재시작 후 BE의 영속 격리 검사가 필요하다.

- #79 당시 분석 이력(현재 작업 Git 상태와 구분): 2026-11-10 KST, 공식 main `d0d40f892a8ed54253a12884fb6f64a149272f27`. 시작 worktree는 detached `5e49cb3`, 변경/미추적 파일 없음. origin=개인 Fork(hyeon-marina), upstream=공식 저장소. 같은 이름의 로컬/원격 브랜치 없음 확인 후 `docs/79/data-collection-analysis-contract` 생성.
- #79 당시 Issue 실제 본문·댓글 0건 확인. 당시 관련 open Issue는 #79만, open PR은 없음. #81 현재 상태·Git 준비는 [결정안 §1](v2-contract-decisions.md#1-상태와-검토-기준) 참조. 아래 PR은 main 병합 로그로 확인했다. 별도 AGENTS.md/CONTRIBUTING/Git 가이드는 발견되지 않았다. project-plan의 develop 통합 방침과 달리 이번 제출은 사용자의 명시적 공식 main 대상 PR 지시를 따른다. main 직접 commit/push/merge는 하지 않는다.
- [수집 규격](data-collection-spec.md)은 이번 작업에서 유지할 설계 요구의 기준이다. 명시적 팀 승인은 별도 대장을 따른다. 이 문서의 **P1~P6 및 v2 API/DB 명칭은 구현 검토 제안**이다. 문서 PR 승인과 별개로 후속 Issue에 선택 결과를 기록해야 한다. 구현 완료·팀 합의·실제 배포로 읽지 않는다.

| 근거 | 현재 구현/검증 | #79 영향 |
| --- | --- | --- |
| #9/PR #15, #21/PR #22, #26/PR #28 | FE 1초 유효성, 검색 추출, finalized 이후 sequence | 5초 전달·4초 복귀와 충돌 |
| #32/PR #33, #43/PR #45, #46/PR #47 | 방문별 누적 행동·POST/PATCH ACK·동결 재시도 | 유지, 5분 트리거 추가 |
| #48/PR #50, #51/PR #52 | IndexedDB aggregate·복구·END_PENDING | 보존 필수, checkpoint 버전 전환 필요 |
| #23/PR #24, #25/PR #35, #36/PR #37 | BE 5개 Window·10초 준비·비동기 분석·조회 | AI 구성/BE 최종 판단·이력으로 변경 |
| #39/PR #40, #41/PR #42, #44/PR #49 | 최신 Window DRIFT 후보·표시 ACK·응답 저장 | stateVersion 연결 확장, 기존 복구 유지 |
| #55/PR #57, #56/PR #58, #59/PR #61 | E2E, 5,000 code points, 실제 검색·권한 검증 | 과거 5개 Window PASS를 v2 근거로 쓰지 않음 |
| #60/PR #62, #64/PR #65, #67/PR #70, #74/PR #76 | 검색 DOM·권한 재허용 순서·기존 문서·Popup 안내 수정 | 결함이 아직 미수정이라고 보고하지 않음; 보호 경로 유지 |
| #66/PR #68, #69/PR #71, #72/PR #73, #77/PR #78, PR #75 | 학습 분류기·AI-API-01·텍스트 임베딩 캐시·Context 경로·HTTP/1.1 수정 | 기존 API는 이미 연동됨. 3개·페이지 라벨 계약으로 바꿔야 함 |

관련 자료: [Issue #79](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/79), [PR #78](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/pull/78), 저장소 `git log`, [E2E](fe-collection-e2e-validation.md), [실제 검색](real-search-permission-e2e-validation.md), [Unicode](unicode-content-length-validation.md), [권한 재허용](permission-regrant-sequence-fix-validation.md), [기존 문서 권한](active-page-permission-fix-validation.md), [권한 안내](permission-denial-feedback-fix-validation.md). 보고서의 FAIL/BLOCKED와 후속 수정 결과를 구분한다. Google CAPTCHA·Windows Stable·일반 결과 증분 DOM 등 기존 검증 한계를 이번 문서 작업에서 해결했다고 주장하지 않는다.

## 2. 코드 대조 및 변경 전후

경로의 BE 패키지 기준은 `be/src/main/java/com/focusrecovery/`다. 아래는 **후속 수정 대상**이며 이번 변경은 문서만이다.

| 실제 파일/구조 | 현재 | 변경 후 계약 |
| --- | --- | --- |
| fe/src/background/collector.ts | >=1000, MAX_CANDIDATES=200, 탭 복귀·reload 무조건 유지, 열린 후보가 순서 차단 | >=5000, 4초 경계, 지속 수집, P1/P2 |
| active-time.ts, index.ts | 이벤트로 누적·버전 증가, recovery alarm; 정확한 5초/5분 타이머 없음 | 이벤트/타이머 양쪽에서 임계 통과 영속 기록. 관측 불가 시간 미가산 |
| durable-state.ts | valid>=1000 검증, aggregate checkpoint 검증 | 버전별 검증·전환. 구버전 원본 보존 |
| visit-delivery.ts, behavior-delivery.ts, session-end.ts | 1000 검증, 동결 POST/PATCH, ACK 의존, retry budget, END_PENDING | 5000 검증·P3. 전송/종료 복구 구조 유지 |
| fe/src/content/{index,extraction,search}.ts; shared/{url,content-change}.ts | SPA identity/DOM, 일반 50자·검색 기준, 5000 code points | 캐시 재검증·EXTRACTION_FAILED 별도 경로. URL 보호 유지 |
| fe/src/api/{types,session,visit,behavior,session-end}.ts | 기존 세션/방문/행동 API 및 응답 검증 | 경로 유지, 버전·진단/이력 DTO 확장 |
| domain/session/{controller/WorkSessionController,service/WorkSessionService}.java | Idempotency-Key, strip 목표 5~150자, ACTIVE/ENDED, finalBehaviors 원자 처리 | 유지. 종료 전 분석 큐와 새 상태 판단을 drain/기록 |
| domain/visit/{controller/PageVisitController,service/PageVisitService,entity/PageVisit,dto/*}.java | POST>=1000, 본문 null 허용, 원본/순서 409, PATCH 버전/누적 검증 | v2 POST>=5000+성공 추출, 순서 계약 P2, P3 재판단 트리거 |
| domain/window/service/AnalysisWindowService.java | WINDOW_SIZE=5, BE가 멤버 구성, 세션 잠금 | AI 구성 응답 검증·ID 발급·저장, 3개. 오래된 신규 sequence 차단을 저장 watermark로 이전 |
| domain/analysis/service/AnalysisRequestService.java | >=10000 또는 종료, 마지막 방문 기준, 입력 스냅샷 | 3개 Window 저장 직후 분석, 체류 갱신은 기존 Window 판단만 |
| AnalysisExecutor.java, AnalysisRecovery.java | commit 후 PENDING→RUNNING→완료/실패; 자동 AI 재시도 없음, timeout 복구, DRIFT 알림 작업 | 소유권·실패 보존 유지. AI 결과 검증 후 BE ruleVersion 판단, stateVersion 단위 알림 |
| domain/analysis/client/{AiAnalysisClient,AiAnalysisRequest,AiAnalysisOutcome}.java | /api/ai/analyses, 5 visits, IDs·확률합 허용오차·시각 검증 | P4 구성 API 및 v2 3 visits·페이지 결과 검증. HTTP/1.1 유지 |
| domain/analysis/{entity/AnalysisResult,dto/*,service/AnalysisQueryService}.java | Window당 결과 1개·확률·input_snapshot | AI 원본은 보존, BE 상태는 별도 이력; 조회에 버전/최종상태 추가 |
| domain/alert/service/{AlertService,AlertDisplayService,AlertTaskProcessor}.java | analysisId UNIQUE, 최신 windowIndex, 연속 DRIFT·최소 간격·실제 표시 확인 | latest windowIndex + stateVersion 확인; 실패를 복귀로 보지 않음. P5 |
| ai/main.py | /api/ai/analyses, 정확히 5개 position, registry 최근1000 메모리, 실패 재요청 가능; searchQuery는 DTO 수신 후 모델 PageVisit으로 전달되지 않음 | P4 구성 + 3개 페이지 예측 계약, BE 영속 멱등과 연계 |
| ai/pipeline.py, models/context.py | WINDOW_SIZE=5/stride1; Context FOCUSED/JUSTIFIED_DETOUR/DRIFTING | AI가 3개 구성·페이지별 label/rationale 반환. 중간 상태를 페이지 정답으로 단순 치환 금지 |
| ai/models/embedding.py | Qwen3 embedding, title/content cosine, 텍스트 SHA-256 LRU | 재사용 가능. cosine은 [-1,1], 확률 아님. 버전·입력 해시로 재현 |
| ai/models/classifier.py | 학습 predict_proba, γ 이상 DRIFT, 나머지 동률 NORMAL | 운영 최종 판단은 BE 규칙. 기존 분류기·확률은 legacy 실험/비교로 보존 |
| ai/training/{dataset,train,compare}.py | 5개 Window candidateLabel/UNREVIEWED, 세션 LOSO·nested 평가, Context 캐시 | v2 페이지/이력 라벨 loader와 목표12/4/4 분리; 이번 학습 없음 |
| db/migration/V1~V10 | 아래 §8 참조 | 기존 파일 변경/실행 없음, 새 migration만 제안 |

기존 테스트의 경계·기대값·관련 검증 보고서를 대조했다: FE collector/sequence/behavior/visit-delivery/behavior-delivery/durable-state/durable-background/session-end 계열, BE PageVisitApiTest/WorkSessionEndApiTest/AnalysisWindowTest/AnalysisIntegrationTest/AnalysisRecoveryTest/AnalysisQueryApiTest/AiAlertCandidateTest/AlertDisplayTest. AI에는 추적된 tests 디렉터리/자동 테스트 파일이 없으며 training·benchmark 코드의 검증 경로를 확인했다. 기존 fixture의 1000/5개/10000 기대값은 **현재 구현 회귀**이며 이번에 임의 수정하지 않는다.

## 3. 공통 타입 및 기존 API 유지 범위

JSON 필드는 camelCase, SQL은 snake_case다. UUID는 문자열 36자, 시각은 RFC3339 UTC 밀리초 `2026-11-10T00:00:00.000Z`, 카운터는 정수다. int64는 FE에서 Number.isSafeInteger 범위(0~9,007,199,254,740,991), int32는 0~2,147,483,647로 제한한다. 오버플로를 순환시키지 않는다.

| API | 현재/유지 계약 | v2 차이 |
| --- | --- | --- |
| POST /api/sessions | goalText 필수 string 5~150, BE strip, 선택 Idempotency-Key(1~255); 201 동일 재요청; 목표 불일치422 | collectionSpecVersion 선택 필드 추가 제안. 신규 v2 FE는 필수 전송 |
| GET /api/sessions/{sessionId} | 200 sessionId/goalText/startedAt/endedAt/status | 버전 반환 |
| POST /api/sessions/{sessionId}/visits | FE visitId, sequence, browserTabKey, normalizedUrl/domain, visitedAt, 행동 누적값; 201 신규/200 동일 원본 | v2 최소5000, extractionStatus=SUCCESS, title/content 필수(제목은 빈 문자열 가능), searchQuery 명시 null 허용 |
| PATCH /api/sessions/{sessionId}/visits/{visitId}/behavior | activeDurationMs:int64, tabSwitchCount:int32, behaviorVersion:int64 모두 필수; 200 applied 및 최신 누적값 | 본문 유지, BE가 5분 통과를 계산. sourceEvent 추가 불필요 |
| POST /api/sessions/{sessionId}/end | 선택 finalBehaviors, 같은 버전/누적 규칙, 원자성, 이미 ENDED면 기존200 | 유지. 분석 실패가 세션 종료를 실패시키지 않음 |
| GET /api/sessions/{sessionId}/analysis-status, /analyses, /analyses/{analysisId} | 현재 분석 조회·페이지네이션 보존 | 기존 확률은 legacy nullable, 최신 stateVersion/finalState/judgedAt/decisionStatus 추가 |
| 알림 후보·shown·response·history API | 기존 alertId·실제 표시·최초 선택·FIXED_INTERVAL 연결 유지 | AI 유형에 windowId/stateVersion 추가. analysisId도 원본 분석 추적용으로 유지 |

sessionId는 방문 POST의 path에 있으며 body에 중복 필수가 아니다. AI/Export에는 명시한다. searchQuery 일반 페이지 null, 검색 페이지 string; isSearchResultPage:boolean 필수(v2), visitedAt은 최초 방문 관측 시각이며 startedAt(세션)과 구분한다. 수집 searchQuery/title 기존 FE 최대500 code points, URL8192 UTF-16 code units·domain253자 제한을 유지한다. BE의 더 넓은 상한을 FE 확대 허가로 해석하지 않는다. title/normalizedUrl 기존 BE 상한16383, domain255, content5000 code points 유지.

원본 POST의 sessionId·sequence·browserTabKey·URL/domain·title/content·searchQuery·검색 여부·visitedAt은 재전송에서 불변이다. 원본 비교에서 행동값은 제외하는 기존 구현을 유지한다. 재전송 200에 더 최신 행동 ACK가 오면 로컬 값과 비교하고 감소시키지 않는다. 다른 세션 visitId는 VISIT_ID_CONFLICT, 같은 sequence 다른 visitId는 VISIT_SEQUENCE_CONFLICT다.

## 4. 추가 필드·이벤트 사전 (제안)

`필수`는 v2 송수신 시 기준이며 legacy에는 null/기존 기본값을 허용한다. 저장 장소는 후속 migration의 논리 이름이며 구현된 테이블이 아니다.

| 필드/타입 | 필수·생성 주체 | 저장 위치·목적 |
| --- | --- | --- |
| collectionSpecVersion:string, `2.0` | 신규 세션 필수·FE, BE 지원값 검증 | work_session 및 checkpoint/Export; 한 세션 안 정책 혼용 방지 |
| apiContractVersion:int32, `2` | BE↔AI 필수·BE | compose_request/analysis_result.input_snapshot; wire 분기 |
| extractionStatus:SUCCESS | 유효 POST 필수·FE | page_visit; 실패를 성공 데이터와 구분 |
| failureId:UUID, status:EXTRACTION_FAILED, observedAt:timestamp | 진단 필수·FE | collection_failure; 민감 원문 없는 추출 실패 |
| candidateId:UUID, browserTabKey:string, activeDurationMs:int64, reasonCode:string | 진단 필수·FE | collection_failure; 실패 관측 추적, sequence는 없음 |
| composeRequestId:UUID, afterSequence:int32 | 구성 요청 필수·BE | compose_request; 요청 멱등·커서 CAS |
| afterSequence:int32, composedThroughSequence:int32 | 응답 필수·AI | compose_request/session 분석 커서; 일부 실패 때 전진 금지 |
| visitIds:UUID[3], endVisitId:UUID | 구성 응답 필수·AI | window_visit, analysis_window; 실제 멤버 구성 |
| windowId:UUID, windowIndex:int32 | 구성 검증 후 필수·BE | analysis_window; 구성 로직은 AI, 식별/저장은 BE |
| pageResults:{position,visitId,label,semanticRelevance,rationale}[] | 분석 성공 필수·AI | analysis_result.page_results JSON; 페이지별 예측 |
| modelVersions:map<string,string>, analyzedAt:timestamp | 성공 필수·AI | analysis_result; embedding/context/prompt 등 버전, AI 완료 시각 |
| stateVersion:int64, judgedAt:timestamp, ruleVersion:string | 판단 필수·BE | window_state_history; window별1부터, BE 판단 시각 |
| behaviorSnapshot:{visitId,activeDurationMs,tabSwitchCount,behaviorVersion}[] | 판단 필수·BE | window_state_history JSON; 판단 당시 값, 순서대로3개 |
| finalState:NORMAL/TRANSITION/DRIFT | 성공 판단 필수·BE | window_state_history. 실패/대기는 성공 이력 없이 조회에서 null |
| decisionStatus:PENDING/COMPLETED/FAILED/INVALIDATED, errorCode:string/null | 조회 필수·BE | 분석/판단 작업 상태; NORMAL과 실패 분리 |
| inputFingerprint:string(SHA-256), analysisId:UUID | 필수·BE | 분석/판단 멱등. 이력의 fingerprint는 AI ID+ruleVersion+행동 스냅샷으로 계산 |
| datasetVersion/labelGuideVersion:string | Export 필수·데이터 담당 | manifest·라벨; 운영 정책/모델 버전과 독립 |

제안 진단 API: `POST /api/sessions/{sessionId}/collection-failures`, 위 failure 필드, 201 신규/200 동일 failureId·payload/409 다른 내용. normalizedUrl·본문·Query·민감 DOM은 필수도 전송 대상도 아니다. sessionId는 path, candidateId는 visitId 후보 UUID이며 유효 page_visit FK를 요구하지 않는다. 확정 전 진단은 로컬에서 보존하며 기존 visits POST에 실패 본문을 정상 방문으로 넣지 않는다. 보존기간·삭제 범위는 P6에서 결정한다.

## 5. P1~P3: 방문과 전송의 추가 설계

### P1. 4초·대상 동일성

수집 규격 §3의 leftAt/returnedAt·탭별·reload·SPA 경계를 권장한다. 같은 탭 A→B→A의 A는 짧은 복귀 캐시에서 찾는다. 시계는 한 Worker 안에서는 단조 경과시간을 사용하고 영속 시각도 남긴다. 재시작/시계 변경으로 간격을 입증할 수 없으면 자동 누적하지 않는다. 장점은 탭 간 체류 오염 방지, 단점은 앱 전환/느린 reload도 새 방문을 만들 수 있다는 점이다. 대안은 앱 비활성을 복귀에서 제외하는 방식이며 수집 수량·체류 분포가 달라진다. **FE·데이터 담당이 파일럿으로 승인할 사항**이다.

### P2. 5초 전달과 sequence

권장안: 활성 5초+콘텐츠 성공 순간 Background 직렬 트랜잭션에서 sequence를 부여하고 POST 원본을 영속 동결한다. sequence는 **유효성 확정 순서**, visitedAt은 시작 시각으로 분리한다. 같은 시각에는 직렬 처리 순서를 쓴다. 열린 탭 종료를 기다리지 않아 5초 전달이 가능하다. 이후 행동만 PATCH하며 재복귀해도 기존 번호를 바꾸지 않는다. 후보가 제외되면 번호를 소급 채우지 않는다. 권한 재개 시 기존 발급 상한을 보존하고 공백을 허용한다(PR #65). #81 권장안은 첫 Window 이전에도 BE 신규 sequence가 수신 high watermark보다 커야 한다. 현재 첫 Window 전 역순 허용과 다른 동작이며 신규 v2에만 적용한다. tombstone/격리 검사가 원본 replay보다 우선하여 삭제 후 재전송 복원과 원문 ACK 반환을 차단해야 한다.

**변경 비용:** 기존 후보 시작 순서와 다르다. 예를 들어 A의 콘텐츠가 늦어 B가 먼저 유효해지면 B sequence1, A sequence2일 수 있다. 최근 탐색 흐름의 의미가 달라지므로 **FE·BE·AI·데이터 담당 승인 전 확정하지 않는다.** 대안은 후보 시작 순서 유지+앞 후보 결론까지 5초 전달 지연인데, Issue의 실시간 의도와 충돌한다. 다른 대안인 후보 순서와 분석 순서를 이원화하면 재정렬/Window 재구성 계약이 추가된다.

5초 전송 후 DOM 정책 변경은 기존 finalized 전 제외와 달리 서버에 이미 본문이 있을 수 있다. 현재 API에는 정정/삭제 구현이 없다. **서버 정정·개인정보 처리 방식을 별도 합의하기 전 조기 POST를 배포하지 않는다.** #81에서는 [P2 회수 계약](v2-contract-decisions.md#41-전송-후-민감-판정-이미-보낸-자료의-처리)에 격리→원문/AI snapshot/캐시/Export 회수·파생무효화·미존재ID tombstone·지연응답 차단까지 구체화했다. 이 회수 수단과 권한 체계가 배포 선결이다. 보호 검사를 제거하거나 기존 큐/영수증을 지워 해결하지 않는다. ACK 완료 자료 정리·짧은 복귀 캐시 수명·저장소 quota backpressure는 같은 후속 FE Issue에서 정한다.

### P3. 5분 통과

새 이벤트 endpoint 없이 기존 PATCH 누적값을 사용한다. FE는 5분 도달 알람/이벤트를 영속 큐에 넣고 BE는 잠금 안에서 old < 300000 <= new를 검출한다. applied=false면 새 판단을 만들지 않는다. 높은 버전만 적용한다. 임계 통과를 놓쳐 늦게 전송해도 최종 누적값으로 판단하지만 판단 시각은 과거로 조작하지 않는다. 이후 행동 갱신도 스냅샷 재현을 위해 판단 이력을 남길 수 있다(P5). 장점은 wire 호환, 단점은 네트워크 장애 시 실시간 알림을 보장하지 못함이다. FE·BE 승인 대상이다.

## 6. P4: AI 구성과 BE 식별·분석 흐름

#81 권장안 A는 **AI 구성→BE Window 저장→기존 분석 API v2**다(PROPOSED). 단일 API는 요청시점 Window FK가 없는 별도 작업·응답매핑 구조가 필요하다. 기존 BE 구성을 유지하는 C는 최신 책임 정책과 충돌한다. 비용/FK/복구 비교는 [결정안 §6](v2-contract-decisions.md#6-p4--ai-구성과-be-저장) 참조.

| 계약 | 필수 정보·의미 | Schema entry point |
| --- | --- | --- |
| Window 구성 요청 | apiContractVersion=2, composeRequestId/sessionId UUID v4, afterSequence>=0, inputFingerprint SHA256, visits(visitId/sequence만) | CompositionRequest |
| 구성 응답 | 같은ID/hash/after, composedThroughSequence=마지막 신규번호, windows(ordered visitIds[3],endVisitId). BE windowId/index 없음 | CompositionResponse |
| 분석 요청 | apiContractVersion=2, analysisId/sessionId/windowId/windowIndex, goalText, inputFingerprint, visits 3개(position1~3/visitId/sequence/title/content/searchQuery/isSearchResultPage/visitedAt) | AnalysisRequest |
| 분석 응답 | 같은ID/hash, pageResults 3개(position/visitId/label/semanticRelevance/rationale), modelVersions(embedding/context/prompt/labelGuide), analyzedAt | AnalysisResponse |

실제 필수·null·범위는 [v2.schema.json](contracts/v2/v2.schema.json)과 [필드 사전](contracts/v2/README.md)을 따른다. §3~4의 초안 필드 설명은 이 구체 Schema에 맞춰 읽는다. title/content/searchQuery는 분석에만 전달하고 구성은 ID/sequence만 전송한다. 일반 query=null, 검색query는non-null, 본문성공 필요. AI는 체류값을 받지 않으며5초 검증은 BE의 책임이다. label은 DIRECT/JUSTIFIED_DETOUR/UNRELATED, cosine finite[-1,1]이며 확률이 아니다. v2는 최종 result/확률을 반환하지 않고 BE가 판단한다.

구성 커서는 Window 끝번호가 아니라 처리완료 방문 high watermark다. 최초1~2개도 windows=[]/커서전진, 다음 요청에 직전 tail최대2+신규prefix를 포함한다. 입력1~256개는 제안 batch상한(수집총량 제한 아님), 숫자공백 허용·저장된 방문 누락 금지, 순서역전/중복422. AI는 인접3개/stride1 구성, BE는 전체 응답 검증·커서CAS 후 UUID/index 발급, Window/멤버/분석PENDING/outbox/커서/job완료를 원자 commit한다. 네트워크는 DB tx 밖이다. through는 마지막 신규sequence이며 부분성공·실패시전진 금지. 다른 원문으로 같은ID는409, 동결구성job은 bounded retry, commit후 재시작은 같은Window ID 재사용.

기존 analysis_result NOT NULL Window FK 때문에 Window 전 분석행 저장은 불가능하다. 별도 compose job에는 session FK만 두고 Window 저장 후 분석행을 만든다. 기존 UNIQUE(window_id)는 유지하고 체류변경은 분석 재요청 대신 P5 판단만 수행한다. AI 메모리 registry는 eviction/재시작으로 사라지므로 BE DB가 영속 멱등의 진실이다. 기존 BE 분석 자동재시도 없음/FAILED확정 뒤 지연응답 무시를 유지한다.

모델 출력 실패를 NORMAL/UNRELATED로 채우지 않는다. 같은 방문도 Window 맥락별 예측은 (analysisId,visitId)에 보존한다. #87에서 v2 searchQuery→임베딩/페이지 LLM 전달을 구현했으며 기존5개 학습분류기를 페이지라벨로 사용하지 않는다. v1 검색어 처리와 모델은 유지한다. API 오류코드/nullable/조회 projection은 [계약 패키지](contracts/v2/README.md)에 통일했다.

## 7. P5: 상태 이력·동시성·알림

수집 규격 §7의 조건 순서(오류→최신 관련/우회→연속3→1~2 중5분→연속2→연속1)를 적용한다. 연속은 최신 방문부터 역방향으로 DIRECT/JUSTIFIED_DETOUR 직전까지, 최대3개다. 과거의 긴 무관 페이지가 최신 DIRECT를 덮지 않는다. 실패한 페이지 결과를 NORMAL/UNRELATED로 채우거나 건너뛰어 성공 이력을 만들지 않는다. 추출 실패 관측은 유효 방문 수에 포함하지 않으며 그 자체로 상태 변경/연속 무관 리셋을 발생시키지 않는다. 다음 성공 Window는 유효 방문 순서로 분석하되 제외/실패 비율을 Export에서 함께 제공한다.

- `analysis_result`는 Window의 AI 분석 스냅샷·원본 결과를 보존한다. v2 최종 판단을 AI result 컬럼에 덮어써 출처를 혼동하지 않는다.
- `window_state_history`는 PK(window_id,state_version), FK analysis_id, judged_at, rule_version, final_state, behavior_snapshot, input_fingerprint를 갖는다. UNIQUE(window_id,input_fingerprint)로 중복 방지한다. 입력에 해당 Window의 고정 AI ID/결과·3개 행동 버전/값을 포함한다.
- 입력마다 이력을 남기는 안은 재현성이 높지만 같은 상태의 저장량이 늘어난다. 대안은 상태 전환/5분 통과만 기록하고 행동 이벤트 로그를 따로 보존하는 방식이다. P5 승인에서 저장량과 재현 범위를 함께 선택한다.
- BE 세션→Window 잠금 순서로 최신 행동값을 일관되게 읽고 max(stateVersion)+1을 같은 트랜잭션에서 발급한다. 네트워크 처리 중 잠금은 금지한다. 동일 입력 재시도는 기존 버전, 다른 입력은 상태가 같아도 새 버전이다.
- 행동 갱신은 해당 visitId를 포함하는 모든 Window에 판단 작업을 만든다. AI 미완료면 대기하고, 완료 시 최신 행동 스냅샷으로 첫 판단한다. AI 입력 시점과 판단 시점은 다를 수 있으며 둘 다 저장한다. AI 완료 전 지나간 5분 경계를 사후 5초 판단으로 꾸미지 않는다.
- 현재 상태는 세션의 **최신 구성 Window의 최신 stateVersion**이다. 최신 Window가 PENDING/FAILED/INVALIDATED이거나 행동 dirty 재판단 대기이면 decisionStatus를 그대로 반환하고 이전 결과는 lastSuccessfulState로만 표시한다. 이전 결과를 현재 NORMAL로 복사하지 않는다.
- 지연·역순 AI 결과는 원래 analysisId/windowId에만 기록한다. 완료/실패 확정 작업을 늦은 응답으로 덮지 않는다. 중복 worker는 기존 PENDING/RUNNING 소유권 검증을 유지한다. 구성 watermark 이전의 신규 작은 sequence는 VISIT_SEQUENCE_OUT_OF_ORDER로 거절한다(이미 저장된 원본 재전송200은 유지).
- AI 현재 registry는 재시작/eviction 후 기억을 잃는다. 영속 중복의 진실은 BE DB의 작업/Window UNIQUE다. BE 자동 분석 재시도는 현재 없으며 유지한다. 운영 재분석이 필요하면 새로운 analysis attempt 구조를 별도 설계하고 기존 결과를 덮지 않는다.
- 종료 후 결과/이력은 평가용 저장 가능하나 알림 금지. 구성 backlog는 종료 전에 저장된 방문만으로 후처리 가능하며 새 관측을 추가하지 않는다.

알림 작업·후보는 v2에서 `(windowId,stateVersion)`로 연결한다. analysisId는 AI 근거 추적용으로 보존하지만 한 AI 분석에서 체류에 따라 여러 판단이 생기므로 기존 UNIQUE(analysis_id)만으로는 부족하다. 후보 생성·조회·새 표시 허가 직전 모두 최신 Window/버전·COMPLETED DRIFT·ACTIVE·알림 모드·최소 간격·연속 DRIFT 보호를 재검사한다. 이미 실제 표시된 늦은 shown ACK는 새 표시 허가와 다르며 기존 시각 검증으로 감사 기록한다. 과거 후보는 무효화하고 실제 shown 이력은 삭제하지 않는다. NORMAL→DRIFT 상태 변경은 후보 평가 사유, 같은 DRIFT 입력 갱신은 반복 표시 사유가 아니다. 연속 DRIFT·최소 간격의 기존 설정을 유지한다. #81 권장안은 같은 Window의 새 NORMAL/TRANSITION만으로 재알림을 허용하지 않고 기존처럼 뒤 Window의 복귀를 요구한다. 같은 Window 리셋 허용은 비교 대안이며 승인되지 않았다. FIXED_INTERVAL과 사용자 선택은 기존 alertId 계약을 유지한다.

예시 재현: W1 AI=[DIRECT,DIRECT,UNRELATED], inputSnapshot에는 고정 목표·페이지 텍스트가 있다. v1 judgedAt=t1, behaviors=[P1:b1,P2:b1,P3:b1/5000], NORMAL. PATCH P3 b2/300000 적용 후 v2=t2, 동일 analysisId, DRIFT. Window 1개·AI 분석1개·판단 이력2개다. 지연 b1 PATCH는 applied=false, v3 없음. W2가 이미 생겼다면 W1 v2는 과거 기록만 바꾸고 현재 W2 알림을 되돌리지 않는다.

### 7.1 v2 조회 확장 제안

기존 `GET /api/sessions/{sessionId}/analysis-status`에 currentDecision을 추가한다. 필드는 windowId:string, windowIndex:int, stateVersion:int64|null, decisionStatus, finalState:enum|null, judgedAt:timestamp|null, analysisId:string|null, errorCode:string|null이며 모두 키를 반환한다. Window 자체가 없으면 currentDecision=null이다. lastSuccessfulState는 같은 형태의 선택 참고값이며 현재 상태/알림 허가가 아니다. 기존 latestAnalysis/latestCompletedAnalysis는 legacy AI 분석 정보로 유지한다. alert에는 v2 windowId/stateVersion을 필수 추가하고 고정주기는 null이다. 생성 주체는 BE, 저장 원천은 Window/상태 이력/분석·알림 테이블이다.

제안 `GET /api/sessions/{sessionId}/windows/{windowId}/states?page=0&size=20`은200 `{items:[{windowId,stateVersion,analysisId,judgedAt,ruleVersion,finalState,behaviorSnapshot,inputFingerprint}],page,size,totalElements,totalPages}`를 반환한다. 항목은 §4/§7 타입이며 BE가 저장값을 반환한다. stateVersion 내림차순, page>=0·size1~100, 잘못된 값400 INVALID_REQUEST, 세션/Window 없거나 다른 세션 소속이면404 SESSION_NOT_FOUND/WINDOW_NOT_FOUND다. 조회는 AI 호출·새 판단·알림 생성을 하지 않는다. 이 경로·필드는 P5 승인 후 구현하며 기존 analysis list/detail에는 최신 판단의 같은 필드를 추가한다.

## 8. DB 변경 및 호환성 (실행 금지, 후속 migration 제안)

| 현행 migration | 유지 및 확장 제안 |
| --- | --- |
| V1 work_session | collection_spec_version 및 composed_through_sequence:int32(신규0) 추가. 구행은 legacy-v1로 식별 |
| V2 page_visit | PK visit_id, UNIQUE(session_id,sequence), 누적 행동·MEDIUMTEXT 유지; extraction_status 추가(구행 LEGACY_UNKNOWN). v2 content 성공 검증은 API에서 강화 |
| V3 analysis_window/window_visit | window_size 현행 기본5와 기존 행 보존, 신규 v2는 명시3. UNIQUE(session_id,index), UNIQUE(session_id,size,end) 유지; collection_spec_version 추적. 구성 커서/compose_request 별도 추가 |
| V4/V5 analysis_result | UNIQUE(window_id) 유지(체류 재판단은 AI 재분석 아님), nullable 확률·원본 input_snapshot 유지, api_contract_version/page_results 추가. processing_status와 최종 상태 분리 |
| 신규 window_state_history | §7 PK/FK/UNIQUE 및 append-only JSON 행동 스냅샷. window_id,state_version 인덱스, visit 포함 조회는 window_visit 활용 |
| 신규 collection_failure / dataset 관리 저장소 | 실패 진단, 메타·독립 투표·합의 라벨 저장; 운영 예측 컬럼과 분리 |
| V6/V7 notification/alert_candidate_task | legacy analysisId PK/UNIQUE/FK 보존 데이터 이관 검토. 신규 stateVersion 연결을 위해 작업 키 확장 및 v2 중복 제약 별도 추가, AI 분석1개당 알림1개 가정 제거 |
| V8~V10 | scheduled_at 회차 UNIQUE, response의 alertId UNIQUE, history 인덱스 유지 |

compose_request는 compose_request_id UUID PK, session_id FK, after_sequence:int32, through_sequence:int32, input_snapshot/response_snapshot JSON, input_fingerprint SHA-256, processing_status, requested_at/started_at/completed_at UTC millis, error_code nullable을 저장하는 제안이다. 세션당 커서 CAS와 작업 claim/lease를 함께 사용하고 만료 RUNNING을 복구한다. lease/재시도 횟수·timeout은 기존 복구 패턴에 맞춰 후속 Issue에서 확정한다. 네트워크 장애 시 스냅샷/ID를 보존한다.

새 Flyway 번호는 구현 시 main의 최신 버전 다음으로 선택한다(현재 V10 다음). expand→검증→신규 세션 v2 활성화 순서다. V1~V10 checksum을 바꾸지 않는다. 기존 5개 Window를 3개로 잘라 재기록하거나 기존 예측을 BE 정답으로 backfill하지 않는다. legacy 결과는 버전별 조회/Export로 유지한다. 필요하면 재계산은 별도 datasetVersion 파생물로 만들고 provenance를 연결한다.

v2 FE는 BE가 해당 collectionSpecVersion을 지원하는지 세션 응답으로 확인해야 한다. 모르는 버전이면 수집 시작/재해석하지 않는다. 세션 중 버전 전환 금지. legacy ACTIVE/END_PENDING은 원래 DTO·순서·ACK로 마무리하고 신규 v2와 큐를 섞지 않는다. FE checkpoint 저장 포맷도 version-up converter가 필요하며 원본·동결 전송값·서버 ACK를 보존해야 한다. rollback은 신규 v2 세션 진입을 막되 이미 생성된 v2 큐/행을 v1 프로세서에 주지 않는 방식이다.

## 9. Export 스키마·라벨 저장 (P6 제안)

아래 파일은 UTF-8 JSONL, manifest만 JSON이다. 모든 행은 datasetVersion:string을 포함한다. ID·시각·카운터 타입은 §3을 따른다. `?`는 선택/null, 나머지는 필수다. 데이터셋 저장소는 비공개 접근 제어 영역이며 Git에 원문을 올리지 않는다. datasetVersion 변경 시 파일 덮어쓰기 대신 새 export를 만든다.

| 파일·행 키 | 필드·타입 | 생성 주체/원천 |
| --- | --- | --- |
| manifest.json: datasetVersion | collectionSpecVersion, apiContractVersion:int, ruleVersion, labelGuideVersion, exportedAt, sourceCommit, splitByGoal:{train:string[12],validation:string[4],test:string[4]}, fileSha256:map, counts:object, exclusions:object | Export 도구; 추출 조건·실패/판단불가 수 포함 |
| sessions.jsonl: sessionId | participantId:string(가명), goalId:string, goalText:string, scenario:enum(GOAL_MAINTENANCE/JUSTIFIED_DETOUR/GRADUAL_DRIFT/CLEAR_DRIFT/NATURAL), cohort:SCRIPTED/NATURAL, startedAt, endedAt?, collectionSpecVersion, collectorVersion:string, browserVersion:string, osFamily:string, collectionStatus:COMPLETE/INCOMPLETE, consentRecordId:string?, assignmentVersion:string | 수집 관리자 메타 + work_session. 참여자 실명/계정 불포함 |
| visits.jsonl: visitId | sessionId, sequence:int, browserTabKey:string, normalizedUrl/domain/title/content:string(legacy null 허용), searchQuery:string?, isSearchResultPage:bool, visitedAt, extractionStatus:SUCCESS/LEGACY_UNKNOWN, activeDurationMs:int64, tabSwitchCount:int, behaviorVersion:int64 | page_visit의 Export 시점 값(판단 스냅샷 대신 쓰면 안 됨) |
| windows.jsonl: windowId | sessionId, windowIndex:int, windowSize:3(legacy5), visitIds:string[3], legacy는 string[5], createdAt, collectionSpecVersion, referenceStateVersion:int64? | BE Window 저장. referenceStateVersion은 정적 라벨 기준 버전 |
| window_states.jsonl: windowId+stateVersion | analysisId, judgedAt, ruleVersion, finalState:enum, behaviorSnapshot:object[3], inputFingerprint:string | BE append-only 판단 원본 |
| ai_predictions.jsonl: analysisId | sessionId, windowId, apiContractVersion, processingStatus, errorCode?, requestedAt, analyzedAt?, completedAt?, inputSnapshot:object, pageResults:object[]?, modelVersions:map?, legacyPrediction:object? | AI 예측/실패 및 BE 요청 원본. 정답 필드 없음 |
| human_labels.jsonl: annotationId(UUID) | targetType:PAGE_VISIT/WINDOW/WINDOW_STATE, visitId?, windowId?, stateVersion?, referenceStateVersion?, raterId:string?, label:string, phase:INDEPENDENT/CONSENSUS, sourceAnnotationIds:string[]?, labelGuideVersion, labeledAt, rationale:string?, adjudicationNote:string? | 평가 도구. PAGE는 visitId만, WINDOW는 windowId+referenceStateVersion, STATE는 windowId+stateVersion 필수 |
| collection_failures.jsonl: failureId | sessionId, candidateId, browserTabKey, observedAt, activeDurationMs, status:EXTRACTION_FAILED, reasonCode | FE 진단. 원본 Query·본문 없이 실패 집계 |
| features.csv (선택) | datasetVersion,analysisId,windowId,stateVersion,featureSchemaVersion 및 명시한 수치 열 | 분석용 파생물, 정답/메타 자동 혼입 금지 |

라벨 저장 제약: INDEPENDENT는 target key+labelGuideVersion+raterId UNIQUE, raterId 필수이고 평가자3명 각각 한 투표다. CONSENSUS는 target key+guideVersion UNIQUE이며 raterId=null, 합의 근거·독립 투표 참조를 보존한다. PAGE label은 DIRECT/JUSTIFIED_DETOUR/UNRELATED/UNJUDGEABLE, 나머지는 NORMAL/TRANSITION/DRIFT/UNJUDGEABLE. AI 응답/BE finalState를 human_labels에 복사하지 않는다.

정적 Window 라벨은 **최초 성공 판단 stateVersion**을 referenceStateVersion으로 고정하는 안을 권장한다. 최종 시점은 window_states의 해당 버전을 별도로 라벨링한다. 최신 방문값으로 과거 Window 라벨을 다시 쓰지 않는다. 최초 성공 판단이 없는 Window는 referenceStateVersion=null/UNJUDGEABLE이며 성공 예측 평가에서 제외한다. 대안은 종료 시점 기준이며 결과 분포가 달라진다. 데이터 담당 승인 전 정적 라벨 수집을 시작하지 않는다.

Fleiss' κ는 세 평가자의 조정 전 투표로 단위별 계산한다. 판단 불가를 포함한 4범주 κ와 세 명 모두 판단 가능한 표본의 3범주 κ/표본 수를 같이 보고하는 안이다. 합의 라벨 정확도는 UNJUDGEABLE 제외 수·비율을 함께 낸다. 최소 1,200개는 상태 버전을 여러 Window로 중복 계산해 채우지 않는다. split은 goalId로 고정하고 상태 버전·Window가 집합을 넘지 않는지 검사한다. manifest의 count는 고유 Window와 각 상태 버전을 별도 집계한다. 버전은 collectionSpecVersion=2.0, apiContractVersion=2, ruleVersion=be-rule-2.0, labelGuideVersion=2.0을 초기 제안값으로 쓰되 승인/변경 이력을 manifest에 고정한다.

AI **wire 식별자**(sessionId/visitId/windowId)는 응답 상관관계·멱등 용도일 뿐 모델 특징이 아니다. participantId, goalId, scenario, cohort, OS/browser, raterId, 정답 라벨은 모델 prompt/embedding/분류기 입력 금지다. goalText, title/content, searchQuery, 순서/position만 의미 분석에 사용한다. 활성 체류·탭 전환은 BE 규칙/평가 스냅샷이고 v2 AI에 필수가 아니다. 공개 재배포·보존기간·삭제/동의 철회·익명 ID 재연결 키 관리·자연 탐색 중 미등록 목표의 배정은 **P6 미확정**이며 임의 수치/권한을 정하지 않는다.

## 10. 계획서와의 차이 및 기능 ID 보존

| 기존 문서의 기준 | #79 이후 |
| --- | --- |
| README/계획서 5페이지, n−4, AI 확률 최종 판단 | 3페이지, n−2, AI 페이지/우회 + BE 규칙 판단 |
| 계획서 평균12페이지→8 Window→약1280 | 평균12→10 Window→약1600, 최소10→8→1280. 최소1200 목표 유지 |
| 계획서 20목표/10명/160세션/3인κ/목표12·4·4 | 유지, 서로 다른16목표·시나리오당4·자연20~40 및 Page/상태이력 라벨 추가 |
| 기존 수집 문서 1초·10초·탭 무조건 재개 | 5초·5분·4초 경계 |
| 계획서 AI 확률/τ·AI-003 분류기 비교 | 운영 판단 BE로 이전. legacy 실험 요구사항을 삭제하지 않고 버전 분리 |
| 계획서 사용자 평가12명 | 이번 데이터 수집10명과 목적이 다름. 최종 사용자 평가 인원 변경 지시는 없어 유지 |
| 계획서 클래스별 최소300·권장1500·응답p95 5초 | 기존 연구 목표로 보존. #79의 새로운 필수 수집량과 구분하며 달성 주장 없음 |

FE-001~010, BE-001~009, AI-001~003 ID를 유지한다. BE-009는 AI 구성 검증·식별·저장으로, AI-003은 운영 최종 판단의 BE 이관 및 legacy 비교로 역할 변경 이유를 기록한다. project-plan/README 전체를 재작성하지 않고 이 표에서 변경 이력을 관리한다.

## 11. 미확정 결정 목록과 구현 순서

| 결정 | 결정 담당·선결 | 권장안 / 남은 확인 |
| --- | --- | --- |
| P1 | FE·데이터 | leftAt~returnedAt, 탭별, 앱/창/reload 동일4초. SPA identity 세부·clock/restart 파일럿 |
| P2 | FE·BE·AI·데이터 | 유효화 순서 sequence vs 기존 시작순서. 조기 전송 후 민감 DOM 정정·삭제가 배포 선결 |
| P3 | FE·BE | PATCH 누적값으로5분 감지, 타이머 오차·장기 장애 지연·quota/정리 방식 |
| P4 | BE·AI | AI 구성 API→BE ID/저장→기존 분석 API. 추가 왕복 vs 단일 스트림 비교, timeout/재시도 예산 실측 |
| P5 | BE·AI·데이터 | 끝 방문 suffix·상태 불변이어도 입력당 이력; 알림 리셋/버전 연결, first2 대기 확인 |
| P6 | 데이터·팀 | 최초 판단 정적 라벨, κ 판단불가 처리, 개인정보 수명/동의·자연탐색 목표 매핑 |

후속 Issue **제안이며 아직 생성하지 않았다.**

1. 공통 결정 P1~P6 승인 및 wire fixture/OpenAPI·JSON schema 고정(P2 개인정보·순서, P4 우선).
2. BE additive migration/버전 호환·구성 작업 저장·상태 이력·기존 데이터 읽기. DB 적용은 별도 검토.
3. AI 3개 구성 API·페이지 관련성/우회 응답·오류/중복 계약. 모델/프롬프트 선택은 Validation 평가로 결정.
4. BE 구성 연동·AI DTO·5초 요청·최종 규칙·동시성/복구·버전별 알림/조회. AI fixture로 선행 작업 가능.
5. FE 5초·4초·캐시·지속 수집·5분·sequence·checkpoint 전환·기존 ACK/END_PENDING 회귀. 승인된 wire로 BE/AI와 병행 가능.
6. Export/독립 라벨 도구·목표 split/manifest·v2 training loader·legacy 비교 분리.
7. 통합 경계/복구·개인정보·실제 Chrome 파일럿 후160+자연20~40 수집. 이 Issue에서 모델 학습/제품 구현/새 Issue 생성은 하지 않는다.

## 12. 문서 검증 및 후속 수용 기준

정적 검증 결과는 [검증 기록](data-contract-validation.md)을 따른다. 아래는 구현 후 필요한 케이스이며 현재 실행 PASS가 아니다.

| 항목 | 수용 케이스 |
| --- | --- |
| 방문 유효성 | 4999 제외, 5000 전달, 추출실패 진단 분리, 5000 code points 포함·5001 거절 |
| 복귀 | 3999 같은 ID·누적, 4000 새 ID; 다른 탭 동일 URL, A→B→A, reload/SPA/검색어 변경, Worker 미관측 |
| 순서 | 열린 후보·늦은 DOM·동시5초·재허용 공백·오래된 신규 sequence 거절·동일 원본200 |
| Window | 첫2개0, 3/4/5개1/2/3, AI 실제 구성, BE ID/저장, 멱등 구성·실패 커서 미전진 |
| 상태 | 여섯 조건 전부, 정확히300000, 최신 관련 우선, 오류 null, 과거 long dwell 미전파 |
| 이력 | W1 v1 NORMAL→v2 DRIFT, Window/AI 분석수 불변, 같은 입력 멱등, 모든 포함 Window 재판단 |
| 비동기 | compose CAS·중복/지연/역순 AI·timeout 후 늦은 응답·종료 후 기록/알림 차단 |
| 복구 | POST ACK 유실·PATCH frozen retry·IDB 오류·quota·END_PENDING drain·권한 철회·legacy 큐 전환 |
| 평가 | 3인 독립/합의 분리·κ·UNJUDGEABLE 분모·goal12/4/4 누출 없음·상태 버전 중복 Window 수 집계 금지 |

## 13. #81 구체화와 승인 게이트

P1~P6별 현재구현/목표/선택지/근거/코드·데이터 영향/승인담당/결정상태는 [결정안](v2-contract-decisions.md)에 분리했다. 유지할 설계 요구인5초·4초·5분·size3/stride1과 팀 승인 사실을 혼동하지 않는다. 정책 상태는 모두 PROPOSED, 개인정보 보존·동의절차 및 회수없는 조기배포는 BLOCKED 하위조건이다.

정적 Window 라벨 권장 기준은 최초성공 BE stateVersion의 실제 snapshot, 예측 숨긴 3인 독립→합의 별도, κ는 조정전 네범주와 완전판단가능 세범주를 각각 보고한다. 목표12/4/4·자연세션 같은목표 split 유지, 철회manifest/백업/캐시/파생모델까지 회수범위다. 보존기간 임의확정 없음. API·DB 새제약/호환성·후속작업과 실행 Fixture의 검증한계는 결정안 §8~11 및 [검증보고](data-contract-validation.md)를 따른다.

## #83 비동기·회수 보완 — PROPOSED

구성 job의 불변 prefix와 privacy/멤버 유효성 revision을 사용한다. 새 방문 append·행동 PATCH는 진행 중 구성 응답을 폐기하는 revision 변경이 아니며 cursor CAS·tombstone/멤버 변경은 폐기 사유다. receipt·Window/멤버·분석 PENDING/outbox·cursor는 원자 commit한다. 시작 멱등키는 목표와 collectionSpecVersion 모두 비교하고 v1 세션을 v2로 재해석하지 않는다.

판단 commit은 최신 행동 벡터를 잠금 또는 CAS로 확인한다. 오래된 snapshot으로 더 높은 stateVersion을 발급하지 않는다. 성공 behaviorSnapshot은 유효 방문이므로 duration>=5000이다. 회수는 tombstone 우선, 세션 분석 격리, lastSuccessfulState/alert 반환 중지, END_PENDING 정상 drain 중단·개인정보 예외 경로가 필요하다. PURGED는 Export/백업/학습 영향 포함 전체 증거가 확인된 집계 상태이며 실제 구현은 없다. [승인 요청](v2-contract-approval.md)에 단계별 처리·해제 조건·후속 의존성을 기록했다.
