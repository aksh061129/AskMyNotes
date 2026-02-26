# AskMyNotes — Subject-Scoped AI Study Copilot

Evidence-grounded RAG study assistant that answers **only** from your uploaded notes.

## Quick Start

### 1. Set your API key

Copy `.env.example` to `python-service/.env` and add your Groq API key:

```bash
cp .env.example python-service/.env
# Edit python-service/.env and set GROQ_API_KEY
```

Get a free key at https://console.groq.com/keys

### 2. Start Python RAG Service

```bash
cd python-service
pip install -r requirements.txt
python main.py
```

Runs on http://localhost:8000

### 3. Start Node.js API

```bash
cd node-api
npm install
node server.js
```

Runs on http://localhost:3000

### 4. Open the app

Navigate to http://localhost:3000

## Architecture

```
Frontend (localhost:3000)  →  Node.js API (Express)  →  Python RAG (FastAPI)  →  FAISS Indexes
```

- **Python** = Intelligence (ingestion, retrieval, LLM, refusal)
- **Node.js** = Controller (subject rules, upload routing, memory)
- **Frontend** = Premium dark UI (voice, gamification, analytics)

## Features

- 3-subject workspace with isolated FAISS indexes
- Dual-gate refusal (pre-LLM + post-LLM)
- Evidence-grounded answers with citations
- Study mode (MCQs + short answers)
- Voice input/output
- Gamification (XP, streaks, badges, leaderboard)
- Pomodoro timer & study calendar
