# 기존 실모델 준비·실행

실제 실행 결과는 [#99 검증 보고](real-collection-validation.md)를 따릅니다. 현재 모델 파일 및 torch/transformers/sentence-transformers가 없어 **BLOCKED**, modelLoaded=false/inferenceExecuted=false입니다. Fake 모델 테스트는 성능 측정이 아닙니다.

기존 명세는 Embedding `Qwen/Qwen3-Embedding-0.6B`, Context 기본 `Qwen/Qwen3-4B`입니다. 기존 명세의 선택 설정은 `CONTEXT_MODEL_NAME`/CUDA4bit 옵션이지만 이번 준비 도구는 기본4B를 고정하며 다른 가중치로 교체하지 않습니다. [Qwen Embedding 공식 모델 카드](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)와 [Qwen3-4B 공식 모델 카드](https://huggingface.co/Qwen/Qwen3-4B)를 확인했고 Qwen3 지원에 필요한 transformers>=4.51.0,<5를 명시했습니다. 이 저장소에 고정된 모델 revision은 없었으므로 운영자가 검토한 두 **40자리 immutable commit SHA**를 필수 인수로 받습니다. `main`을 자동 최신 버전으로 선택하지 않습니다.

```sh
python3.11 -m venv .collection/model-venv
.collection/model-venv/bin/python -m pip install -r ai/requirements.txt
# 두 revision은 공식 모델의 Files/history에서 확인한 실제 SHA. 빈 값·main·tag는 거절.
.collection/model-venv/bin/python tools/collection/prepare-models.py \
  --embedding-revision "$EMBEDDING_REVISION" --context-revision "$CONTEXT_REVISION" \
  --output "$NEW_MODEL_DIRECTORY"
```

새 디렉터리만 허용하고 기존 모델/캐시를 삭제·교체하지 않습니다. 다운로드는 모델 JSON/tokenizer/safetensors 등 지정 파일로 한정합니다. 성공 시 각 파일 bytes/SHA-256와 모델/revision의 model-manifest.json을 남깁니다. 실패 디렉터리는 보존하며 관리자가 검토합니다. Python 환경은 Qwen3 지원 torch/transformers/sentence-transformers/accelerate가 필요합니다. Linux x86_64의 bitsandbytes는 기존 선택4bit용이며 CPU/macOS 필수 의존성에서 제외했습니다. 기본 CPU는 float32, CUDA는 bfloat16이며4bit는 CUDA가 없으면 거절합니다. 실제 메모리/처리량은 이 환경에서 실측하지 않았습니다. 모델 재학습은 없습니다.

```sh
EMBEDDING_MODEL_DIR="$NEW_MODEL_DIRECTORY/qwen3-embedding" \
CONTEXT_MODEL_DIR="$NEW_MODEL_DIRECTORY/qwen3-4b" \
  .collection/model-venv/bin/python ai/smoke_v2.py --require-models \
  > .collection/real-model-smoke.json
```

이 smoke는 다운로드하지 않는 합성 텍스트 실제 추론입니다. status=PASS, modelLoaded=true, inferenceExecuted=true, structuredOutputValid=true를 모두 확인합니다. 의존성/파일 누락은 SKIPPED + strict exit2, 추론 실패는 exit1입니다. load/warm-up·inferenceSeconds·windowsPerSecond·RSS/device/dtype·modelVersions를 보고하며 정확도를 평가하지 않습니다. 한 Window의 reciprocal 처리량은 p95/동시 요청 부하 시험이 아닙니다. 별도 프로세스에서 같은 명령을 재실행해 재로딩을 확인하고 두 결과를 승인 근거에 연결합니다.

수집 서비스는 `ai/collection_main.py`의 `OfflineEmbedding/OfflineContext`를 사용합니다. 기존 v1 엔트리는 변경하지 않습니다. 모델 준비 실패를 v1이나 정상 라벨로 대체하지 않습니다. 승인된 정책 파일+그 digest, 서비스 Secret·Journal 파일이 추가로 있어야 `uvicorn collection_main:app --workers 1`이 시작됩니다. Compose에서는 모델 read-only mount, offline 환경, private network, access log off입니다. 공용 포트로 모델 서버를 노출하지 않습니다.

BE→AI HTTP의 서비스 인증·공통 Schema·Window/Outbox/실패/재시작 경로는 Mock 모델로 실행 검증했습니다. **실제 모델 BE–AI HTTP, 실제 inference timeout/성능·재로딩·GPU 취소는 NOT_TESTED**입니다. strict smoke PASS와 별도로 승인된 통제 HTML E2E를 실모델 서비스에 연결해10 Visit/8 Window·BE 상태·오류·Journal 재시작을 확인한 후 배포해야 합니다. 현재 승인 기록·가중치 없이 이 절차를 완료했다고 보고하지 않습니다.
