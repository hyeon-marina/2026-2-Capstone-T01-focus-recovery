import json
import os
import re
import shutil
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Optional, Union

WINDOW_SIZE = 5
MAX_RETRIES = 1  # 구조화 출력 검증 실패 시 1회 재시도 (총 2회 시도)
MAX_CONTENT_CHARS = 600  # 페이지당 프롬프트에 포함할 본문 최대 길이
DOWNLOAD_MAX_ATTEMPTS = 5  # 네트워크 끊김 시 이어받기 재시도 횟수

# 환경 변수로 바꿀 수 있는 Context Model 설정의 기본값
DEFAULT_CONTEXT_MODEL_NAME = "Qwen/Qwen3-4B"
# 출력은 JSON 객체 1개(약 60 토큰)이므로 생성 길이를 짧게 두어 지연을 줄인다
DEFAULT_MAX_NEW_TOKENS = 128

# contextState는 Context Model의 중간 판단이며 최종 분류(NORMAL/TRANSITION/DRIFT)와 구분한다.
VALID_CONTEXT_STATES = ("FOCUSED", "JUSTIFIED_DETOUR", "DRIFTING")


class ContextAnalysisError(RuntimeError):
    """Context 분석 실패. 실패를 정상 결과로 대체하지 않기 위해 예외로 전달한다."""


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes")


@dataclass(frozen=True)
class ContextModelConfig:
    """
    Context Model 설정. 인자 > 환경 변수 > 기본값 순으로 정한다.
    - CONTEXT_MODEL_NAME: 모델 이름 (예: Qwen/Qwen3-8B)
    - CONTEXT_USE_4BIT: 1/true이면 4-bit 양자화 (CUDA 필요, VRAM이 부족한 GPU용)
    - CONTEXT_MAX_NEW_TOKENS: 최대 생성 토큰 수
    """
    model_name: str
    use_4bit: bool
    max_new_tokens: int

    @classmethod
    def resolve(
        cls,
        model_name: Optional[str] = None,
        use_4bit: Optional[bool] = None,
        max_new_tokens: Optional[int] = None,
    ) -> "ContextModelConfig":
        return cls(
            model_name=model_name or os.getenv("CONTEXT_MODEL_NAME") or DEFAULT_CONTEXT_MODEL_NAME,
            use_4bit=_env_flag("CONTEXT_USE_4BIT") if use_4bit is None else use_4bit,
            max_new_tokens=max_new_tokens or int(os.getenv("CONTEXT_MAX_NEW_TOKENS", DEFAULT_MAX_NEW_TOKENS)),
        )

    @property
    def version(self) -> str:
        """modelVersions 및 학습 캐시 키에 쓰는 설정 식별자."""
        return self.model_name + ("@4bit" if self.use_4bit else "")


@dataclass
class PageVisit:
    title: str
    content: str
    semantic_relevance: Optional[float] = None  # AI-001 결과 (없으면 프롬프트에서 생략)


@dataclass
class ContextAnalysisResult:
    goal_relevance: float          # 0~1: 탐색 구간 전체가 최초 목표와 관련된 정도
    detour_justification: float    # 0~1: 목표와 직접 관련 없는 방문이 목표 달성에 필요한 우회로 설명되는 정도
    drift_degree: float            # 0~1: 목표에서 멀어지는 정도
    context_state: str             # FOCUSED / JUSTIFIED_DETOUR / DRIFTING

    def to_dict(self) -> dict:
        return {
            "goalRelevance": self.goal_relevance,
            "detourJustification": self.detour_justification,
            "driftDegree": self.drift_degree,
            "contextState": self.context_state,
        }


SYSTEM_PROMPT = """You analyze a user's recent web browsing flow against their original work goal.
You receive the goal and the 5 most recent page visits in chronological order.
Judge the flow as a whole: order of visits and topic changes, not any single page.
A single low-relevance page is NOT drift by itself; a detour can be justified if it helps achieve the goal.

Return ONLY one JSON object, with no explanation, no markdown fences:
{
  "goalRelevance": <float 0~1>,
  "detourJustification": <float 0~1>,
  "driftDegree": <float 0~1>,
  "contextState": "FOCUSED" | "JUSTIFIED_DETOUR" | "DRIFTING"
}

Definitions:
- goalRelevance: how related the whole window is to the goal.
- detourJustification: how well off-topic visits are explained as a necessary detour for the goal (0 if there are none).
- driftDegree: how far and how persistently the flow moves away from the goal.
- contextState: FOCUSED (on goal), JUSTIFIED_DETOUR (leaves the goal but plausibly returns/helps), DRIFTING (moving away without justification)."""


class LocalContextModel:
    """
    AI-002: 최근 5개 유효 Page Visit의 탐색 흐름을 분석하는 로컬 Context Model 클래스.
    goalRelevance, detourJustification, driftDegree, contextState를 생성한다.
    최종 목표 이탈 분류(AI-003)는 이 결과만으로 결정하지 않는다.
    """

    def __init__(
        self,
        model_name: Optional[str] = None,
        save_dir: Union[str, Path, None] = None,
        use_4bit: Optional[bool] = None,  # Qwen3-8B 4-bit 사용 시 True (CUDA + bitsandbytes 필요)
        max_new_tokens: Optional[int] = None,
    ):
        import torch
        from transformers import AutoTokenizer

        self.config = ContextModelConfig.resolve(model_name, use_4bit, max_new_tokens)
        self.model_name = self.config.model_name
        self.use_4bit = self.config.use_4bit
        self.max_new_tokens = self.config.max_new_tokens

        if save_dir is None:
            save_dir = os.getenv("CONTEXT_MODEL_DIR")
        if save_dir is not None:
            self.save_dir = Path(save_dir)
        else:
            current_dir = Path(__file__).resolve().parent
            # 4-bit는 로드 시 양자화하므로 원본 가중치 폴더를 그대로 사용한다
            folder = self.model_name.split("/")[-1].lower()
            self.save_dir = current_dir / "saved_models" / folder

        self.has_cuda = torch.cuda.is_available()
        if self.use_4bit and not self.has_cuda:
            raise RuntimeError("[AI-002] 4-bit 양자화는 CUDA 환경에서만 사용할 수 있습니다.")

        self._ensure_model_files()
        self.tokenizer = AutoTokenizer.from_pretrained(str(self.save_dir))
        self.model = self._load_model()

    # ------------------------------------------------------------------ 모델 준비
    def _is_model_valid(self, path: Path) -> bool:
        """config.json과 모든 가중치 shard가 존재하는지 검증한다."""
        if not path.is_dir() or not (path / "config.json").is_file():
            return False
        index_file = path / "model.safetensors.index.json"
        if index_file.is_file():
            try:
                weight_map = json.loads(index_file.read_text(encoding="utf-8"))["weight_map"]
            except (ValueError, KeyError):
                return False
            return all((path / shard).is_file() for shard in set(weight_map.values()))
        return any(path.glob("*.safetensors")) or any(path.glob("*.bin"))

    def _ensure_model_files(self) -> None:
        """
        임시 폴더에 다운로드 -> 검증 -> rename 하는 원자적 다운로드.
        네트워크가 끊겨도 임시 폴더를 유지해 이어받기를 하며, 정리 실패가 원래 오류를 가리지 않는다.
        """
        from huggingface_hub import snapshot_download

        if self._is_model_valid(self.save_dir):
            print(f"[AI-002] 로컬 폴더에서 Context 모델을 로드합니다: {self.save_dir}")
            return

        print("[AI-002] 로컬 모델을 찾을 수 없거나 손상되었습니다. 다운로드를 시작합니다 (중단 시 이어받기)...")
        self.save_dir.parent.mkdir(parents=True, exist_ok=True)
        # 고정 이름의 임시 폴더: 중단 후 다시 실행해도 받던 파일을 이어받는다.
        temp_dir = self.save_dir.parent / f"_temp_download_{self.save_dir.name}"

        last_error: Optional[Exception] = None
        for attempt in range(1, DOWNLOAD_MAX_ATTEMPTS + 1):
            try:
                snapshot_download(repo_id=self.model_name, local_dir=str(temp_dir))
                last_error = None
                break
            except Exception as e:
                last_error = e
                print(f"[AI-002] 다운로드 중단 ({attempt}/{DOWNLOAD_MAX_ATTEMPTS}): {e}")
                if attempt < DOWNLOAD_MAX_ATTEMPTS:
                    time.sleep(min(5 * attempt, 30))
                    print("[AI-002] 이어받기를 재시도합니다...")

        if last_error is not None:
            raise RuntimeError(
                f"[AI-002] 모델 다운로드 실패. 받은 파일은 이어받기를 위해 {temp_dir} 에 유지됩니다. "
                f"다시 실행하면 이어서 받습니다. 원인: {last_error}"
            ) from last_error

        # 이어받기 메타데이터 정리 (실패해도 무시)
        shutil.rmtree(temp_dir / ".cache", ignore_errors=True)

        if not self._is_model_valid(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise RuntimeError("[AI-002] 다운로드된 모델 파일이 손상되었거나 유효하지 않습니다.")

        if self.save_dir.exists():
            shutil.rmtree(self.save_dir, ignore_errors=True)
        temp_dir.rename(self.save_dir)
        print(f"[AI-002] 모델 다운로드 및 안전한 저장이 완료되었습니다: {self.save_dir}")

    def _load_model(self):
        import torch
        from transformers import AutoModelForCausalLM, BitsAndBytesConfig

        kwargs = {}
        if self.use_4bit:
            kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16,
            )
            kwargs["device_map"] = "auto"
        elif self.has_cuda:
            kwargs["torch_dtype"] = torch.bfloat16
            kwargs["device_map"] = "auto"
        else:
            kwargs["torch_dtype"] = torch.float32

        model = AutoModelForCausalLM.from_pretrained(str(self.save_dir), **kwargs)
        model.eval()
        return model

    # ------------------------------------------------------------------ 입력 검증 / 프롬프트
    @staticmethod
    def validate_input(goal: str, visits: List[PageVisit]) -> None:
        if not goal or not goal.strip():
            raise ValueError("[AI-002] 유효한 최초 작업 목표가 필요합니다.")
        if len(visits) != WINDOW_SIZE:
            raise ValueError(
                f"[AI-002] 최근 {WINDOW_SIZE}개의 유효 Page Visit이 필요합니다. (입력: {len(visits)}개)"
            )
        for i, v in enumerate(visits, start=1):
            title = (v.title or "").strip()
            content = (v.content or "").strip()
            if not title and not content:
                raise ValueError(f"[AI-002] P{i}의 제목과 본문이 모두 비어 있습니다.")

    @staticmethod
    def build_user_prompt(goal: str, visits: List[PageVisit]) -> str:
        lines = [f"Goal: {goal.strip()}", "", "Recent page visits (oldest -> newest):"]
        for i, v in enumerate(visits, start=1):
            content = (v.content or "").strip().replace("\n", " ")[:MAX_CONTENT_CHARS]
            lines.append(f"[P{i}] Title: {(v.title or '').strip()}")
            lines.append(f"     Content: {content}")
            if v.semantic_relevance is not None:
                lines.append(f"     SemanticRelevance(to goal): {v.semantic_relevance:.3f}")
        return "\n".join(lines)

    # ------------------------------------------------------------------ 생성 / 파싱
    def _generate(self, user_prompt: str, max_new_tokens: Optional[int] = None, *,
                  system_prompt: str = SYSTEM_PROMPT, max_time: Optional[float] = None) -> str:
        import torch

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        text = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
        )
        inputs = self.tokenizer([text], return_tensors="pt").to(self.model.device)
        if max_time is not None:
            limit = getattr(self.model.config, "max_position_embeddings", None)
            if limit and inputs["input_ids"].shape[1] + (max_new_tokens or self.max_new_tokens) > limit:
                raise ValueError("v2 prompt exceeds model context capacity")
        generation_options = {"max_time": max_time} if max_time is not None else {}
        with torch.no_grad():
            output_ids = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens or self.max_new_tokens,
                do_sample=False,  # 재현성을 위해 greedy decoding
                **generation_options,
            )
        new_tokens = output_ids[0][inputs["input_ids"].shape[1]:]
        return self.tokenizer.decode(new_tokens, skip_special_tokens=True)

    @staticmethod
    def _parse_and_validate(raw: str) -> ContextAnalysisResult:
        """모델 출력을 JSON으로 파싱하고 스키마/값 범위를 검증한다. 실패 시 ValueError."""
        raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)
        start, end = raw.find("{"), raw.rfind("}")
        if start == -1 or end <= start:
            raise ValueError("JSON 객체를 찾을 수 없습니다.")
        data = json.loads(raw[start:end + 1])

        def score(key: str) -> float:
            value = data.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"{key}는 숫자여야 합니다.")
            if not 0.0 <= float(value) <= 1.0:
                raise ValueError(f"{key}는 0~1 범위여야 합니다: {value}")
            return float(value)

        state = data.get("contextState")
        if state not in VALID_CONTEXT_STATES:
            raise ValueError(f"contextState가 유효하지 않습니다: {state}")

        return ContextAnalysisResult(
            goal_relevance=score("goalRelevance"),
            detour_justification=score("detourJustification"),
            drift_degree=score("driftDegree"),
            context_state=state,
        )

    # ------------------------------------------------------------------ 공개 API
    def warm_up(self) -> None:
        """첫 요청의 초기화 지연(CUDA 커널 준비 등)을 서버 시작 시점으로 옮긴다."""
        self._generate("Goal: warm-up", max_new_tokens=4)

    def analyze(self, goal: str, visits: List[PageVisit]) -> ContextAnalysisResult:
        """
        최초 목표와 최근 5개 Page Visit으로 탐색 흐름을 분석한다.
        구조화 출력 검증에 실패하면 1회 재시도하며, 그래도 실패하면
        기본값으로 대체하지 않고 ContextAnalysisError를 발생시킨다.
        """
        self.validate_input(goal, visits)
        user_prompt = self.build_user_prompt(goal, visits)

        last_error: Optional[Exception] = None
        for attempt in range(1 + MAX_RETRIES):
            raw = self._generate(user_prompt)
            try:
                return self._parse_and_validate(raw)
            except (ValueError, json.JSONDecodeError) as e:
                last_error = e
                print(f"[AI-002] 구조화 출력 검증 실패 (시도 {attempt + 1}/{1 + MAX_RETRIES})")

        raise ContextAnalysisError(f"[AI-002] Context 분석 실패: {last_error}")


# --- 실행 및 검증 예시 코드 ---
if __name__ == "__main__":
    # Qwen3-8B 4-bit: LocalContextModel(model_name="Qwen/Qwen3-8B", use_4bit=True)
    context_model = LocalContextModel()

    goal = "Spring Boot에서 JWT 인증 구현 방법 조사하기"
    visits = [
        PageVisit("Spring Security + JWT 연동 가이드", "Spring Boot 환경에서 JWT 로그인 및 토큰 검증 필터...", 0.82),
        PageVisit("JWT 공식 소개 (jwt.io)", "JSON Web Token 구조: header, payload, signature...", 0.71),
        PageVisit("Refresh Token 저장 전략", "쿠키 vs 로컬 스토리지, 토큰 재발급 전략...", 0.66),
        PageVisit("개발자 커리어 로드맵 2026", "백엔드 개발자가 연봉을 올리는 방법...", 0.21),
        PageVisit("인기 유튜브 개발 채널 추천", "구독자 많은 개발 유튜버 모음...", 0.12),
    ]

    result = context_model.analyze(goal, visits)
    print("\n[분석 결과]")
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
