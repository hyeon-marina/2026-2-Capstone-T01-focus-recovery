"""No downloads, deletion, or replacement of existing weights during collection startup."""
from models.embedding import LocalSemanticEmbeddingModel
from models.context import LocalContextModel


class OfflineEmbedding(LocalSemanticEmbeddingModel):
    def _load_or_download_model(self):
        from sentence_transformers import SentenceTransformer
        return SentenceTransformer(str(self.save_dir), device=self.device, local_files_only=True)


class OfflineContext(LocalContextModel):
    def _ensure_model_files(self):
        if not self._is_model_valid(self.save_dir):
            raise RuntimeError('incomplete local context weights')
