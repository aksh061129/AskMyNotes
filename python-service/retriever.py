"""FAISS retriever — loads subject index, searches, returns ranked chunks."""

import json
import faiss
import numpy as np
from pathlib import Path

from config import DATA_DIR, TOP_K, TOP_K_STUDY
from embedder import embedder


def _subject_dir(subject_id: str) -> Path:
    return DATA_DIR / subject_id


def _load_index(subject_id: str) -> faiss.IndexFlatIP | None:
    path = _subject_dir(subject_id) / "index.faiss"
    if path.exists():
        return faiss.read_index(str(path))
    return None


def _load_metadata(subject_id: str) -> list[dict]:
    path = _subject_dir(subject_id) / "chunks_meta.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return []


def retrieve(subject_id: str, query: str, top_k: int | None = None) -> list[dict]:
    """
    Retrieve top-K most similar chunks for a query from the subject's FAISS index.

    Each result dict:
      {
        "text": str,
        "filename": str,
        "page": int,
        "chunk_index": int,
        "score": float   # cosine similarity (0–1)
      }
    """
    if top_k is None:
        top_k = TOP_K

    index = _load_index(subject_id)
    if index is None or index.ntotal == 0:
        return []

    metadata = _load_metadata(subject_id)

    # Embed & normalise query
    query_vec = embedder.encode_query(query)
    faiss.normalize_L2(query_vec)

    # Search
    k = min(top_k, index.ntotal)
    scores, indices = index.search(query_vec, k)

    results = []
    for score, idx in zip(scores[0], indices[0]):
        if idx < 0 or idx >= len(metadata):
            continue
        chunk = metadata[idx].copy()
        chunk["score"] = float(score)
        results.append(chunk)

    # Sort descending by score
    results.sort(key=lambda x: x["score"], reverse=True)
    return results


def retrieve_broad(subject_id: str, top_k: int | None = None) -> list[dict]:
    """
    Retrieve a broad diverse set of chunks for study mode.
    Uses an empty-ish query to get spread across the index,
    or just returns metadata if index is small.
    """
    if top_k is None:
        top_k = TOP_K_STUDY

    metadata = _load_metadata(subject_id)
    if not metadata:
        return []

    # If the index is small, just return all chunks
    if len(metadata) <= top_k:
        for i, m in enumerate(metadata):
            m.setdefault("score", 1.0)
        return metadata

    # Otherwise, sample evenly from the index
    step = max(1, len(metadata) // top_k)
    sampled = []
    for i in range(0, len(metadata), step):
        chunk = metadata[i].copy()
        chunk["score"] = 1.0  # No query-based scoring for broad retrieval
        sampled.append(chunk)
        if len(sampled) >= top_k:
            break

    return sampled
