# AI 기능명세서

## #93 개인정보 회수 구현 — 합성 검증 / 운영 BLOCKED

명시적으로 주입한 RetractionJournal은 요청 ID/세션/방문과 revision만 SQLite에 영속화한다. 같은 파일을 쓰는 Worker는 요청/추론/결과저장 전 재검사하여 Registry replay·늦은 결과를 차단하고 로컬 embedding/Registry를 비운다. 내부 route는 main에 설치되지 않으며 test fixture만 Bearer 서비스 인증으로 설치한다. ACK는 영속 격리와 호출 Worker의 cache 무효화일 뿐 다른 Worker의 즉시 물리 삭제·GPU/모델/학습 Context 캐시 삭제가 아니다. 다중 호스트 저장소/운영 인증은 미구현이다.

상세 구현·삭제/격리 Inventory·명령·실패/미검증 범위는 [개인정보 회수 검증 보고](v2-privacy-retraction-validation.md)를 따른다. 아래 과거 작업의 미구현 설명은 당시 기록이다. **P1~P6 PROPOSED, P2/P6 BLOCKED 유지.**

## 1. 범위·변경 이유

Issue #79 이후의 목표 명세와 #87 AI 구현 상태다. #79 당시 main `6e15dd3`에는 AI-001/002/003, FastAPI 연동, 학습 분류기 로드, Context 구성·캐시가 존재했다. #87은 공식 main `37706428`에서 v1을 보존하고 합성 테스트 전용 v2 API를 구현했다. 실제 범위·검증·제약은 [AI v2 검증 보고](ai-v2-window-analysis-validation.md)를 따른다. 모델 학습·운영 활성화·정책 승인은 수행하지 않았다. 유지할 설계 요구는 [수집 규격](data-collection-spec.md), P1~P6와 wire/DB는 [공통 계약](data-analysis-contract.md)을 따른다.

| 기능 ID | 변경 후 책임 | 기존 요구사항의 처리 |
| --- | --- | --- |
| AI-001 | 목표-페이지 의미적 관련성 계산 | 유지, 페이지 라벨의 근거로 사용 |
| AI-002 | 최근3개 Window 구성·페이지별 맥락/합리적 우회 판단 | 기존5개 구간 특징/중간 상태는 legacy 실험으로 보존 |
| AI-003 | 운영 최종 판단 BE 이관을 위한 페이지 예측 제공·legacy 분류기 비교 | 확률 기반 최종 분류 요구를 삭제하지 않고 v1 실험/비교로 제한 |

FE는 방문·본문·행동 수집, BE는 저장·AI 요청·Window ID 발급·최종 규칙 판단·상태 이력, AI는 Window 멤버 구성과 페이지별 의미/우회 예측이다. AI가 최종 NORMAL/TRANSITION/DRIFT를 운영 응답의 권위로 결정하지 않는다.

## 2. 공통 입력·분석 단위

- 유효 방문: 활성 체류시간 **5초(5,000ms) 이상** + 기존 콘텐츠/개인정보 조건 성공. 5초 미만/EXTRACTION_FAILED 입력은 정상 분석 대상으로 받지 않는다. 본문 최대 **5,000 Unicode code points**.
- 같은 URL <4초 복귀는 같은 visitId, >=4초는 새 visitId. AI가 URL로 방문을 병합하지 않는다. 다른 탭·reload·SPA 세부는 FE·BE 공통 계약 P1이다.
- Window Size **3**, Sliding Stride **1**. W1=[P1,P2,P3], W2=[P2,P3,P4], W3=[P3,P4,P5]. n개에서 max(0,n−2)개다.
- sequence 오름차순 인접 유효 방문을 사용하며 숫자 공백은 허용한다. sequence 의미(기존 후보 시작순서 vs 유효화 순서)는 P2 승인 사항이다. 서버 도착 시각/AI 완료 시각으로 정렬하지 않는다.
- goalText(최초 목표 문자열), title/content, searchQuery(일반 null), position/sequence를 의미 분석에 사용한다. sessionId/visitId/windowId는 식별·멱등용이다. participantId/goalId/scenario/cohort/평가 라벨/수집 환경은 모델 입력 금지다.
- v2 활성 체류·탭 전환은 BE 판단 입력이다. BE가5초·추출 성공을 검증하며 AI는 wire에 없는 체류값을 추정하지 않는다. AI 관련성 예측에 행동값이 필수라는 기존 분류기 가정을 유지하지 않는다. 모델 학습/실험에 쓴다면 별도 featureSchemaVersion으로 기록한다.

## 3. AI-001 목표-페이지 의미적 관련성

최초 목표와 제목·본문을 임베딩하여 semanticRelevance를 산출한다. 현재 `models/embedding.py`는 Qwen/Qwen3-Embedding-0.6B와 cosine similarity를 사용하며 값은 finite [-1,1]이다. 0~1 확률 또는 최종 정답 라벨이 아니다. 빈 목표·분석할 텍스트 부재는 오류이며 0으로 채우지 않는다.

입력은 goalText/title/content, 출력은 semanticRelevance와 모델/입력 버전이다. 같은 텍스트 임베딩의 기존 SHA-256 LRU 재사용은 유지할 수 있다. 새 visitId라도 동일 본문 임베딩을 재사용할 수 있으나 세션 목표가 다른 관련성 점수는 그대로 재사용하면 안 된다. 캐시 키는 실제 텍스트·모델 버전과 일치해야 한다. 캐시 eviction/재시작은 멱등 저장을 대체하지 않는다.

원본 모델 비교 요구를 유지한다: 1차 Qwen3-Embedding-0.6B, 대체 multilingual-e5-base/BGE-M3는 Validation의 관련성 품질·자원·응답시간으로 검토한다. 이 Issue에서 대체 모델/임계값을 확정하지 않는다.

완료 조건: 유효 텍스트의 수치 관련성, 형식/범위 검증, 3개 구간 통계가 필요한 실험에서 재사용 가능, 실패 전파·캐시 오염 방지. 단일 낮은 cosine으로 DRIFT를 확정하지 않는다.

## 4. AI-002 Window 구성·탐색 맥락·우회

### 4.1 구성과 식별 책임

**AI가 구성하고 BE가 식별·저장**한다. 공통 계약 P4 권장안은 AI window-compositions → BE windowId/windowIndex 발급·저장 → 기존 analyses v2 요청이다. BE가 구성한3개를 받기만 하면서 AI가 구성했다고 보고하면 안 된다. 입력은 마지막 최대2개 문맥+구성 커서 이후 신규 유효 방문이며 AI가 길이3/stride1을 적용한다. 부족하면 windows=[]로 응답한다. 1~2개는 상태 대기이며 NORMAL로 만들지 않는다.

구성 응답은 endVisitId와 순서 있는 visitIds[3], 요청 ID/세션/커서를 포함한다. BE는 검증/CAS 후 ID를 발급한다. AI는 영속 Window UUID나 stateVersion을 발급하지 않는다. 입력 재전송·번호 공백·부분 배치·재시작에서도 같은 구성을 반환해야 한다. 데이터베이스 FK와 기존 분석 복구를 살리는 두 단계 방식의 추가 왕복 비용은 BE·AI 승인 대상이다.

### 4.2 페이지별 예측

AI-001 관련성과 최초 목표·최근3개 흐름·검색 맥락으로 각 방문에 아래 label을 반환한다.

| label | 의미 |
| --- | --- |
| DIRECT | 최초 목표를 직접 수행하는 페이지 |
| JUSTIFIED_DETOUR | 표면적으로 다른 주제라도 목표 달성에 필요한 배경/비교/선행 탐색으로 설명 가능한 우회 |
| UNRELATED | 목표 수행과 관련되거나 합리적 우회라는 근거가 없는 페이지 |

응답은 visitId/position/label/semanticRelevance/rationale이며 정확한 타입은 공통 계약 §6이다. rationale은 목표와의 관계 근거이며 사용자 입력·민감 원문을 불필요하게 복제하지 않는다. 모델·프롬프트·라벨 가이드 버전을 modelVersions에 남긴다. 현행 main은 searchQuery를 DTO로 받지만 모델 PageVisit(title,content)에 넘기지 않으므로 검색 맥락 경로도 변경 대상이다. 판단할 수 없는 입력/실패를 UNRELATED나 DIRECT로 채우지 않는다. **UNJUDGEABLE은 사람 라벨**이며 AI 실패는 오류 envelope로 구분한다.

같은 방문도 다른 Window 맥락에서 우회 예측이 달라질 수 있다. 결과를 (analysisId,visitId)로 보존하고 기존 Window의 결과를 이후 맥락으로 덮지 않는다. 체류시간 갱신은 AI 재분석 사유가 아니며 BE가 해당 Window의 고정 AI 결과로 재판단한다.

### 4.3 모델·출력 검증

기존 Context 구조화 출력 검증·1회 재시도·재실패 전파를 유지한다. Context가 없어도 합리적 우회를 어떻게 분석할지는 페이지 라벨 모델 선정에서 검증해야 하며, 기존 embedding-only 분류기를 곧바로 새 페이지 예측기로 사용하지 않는다. 임의 cosine 임계값이나 기존 contextState 이름 치환으로 페이지 라벨을 확정하지 않는다.

원본 후보 Qwen3-4B, 비교 Qwen3-8B 4-bit 및 Validation 기반 품질/응답/자원 선택 요구를 보존한다. 실제 main은 CONTEXT_MODEL_NAME/CONTEXT_USE_4BIT/CONTEXT_MAX_NEW_TOKENS 설정·warm-up, 학습 캐시를 지원한다. 현재 Context enum은 **FOCUSED/JUSTIFIED_DETOUR/DRIFTING**이며 예전 명세의 NORMAL/TRANSITION/DRIFT 표기와 다르다. v1 Context 수치 goalRelevance/detourJustification/driftDegree(각0~1)는 확률·v2 페이지 라벨과 다른 특징이다.

완료 조건: AI의 실제3개 구성, 각 방문의 합리적 우회 근거·페이지 라벨, 출력 형식/범위/ID 검증, 1회 재시도와 오류 전파, Context 실패를 정상 대체하지 않음.

## 5. AI-003 운영 판단 이관·기존 분류기 보존

### 5.1 변경 후 운영 계약

AI는 페이지 예측을 제공하고 BE가 최종 상태를 판단한다. 수집 규격 §7의 순서를 사용한다: 실패/누락은 null, 최신 관련·우회는 NORMAL, 최신부터 연속 무관3개는 DRIFT, 무관1~2개 중5분 이상은 DRIFT, 모두5분 미만의 무관2개는 TRANSITION/1개는 NORMAL. 연속 범위와 최신 페이지 우선은 P5 명료화 제안이다. AI confidence나 Context 중간 상태가 이 조건을 뒤집지 않는다.

체류값이 변경되면 BE가 같은 windowId에서 stateVersion을 증가시킨다. AI는 새로운 Window·stateVersion을 만들지 않는다. 예: DIRECT,DIRECT,UNRELATED의 P3가5초에서5분이 되면 BE W1 v1 NORMAL→v2 DRIFT, AI 결과는 동일하다. AI 결과와 판단 시점 행동 스냅샷을 각각 보존해야 한다.

### 5.2 v1/legacy 요구사항과의 차이

기존 기능/코드는 제거 대상이 아니다. 아래 요구는 v1 실험/비교에 남기고 v2 최종 판단의 권위에서 제외한다.

| 원본 요구사항 | legacy 유지·현재 코드 근거 | v2 차이 |
| --- | --- | --- |
| 최근5개 관련성 평균·변화·Context·행동 특징 | pipeline.py / classifier.extract_features, 선택 use_context/use_behavior | 운영3개 페이지 예측. 특징 설계는 별도 버전 |
| Logistic Regression/Random Forest/XGBoost 비교 | models/classifier.py, training/train.py | 운영 최종상태는 BE 규칙, 연구 비교용 유지 |
| pNormal/pTransition/pDrift와 result 반환 | main.py 확률 정규화·기존 AiAnalysisClient 검증 | pageResults 필수, 최종 확률/result 필수 아님 |
| Validation 임계값 τ | 코드 threshold_gamma(γ) 사용, P(DRIFT)>=γ이면 DRIFT | 최종 상태에 확률 임계값 사용 안 함 |
| 비DRIFT 확률 우위/동률 처리 | 현재 decide는 pNormal>=pTransition이면 NORMAL(동률 포함) | BE 규칙에 동률 개념 없음 |
| Context 사용/제거 구성 비교 | 학습된 artifact의 use_context, from_default 설정 일치 검증 | 우회 예측 성능을 입증한 모델 경로 필요 |
| 입력·특징·모델 버전/확률 보존 | inputSnapshot/featureSnapshot/modelVersions | 예측과 상태 이력·정답을 분리 |

기존 평가 지표 Macro F1, 클래스별 F1, DRIFT Recall, 오알림률, Train/Validation 격차·추론시간·탐지 지연은 연구 비교 요구로 유지한다. v2는 페이지 라벨 품질과 BE 규칙의 Window/상태이력 품질을 따로 평가한다. Test를 모델/규칙/임계값 튜닝에 쓰지 않는다. 이번에 모델 종류·프롬프트·페이지 분류 임계값을 임의 확정하지 않는다.

완료 조건: 운영 최종 판단의 BE 이관, v1/v2 결과 구분, 실패를 상태로 대체하지 않음, legacy 비교 재현, 공통 목표 split/정답 분리 준수.

## 6. API·오류·비동기

실제 기존 경로 `POST /api/ai/analyses`를 유지하고 apiContractVersion=2로 구분한다. v1은5개+확률 응답, v2는3개+페이지 응답이다. #87에서 구성 endpoint와 v2 분석을 합성 테스트 전용으로 구현했다. 정책 P4는 여전히 PROPOSED다. 모든 타입·필수값·생성 주체·저장 위치·오류는 공통 계약 §3~6 및 Schema를 단일 기준으로 삼는다.

- 같은 analysisId+같은 요청 완료는 동일 응답, 다른 payload는409 ANALYSIS_ID_CONFLICT, 진행 중은409 ANALYSIS_IN_PROGRESS.
- INVALID_REQUEST(422), AI_ANALYSIS_FAILED(500), AI_NOT_READY(503), 공통 `{code,message,fieldErrors}`를 유지한다. Context 재시도1회는 서버 출력 검증에 적용한다. 통신 재시도와 구분한다.
- 현재 AnalysisRegistry는 최근1000건 메모리이며 재시작·eviction 후 영속 멱등을 보장하지 않는다. BE 작업/Window UNIQUE와 소유권 검증이 저장의 진실이다. BE timeout 이후 늦은 결과로 완료/실패를 덮지 않는다.
- ID·position·소속·label·수치/시각·버전 검증 실패는 AI_INVALID_RESPONSE이며 NORMAL로 저장하지 않는다. 세션 종료 후 결과는 평가용 기록만 가능하고 알림은 금지한다.
- 기존 HTTP/1.1 연동, 임베딩 캐시·warm-up·Context 설정 및 입력 검증을 유지한다. timeout/구성 왕복 예산은 BE·AI 파일럿 합의 사항이다.

## 7. 데이터셋·정답·학습 입력

확정 수집 목표는20목표·10명·160세션, 참여자당 서로 다른16목표·시나리오별4세션, 세션당 최소10/권장12~15 유효 페이지, 최소1,200 Window, 추가 자연20~40세션이다. 상태 버전을 Window 수로 중복 집계하지 않는다. 상세 수집 시나리오·실패 제외/메타는 수집 규격 §9 및 공통 계약 §9를 따른다.

라벨 단위는 Page(DIRECT/JUSTIFIED_DETOUR/UNRELATED), Window(NORMAL/TRANSITION/DRIFT), windowId+stateVersion(NORMAL/TRANSITION/DRIFT)이다. 판단 불가는 UNJUDGEABLE로 관리한다. 3인 독립 라벨과 합의를 모두 저장하며 Fleiss' κ는 합의 전 투표로 계산한다. AI/BE 예측을 정답으로 복사하지 않는다. 정적 Window 기준 스냅샷·판단불가 κ 처리·보존기간은 P6 승인 대상이다.

Train12/Validation4/Test4 **목표 단위** 분리를 먼저 고정한다. 동일 목표의 세션·Window·모든 stateVersion·자연 탐색 자료는 같은 split이다. 네 작업 영역이 각 split에 포함되도록 한다. 현행 training loader의 5개 candidateLabel/UNREVIEWED와 GOAL-001 세션 LOSO는 임시 코드 확인용이고 이 본 수집 계약을 충족한 성능 평가가 아니다. v2 loader/feature 스키마/라벨 가이드는 후속 Issue에서 변경하며 기존 artifact를 덮지 않는다.

## 8. 연관 기능·통합 수용 기준

| 기능 | 연결 |
| --- | --- |
| BE-003/006 | 방문·행동 저장. AI는 원본 누적값을 수정하지 않음 |
| BE-004 | 구성·분석 요청, 오류/중복/ID 검증 |
| BE-007 | AI 원본 및 BE 최종 판단 이력 저장 |
| BE-009 | AI 구성 결과 검증·UUID 발급·Window 저장 |
| FE-008 | BE가 승인한 최신 DRIFT 후보 표시. AI 중간 결과로 직접 알림 금지 |

통합 검증은 첫2방문 대기,3/4/5방문 Window1/2/3, stride1, 같은 구성 멱등, 각 페이지 라벨/실패 분리, 5분 체류만 변경 시 AI 호출/Window수 불변, 목표 split 누출 방지, 종료·역순 응답 알림 차단이다. 공통 계약 §12와 연결한다. #87 AI API·Mock 경계 검증과 BE 기존 회귀는 [검증 기록](data-contract-validation.md), 실제 모델 미실행·통합 미구현 경계는 [AI v2 보고](ai-v2-window-analysis-validation.md)에 구분한다.

## 9. 원본과 미확정 항목

AI-001/002/003 ID와 모델 비교·특징/확률·검증/실패 요구는 위에서 유지/역할 변경/legacy 범위를 명시했다. 원본 개별 명세는 현재 저장소에 없으며 통합 문서의 기능 정의를 기준으로 삼았다. project-plan/README의5개 최종 분류와의 차이는 공통 계약 §10에 기록한다.

P2 순서 의미, P4 두 단계 구성 API, P5 suffix/버전 판단, P6 라벨 스냅샷·관리 정책을 승인해야 한다. 모델/프롬프트·페이지 라벨 품질·Context 유지 여부·성능 예산은 실제 Validation/파일럿으로 결정한다. 추측한 모델 성능·학습 완료·3개 계약 구현 완료를 보고하지 않는다.

### #81 AI 구현 계약 보충 — PROPOSED

#83의 [승인 요청](v2-contract-approval.md)은 이 설계를 PROPOSED로 유지한다. AI가 ordered stream에서 실제 Window를 선택해야 하며 BE가 미리 만든 triples를 반환만 해서는 안 된다. 회수 중 늦은 추론이 registry/임베딩/Context 캐시를 재오염시키지 않도록 유효성 재확인·폐기/전체 캐시 격리 경로가 필요하다. 기존 학습 loader는 5개 및 연속 숫자를 요구하므로 v2 sparse sequence·목표12/4/4용 loader가 별도로 필요하다. 실제 학습·모델 변경은 이번 범위가 아니다.

[결정안 P4](v2-contract-decisions.md#6-p4--ai-구성과-be-저장)의 권장 A는 모델이 필요 없는 구성 API → BE 식별·저장 → 기존 analysis API v2다. 구성 입력은 visitId/sequence만이며, afterSequence 이하 직전 최대 두 방문과 신규 prefix로 AI가 인접 세 방문을 stride 1로 구성한다. 1~2개는 windows=[]이지만 커서는 전진한다. 숫자 공백은 허용하고 저장 방문 누락·역순·중복은 허용하지 않는다. 기존 pipeline.iter_windows는 5개 오프라인 도구이며 현재 구성 endpoint가 있다는 뜻이 아니다.

CompositionRequest/Response, AnalysisRequest/Response, FailureResponse는 [Schema](contracts/v2/README.md)를 따른다. apiContractVersion=2, 요청 fingerprint echo, position 1~3과 visitId 일대일 검증, finite cosine [-1,1], 페이지 label·근거·모델 네 종류 버전이 필수다. 행동값·사람 정답·참여자 메타는 입력하지 않는다. 최종 상태는 BE가 판단하며 v1 분류기·확률 API는 제거하지 않는다. v1의 searchQuery 미전달 동작은 보존하며 #87의 독립 v2 경로에서 검색어를 실제 임베딩·LLM 입력에 전달한다.

## #87 구현 상태 — 합성 테스트 전용

- 기본 비활성. `AI_V2_PROFILE=synthetic-test`와 `AI_V2_ENABLED=1` 조합만 허용한다. prod·복합 프로필은 503이며 운영 승인 옵션이 아니다. P1~P6 PROPOSED/P2·P6 BLOCKED 유지.
- `v2/contracts.py`가 공통 Schema로 요청/응답 DTO를 검증한다. UUID v4, 필수/null/추가필드, UTC 밀리초·실제 날짜, 길이·관계·canonical fingerprint를 검사한다. OpenAPI도 같은 Schema와 기존 v1 DTO를 제공한다.
- 구성은 모델 독립 size3/stride1. 1~256 방문, sparse sequence, tail 최대2·커서 방문·신규 경계를 검사한다. DB prefix 누락과 진짜 tail identity는 BE 책임이다. AI는 UUID/index를 발급하지 않는다.
- `PageAnalysisModel`은 기존 Qwen3 임베딩과 `LocalContextModel._generate`의 실제 tokenizer/CausalLM 생성을 사용한다. v1 Context 분석·Classifier는 호출하지 않는다. 최초 목표와 3개 페이지 전체 제목·본문·검색어를 JSON으로 전달한다. cosine 임계값으로 라벨을 정하지 않는다.
- 임베딩 페이지 텍스트는 `{searchQuery,title,content}` JSON, 목표는 별도 인코딩이다. LRU 키에 입력 형식·모델·세션·실제 텍스트를 포함하며 목표별 점수 캐시는 없다. 검색어는 자신의 방문과만 결합한다.
- 프롬프트 `page-context-v2-proposed.1`, 라벨 가이드 `page-label-v2-proposed.1`은 코드 내 정의의 개발 버전이다. 기본 모델은 Qwen/Qwen3-Embedding-0.6B와 Qwen/Qwen3-4B이며 응답은 실제 인스턴스 설정을 기록한다. 품질 승인/평가된 버전이 아니다.
- LLM JSON의 ID·position·라벨·근거를 검증한다. 부적합 출력만 1회 재생성, 재실패·임베딩 오류·비유한 수치는 500이다. v2는 확률·최종 상태·원문 예외를 반환하지 않는다. 생성1024토큰·추론60초·잠금 대기는 개발 한도이며 생성 timeout은 step 단위 soft limit이다.
- `V2Service.invalidate_visits`는 v2 Registry 전체·공유 임베딩 캐시를 비우고 generation으로 늦은 저장을 막는 내부 격리 hook이다. v1 Registry·학습 Context JSONL·외부 사본 회수와 메모리 보안 삭제는 미구현이다. BE 외부 회수 API와 연결되지 않았으며 삭제 완료를 반환하지 않는다.
- AI 테스트 220건 통과. 실제 모델 스모크 preflight는 의존성·로컬 가중치 부재로 SKIPPED다. 실제 모델 로드·추론·정확도·우회 판단 품질은 미검증이다.

메모리 registry와 embedding LRU는 재시작·eviction으로 영속 멱등을 보장하지 않으며 BE job·UNIQUE가 기준이다. 기존 Context 중간 enum을 새 페이지 label로 치환하지 않는다. 추론 실패는 일반 메시지로 반환하고 현재 exception str·traceback의 원문 노출 가능성을 후속 수정한다. 회수는 캐시·입출력 snapshot·학습 Context 캐시·Export·모델 artifact 영향까지 처리한다. 방문별 캐시 역색인이 없으면 관련 캐시 전체 폐기 등 검증 가능한 절차가 필요하다. AI·BE·데이터 승인 전 운영 확정 계약이 아니다.
