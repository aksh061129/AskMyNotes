# AskMyNotes: Backend Architecture and Technical Reference

This document provides a comprehensive technical guide to the backend infrastructure of **AskMyNotes: Evidence-Grounded AI Study Copilot**. It details the dual-service design, internal ingestion and retrieval algorithms, authentication and data persistence mechanisms, API contracts, security characteristics, and implementation nuances.

---

## Table of Contents

- [1. Backend Overview](#1-backend-overview)
- [2. Backend Directory Structure](#2-backend-directory-structure)
- [3. Service Architecture and Communication](#3-service-architecture-and-communication)
- [4. API Endpoint Reference](#4-api-endpoint-reference)
  - [Node.js Gateway Endpoints (Port 3000)](#nodejs-gateway-endpoints-port-3000)
  - [Python RAG Service Endpoints (Port 8000)](#python-rag-service-endpoints-port-8000)
- [5. Document Ingestion Pipeline](#5-document-ingestion-pipeline)
  - [Supported Formats & Parsers](#supported-formats--parsers)
  - [Chunking Strategy](#chunking-strategy)
  - [Embedding & Vector Store Management](#embedding--vector-store-management)
  - [Document Deletion & Re-Indexing](#document-deletion--re-indexing)
- [6. Retrieval-Augmented Generation (RAG)](#6-retrieval-augmented-generation-rag)
  - [Hybrid Retrieval (Semantic + Lexical)](#hybrid-retrieval-semantic--lexical)
  - [Evidence Context Construction](#evidence-context-construction)
  - [LLM Grounding Prompt](#llm-grounding-prompt)
- [7. Context-Unavailable Behaviour (Dual-Gate Refusal)](#7-context-unavailable-behaviour-dual-gate-refusal)
  - [Gate 1: Hard Pre-LLM Refusal](#gate-1-hard-pre-llm-refusal)
  - [Gate 2: Soft Post-LLM Refusal](#gate-2-soft-post-llm-refusal)
  - [General AI Fallback Mode](#general-ai-fallback-mode)
- [8. Resource & Subject Management](#8-resource--subject-management)
- [9. Study Features Internal Logic](#9-study-features-internal-logic)
  - [Quiz & Flashcard Generation Engine](#quiz--flashcard-generation-engine)
  - [Concept Simplification Engine](#concept-simplification-engine)
  - [Handwritten Notes Vision Engine](#handwritten-notes-vision-engine)
- [10. Data Storage and Persistence](#10-data-storage-and-persistence)
- [11. Authentication and Security Analysis](#11-authentication-and-security-analysis)
- [12. Error Handling and Logging](#12-error-handling-and-logging)
- [13. Backend Setup and Execution](#13-backend-setup-and-execution)
- [14. End-to-End API Examples](#14-end-to-end-api-examples)
- [15. Known Issues and Improvement Opportunities](#15-known-issues-and-improvement-opportunities)

---

## 1. Backend Overview

The backend is structured into two specialized services working in tandem:

```
┌────────────────────────────────┐         HTTP / REST          ┌────────────────────────────────┐
│   Node.js / Express Gateway    │ ───────────────────────────> │     Python / FastAPI Service   │
│         (Port 3000)            │ <─────────────────────────── │          (Port 8000)           │
│                                │      JSON / Multipart        │                                │
│  • Client Session Auth         │                              │  • Document Parsing & OCR      │
│  • Subject Limits (Max 3)      │                              │  • SentenceSplitter Chunking   │
│  • Multer File Reception       │                              │  • SentenceTransformers Embed  │
│  • Permanent File Storage      │                              │  • FAISS Vector Indexes        │
│  • JSON State Persistence      │                              │  • Hybrid Retriever (70/30)    │
│  • In-Memory Chat Memory       │                              │  • Dual-Gate Refusal System    │
│  • Static Client Hosting       │                              │  • Groq LPU Inference (LLM)    │
└────────────────────────────────┘                              └────────────────────────────────┘
```

1. **Node.js Gateway (`node-api`)**:
   - Acts as the public-facing API controller.
   - Enforces business rules: exactly up to 3 subjects per user, assigns theme colors, and manages user accounts.
   - Handles multi-part file uploads, persists them to the local disk, and proxies streams to Python.
   - Manages sliding-window conversational memory (last 4 turns sent to the LLM; last 8 stored in memory) and long-term conversation logs in JSON format.
   - Authenticates students using hashed passwords and token-based sessions.
2. **Python AI / RAG Service (`python-service`)**:
   - Acts as the computation and intelligence engine.
   - Parses diverse document types (`.pdf`, `.docx`, `.pptx`, `.txt`, `.png`, `.jpg`, `.webp`, `.zip`) with OCR fallback via Tesseract.
   - Chunks text deterministically and vectorizes using a local SentenceTransformer model (`all-MiniLM-L6-v2`).
   - Manages per-subject isolated FAISS indexes on disk.
   - Executes hybrid retrieval (70% semantic cosine similarity + 30% lexical token overlap).
   - Enforces a dual-gate refusal system to eliminate hallucinations.
   - Communicates with Groq LPU Cloud APIs for fast, low-temperature LLM generation and vision OCR.

---

## 2. Backend Directory Structure

```text
AskMyNotes-Team_Rocket/
├── node-api/
│   ├── data/
│   │   ├── conversations.json   # Array of chat histories grouped by userId and subjectId
│   │   ├── files.json           # Array of uploaded file metadata records
│   │   ├── subjects.json        # Array of subjects owned by users
│   │   ├── users.json           # Array of student accounts with scrypt password hashes
│   │   └── users/               # Permanent storage for uploaded files:
│   │       └── <userId>/subjects/<subjectId>/files/<filename>
│   ├── public/                  # Frontend SPA assets
│   ├── uploads/                 # Temporary Multer write destination for file parsing
│   ├── package.json             # Express, Multer, Axios, UUID dependencies
│   └── server.js                # Express app, authentication routes, proxy endpoints
│
└── python-service/
    ├── data/
    │   └── <subject_id>/        # Subject vector database directory
    │       ├── chunks_meta.json # Chunk text, page number, filename, chunk_index
    │       └── index.faiss      # Serialized FAISS IndexFlatIP binary file
    ├── config.py                # Service configuration (thresholds, models, paths)
    ├── embedder.py              # Singleton wrapper for SentenceTransformer embedding model
    ├── handwriting_engine.py    # Base64 image encoding and Groq Vision API caller
    ├── ingestion.py             # Document parsers, SentenceSplitter, FAISS indexing
    ├── main.py                  # FastAPI server, endpoints, and CORS setup
    ├── query_engine.py          # Prompt engineering, Gate 1 & Gate 2 refusal checks
    ├── retriever.py             # FAISS + lexical hybrid retrieval and broad sampling
    ├── simplify_engine.py       # Grade-level simplification and textstat analysis
    ├── study_engine.py          # MCQ, short-answer, and flashcard generation logic
    └── requirements.txt         # FastAPI, LlamaIndex, FAISS, PyMuPDF, Groq dependencies
```

---

## 3. Service Architecture and Communication

Communication between components follows a strict unidirectional proxy model:

```mermaid
sequenceDiagram
    autonumber
    actor Client as Browser Client
    participant Node as Node.js Gateway (Port 3000)
    participant Python as Python RAG Service (Port 8000)
    participant Groq as Groq Cloud API

    %% Document Ingestion
    Note over Client, Python: Document Ingestion Flow
    Client->>Node: POST /api/upload/:subjectId (Multipart Form)
    Node->>Node: Save permanent file to disk
    Node->>Python: POST /py/ingest (Forward Multipart Stream)
    Python->>Python: Parse -> Chunk -> Vectorize -> Save FAISS
    Python-->>Node: 200 OK {status: "success", chunks_added: N}
    Node->>Node: Record metadata in files.json
    Node-->>Client: 200 OK Ingestion Summary

    %% RAG Query
    Note over Client, Groq: Grounded Query Flow
    Client->>Node: POST /api/query {subject_id, query} (Bearer Token)
    Node->>Node: Validate session & check subject ownership
    Node->>Python: POST /py/query {subject_id, subject_name, query, conversation_history}
    Python->>Python: Hybrid Retrieval (FAISS + Lexical)
    alt Top similarity < 0.45
        Python-->>Node: Gate 1 Refusal: "Not found in your notes for <Subject>"
    else Top similarity >= 0.45
        Python->>Groq: Call Groq LLM (Strict JSON prompt)
        Groq-->>Python: Grounded Response JSON
        alt LLM reports answer_found == false
            Python-->>Node: Gate 2 Refusal (With citations and snippets)
        else LLM reports answer_found == true
            Python-->>Node: 200 OK Grounded Answer + Citations
        end
    end
    Node->>Node: Append to in-memory window & save conversations.json
    Node-->>Client: 200 OK Query Result
```

- **Protocol**: HTTP/1.1 over TCP.
- **Node to Python Communication**: Standard `axios` calls to `http://localhost:8000`.
- **File Transfer**: Node streams the uploaded file directly to Python via `form-data` with `maxContentLength: Infinity` and `maxBodyLength: Infinity`.
- **Port Allocations**:
  - Node.js API & Static Frontend: `3000`
  - Python FastAPI Service: `8000`

---

## 4. API Endpoint Reference

### Node.js Gateway Endpoints (Port 3000)

| Method | Endpoint | Purpose | Request Parameters / Body | Response Schema | Source File | Error Handling |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/signup` | Register a new student account | JSON: `{name, email, password}` (min 6 chars) | `{status, message, user: {id, name, email}, token}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L165) | `400` if missing fields or duplicate email |
| `POST` | `/api/auth/login` | Authenticate an existing student | JSON: `{email, password}` | `{status, message, user: {id, name, email}, token}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L220) | `400` missing fields; `401` invalid credentials |
| `GET` | `/api/auth/me` | Fetch active session profile | Header: `Authorization: Bearer <token>` | `{user: {id, name, email}}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L260) | `401` missing or invalid/expired session |
| `POST` | `/api/auth/logout` | Terminate session | Header: `Authorization: Bearer <token>` | `{status: "success", message}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L282) | Deletes token from in-memory map |
| `POST` | `/api/subjects/create` | Create a new subject (max 3) | Header: `Bearer <token>`<br>JSON: `{name}` | `{id, userId, name, color, createdAt}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L291) | `400` if name empty or limit (3) exceeded |
| `GET` | `/api/subjects` | List subjects and file counts for user | Header: `Bearer <token>` | Array of `{id, userId, name, color, createdAt, files: [{filename, chunks}]}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L344) | `401` if unauthorized |
| `DELETE`| `/api/subjects/:id` | Delete a subject and its index | Param: `id` (subject ID) | `{status: "deleted", subject: {...}}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L384) | `404` if subject not found; notifies Python |
| `POST` | `/api/upload/:subjectId` | Upload and ingest a note file | Param: `subjectId`<br>Form-data: `file` | Python ingestion summary `{status, chunks_added, total_chunks, filename}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L404) | `404` subject missing; `400` invalid file type; `500` ingestion failure |
| `DELETE`| `/api/files/:subjectId/:filename` | Delete a file from subject vector index | Params: `subjectId`, `filename` | `{status: "deleted", subject_id, filename, chunks_removed, remaining_chunks}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L487) | `404` subject or file missing; `500` rebuild failure |
| `POST` | `/api/query` | Grounded question answering | Header: `Bearer <token>`<br>JSON: `{subject_id, query}` | `{answer, answer_found, citations, evidence_snippets, retrieval_match_score, retrieval_match_label, grounding_percentage, subject_scope, gate_fired}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L541) | `401` unauthorized; `404` subject not owned; `400` empty query |
| `POST` | `/api/ai-answer` | Unbounded general AI fallback | JSON: `{query}` | `{answer}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L642) | `400` if query empty; `500` Groq error |
| `POST` | `/api/study/:subjectId` | Generate 5 MCQs, 3 short Qs, 5 flashcards | Param: `subjectId`<br>JSON: `{selected_filename?}` | `{subject_name, selected_filename, mcqs: [...], short_answers: [...], flashcards: [...]}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L667) | `404` subject missing; `500` LLM parsing error |
| `POST` | `/api/simplify` | Simplify reading level of answer | JSON: `{original_answer, evidence_snippets, citations, subject_name}` | `{simplified_answer, original_reading_level, simplified_reading_level, readability_improved, citations, evidence_snippets, subject_scope}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L694) | `400` original_answer missing; `500` LLM error |
| `POST` | `/api/memory/clear/:subjectId` | Clear sliding conversation window | Param: `subjectId` | `{status: "cleared"}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L716) | Clears in-memory buffer |
| `GET` | `/api/stats/:subjectId` | Get chunk and vector counts | Param: `subjectId` | `{subject_id, total_chunks, total_vectors, files: [...]}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L723) | `500` if read fails |
| `GET` | `/api/conversations/:subjectId`| Retrieve full persistent chat history | Header: `Bearer <token>`<br>Param: `subjectId` | `{subjectId, messages: [{role, content, timestamp, citations, ...}]}` | [server.js](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L735) | `401` unauthorized; `404` subject missing |

---

### Python RAG Service Endpoints (Port 8000)

| Method | Endpoint | Purpose | Request Body | Response Schema | Source File | Error Handling |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/py/health` | Service liveness probe | None | `{"status": "ok", "service": "askmynotes-rag"}` | [main.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/main.py#L48) | Returns 200 |
| `POST` | `/py/ingest` | Ingest document into FAISS | Form-data: `file: UploadFile`, `subject_id: str` | `{"status": "success", "chunks_added": int, "total_chunks": int, "filename": str}` | [main.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/main.py#L55) | `400` unsupported format; `500` parser error |
| `POST` | `/py/query` | Dual-gate grounded RAG | JSON: `{subject_id, subject_name, query, conversation_history?}` | Structured response with citations and gate evaluation | [main.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/main.py#L93) | `500` on uncaught retrieval failure |
| `POST` | `/py/ai-answer` | Unbounded Groq response | JSON: `{query: str}` | `{"answer": str}` | [main.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/main.py#L106) | `400` query empty; `500` Groq exception |
| `POST` | `/py/study` | Generate quiz and flashcards | JSON: `{subject_id, subject_name, selected_filename?}` | `{"subject_name", "selected_filename", "mcqs", "short_answers", "flashcards"}` | [main.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/main.py#L159) | Returns error message on empty index |
| `POST` | `/py/simplify` | Re-generate answer at lower grade level | JSON: `{original_answer, evidence_snippets, citations, subject_name}` | `{"simplified_answer", "original_reading_level", "simplified_reading_level", ...}` | [main.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/main.py#L181) | Fallback to original text on parse failure |
| `GET` | `/py/stats/{subject_id}` | Read FAISS & chunk metadata counts | Path param: `subject_id` | `{"subject_id", "total_chunks", "total_vectors", "files": [...]}` | [main.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/main.py#L198) | `500` if directory read fails |
| `DELETE`| `/py/subject/{subject_id}` | Remove subject directory and FAISS file | Path param: `subject_id` | `{"status": "deleted" \| "not_found", "subject_id"}` | [main.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/main.py#L209) | Idempotent |
| `DELETE`| `/py/file/{subject_id}/{filename}` | Rebuild index excluding specific file | Path params: `subject_id`, `filename` | `{"status": "deleted", "chunks_removed": int, "remaining_chunks": int}` | [main.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/main.py#L219) | `404` if file not indexed; `500` on rebuild error |
| `POST` | `/py/handwriting` | Transcribe handwritten image | Form-data: `file: UploadFile` | `{"filename": str, "text": str}` | [main.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/main.py#L252) | `500` on vision model error |
| `POST` | `/py/handwriting/add` | Ingest transcribed handwriting as note | JSON: `{subject_id, filename, text}` | `{"success": true, "filename": "handwritten_notes.txt", "chunks_added": int, ...}` | [main.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/main.py#L276) | `400` text empty; `500` ingest failure |

---

## 5. Document Ingestion Pipeline

The document ingestion pipeline is implemented in [ingestion.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/ingestion.py). It converts raw binaries into clean text blocks, chunks them with metadata, calculates dense vector embeddings, and updates the subject's FAISS index.

```mermaid
flowchart LR
    File[Incoming File] --> ExtRouter{Format Check}
    ExtRouter -->|.pdf| Fitz[PyMuPDF / fitz]
    ExtRouter -->|.txt / .text| TextRead[UTF-8 Text Reader]
    ExtRouter -->|.docx| DocxPy[python-docx: Paragraphs + Tables]
    ExtRouter -->|.pptx| PPTXPy[python-pptx + Tesseract Shape OCR]
    ExtRouter -->|.png / .jpg / .webp| Tess[Pillow + Tesseract OCR]
    ExtRouter -->|.zip| ZipUnpack[Zip Extractor + Recursive Walk]
    
    Fitz & TextRead & DocxPy & PPTXPy & Tess & ZipUnpack --> Normalization[Uniform Page Struct:\ntext, page, filename]
    Normalization --> Splitter[SentenceSplitter\nsize=512, overlap=50]
    Splitter --> Embed[SentenceTransformer\nall-MiniLM-L6-v2]
    Embed --> L2Norm[faiss.normalize_L2]
    L2Norm --> FAISS[(FAISS IndexFlatIP\nindex.faiss)]
    Splitter --> Meta[(chunks_meta.json)]
```

### Supported Formats & Parsers

1. **PDF (`_parse_pdf`)**:
   - Uses PyMuPDF (`fitz.open`).
   - Iterates page by page (1-indexed).
   - Extracts raw page text with `page.get_text("text")`. Blank pages are skipped.
2. **Text Files (`_parse_txt`)**:
   - Reads text using UTF-8 with `errors="ignore"`. Assigned `page = 1`.
3. **Word Documents (`_parse_docx`)**:
   - Uses `python-docx.Document`.
   - Extracts all standard paragraph texts.
   - Extracts tables row-by-row, formatting columns as pipe-delimited strings (`cell1 | cell2 | cell3`) and rows separated by newlines.
   - Sets `page = None`.
4. **PowerPoint Presentations (`_parse_pptx`)**:
   - Uses `python-pptx.Presentation`.
   - Recursively inspects shapes (supporting nested groups via `_extract_shape_text`).
   - Identifies image shapes (`shape.shape_type == 13` / PICTURE), extracts the raw image blob via `io.BytesIO(shape.image.blob)`, and applies `pytesseract.image_to_string(image)`.
   - Combines textual shape content and OCR output, assigning `page = slide_number` (1-indexed).
5. **Image Files (`_parse_image`)**:
   - Handles `.png`, `.jpg`, `.jpeg`, and `.webp` via `PIL.Image.open`.
   - Executes Tesseract OCR: `pytesseract.image_to_string(image)`. Assigned `page = 1`.
6. **ZIP Archives (`_parse_zip`)**:
   - Unpacks archive contents into a temporary directory via `tempfile.TemporaryDirectory`.
   - Traverses files recursively, skipping unsupported extensions, and executes the appropriate parser for each file.

> [!IMPORTANT]
> In [ingestion.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/ingestion.py#L17), the Tesseract executable path is explicitly hardcoded to:
> `pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"`
> Systems running Tesseract in non-standard paths or non-Windows environments must modify this path for OCR functionality to execute.

### Chunking Strategy

Chunking is handled by LlamaIndex's `SentenceSplitter`:
- `chunk_size = 512`
- `chunk_overlap = 50`
- Boundary Preservation: Chunks are split at grammatical sentence and paragraph boundaries rather than arbitrary character offsets, maintaining semantic coherence.
- Output metadata per chunk:
  ```json
  {
    "text": "Extracted text content...",
    "filename": "lecture_01.pdf",
    "page": 4,
    "chunk_index": 12
  }
  ```

### Embedding & Vector Store Management

- **Embedding Model**: `all-MiniLM-L6-v2` loaded through the singleton `Embedder` class in [embedder.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/embedder.py).
- **Dimensionality**: 384 dimensions.
- **Normalization**: Vectors are normalized to unit length via `faiss.normalize_L2(vectors)`.
- **Index Architecture**: `faiss.IndexFlatIP(384)` (Inner Product index). Because all vectors are L2-normalized, the inner product computed during search is algebraically identical to **cosine similarity**:
  $$\text{cosine\_similarity}(u, v) = \frac{u \cdot v}{\|u\|_2 \|v\|_2} = \hat{u} \cdot \hat{v}$$
- **Persistence**:
  - Vectors: `python-service/data/<subject_id>/index.faiss`
  - Chunk sidecar: `python-service/data/<subject_id>/chunks_meta.json`

### Document Deletion & Re-Indexing

Unlike simple vector databases that leave orphan vectors, AskMyNotes implements a vector rebuild routine in `delete_document` ([ingestion.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/ingestion.py#L353)):
1. Reads `chunks_meta.json` and filters out all records where `filename == target_filename`.
2. If zero chunks remain, deletes `index.faiss` and writes `[]` to `chunks_meta.json`.
3. If remaining chunks exist:
   - Instantiates a clean `faiss.IndexFlatIP(dimension)`.
   - Re-encodes all remaining chunk texts using `embedder.encode()`.
   - L2-normalizes the vectors and re-populates the new FAISS index.
   - Overwrites `index.faiss` and `chunks_meta.json` on disk.

---

## 6. Retrieval-Augmented Generation (RAG)

The RAG pipeline is orchestrated by [retriever.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/retriever.py) and [query_engine.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/query_engine.py).

### Hybrid Retrieval (Semantic + Lexical)

To balance conceptual matching with precise keyword recall (e.g., specific algorithms, acronyms, or formulas), AskMyNotes uses a hybrid scoring function:

1. **Semantic Similarity ($S_{\text{semantic}}$)**:
   - The query string is encoded into a 384-dimensional vector, L2-normalized, and matched against `index.faiss`.
   - The top $K=5$ vectors are retrieved with their raw cosine similarity scores ($S_{\text{semantic}} \in [-1, 1]$).
2. **Lexical Keyword Overlap ($S_{\text{lexical}}$)**:
   - Both the user query and retrieved chunk are tokenized using regex `\b[a-zA-Z0-9][a-zA-Z0-9_-]*\b`.
   - A list of 32 English stopwords (e.g., *the*, *what*, *where*, *is*, *mentioned*) is filtered out.
   - The lexical score measures keyword recall:
     $$S_{\text{lexical}} = \frac{|\text{Tokens}_{\text{query}} \cap \text{Tokens}_{\text{chunk}}|}{|\text{Tokens}_{\text{query}}|}$$
3. **Composite Hybrid Score**:
   $$S_{\text{hybrid}} = 0.70 \times S_{\text{semantic}} + 0.30 \times S_{\text{lexical}}$$
4. **Re-Ranking**: Chunks are sorted descending by $S_{\text{hybrid}}$.

### Evidence Context Construction

Retrieved chunks are formatted into an evidence block with metadata headers:

```text
[Evidence 1] (Source: DBMS_Unit2.pdf, Page 14, Chunk #8, Score: 0.892)
A B+ Tree is an N-ary tree with a variable but often large number of children per node...

[Evidence 2] (Source: DBMS_Unit2.pdf, Page 15, Chunk #9, Score: 0.781)
The primary value of a B+ Tree is in storing data for efficient retrieval in a block-oriented storage context...
```

If conversational history is passed from Node.js, the last 4 turns are appended:
```text
Previous conversation:
User: What is an index?
Assistant: An index is a data structure that improves the speed of data retrieval...
```

### LLM Grounding Prompt

The prompt sent to Groq (`openai/gpt-oss-120b`) enforces zero-hallucination constraints and strict JSON output:

```text
You are a study assistant. Answer ONLY using the provided evidence from the student's {subject_name} notes.

RULES:
1. ONLY use information from the evidence below. Do NOT add external knowledge.
2. If the evidence does NOT contain enough information to answer, set "answer_found" to false.
3. Include citations referencing the source filename and page number.
4. Estimate what percentage of your answer is derived directly from the evidence (grounding_percentage, 0-100).

EVIDENCE:
{evidence_context}
{history_context}

QUESTION: {query}

Respond in valid JSON format ONLY (no markdown, no code fences):
{
  "answer": "Your grounded answer here",
  "answer_found": true,
  "grounding_percentage": 95
}
```

---

## 7. Context-Unavailable Behaviour (Dual-Gate Refusal)

AskMyNotes implements a **dual-gate refusal architecture** to verify grounding before and after model invocation:

```mermaid
flowchart TD
    Query[User Query Received] --> Ret[Execute Hybrid Retrieval]
    Ret --> CheckChunks{Any chunks returned?}
    CheckChunks -->|No| G1[Gate 1 Refusal:\nImmediate refusal\nScore: 0.0]
    CheckChunks -->|Yes| CheckScore{Top chunk score >= 0.45?}
    CheckScore -->|No| G1B[Gate 1 Refusal:\nScore < 0.45\nNo LLM call triggered]
    CheckScore -->|Yes| LLMCall[Invoke Groq LLM with Evidence]
    LLMCall --> CheckAns{LLM response:\nanswer_found == true?}
    CheckAns -->|No| G2[Gate 2 Refusal:\nLLM refused answer\nPreserves top 3 citations & snippets]
    CheckAns -->|Yes| Success[Deliver Grounded Answer:\nCitations + Match Label + Confidence %]
    
    G1 & G1B --> FallbackOption[Frontend Displays 'Ask General AI' Option]
    G2 --> FallbackOption
```

### Gate 1: Hard Pre-LLM Refusal
- **Condition**: FAISS returns no chunks OR the top chunk's hybrid score $S_{\text{hybrid}} < 0.45$ (`GATE_1_THRESHOLD`).
- **Execution**: The query is halted immediately. **No LLM API call is dispatched**.
- **Payload Returned**:
  ```json
  {
    "answer": "Not found in your notes for Machine Learning",
    "answer_found": false,
    "citations": [],
    "evidence_snippets": [],
    "retrieval_match_score": 0.3124,
    "retrieval_match_label": "Not Found",
    "grounding_percentage": 0,
    "subject_scope": "100% Machine Learning-scoped",
    "gate_fired": "gate_1"
  }
  ```

### Gate 2: Soft Post-LLM Refusal
- **Condition**: Gate 1 passed ($S_{\text{hybrid}} \ge 0.45$), but the LLM analyzed the evidence snippets and determined they do not answer the specific question, setting `"answer_found": false`.
- **Execution**: The system returns a refusal message, but **preserves the top 3 citations and text snippets**.
- **Purpose**: Enables the student to inspect the closest matching text from their notes and understand why the LLM refused to speculate.
- **Payload Returned**:
  ```json
  {
    "answer": "Not found in your notes for Machine Learning",
    "answer_found": false,
    "citations": [
      {"filename": "SVM.pdf", "page": 3, "chunk_index": 2}
    ],
    "evidence_snippets": [
      "Support Vector Machines find the hyperplane that maximizes the margin..."
    ],
    "retrieval_match_score": 0.5421,
    "retrieval_match_label": "Low Match",
    "grounding_percentage": 0,
    "subject_scope": "100% Machine Learning-scoped",
    "gate_fired": "gate_2"
  }
  ```

### General AI Fallback Mode

When a question cannot be answered from notes, students can click **"Ask General AI"**:
- Route: `POST /api/ai-answer` (proxied to `/py/ai-answer`).
- The Python service calls Groq directly without note context, prompting the model to answer using general knowledge.
- The UI displays this response with distinct styling so students clearly differentiate between note-grounded facts and external AI knowledge.

---

## 8. Resource & Subject Management

### 3-Subject Limitation
- Enforced at [server.js line 321](file:///c:/Github/AskMyNotes-Team_Rocket/node-api/server.js#L321).
- When a user requests `POST /api/subjects/create`, Node counts existing subjects for that `userId`. If $\ge 3$, it rejects with:
  `{"error": "Maximum 3 subjects allowed"}`.
- Theme colors are assigned sequentially from `["#6C5CE7", "#00B894", "#E17055"]`.

### Subject Lifecycle & Synchronization
- **Creation**: Writes to `node-api/data/subjects.json` and creates an in-memory chat window `conversationMemory[subject.id] = []`.
- **Upload**: Files are stored under `node-api/data/users/<userId>/subjects/<subjectId>/files/<filename>` and indexed in `python-service/data/<subjectId>/`.
- **Deletion**:
  - Removes the subject entry from `node-api/data/subjects.json`.
  - Dispatches `DELETE http://localhost:8000/py/subject/:id`.
  - Python executes `shutil.rmtree(DATA_DIR / subject_id)`, wiping out the FAISS index and chunk metadata.

---

## 9. Study Features Internal Logic

### Quiz & Flashcard Generation Engine
Implemented in [study_engine.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/study_engine.py):
1. **Sampling (`retrieve_broad`)**:
   - If `selected_filename` is provided, filters metadata exclusively to that document.
   - If total chunks $\le 15$ (`TOP_K_STUDY`), takes all chunks.
   - If total chunks $> 15$, samples evenly across the document using a step size `len(metadata) // 15`.
2. **Prompting**:
   - Calls Groq with temperature `0.2` (`LLM_TEMPERATURE + 0.1`).
   - Demands exactly 5 MCQs with distractors, 3 short-answer questions with model answers, and 5 revision flashcards (`concept` and `summary`).
   - Requires every question and flashcard to include an exact source citation (`filename`, `page`, `chunk_index`).
3. **Markdown Fence Stripping**: Sanitizes raw LLM output by removing optional markdown code fences (` ```json `) before JSON parsing.

### Concept Simplification Engine
Implemented in [simplify_engine.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/simplify_engine.py):
1. Measures initial reading level using `textstat.flesch_kincaid_grade(original_answer)`.
2. Prompts Groq to rewrite the answer for a middle-school student using shorter sentences and everyday vocabulary while preserving facts and citations.
3. Calculates `simplified_grade = textstat.flesch_kincaid_grade(simplified_answer)`.
4. Returns `readability_improved = (simplified_grade < original_grade)`.

### Handwritten Notes Vision Engine
Implemented in [handwriting_engine.py](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/handwriting_engine.py):
1. Accepts an uploaded image via `POST /py/handwriting`.
2. Encodes binary image data into a base64 string.
3. Dispatches a chat completion call to the Groq Vision API (`os.getenv("GROQ_VISION_MODEL")`) with instructions to preserve headings, bullet points, and transcribe unclear words as `[unclear]`.
4. Returns transcribed text to the client editor for manual correction.
5. Ingestion via `POST /py/handwriting/add` writes the text to a temporary `handwritten_notes.txt` file and processes it through the standard chunking and FAISS indexing pipeline.

---

## 10. Data Storage and Persistence

AskMyNotes relies on structured **flat-file JSON storage** and binary **FAISS files**, with no relational database:

| Component | Storage Location | Persistence Type | Update / Invalidation Mechanism |
| :--- | :--- | :--- | :--- |
| **Student Profiles** | `node-api/data/users.json` | Persistent JSON | Appended on signup. Read on login. |
| **Active Sessions** | Node.js `activeSessions` Map | **In-Memory (RAM)** | Added on login. Deleted on logout or server restart. |
| **Subjects** | `node-api/data/subjects.json` | Persistent JSON | Updated on subject creation and deletion. |
| **File Records** | `node-api/data/files.json` | Persistent JSON | Appended on successful upload. |
| **Raw Note Files** | `node-api/data/users/<userId>/subjects/<subjectId>/files/` | Persistent Binary/Text | Saved permanently via `fs.copyFileSync`. |
| **Chat History** | `node-api/data/conversations.json` | Persistent JSON | Appended on every query turn. |
| **Sliding Memory** | Node.js `conversationMemory` Object | **In-Memory (RAM)** | Kept up to 8 turns per subject in memory. |
| **Vector Indexes** | `python-service/data/<subject_id>/index.faiss` | Persistent Binary FAISS | Rebuilt/updated on document upload or delete. |
| **Chunk Metadata** | `python-service/data/<subject_id>/chunks_meta.json` | Persistent JSON | Synchronized with FAISS index rebuilds. |
| **Gamification State** | Browser `localStorage` (`askmynotes_game_<userId>`) | Persistent Client Storage | Updated on user actions (XP, streaks, quizzes). |

---

## 11. Authentication and Security Analysis

### Implemented Security Mechanisms
1. **Password Hashing**:
   - Uses Node.js `crypto.scryptSync(password, salt, 64).toString("hex")`.
   - Each student account receives a unique 16-byte cryptographically secure random salt generated via `crypto.randomBytes(16).toString("hex")`.
2. **Session Token Generation**:
   - Session tokens are 32-byte cryptographically random hex strings (`crypto.randomBytes(32).toString("hex")`).
3. **Upload Filtering**:
   - Multer configuration limits incoming files to 50MB and rejects extensions outside the permitted list (`.pdf`, `.txt`, `.text`, `.docx`, `.pptx`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.zip`).

### Critical Security Vulnerabilities & Missing Protections
- **In-Memory Session Volatility**: `activeSessions` is stored in a JavaScript `Map`. If the Node.js server restarts, all session tokens are lost. Clients must re-login.
- **Missing Token Expiration**: Sessions stored in `activeSessions` have no TTL expiration check. Tokens remain valid indefinitely until server restart or explicit logout.
- **Unprotected Subject Deletion**: In `DELETE /api/subjects/:id`, there is **no check** verifying the caller's session token or whether the requesting user owns the subject. Any client knowing a subject ID can delete it.
- **Unprotected File Upload**: In `POST /api/upload/:subjectId`, there is no token check. Anyone can upload files to an existing subject ID.
- **Unprotected File Deletion**: In `DELETE /api/files/:subjectId/:filename`, there is no token verification.
- **Python Service Open Access**: The FastAPI service has CORS configured to `allow_origins=["*"]` with no API key or HMAC signature required between Node and Python. If port 8000 is exposed to a network, any user can invoke Python endpoints directly.

---

## 12. Error Handling and Logging

- **HTTP Status Codes**:
  - `400 Bad Request`: Validation failures (empty fields, passwords < 6 characters, unsupported file extensions, empty queries).
  - `401 Unauthorized`: Missing or malformed `Authorization: Bearer` headers, expired sessions, or incorrect login credentials.
  - `404 Not Found`: Subject or file not found in metadata.
  - `500 Internal Server Error`: Upstream Groq exceptions, document parsing errors, or FAISS serialization errors.
- **LLM Call Failure Resiliency**: In [query_engine.py line 88](file:///c:/Github/AskMyNotes-Team_Rocket/python-service/query_engine.py#L88), if Groq throws an exception (e.g., rate limits or network timeout), the engine catches the error and returns a fallback response with retrieved evidence snippets rather than crashing:
  ```json
  {
    "answer": "I found relevant evidence in your notes but could not generate a full answer. Please review the evidence snippets below.",
    "answer_found": true,
    "grounding_percentage": 100,
    "_error": "Rate limit exceeded..."
  }
  ```
- **Console Debug Logging**: Python service logs detailed diagnostics to standard output for every retrieval step, including raw query strings, total chunk counts, individual semantic and lexical scores, and raw prompt payloads sent to Groq.

---

## 13. Backend Setup and Execution

### Prerequisites
- Python 3.10+ with `venv`
- Node.js 18+ and `npm`
- Tesseract OCR (Windows: `C:\Program Files\Tesseract-OCR\tesseract.exe`)

### Step-by-Step Setup

```bash
# 1. Configure Python Environment Variables
cd AskMyNotes-Team_Rocket
cp .env.example python-service/.env
# Edit python-service/.env with your GROQ_API_KEY

# 2. Install Python Dependencies
cd python-service
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 3. Start Python Service (Terminal 1)
python -m uvicorn main:app --reload --port 8000

# 4. Install Node Dependencies & Run Gateway (Terminal 2)
cd ../node-api
npm install
node server.js
```

---

## 14. End-to-End API Examples

### 1. Student Sign Up
```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice Smith", "email": "alice@university.edu", "password": "securepassword123"}'
```
*Response (`200 OK`)*:
```json
{
  "status": "success",
  "message": "Account created successfully",
  "user": {
    "id": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
    "name": "Alice Smith",
    "email": "alice@university.edu"
  },
  "token": "7a3f9e8b2d1c4e6a8f0b2d4e6a8f0b2d7a3f9e8b2d1c4e6a8f0b2d4e6a8f0b2d"
}
```

### 2. Create Subject
```bash
curl -X POST http://localhost:3000/api/subjects/create \
  -H "Authorization: Bearer 7a3f9e8b2d1c4e6a8f0b2d4e6a8f0b2d..." \
  -H "Content-Type: application/json" \
  -d '{"name": "Distributed Systems"}'
```
*Response (`200 OK`)*:
```json
{
  "id": "c7e1cf6b-105b-4191-a77f-9e563f6cb24e",
  "userId": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
  "name": "Distributed Systems",
  "color": "#6C5CE7",
  "createdAt": "2026-10-23T12:00:00.000Z"
}
```

### 3. Upload Document
```bash
curl -X POST http://localhost:3000/api/upload/c7e1cf6b-105b-4191-a77f-9e563f6cb24e \
  -F "file=@/path/to/Raft_Consensus.pdf"
```
*Response (`200 OK`)*:
```json
{
  "status": "success",
  "chunks_added": 18,
  "total_chunks": 18,
  "filename": "Raft_Consensus.pdf"
}
```

### 4. Grounded Query (Success Path)
```bash
curl -X POST http://localhost:3000/api/query \
  -H "Authorization: Bearer 7a3f9e8b2d1c4e6a8f0b2d4e6a8f0b2d..." \
  -H "Content-Type: application/json" \
  -d '{"subject_id": "c7e1cf6b-105b-4191-a77f-9e563f6cb24e", "query": "What are the three states of a Raft node?"}'
```
*Response (`200 OK`)*:
```json
{
  "answer": "In the Raft consensus algorithm, a node can exist in one of three states: Follower, Candidate, or Leader. Nodes begin as Followers; if they do not hear from a Leader, they transition to Candidates to initiate an election.",
  "answer_found": true,
  "citations": [
    {"filename": "Raft_Consensus.pdf", "page": 4, "chunk_index": 3}
  ],
  "evidence_snippets": [
    "At any given time each server is in one of three states: leader, follower, or candidate..."
  ],
  "retrieval_match_score": 0.8942,
  "retrieval_match_label": "High Match",
  "grounding_percentage": 100,
  "subject_scope": "100% Distributed Systems-scoped",
  "gate_fired": null
}
```

### 5. Grounded Query (Gate 1 Refusal Path)
```bash
curl -X POST http://localhost:3000/api/query \
  -H "Authorization: Bearer 7a3f9e8b2d1c4e6a8f0b2d4e6a8f0b2d..." \
  -H "Content-Type: application/json" \
  -d '{"subject_id": "c7e1cf6b-105b-4191-a77f-9e563f6cb24e", "query": "How do photosynthesis light reactions operate?"}'
```
*Response (`200 OK`)*:
```json
{
  "answer": "Not found in your notes for Distributed Systems",
  "answer_found": false,
  "citations": [],
  "evidence_snippets": [],
  "retrieval_match_score": 0.1831,
  "retrieval_match_label": "Not Found",
  "grounding_percentage": 0,
  "subject_scope": "100% Distributed Systems-scoped",
  "gate_fired": "gate_1"
}
```

### 6. Simplify Answer
```bash
curl -X POST http://localhost:3000/api/simplify \
  -H "Content-Type: application/json" \
  -d '{
    "original_answer": "In the Raft consensus algorithm, a node can exist in one of three states: Follower, Candidate, or Leader.",
    "evidence_snippets": ["..."],
    "citations": [{"filename": "Raft_Consensus.pdf", "page": 4, "chunk_index": 3}],
    "subject_name": "Distributed Systems"
  }'
```
*Response (`200 OK`)*:
```json
{
  "simplified_answer": "In Raft, each computer plays one of three roles: it can listen as a Follower, ask for votes as a Candidate, or run things as the Leader.",
  "original_reading_level": 11.2,
  "simplified_reading_level": 6.8,
  "readability_improved": true,
  "evidence_snippets": ["..."],
  "citations": [{"filename": "Raft_Consensus.pdf", "page": 4, "chunk_index": 3}],
  "subject_scope": "100% Distributed Systems-scoped"
}
```

---

## 15. Known Issues and Improvement Opportunities

### Implementation Discrepancies & Gaps
1. **File Deletion Metadata Mismatch**:
   - When calling `DELETE /api/files/:subjectId/:filename`, the route informs Python to purge vectors and rebuild FAISS.
   - However, the Node.js handler does **not** remove the entry from `node-api/data/files.json` nor delete the physical file in `node-api/data/users/...`.
2. **Missing Authorization on Resource Endpoints**:
   - `DELETE /api/subjects/:id`, `POST /api/upload/:subjectId`, and `DELETE /api/files/:subjectId/:filename` do not check bearer session tokens or verify subject ownership.
3. **Session Loss on Node Restart**:
   - Because `activeSessions` is stored in RAM as a JavaScript `Map`, restarting the Node server forces all active students to re-login.
4. **Hardcoded Windows Path for Tesseract**:
   - `ingestion.py` hardcodes `r"C:\Program Files\Tesseract-OCR\tesseract.exe"`. Running on Linux containers or alternative Windows install directories causes OCR imports to fail unless adjusted.

### Recommended Architectural Improvements
- **Database Migration**: Transition `users.json`, `subjects.json`, and `files.json` to an embedded SQLite database using Prisma or Kysely for ACID transactional integrity.
- **Stateless Tokens**: Replace the in-memory session map with signed JSON Web Tokens (JWT) containing student IDs, eliminating session loss across server restarts.
- **Inter-Service Authentication**: Secure FastAPI endpoints by checking an internal preshared `X-Internal-Secret` header sent by the Node.js gateway.
- **Asynchronous Ingestion**: For large archives (`.zip`) or multi-hundred-page PDFs, offload parsing to an asynchronous worker queue (e.g., Celery or BullMQ) with WebSocket progress updates.
