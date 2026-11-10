# AI

Focus Recovery의 AI 분석 영역입니다.

사용자가 입력한 최초 작업 목표와 최근 웹 탐색 흐름을 분석하여,
현재 탐색 상태를 `NORMAL`, `TRANSITION`, `DRIFT` 중 하나로 분류합니다.

## 주요 기능

AI 영역은 다음 세 기능으로 구성됩니다.

### AI-001 목표-페이지 의미적 관련성 계산

최초 작업 목표와 각 페이지의 제목 및 본문 사이의 의미적 관련성을 계산합니다.

계산된 관련성은 최근 탐색 흐름의 변화와 통계를 구성하고,
Context 분석과 최종 목표 이탈 분류에 사용합니다.

Embedding Model 후보:

- `Qwen3-Embedding-0.6B`
- `multilingual-e5-base`
- `BGE-M3`

### AI-002 최근 탐색 흐름 분석

최근 5개의 유효 Page Visit을 하나의 탐색 구간으로 보고,
방문 순서와 주제 변화를 분석합니다.

Context Model은 다음 특징을 생성합니다.

- `goalRelevance`
- `detourJustification`
- `driftDegree`
- `contextState`

`contextState`는 Context Model의 중간 판단이며,
최종 목표 이탈 분류 결과와는 구분합니다.

Context Model 후보:

- `Qwen3-4B`
- `Qwen3-8B 4-bit`

### AI-003 목표 이탈 분류

의미적 관련성, 탐색 맥락, 행동 특징을 이용하여
최근 탐색 구간의 최종 상태를 분류합니다.

최종 출력은 다음 세 클래스의 예측 확률과 상태입니다.

- `P(NORMAL)`
- `P(TRANSITION)`
- `P(DRIFT)`
- `result`

분류기 후보:

- Logistic Regression
- Random Forest
- XGBoost

최종 모델과 특징 구성은 Validation 데이터의 평가 결과를 기준으로 결정합니다.

## 분석 단위

AI 분석은 최근 5개의 유효 Page Visit으로 구성된 탐색 구간을 기준으로 수행합니다.

```text
Window Size: 5
Stride: 1
```

새로운 유효 Page Visit이 추가될 때마다 최근 5개 방문으로 새로운 탐색 구간을 구성합니다.

```text
P1 P2 P3 P4 P5       → Window 1
   P2 P3 P4 P5 P6    → Window 2
      P3 P4 P5 P6 P7 → Window 3
```

## 처리 흐름

```text
최초 작업 목표 + Page Visit
            ↓
    Semantic Relevance
            ↓
      Context Analysis
            ↓
       Feature 구성
            ↓
     Drift Classification
            ↓
NORMAL / TRANSITION / DRIFT
```

Context Model이 실제 최종 분류 성능 향상에 기여하지 않는 경우,
검증 결과에 따라 Context 분석 단계를 제외할 수 있습니다.

## 개발 원칙

- 단일 페이지의 관련성이 낮다는 이유만으로 `DRIFT`로 판단하지 않습니다.
- 분석에 필요한 입력을 확보할 수 없는 경우 임의의 값을 생성하지 않습니다.
- Context Model의 결과만으로 최종 상태를 결정하지 않습니다.
- Context Model의 구조화 출력 검증 실패 시 1회 재시도합니다.
- 분석 실패를 `NORMAL` 등의 정상 결과로 대체하지 않습니다.
- 모델 및 임계값은 Validation 데이터를 기준으로 결정합니다.
- Test 데이터는 최종 설정 확정 이후 일반화 성능 평가에만 사용합니다.

## 분류기 학습

학습 데이터는 Git에 올리지 않고 `ai/data/` 아래에 둡니다. (`.gitignore` 처리됨)
데이터 폴더에는 `sessions*.jsonl`, `windows*.jsonl`이 있어야 합니다.

```bash
cd ai
python -m training.train                 # Embedding-only (A)
python -m training.train --use-context   # Embedding + Context (B)
python -m training.compare               # A/B 리포트를 Validation 기준으로 비교
python -m training.train --zip <데이터.zip> --sha256 <체크섬>   # 체크섬 확인 후 학습
```

- 겹치는 Window가 학습/평가에 나뉘지 않도록 목표(3개 이상일 때) 또는 세션 단위로 분할합니다.
- 임계값 γ와 모델 타입은 Validation fold 결과로만 결정하고, held-out fold 결과는 보고에만 사용합니다.
- 행동 측정값이 없는 데이터는 0이나 임의 값으로 채우지 않고 행동 특징을 제외하고 학습합니다.
- 산출물: `ai/artifacts/drift_classifier.joblib` (마지막으로 학습한 구성), `training_report_embedding.json` / `training_report_context.json` (Git 제외)
- API 서버(`main.py`)는 학습된 분류기를 로드하며, 경로는 `DRIFT_CLASSIFIER_PATH`로 바꿀 수 있습니다.

합성 데이터의 후보 라벨로 학습한 결과는 학습 코드의 작동 확인용이며 실제 모델 성능이 아닙니다.

### Context 사용 구성(B) 학습

- Context 분석 결과는 `artifacts/context_cache.jsonl`에 캐시합니다. 모델 설정·프롬프트·관련성 값이 같은 Window는
  재학습 때 LLM을 다시 호출하지 않으므로, 데이터를 추가하면 새 Window만 분석합니다.
- Context 분석에 실패한 Window가 있으면 학습을 중단합니다. 다시 실행하면 실패한 Window만 다시 분석합니다.
  `--skip-context-failures`를 주면 실패한 Window를 제외하고 학습하며, 제외 목록은 리포트 `excludedWindows`에 남습니다.
- 분류기에는 학습에 사용한 Context Model 설정(`contextModel`)이 저장되며, 서버의 설정이 다르면 로드하지 않습니다.
- Context 특징은 실행 환경(GPU bf16 / CPU fp32)에 따라 값이 조금 달라질 수 있으므로 **학습과 배포를 같은 환경에서** 진행합니다.

## 분석 API (AI-API-01)

BE(`AiAnalysisClient`)가 호출하는 API입니다. 실행: `cd ai && uvicorn main:app --port 8000`

- `POST /api/ai/analyses`
  - 요청: `analysisId`, `sessionId`, `windowId`, `windowIndex`, `goalText`, `visits[5]` (position 1~5)
  - 성공(200): 요청 식별자 3개, `result`, `pNormal`/`pTransition`/`pDrift`(합 1), `contextUsed`, `contextResult`, `featureSnapshot`, `modelVersions`, `analyzedAt`(UTC 밀리초)
  - 실패: `{"code", "message", "fieldErrors"}`

| code | HTTP | 상황 |
| --- | --- | --- |
| `INVALID_REQUEST` | 422 | 요청 형식·값 오류 (방문 수, position, 빈 목표 등) |
| `ANALYSIS_ID_CONFLICT` | 409 | 같은 `analysisId`로 다른 내용의 요청 |
| `ANALYSIS_IN_PROGRESS` | 409 | 같은 `analysisId`의 분석이 처리 중 |
| `AI_ANALYSIS_FAILED` | 500 | 분석 실패 (Context 출력 재검증 실패 등) |
| `AI_NOT_READY` | 503 | 모델 로드 중 또는 로드 실패 |

- 같은 `analysisId`와 같은 내용으로 다시 요청하면 저장된 응답을 그대로 반환합니다. (메모리 보관, 재시작 시 초기화)
- `GET /health`: 모델 로드가 끝나면 200 `{"status": "READY"}`, 그 전에는 503 `AI_NOT_READY`

## Context Model 설정 (GPU)

Context 사용 구성은 GPU 환경을 기준으로 합니다. (CPU에서는 Window당 약 210s로 사용할 수 없음)

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `CONTEXT_MODEL_NAME` | `Qwen/Qwen3-4B` | Context Model 이름 |
| `CONTEXT_USE_4BIT` | `false` | 4-bit 양자화 (CUDA 필요). VRAM이 부족한 GPU 또는 `Qwen/Qwen3-8B` 사용 시 |
| `CONTEXT_MAX_NEW_TOKENS` | `128` | 최대 생성 토큰 수 (출력은 JSON 1개) |
| `CONTEXT_MODEL_DIR` | `models/saved_models/<모델명>` | 모델 저장 위치. 모델 이름을 바꾸면 이 경로도 함께 바꿉니다 |

- 필요 VRAM(예상): Qwen3-4B bf16 약 8GB + Embedding 약 1~2GB → 10GB 이상. 부족하면 `CONTEXT_USE_4BIT=1`
- 서버는 시작 시 Embedding과 Context Model을 모두 warm-up한 뒤 READY가 됩니다.
- Docker에서 GPU를 쓰려면 `docker-compose.yml`의 `ai` 서비스 `deploy` 주석을 해제하고 호스트에 NVIDIA Container Toolkit을 설치합니다.
- 지연 측정: `python benchmark.py` (학습된 분류기로 `ai/data`의 Window를 세션 순서대로 분석, p50/p95 출력).
  결과가 BE `focus-recovery.ai.response-timeout`(현재 10s)에 가까우면 BE 담당자와 timeout을 조정합니다.
  Context 출력 검증 실패 시 1회 재생성하므로 최악의 경우 생성 시간이 두 배가 됩니다.

## 응답 시간

Window가 Stride 1로 이동하므로 목표와 이전 방문 4개는 직전 요청과 같은 텍스트입니다.
Embedding Model은 텍스트별 임베딩을 LRU 캐시(`EMBEDDING_CACHE_SIZE`, 기본 4096)에 보관하여
요청마다 새 방문 1개만 임베딩합니다. 서버 시작 시 한 번 추론(warm-up)한 뒤 READY가 됩니다.

측정 (Embedding-only, CPU 8 threads, Windows, 합성 데이터 4세션 32 Window):

| 구분 | 캐시 전 | 캐시 후 |
| --- | --- | --- |
| 세션 첫 Window (새 방문 5개) | 19.3s | p50 11.1s / p95 12.1s |
| 이후 Window (새 방문 1개) | p50 19.0s / p95 19.9s | p50 2.5s / p95 3.0s |

- 페이지 1개 임베딩 약 2.0s, 목표 약 0.7s. 배치 처리, 16 threads, int8 동적 양자화, bf16은 이 CPU에서 더 느렸습니다.
- 세션 첫 Window는 CPU에서 BE `response-timeout`(10s)을 넘습니다. GPU 사용 또는 timeout 조정이 필요합니다.
- Context 사용 구성(Qwen3-4B, CPU fp32)은 Window당 약 210~226s (모델 로드 약 41s)로, CPU에서는 사용할 수 없습니다.
- 분석은 한 번에 하나씩 처리하므로(`inference_lock`) 여러 세션의 요청이 동시에 오면 대기 시간이 더해집니다.

## 개발 상태

v1은 기존 5방문/확률 API와 학습 파이프라인을 유지합니다. #87에서 v2 구성·페이지 분석 API를 합성 테스트 전용으로 추가했습니다. 정책 P1~P6는 PROPOSED, 개인정보 선결은 BLOCKED입니다. 실제 모델 품질은 검증하지 않았습니다.

## v2 합성 테스트와 실제 모델 경로

- `POST /api/ai/window-compositions`: visitId/sequence만으로 size3/stride1을 구성합니다. 모델 준비와 독립입니다.
- `POST /api/ai/analyses`: apiContractVersion=2이면 정확히3개 방문의 목표 관련성·페이지 라벨/근거를 분석합니다. 버전 생략/1은 기존 v1입니다. v2 실패를 v1으로 전달하지 않습니다.
- v2는 `AI_V2_PROFILE=synthetic-test`와 `AI_V2_ENABLED=1`을 함께 지정해야 동작합니다. 기본/prod 비활성, 운영 활성화 옵션이 아닙니다. 합성 데이터만 사용하세요.
- DTO는 [공통 Schema](../docs/contracts/v2/v2.schema.json)를 직접 검증합니다. 저장소 실행은 자동 탐색하며 별도 패키징 시 `AI_V2_SCHEMA_PATH`를 지정합니다. Compose는 공통 파일을 read-only mount합니다.
- 실제 분석은 기존 Qwen3 Embedding cosine과 Qwen3 Context CausalLM의 별도 페이지 프롬프트를 사용합니다. Context 모델이 필요하며 v1 학습 분류기는 사용하지 않습니다. v1이 embedding-only여도 v2에는 Context를 로드합니다.
- v2 생성 설정: `AI_V2_MAX_NEW_TOKENS=1024`, `AI_V2_INFERENCE_TIMEOUT_SECONDS=60`. 개발 한도이며 timeout은 soft limit입니다. 실제 모델 응답시간/품질을 측정한 운영값이 아닙니다. 기존 v1 Context 설정은 유지합니다.

```sh
# 저장소 루트: 모델 라이브러리/가중치 없이 Mock API 테스트
python3 -m venv /private/tmp/focus87-ai
/private/tmp/focus87-ai/bin/python -m pip install -r ai/requirements-test.txt
/private/tmp/focus87-ai/bin/python -m pytest ai/tests -q

# 오프라인 모델 preflight + 가능한 경우에만 합성 실제 추론 (다운로드하지 않음)
/private/tmp/focus87-ai/bin/python ai/smoke_v2.py

# 별도 모델 런타임 환경 + 로컬 모델 준비 후에만 합성 API 서버 실행
cd ai
AI_V2_PROFILE=synthetic-test AI_V2_ENABLED=1 uvicorn main:app --port 8000
```

`/health`는 기존 v1 준비 상태를 유지합니다. v1 classifier가 없어도 v2 로더는 독립적으로 준비를 시도하고 구성은 모델 없이 가능합니다. 위 서버 실행의 기존 모델 로더에는 다운로드 기능이 있으므로 모델 파일을 준비한 개발 환경에서 사용합니다. 이번 검증에서는 서버 모델 로더를 실행하거나 가중치를 다운로드하지 않았습니다.

`V2Service.invalidate_visits`는 내부 캐시 격리 hook이며 공개 회수 API가 아닙니다. 프로세스별 메모리 tombstone/Registry는 재시작 시 사라집니다. BE 영속 격리·모든 프로세스 전파·학습 캐시/외부 사본 회수·실제 삭제는 후속입니다. 상세 결과와 미검증 범위는 [AI v2 검증 보고](../docs/ai-v2-window-analysis-validation.md)를 참조하세요.
