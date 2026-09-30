"""FastAPI entrypoint for the AskMyNotes Python RAG service."""

from starlette import requests
from PIL import ExifTags
from PIL import ExifTags
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

from fastapi import UploadFile, File
from handwriting_engine import transcribe_handwriting
from pydantic import BaseModel

app = FastAPI(title="AskMyNotes RAG Service", version="1.0.0")

# CORS — allow Node.js API layer
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
class HandwritingIngestRequest(BaseModel):
    subject_id: str
    filename: str
    text: str

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
    """Ingest a supported document into a subject's FAISS index."""    
    ext = Path(file.filename).suffix.lower()
    if ext not in (
        ".pdf", ".txt", ".text", ".docx", ".pptx",
        ".png", ".jpg", ".jpeg", ".webp", ".zip"
    ):
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")    # Save to temp file
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
    selected_filename: str | None = None


@app.post("/py/study")
def study_endpoint(req: StudyRequest):
    """Generate study questions for a subject."""
    try:
        result = generate_study_questions(
            subject_id=req.subject_id,
            subject_name=req.subject_name,
            selected_filename=req.selected_filename,
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

@app.post("/py/handwriting")
async def handwriting_endpoint(file: UploadFile = File(...)):
    try:
        image_bytes = await file.read()

        temp_path = f"temp_{file.filename}"

        with open(temp_path, "wb") as f:
            f.write(image_bytes)

        text = transcribe_handwriting(temp_path)

        import os
        os.remove(temp_path)

        return {
            "filename": file.filename,
            "text": text
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/py/handwriting/add")
def add_handwriting(req: HandwritingIngestRequest):
    import os
    import tempfile

    try:
        if not req.text.strip():
            raise HTTPException(
                status_code=400,
                detail="Handwritten content is empty."
            )

        # Create a temporary TXT file from the edited handwriting
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_file = os.path.join(
                temp_dir,
                "handwritten_notes.txt"
            )

            with open(temp_file, "w", encoding="utf-8") as f:
                f.write(req.text)

            # Use the existing RAG ingestion pipeline
            result = ingest_document(
                subject_id=req.subject_id,
                file_path=temp_file
            )

        return {
            "success": True,
            "filename": "handwritten_notes.txt",
            "subject_id": req.subject_id,
            "chunks_added": result.get("chunks_added", 0),
            "total_chunks": result.get("total_chunks", 0),
            "status": result.get("status")
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
        
        
# ── Run ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
