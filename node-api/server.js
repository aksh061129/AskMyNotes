/**
 * AskMyNotes — Node.js API Controller Layer
 *
 * Responsibilities:
 * - Enforce exactly 3 subjects
 * - Handle file uploads (Multer) and forward to Python
 * - Route queries, study, simplify to Python RAG service
 * - Maintain session + conversation memory
 * - Serve static frontend
 */

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const FormData = require("form-data");

const app = express();
const PORT = 3000;
const PYTHON_SERVICE = "http://localhost:8000";
const MAX_SUBJECTS = 3;

// ── Middleware ────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Multer — temp file storage ───────────────────────────────────────
const upload = multer({
  dest: path.join(__dirname, "uploads"),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".pdf", ".txt", ".text"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and TXT files are supported"));
    }
  },
});

// ── In-memory state ──────────────────────────────────────────────────
const subjects = [];                    // { id, name, color, createdAt }
const conversationMemory = {};          // subjectId → [{ query, answer }]

const COLORS = ["#6C5CE7", "#00B894", "#E17055"];

// ── Subject Endpoints ────────────────────────────────────────────────

// Create subject
app.post("/api/subjects/create", (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Subject name is required" });
  }
  if (subjects.length >= MAX_SUBJECTS) {
    return res.status(400).json({
      error: `Maximum ${MAX_SUBJECTS} subjects allowed`,
    });
  }
  const subject = {
    id: uuidv4(),
    name: name.trim(),
    color: COLORS[subjects.length],
    createdAt: new Date().toISOString(),
  };
  subjects.push(subject);
  conversationMemory[subject.id] = [];
  res.json(subject);
});

// List subjects
app.get("/api/subjects", (req, res) => {
  res.json(subjects);
});

// Delete subject
app.delete("/api/subjects/:id", async (req, res) => {
  const idx = subjects.findIndex((s) => s.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Subject not found" });
  }
  const removed = subjects.splice(idx, 1)[0];
  delete conversationMemory[removed.id];

  // Tell Python to delete FAISS data
  try {
    await axios.delete(`${PYTHON_SERVICE}/py/subject/${removed.id}`);
  } catch (e) {
    // Non-fatal — Python may not have data yet
  }

  res.json({ status: "deleted", subject: removed });
});

// ── File Upload ──────────────────────────────────────────────────────

app.post("/api/upload/:subjectId", upload.single("file"), async (req, res) => {
  const subject = subjects.find((s) => s.id === req.params.subjectId);
  if (!subject) {
    return res.status(404).json({ error: "Subject not found" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    // Forward to Python /py/ingest
    const form = new FormData();
    form.append("file", fs.createReadStream(req.file.path), {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
    form.append("subject_id", subject.id);

    const pyRes = await axios.post(`${PYTHON_SERVICE}/py/ingest`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    res.json(pyRes.data);
  } catch (e) {
    const msg = e.response?.data?.detail || e.message;
    res.status(500).json({ error: msg });
  } finally {
    // Clean up temp file
    fs.unlink(req.file.path, () => {});
  }
});

// ── Query ────────────────────────────────────────────────────────────

app.post("/api/query", async (req, res) => {
  const { subject_id, query } = req.body;
  const subject = subjects.find((s) => s.id === subject_id);
  if (!subject) {
    return res.status(404).json({ error: "Subject not found" });
  }
  if (!query || !query.trim()) {
    return res.status(400).json({ error: "Query is required" });
  }

  const history = conversationMemory[subject_id] || [];

  try {
    const pyRes = await axios.post(`${PYTHON_SERVICE}/py/query`, {
      subject_id: subject.id,
      subject_name: subject.name,
      query: query.trim(),
      conversation_history: history.slice(-4),
    });

    // Store in conversation memory
    if (!conversationMemory[subject_id]) {
      conversationMemory[subject_id] = [];
    }
    conversationMemory[subject_id].push({
      query: query.trim(),
      answer: pyRes.data.answer || "",
    });
    // Keep only last 8 turns in memory
    if (conversationMemory[subject_id].length > 8) {
      conversationMemory[subject_id] = conversationMemory[subject_id].slice(-8);
    }

    res.json(pyRes.data);
  } catch (e) {
    const msg = e.response?.data?.detail || e.message;
    res.status(500).json({ error: msg });
  }
});

// ── Study ────────────────────────────────────────────────────────────

app.post("/api/study/:subjectId", async (req, res) => {
  const subject = subjects.find((s) => s.id === req.params.subjectId);
  if (!subject) {
    return res.status(404).json({ error: "Subject not found" });
  }

  try {
    const pyRes = await axios.post(`${PYTHON_SERVICE}/py/study`, {
      subject_id: subject.id,
      subject_name: subject.name,
    });
    res.json(pyRes.data);
  } catch (e) {
    const msg = e.response?.data?.detail || e.message;
    res.status(500).json({ error: msg });
  }
});

// ── Simplify ─────────────────────────────────────────────────────────

app.post("/api/simplify", async (req, res) => {
  const { original_answer, evidence_snippets, citations, subject_name } = req.body;
  if (!original_answer) {
    return res.status(400).json({ error: "original_answer is required" });
  }

  try {
    const pyRes = await axios.post(`${PYTHON_SERVICE}/py/simplify`, {
      original_answer,
      evidence_snippets: evidence_snippets || [],
      citations: citations || [],
      subject_name: subject_name || "Unknown",
    });
    res.json(pyRes.data);
  } catch (e) {
    const msg = e.response?.data?.detail || e.message;
    res.status(500).json({ error: msg });
  }
});

// ── Clear Conversation Memory (on subject switch) ────────────────────

app.post("/api/memory/clear/:subjectId", (req, res) => {
  conversationMemory[req.params.subjectId] = [];
  res.json({ status: "cleared" });
});

// ── Subject Stats ───────────────────────────────────────────────────

app.get("/api/stats/:subjectId", async (req, res) => {
  try {
    const pyRes = await axios.get(
      `${PYTHON_SERVICE}/py/stats/${req.params.subjectId}`
    );
    res.json(pyRes.data);
  } catch (e) {
    const msg = e.response?.data?.detail || e.message;
    res.status(500).json({ error: msg });
  }
});

// ── SPA fallback ─────────────────────────────────────────────────────

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[AskMyNotes API] Running on http://localhost:${PORT}`);
  console.log(`[AskMyNotes API] Python service expected at ${PYTHON_SERVICE}`);
});
