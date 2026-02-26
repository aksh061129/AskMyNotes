"""FastAPI entrypoint for the AskMyNotes Python RAG service."""

import os
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import DATA_DIR
from ingestion import ingest_document, get_subject_stats
from query_engine import query as run_query
from study_engine import generate_study_questions
from simplify_engine import simplify_answer

app = FastAPI(title="AskMyNotes RAG Service", version="1.0.0")

# CORS — allow Node.js API layer
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────

@app.get("/py/health")
def health():
    return {"status": "ok", "service": "askmynotes-rag"}


# ── Ingest ────────────────────────────────────────────────────────────

@app.post("/py/ingest")
async def ingest(
    file: UploadFile = File(...),
    subject_id: str = Form(...),
):
    """Ingest a document (PDF or TXT) into a subject's FAISS index."""
    ext = Path(file.filename).suffix.lower()
    if ext not in (".pdf", ".txt", ".text"):
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    # Save to temp file
    tmp_dir = tempfile.mkdtemp()
    tmp_path = os.path.join(tmp_dir, file.filename)
    try:
        with open(tmp_path, "wb") as f:
            content = await file.read()
            f.write(content)

        result = ingest_document(subject_id, tmp_path)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ── Query ─────────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    subject_id: str
    subject_name: str
    query: str
    conversation_history: list[dict] | None = None


@app.post("/py/query")
def query_endpoint(req: QueryRequest):
    """Query a subject with dual-gate refusal."""
    try:
        result = run_query(
            subject_id=req.subject_id,
            subject_name=req.subject_name,
            user_query=req.query,
            conversation_history=req.conversation_history,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Study ─────────────────────────────────────────────────────────────

class StudyRequest(BaseModel):
    subject_id: str
    subject_name: str


@app.post("/py/study")
def study_endpoint(req: StudyRequest):
    """Generate study questions for a subject."""
    try:
        result = generate_study_questions(
            subject_id=req.subject_id,
            subject_name=req.subject_name,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Simplify ──────────────────────────────────────────────────────────

class SimplifyRequest(BaseModel):
    original_answer: str
    evidence_snippets: list[str]
    citations: list[dict]
    subject_name: str


@app.post("/py/simplify")
def simplify_endpoint(req: SimplifyRequest):
    """Simplify an answer to a lower reading level."""
    try:
        result = simplify_answer(
            original_answer=req.original_answer,
            evidence_snippets=req.evidence_snippets,
            citations=req.citations,
            subject_name=req.subject_name,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Subject Stats ─────────────────────────────────────────────────────

@app.get("/py/stats/{subject_id}")
def stats_endpoint(subject_id: str):
    """Get stats about a subject's index."""
    try:
        return get_subject_stats(subject_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Delete Subject Data ───────────────────────────────────────────────

@app.delete("/py/subject/{subject_id}")
def delete_subject(subject_id: str):
    """Delete a subject's FAISS index and metadata."""
    subject_dir = DATA_DIR / subject_id
    if subject_dir.exists():
        shutil.rmtree(subject_dir)
        return {"status": "deleted", "subject_id": subject_id}
    return {"status": "not_found", "subject_id": subject_id}


# ── Run ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
