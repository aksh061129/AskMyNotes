# AskMyNotes: Evidence-Grounded AI Study Copilot

AskMyNotes is an intelligent, evidence-grounded study companion designed to eliminate AI hallucinations by answering questions **strictly and exclusively** from student-uploaded course materials. 

Unlike generic conversational AI tools that answer from broad pre-training data, AskMyNotes operates under a zero-hallucination paradigm: every answer must be grounded in verified snippets from course notes, slides, documents, or handwritten notes, complete with exact source filenames, page numbers, and chunk references. If the material does not contain the answer, the system refuses to guess.

---

## Table of Contents

- [Overview & Problem Statement](#overview--problem-statement)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Technology Stack](#technology-stack)
- [Project Directory Structure](#project-directory-structure)
- [End-to-End Application Workflow](#end-to-end-application-workflow)
- [Installation and Setup](#installation-and-setup)
- [Environment Variables & Configuration](#environment-variables--configuration)
- [How to Run the Application](#how-to-run-the-application)
- [Study Modes & Frontend Capabilities](#study-modes--frontend-capabilities)
- [Testing & Troubleshooting](#testing--troubleshooting)
- [Current Limitations & Future Enhancements](#current-limitations--future-enhancements)
- [Contributing & License](#contributing--license)

---

## Overview & Problem Statement

Students frequently encounter critical challenges when studying with modern Large Language Models (LLMs):
1. **Hallucinations & Confabulations**: General-purpose LLMs generate convincing answers that may be completely absent from or contradict a specific course curriculum or textbook.
2. **Lack of Verifiable Grounding**: Traditional chatbots do not cite exact slides, pages, or excerpts from the student's personal notes.
3. **Cross-Course Contamination**: Notes from one subject (e.g., Database Management Systems) often bleed into queries about another (e.g., Machine Learning).
4. **Unscanned Handwritten Notes**: Paper lecture notes and handwritten assignments remain disconnected from digital AI search tools.

**AskMyNotes solves these problems** by combining isolated subject-level vector indexes, hybrid retrieval (semantic embedding + lexical keyword matching), strict pre-LLM and post-LLM dual-gate refusal mechanisms, and an optical/vision pipeline for handwritten lecture notes.

---

## Key Features

- **Strict Subject Isolation**: Enforces a focused workspace of up to 3 active subjects per student (e.g., DBMS, ML, Operating Systems). Each subject maintains an isolated vector database and metadata store to guarantee zero cross-subject leakage.
- **Dual-Gate Refusal System**:
  - **Gate 1 (Pre-LLM Hard Gate)**: Queries with poor similarity matches (< 0.45 threshold) are rejected instantly without calling the LLM, saving inference tokens and avoiding speculative answers.
  - **Gate 2 (Post-LLM Soft Gate)**: If the LLM determines the retrieved evidence is insufficient to answer the query, it triggers an honest refusal while still showing the closest matching excerpts for transparency.
- **Source-Level Citations & Confidence Scoring**: Every response includes filename, page number, chunk ID, retrieval match score (High, Medium, Low), and grounding percentage.
- **Multi-Format Document Ingestion**:
  - Portable Document Format (`.pdf`) with page-by-page extraction via PyMuPDF.
  - Microsoft Word (`.docx`) including structured tables and text paragraphs.
  - Microsoft PowerPoint (`.pptx`) with shape extraction and automated slide image OCR.
  - Plain Text (`.txt`, `.text`).
  - Image Notes (`.png`, `.jpg`, `.jpeg`, `.webp`) with Tesseract OCR.
  - Compressed Archives (`.zip`) containing any combination of supported files.
- **Handwritten Notes Pipeline**: Transcribes handwritten notebook photos using Groq Vision models, allows in-browser text review/editing, and indexes the content into the subject's knowledge base.
- **Study Mode (Quizzes & Flashcards)**:
  - Generates 5 Multiple Choice Questions (MCQs) with plausible distractors and verified citations.
  - Generates 3 short-answer questions with model answers.
  - Generates 5 interactive flashcards with concepts on the front and key takeaways on the back.
  - Supports scoping quizzes to an individual selected document or all subject materials.
- **Concept Simplification**: Re-synthesizes technical answers into simpler, middle-school-level explanations while preserving citations, verified mathematically via Flesch-Kincaid readability scoring (`textstat`).
- **Context-Unavailable AI Fallback ("Ask General AI")**: When notes do not contain the answer, an optional general AI mode allows students to seek broader help without compromising the integrity of note-grounded answers.
- **Gamification & Habit Building**: Tracks XP points, levels (Freshman, Scholar, Topper, Legend), daily study streaks, night-owl sessions, and unlockable achievement badges in browser local storage.
- **Productivity & Analytics Suite**:
  - 28-day GitHub-style study heatmap calendar.
  - Integrated 25-minute Pomodoro focus timer with audio alerts.
  - Ebbinghaus knowledge retention predictor and weakness analysis.
  - Audio speech recognition (voice input) and speech synthesis (voice output).

---

## System Architecture

AskMyNotes uses a decoupled two-tier backend architecture: a **Node.js/Express API Gateway** that manages clients, auth, sessions, and uploads, and a **Python/FastAPI AI Service** that handles heavy document ingestion, vector embeddings, and RAG retrieval.

```mermaid
flowchart TD
    subgraph Client ["Frontend Client (Browser)"]
        UI["Single Page Application\n(HTML5, Vanilla CSS, Vanilla JS)"]
        LocalStorage[("Browser LocalStorage\nAuth Tokens & Gamification")]
    end

    subgraph NodeLayer ["Node.js API Gateway (Port 3000)"]
        Express["Express Server (server.js)"]
        AuthModule["Auth & In-Memory Sessions"]
        MulterStorage["Multer File Receiver & Disk Store"]
        JSONStore[("JSON File Storage\nusers, subjects, files, conversations")]
    end

    subgraph PythonLayer ["Python RAG Service (Port 8000)"]
        FastAPIApp["FastAPI Server (main.py)"]
        IngestEngine["Ingestion Engine (ingestion.py)\nPyMuPDF, docx, pptx, Tesseract"]
        EmbedSingleton["Embedder Singleton (embedder.py)\nall-MiniLM-L6-v2 (384-dim)"]
        FAISSStore[("FAISS Vector Store\nindex.faiss + chunks_meta.json")]
        HybridRetriever["Hybrid Retriever (retriever.py)\n70% Semantic + 30% Lexical"]
        QueryEngine["Query Engine (query_engine.py)\nDual-Gate Refusal"]
        StudyEngine["Study Engine (study_engine.py)\nQuizzes & Flashcards"]
        VisionEngine["Vision Engine (handwriting_engine.py)"]
    end

    subgraph CloudAI ["External Cloud LLM (Groq)"]
        GroqLLM["Groq LPU API\n(openai/gpt-oss-120b)"]
        GroqVision["Groq Vision API\n(e.g., qwen/qwen3.8-27b)"]
    end

    %% Client Interactions
    UI <-->|HTTP / REST (Port 3000)| Express
    UI <-->|Read / Write| LocalStorage

    %% Node to Storage
    Express <-->|Read / Write| JSONStore
    MulterStorage -->|Save original files| JSONStore

    %% Node to Python Service
    Express -->|Proxy Ingestion (Multipart)| FastAPIApp
    Express -->|Forward Queries (JSON)| FastAPIApp
    Express -->|Request Study / Quizzes| FastAPIApp

    %% Python Internal Pipeline
    FastAPIApp --> IngestEngine
    IngestEngine --> EmbedSingleton
    EmbedSingleton --> FAISSStore
    FastAPIApp --> QueryEngine
    QueryEngine --> HybridRetriever
    HybridRetriever --> FAISSStore
    QueryEngine --> GroqLLM
    StudyEngine --> GroqLLM
    VisionEngine --> GroqVision
    FastAPIApp --> VisionEngine
```

---

## Technology Stack

### Frontend
- **Structure**: Semantic HTML5 Single Page Application (`node-api/public/index.html`).
- **Styling**: Vanilla CSS3 (`node-api/public/styles.css`) featuring custom CSS variables, responsive grid/flexbox layouts, dark mode palette, and CSS keyframe animations.
- **Client Logic**: Vanilla JavaScript ES6+ (`node-api/public/app.js`) managing state, DOM events, Web Speech API (speech recognition and synthesis), and localStorage.
- **Typography & Icons**: Google Fonts (Inter), native Unicode emoji iconography.

### API Gateway & Controller Layer (`node-api`)
- **Runtime**: Node.js (v18+ recommended).
- **Framework**: Express 4 (`express`).
- **File Handling**: Multer (`multer`) with 50MB file size limit and MIME/extension filtering.
- **HTTP Client**: Axios (`axios`) and FormData (`form-data`) for streaming files and proxying requests to FastAPI.
- **Security & Cryptography**: Node.js standard `crypto` module (`crypto.scryptSync` with random salt for password hashing, `crypto.randomBytes` for bearer session tokens).
- **UUID Generation**: `uuid` (v4).
- **CORS**: `cors` middleware.

### Intelligence & RAG Service (`python-service`)
- **Runtime**: Python 3.10+ / 3.11+.
- **Web Framework**: FastAPI 0.115.0 and Uvicorn 0.30.6.
- **Vector Search Engine**: FAISS CPU (`faiss-cpu` 1.9.0) using `IndexFlatIP` (inner product on normalized vectors for cosine similarity).
- **Embeddings**: Sentence-Transformers 3.3.1 using `all-MiniLM-L6-v2` (384-dimensional dense vectors).
- **LLM Orchestration**: LlamaIndex Core 0.12.5 (`llama-index-core`) and Groq LLM Provider (`llama-index-llms-groq` 0.3.1).
- **External LLM Provider**: Groq Cloud API running `openai/gpt-oss-120b` (temperature 0.1 for high determinism).
- **Vision Model**: Official Groq Python SDK (`groq`) using vision models (e.g. `qwen/qwen3.8-27b`).
- **Document Extractors**:
  - `PyMuPDF` (`fitz` 1.25.1) for PDF parsing.
  - `python-docx` for Word document and table parsing.
  - `python-pptx` for PowerPoint text and slide shape inspection.
  - `Pillow` (PIL) and `pytesseract` for Optical Character Recognition (OCR).
- **Readability Verification**: `textstat` 0.7.4 for Flesch-Kincaid Grade Level calculations.

---

## Project Directory Structure

```text
AskMyNotes-Team_Rocket/
├── .env.example                     # Root environment template
├── .gitignore                       # Git ignore patterns
├── README.md                        # Complete project overview (this file)
├── BACKEND_README.md                # In-depth technical backend architecture guide
│
├── node-api/                        # Node.js Express Gateway & Frontend Server
│   ├── data/                        # Persistent JSON data and user files
│   │   ├── conversations.json       # Persisted student-assistant chat histories
│   │   ├── files.json               # Metadata records of all uploaded files
│   │   ├── subjects.json            # Subject workspace records
│   │   ├── users.json               # Registered student accounts and password hashes
│   │   └── users/                   # Permanent file storage tree:
│   │       └── <userId>/subjects/<subjectId>/files/<filename>
│   ├── node_modules/                # Installed Node dependencies
│   ├── public/                      # Static client assets (served directly)
│   │   ├── assets/                  # Illustrations and visual assets
│   │   ├── app.js                   # Client state, auth, quiz, voice, and analytics logic
│   │   ├── index.html               # Main SPA markup (Auth, Home, Workspace views)
│   │   └── styles.css               # Complete stylesheet
│   ├── uploads/                     # Temporary upload buffer for incoming files
│   ├── package.json                 # Node dependencies and execution scripts
│   ├── package-lock.json            # Node dependency lockfile
│   └── server.js                    # Express application entrypoint and route handlers
│
└── python-service/                  # Python FastAPI Intelligence & RAG Service
    ├── data/                        # Per-subject FAISS indexes and chunk metadata
    │   └── <subject_id>/            # Unique folder per subject UUID
    │       ├── chunks_meta.json     # Extracted text chunks with page & filename metadata
    │       └── index.faiss          # Serialized FAISS IndexFlatIP binary index
    ├── config.py                    # Central configuration (paths, models, thresholds)
    ├── embedder.py                  # Singleton wrapper for SentenceTransformer embedding
    ├── handwriting_engine.py        # Groq Vision pipeline for transcribing handwritten notes
    ├── ingestion.py                 # Multi-format document parser, chunker, and FAISS builder
    ├── main.py                      # FastAPI app entrypoint, routes, and CORS setup
    ├── query_engine.py              # Dual-gate retrieval, LLM prompting, and refusal logic
    ├── retriever.py                 # Hybrid retriever (70% semantic + 30% lexical keyword)
    ├── simplify_engine.py           # Answer simplification with textstat grade level checking
    ├── study_engine.py              # Quiz (MCQs/short answers) and flashcard generator
    ├── requirements.txt             # Python pip dependencies
    ├── test_handwriting.py          # Standalone verification script for handwriting OCR
    ├── test_handwriting.jpeg        # Test handwriting image sample
    └── test_handwriting1.jpeg       # Test handwriting image sample
```

---

## End-to-End Application Workflow

1. **Subject Workspace Creation**:
   - The student logs in and creates a subject workspace (up to 3 per account).
   - Node.js records the subject in `node-api/data/subjects.json` and assigns a distinct visual theme color.
2. **Document Ingestion**:
   - The student drags a document (`.pdf`, `.docx`, `.pptx`, `.txt`, `.png`, `.jpg`, `.zip`) into the sidebar upload zone.
   - Node.js temporarily buffers the file via Multer, saves a permanent copy under `node-api/data/users/<userId>/subjects/<subjectId>/files/`, and streams the file to Python at `/py/ingest`.
   - Python extracts text per page/slide, executes Tesseract OCR on images/pictures, and splits text into chunks of 512 tokens with 50-token overlap using LlamaIndex `SentenceSplitter`.
   - Chunks are vectorized using `all-MiniLM-L6-v2`, L2-normalized, and added to the subject's `index.faiss`. Metadata is appended to `chunks_meta.json`.
3. **Question Answering & Dual-Gate Evaluation**:
   - The student enters a query in Chat Mode.
   - Node.js appends the last 4 conversational turns from memory and forwards the request to `/py/query`.
   - The hybrid retriever searches FAISS for top-5 chunks by cosine similarity, then computes lexical overlap against query keywords (`hybrid_score = 0.70 * semantic + 0.30 * lexical`).
   - **Gate 1 check**: If the top chunk score is below 0.45, Python terminates immediately with `"Not found in your notes for <Subject>"` without calling the LLM.
   - If Gate 1 passes, the prompt is formatted with evidence snippets and sent to Groq (`openai/gpt-oss-120b`).
   - **Gate 2 check**: If the LLM determines the evidence does not answer the question, it outputs `"answer_found": false`. The system returns a refusal message while preserving top citations and snippets so the student can verify what was retrieved.
   - If successful, the grounded answer is delivered with citations, grounding confidence score, and match quality.
4. **Interactive Revision**:
   - The student can click **"Simplify"** to re-phrase the answer in middle-school language, with readability changes measured via Flesch-Kincaid grade level scores.
   - In Study Mode, the student can click **"Generate Quiz"** or **"Study Flashcards"** scoped to either all materials or a specific file.

---

## Installation and Setup

### Prerequisites

- **Node.js**: Version 18.0.0 or higher.
- **Python**: Version 3.10 or 3.11 (64-bit recommended).
- **Tesseract OCR**: Required for image and PPTX picture OCR.
  - On Windows, install Tesseract to: `C:\Program Files\Tesseract-OCR\tesseract.exe` (or adjust the path in `python-service/ingestion.py`).
- **Groq API Key**: A free key obtainable from [console.groq.com](https://console.groq.com/keys).

---

### Step 1: Clone Repository & Configure Environment

```bash
git clone https://github.com/aksh061129/AskMyNotes.git
cd AskMyNotes-Team_Rocket
```

Create the environment file for the Python service:

```bash
# Windows PowerShell
Copy-Item .env.example python-service/.env

# Linux / macOS
cp .env.example python-service/.env
```

Open `python-service/.env` in a text editor and provide your keys:

```ini
GROQ_API_KEY=gsk_your_actual_groq_api_key_here
GROQ_VISION_MODEL=qwen/qwen3.8-27b
```

---

### Step 2: Set Up Python Service

Open a terminal dedicated to the Python RAG service:

```bash
cd python-service

# Create a virtual environment
python -m venv venv

# Activate virtual environment
# Windows (PowerShell):
.\venv\Scripts\Activate.ps1
# Windows (CMD):
.\venv\Scripts\activate.bat
# Linux / macOS:
source venv/bin/activate

# Install required packages
pip install --upgrade pip
pip install -r requirements.txt
```

---

### Step 3: Set Up Node.js Gateway

Open a second terminal dedicated to the Node.js API:

```bash
cd node-api

# Install Node dependencies
npm install
```

---

## Environment Variables & Configuration

### Python Service Configuration (`python-service/.env` & `config.py`)

| Variable / Parameter | Location | Type | Default Value | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `GROQ_API_KEY` | `.env` | String | `""` | Authentication key for Groq Cloud LLM and Vision models. |
| `GROQ_VISION_MODEL` | `.env` | String | `qwen/qwen3.8-27b` | Model used for transcribing handwritten images. |
| `GROQ_MODEL` | `config.py` | String | `openai/gpt-oss-120b` | LLM used for grounded RAG, quizzes, and simplification. |
| `LLM_TEMPERATURE` | `config.py` | Float | `0.1` | Low temperature setting for factual, deterministic generation. |
| `EMBED_MODEL_NAME` | `config.py` | String | `all-MiniLM-L6-v2` | SentenceTransformer model used for embedding notes. |
| `EMBED_DIMENSION` | `config.py` | Integer | `384` | Embedding dimensionality. |
| `CHUNK_SIZE` | `config.py` | Integer | `512` | Token chunk size for `SentenceSplitter`. |
| `CHUNK_OVERLAP` | `config.py` | Integer | `50` | Overlap between consecutive chunks. |
| `TOP_K` | `config.py` | Integer | `5` | Number of chunks retrieved during standard queries. |
| `TOP_K_STUDY` | `config.py` | Integer | `15` | Number of chunks retrieved during study quiz generation. |
| `GATE_1_THRESHOLD` | `config.py` | Float | `0.45` | Minimum hybrid similarity score required to bypass Gate 1 refusal. |

### Node.js Configuration (`node-api/server.js`)

| Constant | Default Value | Purpose |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for the Express gateway and frontend static files. |
| `PYTHON_SERVICE` | `http://localhost:8000` | Address of the upstream FastAPI intelligence service. |
| `MAX_SUBJECTS` | `3` | Maximum subjects allowed per student account. |

---

## How to Run the Application

The application requires running both the Python service and the Node.js API concurrently.

### Terminal 1: Start Python Service (Port 8000)

```bash
cd python-service
# Activate your venv if not already active:
.\venv\Scripts\Activate.ps1
# Start the FastAPI server:
python -m uvicorn main:app --reload --port 8000
```
*Health Check*: Open `http://localhost:8000/py/health` in your browser to verify it returns `{"status":"ok","service":"askmynotes-rag"}`.

### Terminal 2: Start Node.js API (Port 3000)

```bash
cd node-api
node server.js
```
*Output*:
```text
[AskMyNotes API] Running on http://localhost:3000
[AskMyNotes API] Python service expected at http://localhost:8000
```

### Accessing the Web Application

Navigate your browser to:
```text
http://localhost:3000
```

1. **Sign Up**: Create an account with your Name, Email/Username, and Password (min 6 characters).
2. **Log In**: Authenticate to enter the Home Screen or Dashboard.
3. **Create Subject**: Click `+ Add` in the sidebar (e.g., "Computer Networks").
4. **Upload Notes**: Select your subject and drag a PDF, Word document, PPTX, or image into the upload box.
5. **Ask Questions**: Type queries into the chat box or use the microphone button for voice input.

---

## Study Modes & Frontend Capabilities

### 1. Chat Mode (`#chat-view`)
- **Evidence Card**: Answers render with collapsible cards showing excerpts of the exact chunks retrieved.
- **Citations**: Source filename and page number badges for instant verification.
- **Match Indicator**: Color-coded badges indicating High (>0.85), Medium (0.65–0.85), or Low (0.45–0.65) retrieval confidence.
- **Simplify Button**: Calls the readability engine to convert complex explanations into simpler phrasing.
- **Speech Engine**: Built-in voice input via Web Speech API recognition and text-to-speech answer playback.

### 2. Study Mode (`#study-view`)
- **Document Selector**: Choose a single document to generate a focused quiz or select all documents for a comprehensive review.
- **Interactive Quizzes**: 5 MCQs with instant feedback, answer explanations, citations, and score calculation. Includes 3 short-answer self-assessment questions.
- **Interactive Flashcards**: 3D flip card UI displaying key concepts on the front and concise note-grounded summaries on the back.

### 3. Analytics & Planner Mode (`#analytics-view`)
- **Study Activity Calendar**: 28-day activity heatmap tracking daily revisions.
- **Quiz Performance Trend**: Visual SVG graph tracing quiz scores over time.
- **Pomodoro Timer**: Embedded 25:00 countdown timer with start/pause/reset controls.
- **Weakness Heatmap & Personalized Study Plan**: Analyzes missed quiz questions to recommend focus areas.

---

## Testing & Troubleshooting

### Standalone Handwriting Transcription Test

You can test vision model connectivity independently using the included verification script:

```bash
cd python-service
python test_handwriting.py
```
This sends `test_handwriting1.jpeg` to the Groq vision model and prints the transcribed output to the console.

### Common Issues and Solutions

1. **OCR Fails with `TesseractNotFoundError`**:
   - *Cause*: Tesseract OCR is not installed or not located at `C:\Program Files\Tesseract-OCR\tesseract.exe`.
   - *Fix*: Install Tesseract-OCR for Windows or edit line 17 of `python-service/ingestion.py` to point to your actual binary path.
2. **`GroqError: Rate limit reached` or `Authentication Error`**:
   - *Cause*: Invalid or expired `GROQ_API_KEY` in `python-service/.env`.
   - *Fix*: Confirm your key at [console.groq.com/keys](https://console.groq.com/keys). Ensure there are no surrounding quotes or trailing spaces in `python-service/.env`.
3. **Uploads Fail with `500 Internal Server Error`**:
   - *Cause*: Python service is not running on port 8000 or the virtual environment is missing dependencies.
   - *Fix*: Verify `http://localhost:8000/py/health` returns `{"status":"ok"}`.
4. **Session Invalidated After Server Restart**:
   - *Cause*: Active auth tokens are maintained in Node.js memory (`activeSessions = new Map()`).
   - *Fix*: Re-login via the UI at `http://localhost:3000`. User accounts themselves remain preserved in `node-api/data/users.json`.

---

## Current Limitations & Future Enhancements

### Current Verified Limitations
- **In-Memory Session Store**: Restarting the Node.js process clears active session tokens in RAM, requiring users to log in again even though user records persist in `users.json`.
- **Hardcoded Tesseract Binary Path**: Windows-specific executable path (`C:\Program Files\Tesseract-OCR\tesseract.exe`) is hardcoded in `ingestion.py`, requiring manual edits on Linux/macOS.
- **File Deletion Metadata Desynchronization**: While `DELETE /api/files/:subjectId/:filename` successfully updates the FAISS vector index, it does not currently prune `node-api/data/files.json` or delete the physical file from `node-api/data/users/`.
- **Absence of Rate Limiting**: The API gateway does not enforce request rate limits or body size limits on plain JSON routes.
- **Local FAISS Indexing**: Vector search runs locally on CPU via `faiss-cpu`; large enterprise document sets (>10,000 pages) may require distributed vector databases.

### Planned Enhancements
- [ ] Migrate file-based JSON storage (`users.json`, `subjects.json`, `conversations.json`) to SQLite or PostgreSQL with Prisma ORM.
- [ ] Implement stateless JWT tokens or Redis-backed persistent sessions.
- [ ] Add cross-platform environment variable configuration for Tesseract OCR (`TESSERACT_PATH`).
- [ ] Support export of study flashcards into standard Anki (`.apkg`) packages.
- [ ] Add PDF side-by-side split screen viewer with automated jump-to-page highlighting based on chunk citations.

---

## Contributing & License

### Contributing
Contributions to AskMyNotes are welcome! Please follow these guidelines:
1. Fork the repository and create a descriptive feature branch (`git checkout -b feature/improved-chunking`).
2. Adhere to existing code styles (PEP 8 for Python, standard clean JavaScript for Node and frontend).
3. Verify that changes do not compromise the zero-hallucination dual-gate refusal system.
4. Submit a pull request detailing your changes and test results.

### License
This repository is currently maintained for academic and educational purposes by **Team Rocket**. Refer to repository metadata or contact maintainers for commercial usage terms.
