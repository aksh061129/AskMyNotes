"""Central configuration for the AskMyNotes Python RAG service."""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ── Paths ──────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# ── Groq LLM ──────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = "llama-3.3-70b-versatile"
LLM_TEMPERATURE = 0.1          # Low temp → deterministic answers

# ── Embedding Model (local) ───────────────────────────────────────────
EMBED_MODEL_NAME = "all-MiniLM-L6-v2"
EMBED_DIMENSION = 384           # Output dim of all-MiniLM-L6-v2

# ── Chunking ──────────────────────────────────────────────────────────
CHUNK_SIZE = 512
CHUNK_OVERLAP = 50

# ── Retrieval ─────────────────────────────────────────────────────────
TOP_K = 5
TOP_K_STUDY = 15                # Broader retrieval for study mode

# ── Gating Thresholds ────────────────────────────────────────────────
GATE_1_THRESHOLD = 0.45         # Below this → immediate refusal, no LLM

# ── Retrieval Match Labels ───────────────────────────────────────────
def get_retrieval_label(score: float) -> str:
    """Return human-readable retrieval match label."""
    if score > 0.85:
        return "High Match"
    elif score >= 0.65:
        return "Medium Match"
    elif score >= 0.45:
        return "Low Match"
    else:
        return "Not Found"

# ── Refusal Message ──────────────────────────────────────────────────
def get_refusal_message(subject_name: str) -> str:
    return f"Not found in your notes for {subject_name}"
