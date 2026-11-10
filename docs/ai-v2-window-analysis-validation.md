# Issue #87 — AI v2 Window 구성·페이지 분석 구현 검증

2026-11-10 KST. **합성 데이터 전용 구현. P1~P6 PROPOSED, P2/P6 개인정보 선결 BLOCKED 유지.** 실제 모델 로드/추론·정확도·합리적 우회 판단 품질은 미검증이다. API/검증·실제 모델 호출 경로 구현과 실제 모델 실행 증거를 구분한다.

## 1. 작업 전 Git과 공식 main

- 시작: detached HEAD `6e15dd3fa1789e96c42bc4f33250c4221d6d2616`, tracked 수정/미추적 파일0.
- origin: `https://github.com/hyeon-marina/2026-2-Capstone-T01-focus-recovery.git`.
- upstream: `https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery.git`.
- `git fetch upstream main`, `git fetch origin` 후 공식 main `37706428a693b127ad0d3334bcc08310b4b56fec`에서 `feat/87/ai-v2-window-analysis` 생성. 제출 전 ls-remote에서도 같은 main SHA와 기존 원격 작업 브랜치 부재를 확인했다.
- worktree Git 메타데이터가 공용 저장소 외부에 있어 fetch/branch 작업만 sandbox escalation으로 수행했다. 파괴적 reset/clean/강제 Push, 공식 main 직접 Commit/Push는 하지 않았다.
- 별도 AGENTS.md/CONTRIBUTING 없음. project-plan의 develop 방침보다 이번 사용자의 공식 main 대상 지시를 따른다. `.github/pull_request_template.md` 사용, 한국어 Commit, 자동 Merge/후속 Issue 생성 없음.

## 2. 요구사항과 기존 코드 확인

[#87](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/87) 본문·댓글0, [#85](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/85), 병합된 [PR #86](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/pull/86)의 본문과 실제 main 파일을 대조했다. 지정된 AI/공통/수집/결정/승인/Schema/두 Fixture/검증/BE 저장 보고서를 읽었다. Schema나 구현을 정책 승인으로 보지 않는다.

| 기준 main에서 확인한 동작 | 이번 구현과의 구분 |
| --- | --- |
| main.AnalysisRequest는 5방문, position 정렬, UUID 일반 검증, 완화된 필드/추가필드 처리 | 기존 v1 DTO/검증 보존. v2는 Schema 직접 검증·정확히3개·추가필드 거절 |
| pipeline.iter_windows는 5개 오프라인 도구 | 별도 HTTP 구성 API가 실제 ordered stream에서 인접3개를 선택 |
| Qwen3-Embedding-0.6B, Title/Content cosine | v1 유지, v2에 searchQuery/title/content JSON 입력 추가 |
| Context는 5개 전체의 FOCUSED/JUSTIFIED_DETOUR/DRIFTING·수치 특징 | 같은 tokenizer/CausalLM 생성기를 이용하는 별도 페이지 프롬프트/JSON 경로. enum 매핑 없음 |
| Classifier는 NORMAL/TRANSITION/DRIFT·확률, 학습 artifact 필요 | v1 보존. v2는 Classifier·행동 특징·최종 상태 계산을 호출하지 않음 |
| searchQuery DTO는 있으나 run_analysis의 PageVisit에는 전달되지 않음 | v1 유지. v2에서 방문별 query를 임베딩과 LLM 양쪽으로 전달 |
| AnalysisRegistry는 최근1000 메모리, 완료 eviction·진행중 보존·실패 discard | 기존 동작 보존. 별도 v2 Registry는 실패 fingerprint도 eviction까지 보존 |
| 학습 Context 캐시는 모델 설정/토큰수/system+user prompt hash → JSONL 결과 | 수정/재사용하지 않음. v2는 Context 결과 파일 캐시를 만들지 않음 |

## 3. 실제 변경 파일

AI 파일15개:

- `ai/main.py`: v1/v2 분기·격리된 오류 처리·로더·공통 Schema OpenAPI.
- `ai/models/context.py`: v1 기본값 보존, system prompt/soft timeout 주입·v2 context capacity 검사·민감 오류 로그 제거·ML import 지연.
- `ai/models/embedding.py`: v1 입력/기본 키 유지, v2 query 입력·namespace·generation 무효화.
- `ai/v2/__init__.py`, `ai/v2/contracts.py`, `ai/v2/model.py`, `ai/v2/service.py`.
- `ai/tests/conftest.py`, `ai/tests/test_v2_api.py`, `ai/tests/test_v2_models.py`, `ai/tests/test_privacy_and_v1.py`.
- `ai/requirements.txt`, `ai/requirements-test.txt`, `ai/smoke_v2.py`, `ai/README.md`.

문서: `docs/ai-spec.md`, `docs/data-analysis-contract.md`, `docs/data-contract-validation.md`, `docs/contracts/v2/README.md`, 이 보고서. `docker-compose.yml`에는 공통 Schema의 AI read-only mount 한 줄을 추가했다. BE/FE 제품 소스·DB Migration·공통 Schema/Fixture·pipeline.py·Classifier·training·기존 가중치/산출물은 변경하지 않았다.

## 4. Window 구성 API

`POST /api/ai/window-compositions`: 모델 없이 구성한다. 총1~256개 identity를 순서대로 검사하고 인접3개/stride1을 선택한다. 숫자 공백1,3,4,6은 [1,3,4]/[3,4,6]이다. 1~2개는 windows=[]와 마지막 방문 커서를 반환한다. 다음 배치는 이전 최대2개 tail+신규 방문을 전달한다. 구성 중 부분 성공은 없다.

Schema 타입/UUID/범위·추가필드 외에 visitId 중복, 동일/역순 sequence, 신규 없음, tail>2, after>0인데 해당 커서 방문이 없음·tail 마지막과 불일치하는 입력을 거절한다. `composedThroughSequence`는 마지막 신규 sequence다. AI는 windowId/windowIndex를 발급하지 않는다.

AI는 DB의 실제 prefix/tail을 모른다. sparse sequence만으로 실제 저장 방문 누락을 판정할 수 없다. 기존 `omitted-visit`와 `missing-tail` Fixture는 외부 DB 사실로 BE가 COMPOSE_INPUT_MISMATCH를 반환하는 사례다. AI 내부 검사를 통과할 수 있음을 별도 테스트했다. BE의 CompositionService가 진짜 tail/prefix·소속·개인정보·cursor CAS와 전체 결과를 검증해야 한다.

## 5. v2 분석 API·DTO

`POST /api/ai/analyses`: 버전 없음 또는1은 기존 v1,2는 독립 v2다. 미지원/잘못된 버전은422이며 v2 실패를 v1으로 전달하지 않는다.

DTO는 [공통 Schema](contracts/v2/v2.schema.json)의 명명된 `$defs`를 직접 검증한다. 필수·null·추가필드·UUID lowercase v4·실제 UTC 밀리초 날짜·길이/범위·검색 분기를 적용하고, 정확히3개/순서1,2,3/visitId 중복 없음/sequence 단조 증가/fingerprint를 추가 검사한다. 목표 공백만·본문 공백만·검색어 공백만도 거절한다. 원문을 trim/Unicode 정규화한 뒤 hash하는 방식이 아니다.

검색 페이지 query 필수·본문1~5000, 일반 query=null·본문50~5000, 제목<=500, 목표5~150이다. JSON 중복 key와 NaN/Infinity도 거절한다. 행동·평가 라벨·참여자·split 메타는 추가필드이므로 거절하며 모델 입력에 쓰지 않는다. response의 ID/hash/window/페이지 pairing·라벨·범위·근거/버전/시각도 검증한다.

성공은 pageResults[3]/modelVersions/analyzedAt이며 최종 상태·확률·stateVersion을 넣지 않는다. FailureResponse는 apiContractVersion/code/message/fieldErrors다. 422 INVALID_REQUEST,409 ID_CONFLICT/IN_PROGRESS,500 AI_COMPOSITION_FAILED/AI_ANALYSIS_FAILED,503 AI_NOT_READY를 사용한다. 내부 격리 hook 이후에는409 PRIVACY_RETRACTED다. 상세 원문·traceback·모델 출력으로 HTTP 메시지나 field path를 만들지 않는다.

## 6. 모델·프롬프트·페이지 판단

기존 기본 Qwen/Qwen3-Embedding-0.6B와 ContextModelConfig(Qwen/Qwen3-4B, 선택 Qwen3-8B/4-bit 설정)를 사용한다. 대체 모델을 선정하거나 학습하지 않았다. v2는 v1이 embedding-only이거나 학습 Classifier가 없어도 별도 Context 모델을 준비한다. v1 모델이 준비되어 있으면 같은 인스턴스와 추론 잠금을 재사용한다. ML 라이브러리 import를 로딩 시점으로 미뤄 구성 API가 모델 준비와 독립적으로 동작한다.

실제 경로는 `PageAnalysisModel.analyze → context._generate → tokenizer.apply_chat_template → tokenizer → model.generate → decode`다. system prompt는 v1과 다르며 원래 목표를 고정하고 순서 있는3개 방문의 전체 제목·본문·query를 JSON으로 제공한다. v1의600자 본문 제한을 v2에 적용하지 않는다. 모델 context capacity 초과는 오류이며 조용히 truncate하지 않는다.

DIRECT/합리적인 배경·비교·선행 학습의 JUSTIFIED_DETOUR/근거 없는 UNRELATED를 페이지별로 설명하도록 한다. cosine 값은 라벨 결정 프롬프트에 넣지 않으며 임계값/이름 치환이 없다. 문서 안의 지시를 데이터로 취급하도록 지시한다. 다만 prompt injection 저항성은 실증 평가하지 않았다.

프롬프트 `page-context-v2-proposed.1`, 라벨 가이드 `page-label-v2-proposed.1`은 코드 내 정의의 개발 버전이다. 응답 embedding/context에는 실제 인스턴스의 model_name/config.version을 기록한다. 프롬프트/guide가 검증·승인되었다는 의미가 아니다. 모델 디렉터리와 선언 모델의 일치·artifact 고정은 운영 준비 시 확인해야 한다.

출력은 정확한 JSON 하나만 수락한다. 페이지 ID/position·필드·라벨·근거가 잘못되면1회 재생성하고 재실패는500이다. 추론 예외는 정상 라벨로 대체하지 않는다. 근거는1~500자 비공백, 개인정보/민감 원문을 반복하지 않도록 지시하고 이메일/URL/긴 숫자·공백 정리 후40자 연속 원문 인용을 거절한다. 이 검사는 완전한 개인정보 탐지기가 아니며 안전성·의미 있는 근거의 품질은 미검증이다.

기본 v2 생성1024토큰·추론60초·최대2회 출력 검증 시도를 사용한다. 잠금 대기도 timeout으로 제한한다. `max_time`은 생성 step 경계의 soft limit이며 tokenize/encode/GPU hang·진행 중 연산의 강제 중단을 보장하지 않는다. 계산이 끝나도 deadline을 넘긴 결과는 오류로 폐기한다. hard timeout/프로세스 격리는 후속이다.

## 7. semanticRelevance와 searchQuery

목표 원문을 별도로 인코딩하고 각 방문의 `{searchQuery,title,content}` compact UTF-8 JSON을 인코딩한 뒤 기존 util.cos_sim으로 계산한다. 일반 query는 null이다. query는 해당 방문의 제목/본문 객체에만 넣고 LLM에도 같은 방문 객체로 전달한다. 임베딩 실패·빈 텍스트·finite[-1,1] 밖 수치는 오류이며 확률·정답으로 해석하지 않는다.

v1은 기존 `Title: ...\nContent: ...`와 SHA256(text) LRU를 유지한다. v2 LRU 키는 `v2-page-text.1`, 모델명, 세션 namespace, 실제 텍스트를 포함한 hash다. 목표 벡터도 실제 목표 텍스트로 구분하고 관련성 점수 자체를 visitId로 캐시하지 않는다. 다른 목표/모델/검색어/세션의 잘못된 재사용을 가짜 encoder로 검증했다. 실제 모델은 기존 SentenceTransformer의 인코딩 설정을 사용하며 그 truncation/관련성 품질은 별도 실측 대상이다.

## 8. Fingerprint·멱등성

fingerprint 필드만 제외, key 재귀 정렬·배열 순서 보존·UTF-8·compact JSON·Unicode 비정규화·SHA256 lowercase hex를 사용한다. Schema가 정수값으로 허용하는1.0은 불필요 소수 없는1로 직렬화한다. golden 요청/한글/비BMP/조합문자/제어문자와 Python reference 함수를 비교했다. 응답은 요청 hash를 echo한다.

별도 v2 Registry는 구성/분석 각각1000개, 동일 ID·같은 입력은 완료 응답 재사용, 다른 입력은409, 진행 중은409다. 실패는 결과를 저장하지 않고 같은 입력 재시도를 허용하며 ID와 fingerprint 결합은 eviction까지 보존한다. 완료/실패의 오래된 항목부터 eviction, 진행 중만 가득하면503으로 용량을 제한한다. 동일 요청 동시 실행을 실제 테스트 스레드로 검사했다.

메모리 Registry는 BE 영속 Receipt/Outbox를 대체하지 않는다. eviction 후 ID 충돌을 기억하지 못하고 재시작 시 모두 사라진다. 두 별도 Python 프로세스에서 같은 ID의 다른 입력이 수락됨을 검사했다. 구성은 같은 입력을 재계산해도 같은 멤버지만 분석은 재추론될 수 있다. 영속/다중 프로세스 멱등 보장은 없다.

## 9. v1 호환성

기존 AnalysisRequest/VisitRequest의 필드명·타입·완화된 규칙·position 정렬,5방문,확률 합 정규화,Context/featureSnapshot/modelVersions/analyzedAt 응답을 유지했다. BE AiAnalysisRequest 모양으로 실제 FastAPI 호출 후 기존 Client의 ID/확률/필드/시각 조건과 대조했다. 같은 UUID의 v1/v2 Registry 분리·v2 실패 시 v1 미호출도 검사했다.

pipeline.py·Classifier·training·학습 artifact는 변경하지 않았다. 기본 임베딩 키·입력과 Context128토큰·기존 system prompt·5방문 validation·중간 enum도 보존한다. 모델 warm-up과 로드 실패503 동작을 유지한다. 공통 예외의 원문/traceback 출력은 v1에서도 일반 메시지로 바꾸되 오류 envelope·code·HTTP 상태는 유지했다.

Python 회귀는 Mock pipeline·가짜 encoder/tokenizer/generate를 사용한다. 기존 BE AnalysisIntegrationTest38건은 JDK 모의 AI HTTP 서버 기반이며 새 Python 서버와의 E2E는 아니다. 실제 v1 artifact 로드/확률 추론·학습 재실행은 하지 않았다.

## 10. BE 계약 대조·정상/오류 예제

| 실제 BE 경계 | AI 대조 결과/후속 |
| --- | --- |
| CompositionService/Composition.Input·Output | 필드·hash·after/through·전체 stride1·endVisitId 일치. DB prefix/진짜 tail·privacy revision/CAS/원자 저장은 BE |
| ComposeRequest | 동일 ID/hash/snapshot·lease/token/Receipt 영속. AI Registry는 재시작 시 손실 |
| V2AnalysisInput | 정확한3방문·검색 필드·UTC millis·goal/hash·추가필드 없는 wire와 일치 |
| V2AnalysisCompletion | ID/hash/pageResults·4종 modelVersions·시각 일치. 상태/확률 없음 |
| AnalysisOutbox/V2AnalysisOutboxService | claim→tx 밖 HTTP→complete가 후속. lease60초·늦은 완료 거절·분석 자동 재시도 없음 보존 필요 |
| CanonicalJson | Python golden과 Java 기존 테스트 통과. 현재 입력 key는 고정 ASCII, 값 Unicode 정규화 없음 |
| V2StorageGate | BE 정확히 test+flag, AI 정확히 synthetic-test+flag. 합성 전용 설정이 서로 다름을 통합 harness가 명시해야 함 |

현재 필드/형식 불일치를 감추기 위한 Schema/BE 수정은 없다. 기존 AiAnalysisClient는 v1 확률 응답 전용이므로 v2를 그대로 보내면 안 된다. BE 기본 response timeout10초 및 lease60초와 AI soft budget60초+잠금 대기를 그대로 조합하면 완료 전에 timeout/lease가 끝날 수 있다. 실측 후 dispatcher의 예산·취소·지연 응답 처리를 설계해야 한다.

정상 요청/응답은 [공통 Fixture](contracts/v2/fixtures/schema-cases.json)의 `compose-1`/`composed-1`, `analysis-request`/`analysis-response`를 사용한다. 라벨 예시는 합성 계약 모양이며 실제 모델 예측이 아니다. 실제 API 경로의 query pairing·3종 라벨 모양 검증은 Mock 결과를 사용했다. FailureResponse 예:

```json
{"apiContractVersion":2,"code":"ANALYSIS_IN_PROGRESS","message":"요청을 처리할 수 없습니다.","fieldErrors":[]}
```

422/409/500/503과 `COMPOSE_ID_CONFLICT`/`COMPOSE_IN_PROGRESS`/`ANALYSIS_ID_CONFLICT`/`ANALYSIS_IN_PROGRESS`/`AI_NOT_READY`/`AI_ANALYSIS_FAILED`의 HTTP 예제는 `ai/tests/test_v2_api.py`와 `test_v2_models.py`에서 실제 FastAPI 응답을 검사한다.

## 11. 개인정보·캐시 경계

`V2Service.invalidate_visits(visit_ids)`는 인증된 외부 API가 아닌 내부 hook이다. 알려진 ID를 프로세스 내 차단 집합에 넣고 모든 v2 Registry와 공유 임베딩 캐시를 보수적으로 무효화한다. visit→cache 역색인이 없어 표적 삭제로 주장하지 않는다. Context 모델은 inference KV/로컬 변수를 영속 결과 캐시로 저장하지 않으며, v2는 학습 Context JSONL을 읽거나 쓰지 않는다.

서비스 generation을 요청 시작·잠금 획득·완료 시 확인한다. 임베딩 generation을 요청 전체에서 고정하여 invalidate 이후에 시작되는 남은 encode와 늦게 끝난 encode도 이전 세대 캐시를 재생성하지 못하게 한다. 관련 없는 진행 중 v2도 전체 무효화로 폐기할 수 있다. 격리 검사는 receipt replay보다 앞이다.

이는 Python 객체 참조/재사용 경계다. 이미 실행 중인 요청·모델/GPU 메모리의 원문을 강제로 지우거나 응답을 회수하는 보안 삭제를 보장하지 않는다. v1 진행 중/재요청이 새로 만드는 v1 namespace 캐시는 이 v2 hook의 차단 대상이 아니다. v1 Registry·학습 Context JSONL·Export·로그 과거본·백업·학습 artifact 영향·외부 사본도 회수하지 않는다. 재시작 시 차단 집합도 사라지고 프로세스 간 전파도 없다. BE의 영속 세션 격리와 동일 기능이 아니며 전체 개인정보 회수 완료/PURGED를 반환하지 않는다.

## 12. 실행 명령과 결과

환경: macOS27.2 arm64, Python3.11.16. 기존 Python에 FastAPI/Pydantic/ML 라이브러리 없음. 기존 AI 테스트 없음. 임시 venv만 생성하고 ML 라이브러리/모델은 설치하지 않았다. 테스트 환경 FastAPI0.162.2/Pydantic2.14.3/Starlette1.10.0/httpx0.28.1/pytest9.2.0/jsonschema4.26.0. 기존 제품 ML requirements는 보존하고 런타임 Schema 검증 의존성만 추가했다.

```sh
# 수정 전
/private/tmp/focus81-validator/bin/python docs/contracts/v2/validate.py
python3 -m pytest ai --collect-only -q
# reference PASS: Schema80/scenarios139/rule216/kappa4
# AI: no tests collected, exit5

# 이번 임시 환경 준비
python3 -m venv /private/tmp/focus87-ai
/private/tmp/focus87-ai/bin/python -m pip install -r ai/requirements-test.txt

# 최종 AI 검증
/private/tmp/focus87-ai/bin/python -m pytest ai/tests -q --tb=short --junitxml=/private/tmp/focus87-ai-results.xml
# 220 passed; Starlette httpx deprecation 경고1, failures0

cd be
./gradlew test --tests '*AnalysisIntegrationTest' --tests '*V2GateAndFingerprintTest'
# 38+8=46 tests, failures0/errors0/skipped0
cd ..

/private/tmp/focus87-ai/bin/python docs/contracts/v2/validate.py
python3 -m compileall -q ai
git diff --check

# 실제 모델용 별도 오프라인 preflight
/private/tmp/focus87-ai/bin/python ai/smoke_v2.py
# SKIPPED: torch/transformers/sentence_transformers + local models absent
```

설치는 위 requirements-test와 같은 API/테스트 의존성을 명시한 pip 명령으로 수행했다. 최초 테스트에서 Schema 탐색 parent 경로 오류를 발견해 수정했다. 공유 Fixture를 한 Registry에 다른 입력/같은 ID로 넣은 신규 테스트 구성 오류도 독립 파라미터로 수정했다. 기존 Fixture 기대값이나 BE 테스트는 바꾸지 않았다. 최종 문서 reference 검사도 통과했으며 제품/모델 실행으로 집계하지 않는다.

## 13. Mock 검증과 실제 모델 검증의 구분

AI220건 중 Schema 모양80건·reference 요청17건·나머지 API/Mock/캐시/v1 회귀123건이다. FakeContext는3종 고정 라벨을 반환하지만 **테스트에서만** 사용한다. 제품 PageAnalysisModel은 실제 CausalLM generate를 호출하며 고정 라벨 구현이 없다. fake tokenizer/encoder는 생성 옵션·입력 결합·cache/late write를 검사하는 수단이다. Mock 정상 라벨은 실제 모델 품질의 증거가 아니다.

실제 모델 스모크 도구는 로컬 가중치가 있고 의존성이 있을 때만 offline load/warm-up/합성3방문/구조화 응답/시간/장치/모델 버전을 기록한다. 이번에는 preflight만 실행했고 모델 로딩 성공·실제 응답·판단 실패 사례를 관측하지 못했다. 스모크가 성공하더라도 정확도 평가가 아니다.

## 14. 미실행 검증과 사유

- 실제 Qwen 임베딩/Context 모델 로드·추론·warm-up·GPU/CPU 메모리·지연: 로컬 가중치/의존성 부재. 다운로드나 환경 대규모 변경 안 함. macOS arm64만 확인했고 실제 추론 장치는 미선택, RAM/VRAM 실측 미확보.
- 실제 v1 artifact/학습·benchmark: artifact/ML 런타임 없음, 기존 학습·가중치 변경은 범위 밖.
- 새 AI 서버+BE dispatcher E2E: BE 실제 HTTP/dispatcher가 아직 구현되지 않음. 모의 통합과 계약 대조로 한정.
- FE/운영 DB·새 Migration·전체 BE436건/MySQL 재실행: 변경 범위 밖. BE의 기존 관련46건만 실행했고 과거436건을 이번 PASS로 세지 않음.
- 다중 worker/다중 서버·고부하·hard hang·실제 개인정보 삭제/복원/외부 사본 전파: 관련 통합 경계와 승인/인프라 미완비.

## 15. 미확정 모델 품질

DIRECT/우회/무관의 정확도·Macro F1·클래스별 혼동·근거 충실도·cosine 해석 적절성·검색/비검색 편향·prompt injection/개인정보 탐지·다국어·긴 문서·Window 문맥 효과는 평가하지 않았다. 검증되지 않은 Qwen3-4B 페이지 프롬프트가 성능을 보장한다고 보고하지 않는다. 목표 단위 Train12/Validation4/Test4·사람 독립 라벨/합의·blind 평가와 P6 동의/보존 승인 이후 별도로 평가해야 한다.

## 16. 후속 BE·AI 작업

1. BE composition claim→tx 밖 HTTP→complete/retry와 분석 Outbox dispatcher/엄격한 v2 응답 어댑터를 연결한다. 기존 v1 Client에 v2를 전달하지 않는다.
2. timeout/backoff/lease·queue·취소·hard process deadline과 자원 한도를 실제 모델로 측정한다. 실패 확정 뒤 늦은 응답의 저장을 차단한다.
3. 실제 모델 offline 스모크 후 Validation용 페이지 프롬프트/라벨 가이드/버전·재현 가능한 artifact와 장치 구성을 고정한다. 평가 없이 모델/임계값을 확정하지 않는다.
4. BE 인증/소유권/세션 격리·모든 AI 프로세스 캐시 hook 전파·재시작 복원·학습/Export/백업 lineage·실제 회수 증거를 연결한다. v1 Registry와 학습 캐시도 별도 대상이다.
5. BE 최종 상태 규칙·dirty fanout·state 이력 조회·stateVersion 알림·FE 전환과 승인된 통합 검증을 진행한다. 이번에는 BE/FE 제품 코드를 수정하지 않았다.
6. P1~P6 승인 및 P2/P6 BLOCKED 해제 증거를 확보한 후에만 운영 활성화를 검토한다. 합성 profile/flag는 운영 승인 경로가 아니다. 후속 GitHub Issue는 자동 생성하지 않았다.

## 17. Commit·Push

개인 Fork의 `feat/87/ai-v2-window-analysis`로만 제출한다. Commit SHA·Push 결과는 최종 작업 보고/PR에 기록한다. 이 문서 안에 자기 자신의 최종 Commit SHA를 고정하지 않는다.

## 18. PR

공식 저장소 main 대상, 제목 `[Feat/#87] AI v2 Window 구성 및 페이지별 관련성 분석 API 구현`, 저장소 PR 템플릿의4개 항목을 사용한다. PR URL 또는 권한 오류·비교 URL은 최종 작업 보고에 기록한다. 자동 Merge하지 않는다.
