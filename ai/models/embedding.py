import hashlib
import os
import shutil
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Union

# 임베딩 캐시 크기 (임베딩 1개 약 4KB, 4096개 약 16MB)
EMBEDDING_CACHE_SIZE = int(os.getenv("EMBEDDING_CACHE_SIZE", "4096"))

class LocalSemanticEmbeddingModel:
    """
    AI-001: 최초 작업 목표와 페이지 내용 사이의 의미적 관련성을 계산하는 로컬 임베딩 모델 클래스.
    안전한 원자적(Atomic) 다운로드 방식을 적용하여 비정상 종료 시 손상된 파일 로딩을 방지합니다.
    """
    def __init__(
        self, 
        model_name: str = "Qwen/Qwen3-Embedding-0.6B", 
        save_dir: Union[str, Path, None] = None
    ):
        import torch

        self.model_name = model_name
        
        # 1. 환경 변수 우선 적용, 없으면 기본 파일 경로 기준 설정
        if save_dir is None:
            save_dir = os.getenv("EMBEDDING_MODEL_DIR")
        
        if save_dir is not None:
            self.save_dir = Path(save_dir)
        else:
            current_dir = Path(__file__).resolve().parent
            self.save_dir = current_dir / "saved_models" / "qwen3-embedding"
            
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = self._load_or_download_model()

        # 텍스트별 임베딩 캐시.
        # Window가 Stride 1로 이동하므로 목표와 이전 방문 4개는 직전 요청과 같은 텍스트이며,
        # 새로 임베딩해야 하는 것은 새 방문 1개뿐이다.
        self._cache: "OrderedDict[str, torch.Tensor]" = OrderedDict()
        self._cache_lock = threading.Lock()
        self._cache_generation = 0

    def _is_model_valid(self, path: Path) -> bool:
        """
        저장된 폴더가 실제로 유효한 SentenceTransformer 모델 구조를 갖추고 있는지 검증합니다.
        """
        if not path.exists() or not path.is_dir():
            return False
        
        config_file = path / "config.json"
        return config_file.is_file() and any(path.iterdir())

    def _load_or_download_model(self):
        from sentence_transformers import SentenceTransformer

        save_path_str = str(self.save_dir)
        
        if self._is_model_valid(self.save_dir):
            print(f"[AI-001] 로컬 폴더에서 정상적인 임베딩 모델을 로드합니다: {save_path_str}")
            try:
                model = SentenceTransformer(save_path_str, device=self.device)
                return model
            except Exception as e:
                print(f"[AI-001] 경고: 기존 모델 로드 중 오류가 발생했습니다 ({e}). 재다운로드를 시도합니다.")
        
        print(f"[AI-001] 로컬 모델을 찾을 수 없거나 손상되었습니다. 임시 공간에서 다운로드를 시작합니다...")
        
        self.save_dir.parent.mkdir(parents=True, exist_ok=True)
        temp_dir = self.save_dir.parent / f"_temp_download_{os.getpid()}"
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        temp_dir.mkdir(parents=True, exist_ok=True)

        try:
            temp_model = SentenceTransformer(self.model_name, device=self.device)
            temp_model.save(str(temp_dir))
            
            if not self._is_model_valid(temp_dir):
                raise RuntimeError("다운로드된 모델 파일이 손상되었거나 유효하지 않습니다.")
            
            if self.save_dir.exists():
                shutil.rmtree(self.save_dir)
            temp_dir.rename(self.save_dir)
            
            print(f"[AI-001] 모델 다운로드 및 안전한 저장이 완료되었습니다: {save_path_str}")
            
        except Exception as e:
            if temp_dir.exists():
                shutil.rmtree(temp_dir)
            raise RuntimeError(f"[AI-001] 모델 다운로드 중 오류 발생: {e}")

        return SentenceTransformer(save_path_str, device=self.device)

    @property
    def cache_generation(self):
        with self._cache_lock:
            return self._cache_generation

    def invalidate_cache(self):
        """Clear all vectors; in-flight old generations cannot repopulate them."""
        with self._cache_lock:
            self._cache_generation += 1
            self._cache.clear()

    def _embed(self, text: str, namespace: str = "", cache_generation=None):
        """텍스트 임베딩을 반환한다. 같은 텍스트는 캐시된 임베딩을 재사용한다."""
        # Preserve legacy keys. v2 is isolated by model, session and input format.
        key = hashlib.sha256((namespace + text).encode("utf-8")).hexdigest()
        with self._cache_lock:
            generation = self._cache_generation if cache_generation is None else cache_generation
            cached = self._cache.get(key) if generation == self._cache_generation else None
            if cached is not None:
                self._cache.move_to_end(key)
                return cached

        embedding = self.model.encode([text], convert_to_tensor=True, device=self.device)[0]

        with self._cache_lock:
            if generation == self._cache_generation:
                self._cache[key] = embedding
                self._cache.move_to_end(key)
                while len(self._cache) > EMBEDDING_CACHE_SIZE:
                    self._cache.popitem(last=False)
        return embedding

    def warm_up(self) -> None:
        """첫 요청에서 발생하는 초기화 지연을 서버 시작 시점으로 옮긴다. (캐시에 남기지 않음)"""
        self.model.encode(["warm-up"], convert_to_tensor=True, device=self.device)

    def calculate_relevance(self, goal: str, title: str, content: str) -> float:
        """
        최초 작업 목표(goal)와 페이지 Title + Content 간의 의미적 관련성(Semantic Relevance)을 계산합니다.
        """
        from sentence_transformers import util

        # 빈 값 및 공백만 있는 문자열 검증
        if not goal or not goal.strip() or not (title or content) or not (title.strip() or content.strip()):
            raise ValueError("[AI-001] 유효한 최초 목표와 공백이 아닌 페이지 텍스트가 필요합니다.")

        page_text = f"Title: {title}\nContent: {content}"
        cosine_sim = util.cos_sim(self._embed(goal), self._embed(page_text)).item()

        return cosine_sim

    def calculate_v2_relevance(self, goal, title, content, search_query, *, namespace, cache_generation):
        import json
        import math
        from sentence_transformers import util

        if not goal.strip() or not content.strip():
            raise ValueError("invalid embedding input")
        # JSON preserves field boundaries and binds each query to its own page.
        page_text = json.dumps({"searchQuery": search_query, "title": title, "content": content},
                               ensure_ascii=False, separators=(",", ":"))
        scope = json.dumps(["v2-page-text.1", self.model_name, namespace], separators=(",", ":"))
        score = util.cos_sim(self._embed(goal, scope, cache_generation),
                             self._embed(page_text, scope, cache_generation)).item()
        if not math.isfinite(score) or not -1 <= score <= 1:
            raise ValueError("invalid cosine")
        return score


# --- 실행 및 검증 예시 코드 ---
if __name__ == "__main__":
    embedding_service = LocalSemanticEmbeddingModel()

    sample_goal = "Spring Boot에서 JWT 인증 구현 방법 조사하기"
    sample_title = "Spring Security + JWT 연동 가이드"
    sample_content = "Spring Boot 환경에서 JWT를 활용한 로그인 및 토큰 검증 필터 설정 과정..."

    relevance_score = embedding_service.calculate_relevance(sample_goal, sample_title, sample_content)
    print(f"\n[계산 결과] semanticRelevance: {relevance_score:.4f}")
