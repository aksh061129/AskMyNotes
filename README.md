# 📚 AskMyNotes: Evidence-Grounded AI Study Copilot

> **An intelligent study companion that answers questions strictly and exclusively from your uploaded course notes — with zero guesses and exact page citations.**

---

## 🎯 What is AskMyNotes?

Studying with generic AI tools like ChatGPT often leads to **hallucinations** — the AI makes up convincing facts or answers from outside your course syllabus.

**AskMyNotes solves this with a zero-hallucination promise:**
- **100% Course-Grounded**: It only answers using the notes, slides, and textbooks you upload.
- **Verifiable Citations**: Every answer tells you the exact filename and page or slide number where the answer was found.
- **Zero Guessing**: If the answer isn't in your notes, it will honestly tell you rather than making something up.
- **Isolated Subject Workspaces**: Your Biology notes will never mix with your History or Computer Science notes.

---

## 🔄 The Complete User Flow

Here is how you use AskMyNotes to study for an exam from start to finish:

```
 ┌──────────────────────┐
 │  1. Create a Subject │ ─── Create a dedicated workspace (e.g., "Machine Learning")
 └──────────┬───────────┘
            ▼
 ┌──────────────────────┐
 │  2. Upload Notes     │ ─── Drag & drop PDFs, Word docs, PPT slides, or photos of handwriting
 └──────────┬───────────┘
            ▼
 ┌──────────────────────┐
 │  3. Ask Questions    │ ─── Ask anything in Chat Mode (by typing or using your voice)
 └──────────┬───────────┘
            ▼
 ┌──────────────────────┐
 │  4. Verify Evidence  │ ─── Check the exact page citation & confidence match score
 └──────────┬───────────┘
            ▼
 ┌──────────────────────┐
 │  5. Test Knowledge   │ ─── Switch to Study Mode for instant MCQs, flashcards, & self-tests
 └──────────┬───────────┘
            ▼
 ┌──────────────────────┐
 │  6. Track Habits     │ ─── Build streaks on your study heatmap & focus with the Pomodoro timer
 └──────────────────────┘
```

---

## 🌟 Core Features & How They Help You Study

### 1. 💬 Evidence-Grounded Chat & Smart Citations
- **Strictly from your notes**: Ask any question about your curriculum and get clear, accurate answers.
- **Page-Level Citations**: Click on badges to see the exact file and page number.
- **Match Indicator**: Color-coded badges show how strongly your notes support the answer (**High**, **Medium**, or **Low** match).
- **Expandable Evidence Snippets**: Read the raw excerpts pulled directly from your notes for complete peace of mind.
- **Honest Refusals**: If a topic wasn't covered in your uploaded files, AskMyNotes lets you know upfront.

### 2. 📂 Upload Any Study Material
Drop your study files straight into your subject workspace:
- **PDF Documents** (`.pdf`) — lecture slides, textbooks, research papers
- **Word Documents** (`.docx`) — typed revision notes, syllabus guides, tables
- **PowerPoint Presentations** (`.pptx`) — lecture presentations and slide decks
- **Plain Text** (`.txt`) — quick summaries and cheat sheets
- **Images of Notes** (`.png`, `.jpg`, `.jpeg`, `.webp`) — diagrams and lecture photos
- **ZIP Archives** (`.zip`) — upload entire folders of materials in one go

### 3. ✍️ Handwritten Notes Scanner
Have handwritten notes in a paper notebook?
- Take a photo of your notebook page and upload it.
- Built-in AI vision transcribes your handwriting into clean, searchable text.
- Review and edit the transcription in your browser.
- Once saved, your handwritten notes can be searched, queried, and turned into quizzes just like any digital document!

### 4. 📝 Study Mode: Interactive Quizzes & Flashcards
Turn your static notes into an active revision session:
- **5 Multiple-Choice Questions (MCQs)**: With smart distractors and detailed explanations for each answer.
- **3 Short-Answer Questions**: Test your understanding with model answers to compare against.
- **5 3D Flip Flashcards**: Practice active recall with core concepts on the front and key takeaways on the back.
- **Targeted Practice**: Generate quizzes from all materials in a subject or focus exclusively on a single uploaded file.

### 5. 🐣 "Simplify" Explanation Mode
Stuck on dense academic jargon or a complicated textbook definition?
- Click the **"Simplify"** button under any response.
- AskMyNotes rewrites the explanation into plain, everyday language (middle-school reading level) while preserving all factual citations and definitions.

### 6. 🎙️ Hands-Free Voice Mode
- Click the **Microphone** button to speak your questions out loud.
- Click the **Speaker** button to have the answer read aloud to you — perfect for auditory learners or hands-free study sessions.

### 7. ⏱️ Focus & Productivity Suite
- **28-Day Study Heatmap**: A GitHub-style calendar that tracks your daily study habits.
- **Pomodoro Focus Timer**: Built-in 25-minute focus session timer with audio chimes to keep you on schedule.
- **Gamification & XP**: Earn study points, level up (from *Freshman* to *Legend*), and unlock achievement badges as you review notes and complete quizzes.

---

## 🚀 Getting Started (Simple Setup)

Follow these quick steps to get AskMyNotes running on your machine:

### Prerequisites
1. **Node.js** (v18+) — [Download Node.js](https://nodejs.org/)
2. **Python** (v3.10 or v3.11) — [Download Python](https://www.python.org/)
3. A free **Groq API Key** — [Get your free key at console.groq.com](https://console.groq.com/keys)

---

### Step 1: Clone the Repo & Set Your API Key
```bash
git clone https://github.com/aksh061129/AskMyNotes.git
cd AskMyNotes-Team_Rocket
```

Copy the example environment file:
- **Windows (PowerShell)**: `Copy-Item .env.example python-service/.env`
- **Mac / Linux**: `cp .env.example python-service/.env`

Open `python-service/.env` and paste your free Groq API key:
```ini
GROQ_API_KEY=gsk_your_groq_key_here
```

---

### Step 2: Start the Application

You'll run two quick commands in two separate terminal windows:

#### Terminal 1 (AI Engine):
```bash
cd python-service
python -m venv venv

# Activate virtual environment:
# Windows (PowerShell): .\venv\Scripts\Activate.ps1
# Mac/Linux: source venv/bin/activate

pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

#### Terminal 2 (Web Server):
```bash
cd node-api
npm install
node server.js
```

---

### Step 3: Open in Browser & Start Studying!

Open your browser and navigate to:
👉 **[http://localhost:3000](http://localhost:3000)**

1. **Sign Up**: Create an account with your name, email, and password.
2. **Add a Subject**: Click `+ Add` in the sidebar (e.g. *"Operating Systems"*).
3. **Upload Notes**: Drag and drop your notes or lecture slides.
4. **Ask Away**: Ask any question or switch to the **Study** tab for quizzes!

> 💡 **Looking for technical architecture, API routes, or code documentation?**  
> Check out the [Backend Developer Guide (`BACKEND_README.md`)](file:///c:/Github/AskMyNotes-Team_Rocket/BACKEND_README.md).

---

## 🙋 Frequently Asked Questions (FAQ)

### Can notes from different subjects mix together?
**No.** Each subject workspace is completely isolated. When you ask a question in "Database Management Systems", the system will never search or pull answers from your "Machine Learning" notes.

### What happens if my notes don't contain the answer?
AskMyNotes will honestly tell you: *"Not found in your notes for [Subject]"*. It will also display an optional **"Ask General AI"** button so you can still get a general answer if you wish, without confusing it with your notes.

### How are the quizzes and flashcards generated?
AskMyNotes scans through your notes and extracts key concepts, definitions, and relationships. It formats them into standard exam-style multiple-choice questions with answer explanations and flashcards that cite the original pages.

### Can I upload multiple files to one subject?
**Yes!** You can upload multiple PDFs, Word documents, slide decks, and image notes to a single subject. AskMyNotes searches across all of them simultaneously.

---

## 👥 Credits & Contributing

Developed by **Team Rocket** for students, educators, and lifelong learners who want verifiable, trustworthy study answers.

Contributions and suggestions are always welcome! Feel free to open an issue or submit a pull request.
