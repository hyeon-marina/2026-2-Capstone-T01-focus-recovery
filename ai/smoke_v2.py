"""Offline-only, synthetic real-model smoke. Never downloads or trains weights.

Run from ai/: python smoke_v2.py
Exit 0 on PASS/SKIPPED, 1 on an attempted model/inference failure.
"""
import importlib.util
import json
import os
import platform
import resource
import time
from pathlib import Path
from uuid import uuid4


def run():
    report = {"kind": "real-model-synthetic-smoke", "platform": platform.platform(),
              "embedding": "Qwen/Qwen3-Embedding-0.6B",
              "context": os.getenv("CONTEXT_MODEL_NAME", "Qwen/Qwen3-4B"),
              "accuracyEvaluated": False, "modelLoaded": False, "inferenceExecuted": False}
    missing = [name for name in ("torch", "transformers", "sentence_transformers", "jsonschema")
               if importlib.util.find_spec(name) is None]
    base = Path(__file__).resolve().parent / "models/saved_models"
    embedding_dir = Path(os.getenv("EMBEDDING_MODEL_DIR", base / "qwen3-embedding"))
    context_dir = Path(os.getenv("CONTEXT_MODEL_DIR", base / report["context"].split("/")[-1].lower()))
    missing_files = [str(p) for p in (embedding_dir, context_dir) if not (p / "config.json").is_file()]
    if missing or missing_files:
        report.update(status="SKIPPED", missingDependencies=missing, missingModelDirectories=missing_files,
                      modelLoaded=False, inferenceExecuted=False)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    started = time.monotonic()
    try:
        import torch
        from sentence_transformers import SentenceTransformer
        from models.context import LocalContextModel
        from models.embedding import LocalSemanticEmbeddingModel
        from v2.contracts import check, fingerprint, request_dto
        from v2.model import PageAnalysisModel

        class OfflineEmbedding(LocalSemanticEmbeddingModel):
            def _load_or_download_model(self):
                return SentenceTransformer(str(self.save_dir), device=self.device, local_files_only=True)

        class OfflineContext(LocalContextModel):
            def _ensure_model_files(self):
                if not self._is_model_valid(self.save_dir):
                    raise RuntimeError("incomplete local context weights")

        embedding = OfflineEmbedding(save_dir=embedding_dir)
        context = OfflineContext(save_dir=context_dir)
        report.update(modelLoaded=True, device=str(context.model.device), dtype=str(context.model.dtype),
                      cudaAvailable=torch.cuda.is_available())
        model = PageAnalysisModel(embedding, context)
        embedding.warm_up()
        model.warm_up()
        report.update(warmUpSucceeded=True, loadSeconds=round(time.monotonic() - started, 3))
        texts = [("JWT implementation", "An implementation guide for JWT authentication in Spring Boot. " * 3),
                 ("Signature algorithms", "Background explaining asymmetric signatures used to verify authentication tokens. " * 3),
                 ("Synthetic sports results", "A fictional sports league and its match scores, with no software topic. " * 3)]
        body = {"apiContractVersion": 2, "analysisId": str(uuid4()), "sessionId": str(uuid4()),
                "windowId": str(uuid4()), "windowIndex": 1,
                "goalText": "Compare approaches for JWT authentication in Spring Boot",
                "visits": [{"position": i, "visitId": str(uuid4()), "sequence": i, "title": title,
                            "content": content, "searchQuery": None, "isSearchResultPage": False,
                            "visitedAt": "2026-11-10T00:00:00.000Z"}
                           for i, (title, content) in enumerate(texts, 1)]}
        body["inputFingerprint"] = fingerprint(body)
        request_dto("AnalysisRequest", body)
        inference_started = time.monotonic()
        report["inferenceExecuted"] = True
        result = model.analyze(body, embedding.cache_generation)
        check("AnalysisResponse", result)
        report.update(status="PASS", inferenceExecuted=True, structuredOutputValid=True,
                      inferenceSeconds=round(time.monotonic() - inference_started, 3),
                      modelVersions=result["modelVersions"],
                      labels=[p["label"] for p in result["pageResults"]])
    except Exception as exc:
        report.update(status="FAILED", failureType=type(exc).__name__, structuredOutputValid=False)
        # Never print raw model output, exception text or input.
    report["elapsedSeconds"] = round(time.monotonic() - started, 3)
    report["peakRssBytes"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if platform.system() == "Darwin" else 1024)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(run())
