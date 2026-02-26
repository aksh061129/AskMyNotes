"""Singleton embedding wrapper around SentenceTransformers."""

import numpy as np
from sentence_transformers import SentenceTransformer
from config import EMBED_MODEL_NAME, EMBED_DIMENSION


class Embedder:
    """Lazy-loaded singleton for the embedding model."""

    _instance: "Embedder | None" = None
    _model: SentenceTransformer | None = None

    def __new__(cls) -> "Embedder":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @property
    def model(self) -> SentenceTransformer:
        if self._model is None:
            print(f"[embedder] Loading {EMBED_MODEL_NAME} ...")
            self._model = SentenceTransformer(EMBED_MODEL_NAME)
            print("[embedder] Model loaded.")
        return self._model

    def encode(self, texts: list[str]) -> np.ndarray:
        """Encode a list of texts → (N, EMBED_DIMENSION) float32 array."""
        vectors = self.model.encode(texts, show_progress_bar=False, convert_to_numpy=True)
        return vectors.astype(np.float32)

    def encode_query(self, query: str) -> np.ndarray:
        """Encode a single query → (1, EMBED_DIMENSION) float32 array."""
        return self.encode([query])

    @property
    def dimension(self) -> int:
        return EMBED_DIMENSION


# Module-level singleton
embedder = Embedder()
