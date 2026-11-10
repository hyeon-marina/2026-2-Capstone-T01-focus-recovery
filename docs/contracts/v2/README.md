# v2 계약 패키지 — 2.0-proposed.2

## #91 FE 합성 전용 구현 — 승인 변경 없음

FE는 공유 Schema의 PageVisitPost/BehaviorPatch를 실제 validator·Fixture와 대조하고 실제 Chrome→Spring/H2의 wire 요청/응답을 이 Schema로 재검증한다. DB version2의 v2 전용 store/receipt는 로컬 구현 세부이며 wire 필드를 늘리지 않는다. production FE는 v1이고 v2는 별도 synthetic-test 빌드만 허용한다.

실제 구현·명령·Mock/Chrome/HTTP 구분·미구현/미검증 범위는 [FE v2 검증 보고](../../fe-v2-collection-validation.md)를 따른다. **P1~P6 PROPOSED, P2/P6 BLOCKED 유지.** 아래 과거 작업의 미구현 설명은 각 작업 당시 기록이다.

**PROPOSED / Backend 저장 기반과 AI API를 합성 테스트 구현 / 운영 활성화 승인 아님.** 정책별 근거·대안·담당은 [결정안](../../v2-contract-decisions.md), 현행 API·호환성은 [공통 계약](../../data-analysis-contract.md) 참조. `.invalid` Schema ID는 식별자이며 다운로드 주소가 아니다. 네트워크 없는 local `$ref`만 사용한다.

## #85 제품 저장 경계와 계약 패키지의 구분

V11·세션 버전·방문 watermark·compose job/Receipt·분석 Outbox·상태 이력·내부 개인정보 격리 저장 경계를 구현했다. [검증 보고](../../be-v2-storage-foundation-validation.md)에 실제 Java/H2/MySQL 테스트를 별도로 기록한다. `validate.py`는 계속 문서 reference 검증이며 DB/제품 테스트를 대체하지 않는다. Schema/Fixture의 정책 기대값은 변경하지 않았다.

BE v2는 기본 비활성, 정확히 test 프로필+명시 flag에서만 허용한다. #87에서 아래 AI API를 합성 테스트 전용으로 구현했으며 BE의 실제 AI HTTP 변환/dispatcher는 후속이다. 상태 조회 projection·진단·개인정보 공개 API는 아직 구현/공개되지 않았다. v2 legacy 분석 조회·알림도 거절한다. 외부 회수·실제 삭제·PURGED 집계와 운영 활성화는 계속 차단된다. 기존 v1 API는 유지한다.

## #89 Backend 적용

BE 두 v2 HTTP Client/Dispatcher·최종 판단·영속 dirty 재판단·Status/StatePage projection·stateVersion 후보를 구현했다. [BE–AI 검증 보고](../../be-ai-v2-integration-validation.md)에서 H2/MySQL·Mock HTTP·실제 BE/FastAPI(모델만 Mock)·모델 미실행을 분리한다. Schema/Fixture의 입력/기대값은 바꾸지 않았다. 위 #85/#87의 BE 미구현 설명은 당시 기록이다.

BE는 정확히 test+storage flag에서만 v2 API를 허용하고, 자동 실행에는 dispatch flag도 필요하다. 두 flag 모두 기본false다. 운영 활성화 방법이 아니다. V12는 재시도 시각/dirty 판단과 상태 FK 알림을 추가한다. 분석 자동 재호출/v1 fallback 없이 실패를 보존한다. v2 HTTP130초/Lease180초/여유15초·구성 최대3claims/1초·2초 backoff·Worker2/큐0은 합성 개발 한도다.

StatusResponse의 실제 BE 응답은 기존 latestAnalysis/latestCompletedAnalysis와 기존 alert 필드를 함께 유지한다. v2 alert의 windowId/stateVersion은 고정주기에서도 명시 null이다. 검증 시 아래와 같이 projection을 선택한다. 격리 시 currentDecision=INVALIDATED(구간 없으면null), lastSuccessfulState/alert/legacy 분석=null이며 실제 삭제/PURGED를 뜻하지 않는다. 상태 이력 조회는 격리 시409로 차단한다.

실제 HTTP 합성 증거의 Schema·hash·AI 구성/페이지 pairing/상태 hash 재검증:

```sh
/private/tmp/focus87-ai/bin/python be/src/test/python/validate_http_evidence.py
```

실행 전 V2LiveHttpTest로 증거를 만들어야 한다. 단순 reference validator PASS와 제품 테스트는 별개다. P1~P6 PROPOSED/P2·P6 BLOCKED 유지, 실삭제·외부 회수/동의·보존·운영 Gate는 여전히 선결이다.

## #87 AI 런타임 적용

`ai/v2/contracts.py`는 이 Schema의 CompositionRequest/Response·AnalysisRequest/Response·FailureResponse를 직접 사용한다. 복사본·Schema/Fixture 정책 변경은 없다. Schema 밖 fingerprint/position/ID/순서/커서 관계도 검증한다. Python 정규식 `$`가 끝 개행을 허용하는 점을 보완하여 timestamp는 전체 문자열과 실제 날짜를 검사한다. 정수값 `1.0`은 Schema 의미에 따라 수락하되 fingerprint에서는 `1`로 직렬화한다.

AI v2는 `AI_V2_PROFILE=synthetic-test`와 `AI_V2_ENABLED=1`을 함께 지정한 개발 실행에서만 동작한다. Schema 파일은 저장소 경로를 직접 읽거나 `AI_V2_SCHEMA_PATH`로 지정한다. Docker Compose는 공통 파일을 `/app/v2.schema.json`에 read-only mount한다. standalone AI 이미지에서 v2를 시험하려면 같은 파일을 제공해야 하며 누락 시 503이다. v1은 이 파일 없이도 동작한다.

AI는 구성 목록 안의 순서·중복·tail 최대2·커서와 신규 방문 경계를 확인한다. 저장 prefix의 실제 누락이나 진짜 tail ID는 요청 밖 사실이므로 BE가 검사한다. `omitted-visit`/`missing-tail` reference의 COMPOSE_INPUT_MISMATCH는 BE 검증 책임이며 AI가 DB를 조회하는 코드로 구현하지 않는다.

모델 독립 구성, 실제 LLM 생성 호출 경로, Mock/캐시/오류 검증, 재시작 한계 및 BE 후속 작업은 [AI v2 구현 검증](../../ai-v2-window-analysis-validation.md)에 기록한다. 실제 모델 파일/의존성이 없어 스모크 추론은 미실행이며 품질 승인은 아니다. P1~P6 PROPOSED/P2·P6 BLOCKED 유지.

## 실행과 자산

```sh
python3 -m venv /tmp/focus81-validator
/tmp/focus81-validator/bin/python -m pip install 'jsonschema[format]==4.26.0'
/tmp/focus81-validator/bin/python docs/contracts/v2/validate.py
```

문서 검증만 수행할 때 제품 의존성은 필요 없다. #87 AI 런타임은 같은 Schema를 직접 검증하므로 AI requirements에도 `jsonschema[format]==4.26.0`을 명시한다. Draft 2020-12와 FormatChecker(특히 uuid/date-time)를 사용한다. 기본 validator는 format을 annotation으로 취급할 수 있으므로 FormatChecker를 생략하지 않는다. `python -O`는 assertion 검사를 끄므로 사용하지 않는다.

- [v2.schema.json](v2.schema.json): 30개 `$defs`, 아래 entry point별 검증. 루트 oneOf는 wire 본문 종류 분류용이다. 특정 API 검증은 해당 `$defs`를 선택한다.
- [schema-cases.json](fixtures/schema-cases.json): 각 `contract`, **실행 입력 input**, **예상 expected.valid/keyword**를 분리. invalid 사례는 실패가 기대 결과이며 정상 데이터로 보내지 않는다. Schema 통과는 관계·상태 통과와 다르다.
- [scenarios.json](fixtures/scenarios.json): kind별 합성 **input**과 **expected**. validate.py의 executable reference model로 sequence/replay/patch/compose/AI pairing/state flow/split을 실제 비교한다.
- [validate.py](validate.py): Schema meta-validation·format·경계값, 관계/상태 reference model, 216개 규칙 조합·κ 산술 검사, 관련10문서 상대 링크/anchor·code fence 검사. 제품 소스나 기존 테스트를 import/변경하지 않는 문서용 검증 도구다.

Fixture는 실제 사용자 데이터·진짜 모델 결과·동의 승인을 포함하지 않는다. 합성 manifest의 `SYNTHETIC-NO-CONSENT-CLAIM`은 운영 정책 버전이 아니다. schema-cases의 fingerprint 임의값은 **모양 검사만** 하는 예시이며 hash 관계가 필요한 시나리오는 실제 계산값을 사용한다.

#83 재검토·승인 상태는 [승인 요청 대장](../../v2-contract-approval.md)을 따른다. .2는 문서용 제안 패키지 수정이며 승인/운영 wire 버전 승격이 아니다. 기존 endpoint/body를 유지하고 ComposedWindow.visitIds와 RetractionAck.invalidatedWindowIds의 중복 금지, 성공 BehaviorSnapshot.duration>=5000을 Schema에 반영했다. 기존 정상 Fixture·제품 테스트 기대값은 보존한다.

추가 reference 시나리오는 유효화 commit 순서/abort, 구성 중 append와 privacy revision·cursor 경합, 전체 행동 snapshot의 stateVersion/fingerprint, POST 유실·회수 전후 늦은 POST/AI·Export/학습/백업 미회수, blind 데이터의 예측 누출을 다룬다. 실제 저장소 삭제·DB 경합·학습 영향 제거를 수행하는 도구가 아니다.

## Endpoint와 entry point

버전 협상은 신규 session의 collectionSpecVersion=`2.0`으로 고정(세션 API 확장 후 사용), AI는 apiContractVersion=2. 기존 버전 없는 AI API는 v1이며 이전5개/확률 규격 유지. 기존 API 제거 없음.

| 메서드·경로(제안 v2) | 요청 `$defs` | 성공·응답 `$defs` | 실패 |
| --- | --- | --- | --- |
| POST `/api/sessions/{sessionId}/visits` | PageVisitPost | 201 신규/200 원본 replay: PageVisitAck | BE400/404/409 |
| PATCH `/api/sessions/{sessionId}/visits/{visitId}/behavior` | BehaviorPatch | 200 BehaviorAck(현재 서버값/applied) | BE400/404/409 |
| POST `/api/ai/window-compositions` | CompositionRequest | 200 CompositionResponse(구간0개도 성공) | AI422/409/500/503 |
| POST `/api/ai/analyses` | AnalysisRequest | 200 AnalysisResponse | AI422/409/500/503 |
| GET `/api/sessions/{sessionId}/analysis-status` | path/query | 200 StatusResponse **v2 projection** | BE400/404 |
| GET `/api/sessions/{sessionId}/windows/{windowId}/states?page=0&size=20` | page>=0, size1~100 | 200 StatePageResponse | BE400/404 |
| POST `/api/sessions/{sessionId}/collection-failures` | CollectionFailure | 201 신규/200 replay: 같은 CollectionFailure | BE400/404/409 |
| POST `/api/sessions/{sessionId}/visit-retractions` | PrivacyRetraction | 202 격리/200 완료 또는 replay: RetractionAck | BE400/404/409 |
| 실패 응답 | 없음 | FailureResponse | non-2xx만. 성공 enum에 오류를 채우지 않음 |
| 오프라인 `manifest.json` | Manifest | Export 도구 입력/출력 | API 성공 응답으로 취급하지 않음 |

sessionId/visitId/windowId path도 Uuid로 검증한다. Session 생성/종료·고정주기·shown/response·기존 분석 list/detail은 기존 계약 유지하며 이 패키지가 전체 legacy API를 재정의하지 않는다. `StatusResponse`는 v2 projection을 검증하며 **실제 기존 응답 전체를 그대로 넣으면** additionalProperties=false로 실패한다. 구현 어댑터는 기존 latestAnalysis/latestCompletedAnalysis 필드를 유지하고 projection에 sessionId/sessionStatus/currentDecision/lastSuccessfulState/alert/apiContractVersion만 매핑한다. 새 alert도 여기서는 식별·판단 참조 projection이며 기존 message/goalText 등은 기존 DTO 유지. FE·BE·AI 명세 모두 이 동일 projection/Schema를 사용한다.

## 공통 타입·필수·null·상한

**모든 object는 추가 필드 금지, 모든 properties는 required**다. null을 허용하는 필드만 아래 명시한다. 생략과 null은 다르다. optional 암묵 기본값은 v2에 없다. 예외는 `$defs`에 별도 required 배열이 명시된 경우뿐이며 현재 모든 필드는 필수다.

| 타입/필드 | 규격 |
| --- | --- |
| Uuid | lowercase canonical UUID v4/variant RFC형식, 36자. session/visit/window/analysis/compose/failure/retraction/alert ID. 신규 v2 생성자의 v4 통일 제안이며 현행 legacy UUID 검증을 강화 적용하지 않음 |
| Timestamp | RFC3339 실제 달력시각, UTC `YYYY-MM-DDTHH:mm:ss.SSSZ` 정확히 millisecond. offset·존재하지 않는 날짜·정밀도변경 거절 |
| Hash | SHA256 lowercase hex64. 저장 identity와 데이터 익명화의 의미 없음 |
| Sequence/windowIndex | integer 1~2147483647. Cursor/afterSequence는0~2147483647. 숫자 문자열/bool/소수 금지. JSON Schema 의미상1.0도 정수값으로 판정할 수 있음 |
| activeDurationMs/behaviorVersion/stateVersion | JSON safe integer <=9007199254740991. duration/behaviorVersion>=0, stateVersion>=1. DB BIGINT 전체를 JS로 보내면 안 됨 |
| tabSwitchCount | integer 0~2147483647 |
| 문자열 길이 | Schema min/maxLength는 Unicode code points. URL은 추가로 UTF-16 code units<=8192 검사(기존 FE 보호 상한). 본문<=5000, title/query<=500, domain<=253, browserTabKey1~100 |
| 버전 | wire apiContractVersion const2, session/manifest collectionSpecVersion const`2.0`; 규칙 `suffix3-v2-proposed.1`. 모델4종 버전은 embedding/context/prompt/labelGuide 각각1~200자 |

카운터 overflow는 wrap/음수/잘라내기 금지, 안전중지·명시 오류. 전송 snapshot·측정값과 ACK 현재값을 구분한다. Schema의 정수 최대범위보다 Java long이 크다고 더 큰 값을 허용하지 않는다.

## 필드 사전

필드의 세부 enum/min/max/conditional은 `$defs`가 기계 검증 단일 기준이다. 아래는 생성/저장과 null 의미를 함께 설명한다.

| entry point | 필수 필드·의미 | nullable |
| --- | --- | --- |
| PageVisitPost | FE visitId/sequence/browserTabKey/normalizedUrl/domain/title/content/searchQuery/isSearchResultPage/visitedAt/activeDurationMs/tabSwitchCount/behaviorVersion/extractionStatus. sessionId는 path. 최초duration>=5000, extractionStatus=SUCCESS | 일반 페이지 searchQuery만null. title은빈문자 허용, content null 금지 |
| PageVisitAck | 위 필드+BE sessionId/updatedAt. ACK 행동값은 POST 원본보다 최신일 수 있음 | searchQuery, updatedAt |
| BehaviorPatch | activeDurationMs, tabSwitchCount, behaviorVersion. 전부 누적값, POST ACK 뒤만 전송 | 없음 |
| BehaviorAck | 같은3값+visitId/updatedAt/applied. 항상 서버 현재값, 적용여부 별도 | updatedAt(최초행) |
| CompositionRequest | BE apiContractVersion/composeRequestId/sessionId/afterSequence/inputFingerprint/visits. visit은 **visitId/sequence만**; 본문·behavior 전송 안 함 | 없음 |
| CompositionResponse | AI apiContractVersion/composeRequestId/sessionId/afterSequence/inputFingerprint/composedThroughSequence/windows. window는 visitIds[3]/endVisitId, **BE windowId/index 없음** | 없음, windows=[] 허용 |
| AnalysisRequest | BE apiContractVersion/analysisId/sessionId/windowId/windowIndex/goalText/inputFingerprint/visits[3]. 각 position/visitId/sequence/title/content/searchQuery/isSearchResultPage/visitedAt | 일반 searchQuery만null. behavior/사람라벨/참여자 입력 금지 |
| AnalysisResponse | AI apiContractVersion/analysisId/sessionId/windowId/inputFingerprint/pageResults[3]/modelVersions/analyzedAt. page position/visitId/label/semanticRelevance/rationale | 없음. label DIRECT/JUSTIFIED_DETOUR/UNRELATED, cosine finite[-1,1]. state/확률 없음 |
| WindowState | BE windowId/stateVersion/analysisId/ruleVersion/judgedAt/finalState/behaviorSnapshot[3]/inputFingerprint. snapshot은 visitId+3행동값, duration>=5000. 성공 이력만 저장 | 없음. finalState NORMAL/TRANSITION/DRIFT |
| CurrentDecision | windowId/windowIndex/stateVersion/analysisId/decisionStatus/finalState/judgedAt/errorCode. COMPLETED는 모든 근거 non-null/errorCode=null | PENDING/FAILED/INVALIDATED는 stateVersion/finalState/judgedAt=null. 분석 ID 미발급이면null, PENDING errorCode=null, 실패/무효화 code필수 |
| StatusResponse | BE apiContractVersion/sessionId/sessionStatus/currentDecision/lastSuccessfulState/alert. 최신 **구성 Window** 기준, lastSuccessfulState는 참고 | Window없으면currentDecision=null, 과거성공없으면lastSuccessfulState=null, 허용후보없으면alert=null. ENDED는alert=null |
| AlertCandidate | alertId/alertType/analysisId/windowId/stateVersion/createdAt/shownAt. 기존 DTO 식별 projection | AI는 세참조 non-null, FIXED_INTERVAL은 모두null. 미표시 후보 shownAt 항상null |
| StatePageResponse | items/window-state[], page,size,totalElements,totalPages. stateVersion 내림차순 | 없음, items=[] 허용 |
| FailureResponse | apiContractVersion/code/message/fieldErrors[{field,message}]. 원문 없는 일반 메시지; fieldErrors=[] 허용 | 없음 |
| CollectionFailure | failureId/candidateId/browserTabKey/status/observedAt/activeDurationMs/reasonCode. visit FK없음, sequence 없음. status 정확히 EXTRACTION_FAILED | 없음. URL/query/title/content/exception dump 금지 |
| PrivacyRetraction | retractionId/visitId/observedAt/reasonCode(SENSITIVE_CONTENT/CONSENT_WITHDRAWN). reason 원문 없음 | 없음 |
| RetractionAck | retractionId/visitId/status(QUARANTINED/PURGED)/중복 없는 invalidatedWindowIds | 없음. PURGED는 Export/학습/백업 포함 승인된 전체 회수 증거 확인 후만. replay200의 QUARANTINED는 완료 아님 |
| Manifest | datasetVersion/collectionSpecVersion/apiContractVersion/ruleVersion/labelGuideVersion/exportedAt/sourceCommit/referencePolicy/splitByGoal/files/counts/exclusions/consentPolicyVersion/deletionRevision | 없음. 정책 미승인으로 값이 없으면 실Export 차단 |

검색 true는 정리된 검색어1~500 및 유기결과 최소1개를 전송 전 검사, 본문1~5000. 일반 false는 searchQuery=null·본문50~5000. title/content는 원문 보호 및 공백정리를 통과해야 한다. 검색/일반분기 길이는 Schema conditional로 검증하지만 실제 organicResultCount/민감DOM은 FE 로컬검사이며 wire에 추가하지 않는다.

## Schema 밖 관계·상태 검증

JSON Schema는 동적 ID 일치/DB 소속·저장 이력을 읽을 수 없다. 후속 구현 validator가 다음 검사를 수행해야 한다. 이 패키지는 일부를 reference scenario로 실행하며 실제 DB·브라우저를 대체하지 않는다.

1. URL http/https·소문자 host·default port 없음·userinfo/query/fragment 없음, domain=URL.hostname. 민감 path/query/DOM 차단은 URL 정규화 **전** 원본 보호 검사. 정규화 URL만 받은 BE가 원본 안전성을 증명할 수 없음.
2. Composition ordered distinct visitId/sequence, 신규>=1, 이전 tail 일치·저장 prefix 누락 없음. response의 IDs/hash/cursor·모든 stride1 멤버·endVisitId 일치 및 through=마지막신규. 1~256 total/구간<=254, stream은 다중배치로 무제한 수집. BE 발급 windowId/index는 commit 후 멱등 receipt로 재사용.
3. Analysis request positions 정확히1,2,3/sequence strictly increasing/visit distinct, request fingerprint 재계산. response positions/visitId 1:1·ID/hash echo 일치. 같은 analysisId의 payload 교체 금지. 분석 실패를 pageResults로 반환하지 않음.
4. State snapshot 순서와 Window멤버 일치, 행동버전 비감소, stateFingerprint 재계산·Window별 버전 증가 및 중복 입력 unique. 원래 analysisId는 immutable 성공 결과를 가리켜야 함.
5. Status currentDecision는 최신 windowIndex·최신 완료 판단 또는 dirty/PENDING/실패, lastSuccessfulState는 실제 성공만. AI alert는 currentDecision와 동일 Window/version DRIFT·ACTIVE여야 함. FK·지연응답·실제 표시 ACK는 #89 합성 제품 테스트에서 확인하며 실제 FE 표시 race/분산 운영은 후속이다.
6. manifest split disjoint·20고유목표, files path중복/실제checksum/rowCount/FK/동의·삭제revision·blind export 검증. Schema counts는0이상이며 수집 목표160/1200 달성은 별도 데이터 품질 검사(샘플0건을 목표달성으로 보지 않음).

Canonical fingerprint: fingerprint 필드를 제외한 요청 객체, 또는 상태의 `{analysisId,ruleVersion,behaviorSnapshot}`를 key 사전순으로 재귀 정렬, 배열 순서 유지, Unicode 정규화 없음, UTF-8 JSON, 공백 없음, 문자열은 `ensure_ascii=false`/JSON 표준 이스케이프, 정수는10진수/불필요0·소수 없음. 이 입력에는 실수 필드를 넣지 않는다. 개행문자·제어문자는 JSON escape. 검증용 Python fingerprint 함수와 교차언어 golden case를 후속 FE/BE/AI 테스트에 재사용한다. 응답은 요청 fingerprint를 echo하며 임의 재계산한 새 해시로 바꾸지 않는다.

회수 제어: tombstone/세션 격리는 POST의 기존 원본 replay보다 우선한다(PRIVACY_RETRACTED409). QUARANTINED 중 currentDecision은 가능한 경우 INVALIDATED, lastSuccessfulState/alert는 null. Window가 없어도 분석·Export 차단은 별도 서버 privacy gate로 적용한다. ACTIVE/ENDED는 생명주기이며 PURGED 의미가 아니다. END_PENDING 일반 drain 대신 개인정보 예외 경로가 필요하다. 회수 기능은 아직 구현되지 않았다.

구성 제어: BE job의 immutable prefix·privacy/멤버 유효성 revision·cursor CAS가 기준이다. 새 방문 append/행동 PATCH는 기존 prefix를 무효화하지 않는다. 개인정보 철회/격리와 cursor 변경은 응답 폐기 사유다. AI는 ordered 방문 입력에서 멤버를 직접 구성하고 BE는 전체 결과 검증 후 원자 저장한다. revision은 BE 내부 메타이며 wire 필드를 추가하지 않는다. 상태 판단도 commit 직전 최신 행동 벡터를 확인한다.

## 실패 코드와 재시도

| HTTP/발생 영역 | code | 처리 |
| --- | --- | --- |
| BE400 / AI422 | INVALID_REQUEST | 타입/필수/관계 오류, 같은 payload 자동재시도 금지. 민감원문 반환 금지 |
| BE404 | SESSION_NOT_FOUND/VISIT_NOT_FOUND/WINDOW_NOT_FOUND | 다른 소속도404, ID를 다른 세션으로 재사용 금지 |
| BE409 | VISIT_ID_CONFLICT/VISIT_SEQUENCE_CONFLICT/VISIT_SEQUENCE_OUT_OF_ORDER/BEHAVIOR_VERSION_CONFLICT/BEHAVIOR_COUNTER_DECREASED/SESSION_ENDED/FAILURE_ID_CONFLICT/RETRACTION_ID_CONFLICT | 원본 보존·수동확인; SESSION_ENDED는 데이터ACK 아님 |
| AI409 | COMPOSE_ID_CONFLICT/ANALYSIS_ID_CONFLICT | 동일ID 다른payload, 자동재시도 금지 |
| AI409 | COMPOSE_IN_PROGRESS/ANALYSIS_IN_PROGRESS | 진행중, 구성만 승인된 bounded backoff. 현행BE 자동 분석 재시도 없음 |
| AI500/503 | AI_COMPOSITION_FAILED/AI_ANALYSIS_FAILED/AI_NOT_READY | 구성job은 같은ID·body로 bounded retry, 분석실패는 기존 실패보존. 정상라벨 대체 금지 |
| BE 내부 job/조회 code | COMPOSE_CURSOR_CONFLICT/COMPOSE_INPUT_MISMATCH | 커서/입력 바뀐 응답 미적용, 현재값으로 새job, 기존 snapshot 감사·원문회수 고려 |
| BE 내부 분석실패/조회 code | AI_TIMEOUT/AI_UNAVAILABLE/AI_INVALID_RESPONSE/ANALYSIS_QUEUE_FULL/ANALYSIS_INTERNAL_ERROR/ANALYSIS_NOT_STARTED/ANALYSIS_INTERRUPTED | 실패상태/last error, finalState=null. 늦은 응답이 확정실패 덮기 금지 |
| BE 조회 INVALIDATED/회수충돌409 | PRIVACY_RETRACTED | 분석·표시·재수집 차단, 원문 회수 완료 전 격리 |

FailureResponse는 현행 `{code,message,fieldErrors}`에 apiContractVersion=2를 추가한 **제안 v2 envelope**다. v1 오류 envelope 변경을 이미 구현한 것으로 읽지 않는다. HTTP200 내 실패 status 조회는 FailureResponse가 아니라 StatusResponse/currentDecision이다. errorCode enum의 내부 코드를 전부 외부 HTTP endpoint로 노출할 필요는 없다.
