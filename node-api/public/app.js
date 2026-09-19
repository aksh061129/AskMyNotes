/**
 * AskMyNotes — Client Application
 * Handles: subjects, uploads, queries, study mode, voice, gamification, analytics
 */

const API = '';  // Same origin

// ═══════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════
const state = {
    subjects: [],
    activeSubjectId: null,
    uploadedFiles: {},       // subjectId → [{ filename, chunks }]
    quizData: null,
    quizAnswers: {},
    quizRevealed: false,
    isListening: false,
    isSpeaking: false,
    lastAnswer: null,        // for simplify
    pomodoroInterval: null,
    pomodoroSeconds: 25 * 60,
    pomodoroRunning: false,
};

// ═══════════════════════════════════════════════════════════════════════
// GAMIFICATION (localStorage)
// ═══════════════════════════════════════════════════════════════════════
const LEVELS = [
    { name: 'Freshman', xp: 0 },
    { name: 'Scholar', xp: 500 },
    { name: 'Topper', xp: 1500 },
    { name: 'Legend', xp: 3000 },
];

const BADGES_DEF = [
    { id: 'first_upload', icon: '📤', label: 'First Upload', check: g => g.totalUploads >= 1 },
    { id: '7_streak', icon: '🔥', label: '7-Day Streak', check: g => g.streak >= 7 },
    { id: 'perfect_quiz', icon: '💯', label: 'Perfect Quiz', check: g => g.perfectQuizzes >= 1 },
    { id: 'night_owl', icon: '🦉', label: 'Night Owl', check: g => g.nightSessions >= 1 },
    { id: 'note_master', icon: '📚', label: 'Note Master (100+ chunks)', check: g => g.totalChunks >= 100 },
    { id: 'quiz_10', icon: '🎯', label: '10 Quizzes', check: g => g.totalQuizzes >= 10 },
];

function loadGameData() {
    const d = localStorage.getItem('askmynotes_game');
    return d ? JSON.parse(d) : {
        xp: 0,
        streak: 0,
        lastStudyDate: null,
        totalUploads: 0,
        totalQuizzes: 0,
        perfectQuizzes: 0,
        nightSessions: 0,
        totalChunks: 0,
        quizHistory: [],
        badges: [],
        studyDays: {},    // 'YYYY-MM-DD' → minutes
        dailyQuizDone: false,
        streakFreezes: 1,
    };
}

function saveGameData(g) {
    localStorage.setItem('askmynotes_game', JSON.stringify(g));
}

function addXP(amount, reason) {
    const g = loadGameData();
    g.xp += amount;
    saveGameData(g);
    updateGamificationUI();
    // Flash XP badge
    const badge = document.getElementById('xp-badge');
    badge.style.animation = 'none';
    badge.offsetHeight; // Reflow
    badge.style.animation = 'xpFlash 0.6s ease';
}

function checkStreak() {
    const g = loadGameData();
    const today = new Date().toISOString().slice(0, 10);
    if (g.lastStudyDate === today) return;

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (g.lastStudyDate === yesterday) {
        g.streak += 1;
    } else if (g.lastStudyDate !== today) {
        g.streak = 1;
    }
    g.lastStudyDate = today;

    // Night owl check
    const hour = new Date().getHours();
    if (hour >= 22 || hour < 5) {
        g.nightSessions += 1;
    }

    // Study day tracking
    g.studyDays[today] = (g.studyDays[today] || 0) + 1;

    saveGameData(g);
    updateGamificationUI();
}

function getLevel(xp) {
    let level = LEVELS[0];
    for (const l of LEVELS) {
        if (xp >= l.xp) level = l;
    }
    return level;
}

function getNextLevel(xp) {
    for (const l of LEVELS) {
        if (xp < l.xp) return l;
    }
    return LEVELS[LEVELS.length - 1];
}

function updateGamificationUI() {
    const g = loadGameData();

    // XP & Level
    document.getElementById('xp-count').textContent = g.xp;
    document.getElementById('streak-count').textContent = g.streak;
    const lvl = getLevel(g.xp);
    const next = getNextLevel(g.xp);
    document.getElementById('level-text').textContent = lvl.name;

    // XP progress bar
    const progressPct = next.xp > lvl.xp
        ? ((g.xp - lvl.xp) / (next.xp - lvl.xp)) * 100
        : 100;
    document.getElementById('xp-fill').style.width = progressPct + '%';
    document.getElementById('xp-progress-text').textContent =
        `${g.xp - lvl.xp} / ${next.xp - lvl.xp} XP to ${next.name}`;

    // Badges
    const panel = document.getElementById('badges-panel');
    panel.innerHTML = '';
    for (const bd of BADGES_DEF) {
        const el = document.createElement('div');
        el.className = 'achievement-badge' + (bd.check(g) ? ' earned' : '');
        el.title = bd.label;
        el.textContent = bd.icon;
        panel.appendChild(el);
    }

    // Study calendar (last 28 days)
    const cal = document.getElementById('study-calendar');
    cal.innerHTML = '';
    for (let i = 27; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        const mins = g.studyDays[d] || 0;
        const div = document.createElement('div');
        div.className = 'cal-day';
        if (mins >= 4) div.classList.add('level-4');
        else if (mins >= 3) div.classList.add('level-3');
        else if (mins >= 2) div.classList.add('level-2');
        else if (mins >= 1) div.classList.add('level-1');
        div.title = `${d}: ${mins} session(s)`;
        cal.appendChild(div);
    }

    // Analytics
    updateAnalytics(g);
}

// ═══════════════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════════════
function updateAnalytics(g) {
    // Subject progress
    const progressEl = document.getElementById('subject-progress');
    progressEl.innerHTML = '';
    for (const s of state.subjects) {
        const files = state.uploadedFiles[s.id] || [];
        const totalChunks = files.reduce((sum, f) => sum + (f.chunks || 0), 0);
        const item = document.createElement('div');
        item.className = 'progress-item';
        item.innerHTML = `
      <span class="progress-item-label">${s.name}</span>
      <div class="progress-item-bar">
        <div class="progress-item-fill" style="width: ${Math.min(100, totalChunks * 2)}%; background: ${s.color};"></div>
      </div>
      <span style="font-size:11px;color:var(--text-muted)">${totalChunks} chunks</span>
    `;
        progressEl.appendChild(item);
    }

    // Quiz trend
    const trendEl = document.getElementById('quiz-trend');
    if (g.quizHistory.length === 0) {
        trendEl.innerHTML = '<span>No quizzes taken yet</span>';
    } else {
        const last5 = g.quizHistory.slice(-5);
        trendEl.innerHTML = '<div style="display:flex;gap:8px;align-items:flex-end;height:80px;">' +
            last5.map(q => {
                const h = Math.max(10, q.score * 80);
                return `<div style="width:30px;height:${h}px;background:var(--gradient-primary);border-radius:4px 4px 0 0;" title="${Math.round(q.score * 100)}%"></div>`;
            }).join('') + '</div>';
    }

    // Weakness heatmap
    const weakEl = document.getElementById('weakness-heatmap');
    weakEl.innerHTML = g.quizHistory.length > 0
        ? '<span style="color:var(--accent-orange)">Review questions you got wrong in Study Mode</span>'
        : '<span>Take quizzes to identify weaknesses</span>';

    // Retention
    const retEl = document.getElementById('retention-predictor');
    if (g.streak > 0) {
        const ret = Math.min(95, 50 + g.streak * 5);
        retEl.innerHTML = `<div style="text-align:center"><div style="font-size:32px;font-weight:800;background:var(--gradient-primary);-webkit-background-clip:text;-webkit-text-fill-color:transparent">${ret}%</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">Estimated retention (${g.streak}-day streak)</div></div>`;
    } else {
        retEl.innerHTML = '<span>Start studying to see predictions</span>';
    }
}

// ═══════════════════════════════════════════════════════════════════════
// SUBJECTS
// ═══════════════════════════════════════════════════════════════════════
async function loadSubjects() {
    try {
        const res = await fetch(`${API}/api/subjects`);
        state.subjects = await res.json();
        renderSubjects();
    } catch (e) {
        console.error('Failed to load subjects:', e);
    }
}

function renderSubjects() {
    const list = document.getElementById('subject-list');
    list.innerHTML = '';
    document.getElementById('subject-counter').textContent = `${state.subjects.length}/3`;

    for (const s of state.subjects) {
        const card = document.createElement('div');
        card.className = 'subject-card' + (s.id === state.activeSubjectId ? ' active' : '');
        card.innerHTML = `
      <div class="subject-dot" style="background: ${s.color}"></div>
      <span class="subject-card-name">${s.name}</span>
      <span class="subject-card-chunks" id="chunks-${s.id}"></span>
      <button class="subject-delete" title="Delete subject">&times;</button>
    `;
        card.addEventListener('click', (e) => {
            if (!e.target.classList.contains('subject-delete')) {
                selectSubject(s.id);
            }
        });
        card.querySelector('.subject-delete').addEventListener('click', () => deleteSubject(s.id));
        list.appendChild(card);
    }

    // Disable add button if 3 subjects
    const addBtn = document.getElementById('add-subject-btn');
    addBtn.disabled = state.subjects.length >= 3;

    // Update analytics
    updateGamificationUI();
}

async function createSubject() {
    const input = document.getElementById('subject-name-input');
    const name = input.value.trim();
    if (!name) return;

    try {
        const res = await fetch(`${API}/api/subjects/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (!res.ok) {
            const err = await res.json();
            alert(err.error);
            return;
        }
        const subject = await res.json();
        state.subjects.push(subject);
        state.uploadedFiles[subject.id] = [];
        input.value = '';
        renderSubjects();
        selectSubject(subject.id);
    } catch (e) {
        alert('Failed to create subject');
    }
}

async function deleteSubject(id) {
    if (!confirm('Delete this subject and all its notes?')) return;
    try {
        await fetch(`${API}/api/subjects/${id}`, { method: 'DELETE' });
        state.subjects = state.subjects.filter(s => s.id !== id);
        delete state.uploadedFiles[id];
        if (state.activeSubjectId === id) {
            state.activeSubjectId = null;
            document.getElementById('active-subject-badge').style.display = 'none';
            document.getElementById('upload-section').style.display = 'none';
        }
        renderSubjects();
    } catch (e) {
        alert('Failed to delete subject');
    }
}

async function selectSubject(id) {
    if (state.activeSubjectId === id) return;

    // Clear conversation memory on subject switch
    if (state.activeSubjectId) {
        try { await fetch(`${API}/api/memory/clear/${state.activeSubjectId}`, { method: 'POST' }); } catch (e) { }
    }

    state.activeSubjectId = id;
    const subject = state.subjects.find(s => s.id === id);

    // Update active badge
    const badge = document.getElementById('active-subject-badge');
    badge.style.display = 'flex';
    document.getElementById('asb-name').textContent = subject.name;
    badge.querySelector('.asb-dot').style.background = subject.color;

    // Show upload section
    document.getElementById('upload-section').style.display = 'block';

    // Enable buttons
    document.getElementById('send-btn').disabled = false;
    document.getElementById('generate-quiz-btn').disabled = false;

    // Clear chat
    const msgs = document.getElementById('chat-messages');
    msgs.innerHTML = `<div class="welcome-card"><h2>📖 ${subject.name}</h2><p>Upload notes and start asking questions. All answers are grounded in your uploaded materials only.</p></div>`;

    // Reset quiz
    state.quizData = null;
    document.getElementById('quiz-container').innerHTML = '';
    document.getElementById('quiz-results').style.display = 'none';

    renderSubjects();
    renderFileList();
    checkStreak();
}

// ═══════════════════════════════════════════════════════════════════════
// FILE UPLOAD
// ═══════════════════════════════════════════════════════════════════════
function setupUpload() {
    const zone = document.getElementById('upload-zone');
    const input = document.getElementById('file-input');

    zone.addEventListener('click', () => input.click());

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
    });

    input.addEventListener('change', () => {
        if (input.files.length) uploadFile(input.files[0]);
        input.value = '';
    });
}

async function uploadFile(file) {
    if (!state.activeSubjectId) {
        alert('Select a subject first');
        return;
    }

    const pipeline = document.getElementById('ingest-pipeline');
    const content = document.getElementById('upload-content');
    const status = document.getElementById('upload-status');
    const steps = pipeline.querySelectorAll('.pipeline-step');

    // Show pipeline
    content.style.display = 'none';
    pipeline.style.display = 'flex';
    steps.forEach(s => { s.classList.remove('active', 'done'); });
    status.textContent = `Uploading ${file.name}...`;

    // Animate pipeline steps
    const animateStep = (idx) => new Promise(resolve => {
        steps[idx].classList.add('active');
        setTimeout(() => {
            steps[idx].classList.remove('active');
            steps[idx].classList.add('done');
            resolve();
        }, 600);
    });

    try {
        await animateStep(0); // Parse

        const formData = new FormData();
        formData.append('file', file);

        await animateStep(1); // Chunk

        const res = await fetch(`${API}/api/upload/${state.activeSubjectId}`, {
            method: 'POST',
            body: formData,
        });

        await animateStep(2); // Embed

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error);
        }

        const data = await res.json();

        await animateStep(3); // Ready

        // Update file list
        if (!state.uploadedFiles[state.activeSubjectId]) {
            state.uploadedFiles[state.activeSubjectId] = [];
        }
        state.uploadedFiles[state.activeSubjectId].push({
            filename: data.filename || file.name,
            chunks: data.chunks_added || 0,
        });

        status.textContent = `✅ ${file.name} — ${data.chunks_added} chunks indexed`;

        // XP
        addXP(50, 'Upload notes');
        const g = loadGameData();
        g.totalUploads += 1;
        g.totalChunks += (data.chunks_added || 0);
        saveGameData(g);
        updateGamificationUI();

        renderFileList();

    } catch (e) {
        status.textContent = `❌ Failed: ${e.message}`;
    }

    // Reset pipeline after delay
    setTimeout(() => {
        pipeline.style.display = 'none';
        content.style.display = 'flex';
    }, 2000);
}

function renderFileList() {
    const list = document.getElementById('file-list');
    list.innerHTML = '';
    const files = state.uploadedFiles[state.activeSubjectId] || [];
    for (const f of files) {
        const div = document.createElement('div');
        div.className = 'file-item';
        div.innerHTML = `
      <span class="file-item-icon">📄</span>
      <span class="file-item-name">${f.filename}</span>
      <span class="file-item-chunks">${f.chunks} chunks</span>
    `;
        list.appendChild(div);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// CHAT / QUERY
// ═══════════════════════════════════════════════════════════════════════
async function sendQuery(queryText) {
    if (!state.activeSubjectId || !queryText.trim()) return;

    const subject = state.subjects.find(s => s.id === state.activeSubjectId);
    const msgs = document.getElementById('chat-messages');

    // Remove welcome card
    const welcome = msgs.querySelector('.welcome-card');
    if (welcome) welcome.remove();

    // User message
    addMessage('user', queryText);

    // Typing indicator
    const typingEl = document.createElement('div');
    typingEl.className = 'message assistant';
    typingEl.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
    msgs.appendChild(typingEl);
    msgs.scrollTop = msgs.scrollHeight;

    try {
        const res = await fetch(`${API}/api/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subject_id: state.activeSubjectId,
                query: queryText,
            }),
        });

        typingEl.remove();

        if (!res.ok) {
            const err = await res.json();
            addMessage('assistant', `⚠️ Error: ${err.error}`, true);
            return;
        }

        const data = await res.json();
        state.lastAnswer = data;

        if (!data.answer_found) {
            // Refusal
            addRefusalMessage(data);
        } else {
            // Grounded answer
            addAnswerMessage(data, subject);
        }

        // XP for asking
        addXP(10, 'Ask question');
        checkStreak();

    } catch (e) {
        typingEl.remove();
        addMessage('assistant', `⚠️ Error: ${e.message}`, true);
    }
}

function addMessage(role, text, isError = false) {
    const msgs = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.innerHTML = `<div class="message-bubble${isError ? ' refusal-message' : ''}">${escapeHtml(text)}</div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
}

function addRefusalMessage(data) {
    const msgs = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'message assistant';

    const matchClass = 'match-notfound';
    div.innerHTML = `
    <div class="message-bubble">
      <div class="refusal-message">${escapeHtml(data.answer)}</div>
      <div class="answer-meta">
        <span class="meta-badge ${matchClass}">❌ ${data.retrieval_match_label || 'Not Found'}</span>
        <span class="meta-badge" style="background:rgba(255,255,255,0.05);color:var(--text-muted)">Score: ${data.retrieval_match_score || 0}</span>
        ${data.gate_fired ? `<span class="meta-badge" style="background:rgba(225,112,85,0.1);color:var(--accent-orange)">Gate: ${data.gate_fired}</span>` : ''}
      </div>
    </div>
  `;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;

    // TTS for refusal
    if (state.isSpeaking || state.autoSpeak) {
        const subject = state.subjects.find(s => s.id === state.activeSubjectId);
        speak(`I couldn't find that in your ${subject?.name || ''} notes`);
    }
}

function addAnswerMessage(data, subject) {
    const msgs = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'message assistant';

    const matchClass = data.retrieval_match_label === 'High Match' ? 'match-high'
        : data.retrieval_match_label === 'Medium Match' ? 'match-medium'
            : 'match-low';

    let citationsHtml = '';
    if (data.citations && data.citations.length > 0) {
        citationsHtml = `
      <div class="citations">
        <div class="citations-title">📎 Citations</div>
        ${data.citations.map(c => `<span class="citation-item">📄 ${escapeHtml(c.filename)} • Page ${c.page} • Chunk #${c.chunk_index}</span>`).join('')}
      </div>`;
    }

    let evidenceHtml = '';
    if (data.evidence_snippets && data.evidence_snippets.length > 0) {
        evidenceHtml = `
      <div class="evidence-section">
        <div class="evidence-title">📖 Evidence Snippets</div>
        ${data.evidence_snippets.map(e => `<div class="evidence-snippet">${escapeHtml(e)}</div>`).join('')}
      </div>`;
    }

    div.innerHTML = `
    <div class="message-bubble">
      <div class="answer-text">${escapeHtml(data.answer)}</div>
      <div class="answer-meta">
        <span class="meta-badge ${matchClass}">📊 ${data.retrieval_match_label} (${data.retrieval_match_score})</span>
        <span class="meta-badge grounding">🎯 ${data.grounding_percentage}% grounded</span>
        <span class="meta-badge scope">🔒 ${data.subject_scope}</span>
      </div>
      ${citationsHtml}
      ${evidenceHtml}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="simplify-btn" onclick="simplifyLast()">✨ Simplify This</button>
        <button class="tts-btn" onclick="speakAnswer()">🔊 Read Aloud</button>
      </div>
    </div>
  `;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;

    // Auto-speak if voice mode
    if (state.autoSpeak) {
        speakAnswer();
    }
}

async function simplifyLast() {
    if (!state.lastAnswer || !state.lastAnswer.answer_found) return;

    const subject = state.subjects.find(s => s.id === state.activeSubjectId);
    const msgs = document.getElementById('chat-messages');

    // Typing
    const typingEl = document.createElement('div');
    typingEl.className = 'message assistant';
    typingEl.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
    msgs.appendChild(typingEl);
    msgs.scrollTop = msgs.scrollHeight;

    try {
        const res = await fetch(`${API}/api/simplify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                original_answer: state.lastAnswer.answer,
                evidence_snippets: state.lastAnswer.evidence_snippets || [],
                citations: state.lastAnswer.citations || [],
                subject_name: subject?.name || 'Unknown',
            }),
        });

        typingEl.remove();

        if (!res.ok) throw new Error('Simplify failed');

        const data = await res.json();

        const div = document.createElement('div');
        div.className = 'message assistant';
        div.innerHTML = `
      <div class="message-bubble">
        <div style="font-size:11px;color:var(--accent-purple);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">✨ Simplified Version</div>
        <div class="answer-text">${escapeHtml(data.simplified_answer)}</div>
        <div class="answer-meta">
          <span class="meta-badge grounding">📖 Reading level: Grade ${data.simplified_reading_level} (was ${data.original_reading_level})</span>
          <span class="meta-badge" style="background:${data.readability_improved ? 'rgba(0,184,148,0.15);color:var(--accent-green)' : 'rgba(225,112,85,0.15);color:var(--accent-orange)'}">
            ${data.readability_improved ? '✅ Easier' : '⚠️ Similar level'}
          </span>
          <span class="meta-badge scope">🔒 ${data.subject_scope}</span>
        </div>
      </div>
    `;
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;

    } catch (e) {
        typingEl.remove();
        addMessage('assistant', '⚠️ Failed to simplify. Please try again.', true);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// STUDY MODE
// ═══════════════════════════════════════════════════════════════════════
async function generateQuiz() {
    if (!state.activeSubjectId) return;

    const container = document.getElementById('quiz-container');
    const resultsEl = document.getElementById('quiz-results');
    resultsEl.style.display = 'none';
    container.innerHTML = '<div class="typing-indicator" style="margin:24px auto"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';

    try {
        const res = await fetch(`${API}/api/study/${state.activeSubjectId}`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to generate quiz');

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        state.quizData = data;
        state.quizAnswers = {};
        state.quizRevealed = false;
        renderQuiz();

        // XP
        addXP(100, 'Daily quiz');
        const g = loadGameData();
        g.totalQuizzes += 1;
        g.dailyQuizDone = true;
        saveGameData(g);
        updateGamificationUI();

    } catch (e) {
        container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--accent-orange)">${e.message}</div>`;
    }
}

function renderQuiz() {
    const container = document.getElementById('quiz-container');
    const data = state.quizData;
    if (!data) return;

    const totalQ = (data.mcqs?.length || 0) + (data.short_answers?.length || 0);
    const answered = Object.keys(state.quizAnswers).length;

    let html = `
    <div class="quiz-progress">
      <div class="quiz-progress-bar">
        <div class="quiz-progress-fill" style="width: ${totalQ ? (answered / totalQ) * 100 : 0}%"></div>
      </div>
      <span class="quiz-progress-text">${answered} / ${totalQ}</span>
    </div>
  `;

    // MCQs
    if (data.mcqs) {
        data.mcqs.forEach((mcq, qi) => {
            const qKey = `mcq_${qi}`;
            const selected = state.quizAnswers[qKey];
            html += `
        <div class="quiz-question-card">
          <div class="quiz-question-number">Question ${qi + 1} — Multiple Choice</div>
          <div class="quiz-question-text">${escapeHtml(mcq.question)}</div>
          <div class="quiz-options">
            ${Object.entries(mcq.options).map(([letter, text]) => {
                let cls = 'quiz-option';
                if (state.quizRevealed) {
                    cls += ' disabled';
                    if (letter === mcq.correct) cls += ' correct';
                    else if (letter === selected) cls += ' wrong';
                } else if (letter === selected) {
                    cls += ' selected';
                }
                return `<div class="${cls}" onclick="selectMCQ('${qKey}', '${letter}')">
                <span class="quiz-option-letter">${letter}</span>
                <span>${escapeHtml(text)}</span>
              </div>`;
            }).join('')}
          </div>
          <div class="quiz-citation">📎 Source: ${mcq.citation ? `${escapeHtml(mcq.citation.filename)}, Page ${mcq.citation.page}` : 'N/A'}</div>
        </div>
      `;
        });
    }

    // Short answers
    if (data.short_answers) {
        data.short_answers.forEach((sa, qi) => {
            const qKey = `sa_${qi}`;
            html += `
        <div class="quiz-question-card">
          <div class="quiz-question-number">Question ${(data.mcqs?.length || 0) + qi + 1} — Short Answer</div>
          <div class="quiz-question-text">${escapeHtml(sa.question)}</div>
          <div class="quiz-short-answer">
            <textarea placeholder="Type your answer…" onchange="state.quizAnswers['${qKey}']=this.value" ${state.quizRevealed ? 'disabled' : ''}></textarea>
            <div class="quiz-model-answer ${state.quizRevealed ? 'show' : ''}">
              <strong>Model Answer:</strong> ${escapeHtml(sa.model_answer)}
            </div>
          </div>
          <div class="quiz-citation">📎 Source: ${sa.citation ? `${escapeHtml(sa.citation.filename)}, Page ${sa.citation.page}` : 'N/A'}</div>
        </div>
      `;
        });
    }

    if (!state.quizRevealed) {
        html += `<div style="text-align:center;margin:16px 0"><button class="btn btn-primary" onclick="revealQuiz()">Submit Answers</button></div>`;
    }

    container.innerHTML = html;
}

function selectMCQ(qKey, letter) {
    if (state.quizRevealed) return;
    state.quizAnswers[qKey] = letter;
    renderQuiz();
}

function revealQuiz() {
    state.quizRevealed = true;
    renderQuiz();

    // Calculate score
    const data = state.quizData;
    let correct = 0;
    let total = data.mcqs?.length || 0;

    data.mcqs?.forEach((mcq, qi) => {
        if (state.quizAnswers[`mcq_${qi}`] === mcq.correct) correct++;
    });

    const score = total > 0 ? correct / total : 0;

    // Show results
    const resultsEl = document.getElementById('quiz-results');
    resultsEl.style.display = 'block';
    document.getElementById('quiz-score').textContent = `${correct} / ${total} (${Math.round(score * 100)}%)`;

    // Update game data
    const g = loadGameData();
    g.quizHistory.push({ score, date: new Date().toISOString() });
    if (score === 1 && total > 0) {
        g.perfectQuizzes += 1;
        addXP(50, 'Perfect quiz');
    }
    saveGameData(g);
    updateGamificationUI();
}

// ═══════════════════════════════════════════════════════════════════════
// VOICE (Web Speech API)
// ═══════════════════════════════════════════════════════════════════════
let recognition = null;
let synthesis = window.speechSynthesis;

function setupVoice() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        document.getElementById('mic-btn').title = 'Voice not supported in this browser';
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
            .map(r => r[0].transcript)
            .join('');
        document.getElementById('voice-transcript').textContent = transcript;
        document.getElementById('voice-transcript').style.display = 'block';

        if (event.results[0].isFinal) {
            // Check for "simplify that" command
            if (transcript.toLowerCase().includes('simplify that') || transcript.toLowerCase().includes('simplify this')) {
                simplifyLast();
            } else {
                document.getElementById('query-input').value = transcript;
                sendQuery(transcript);
            }
            stopListening();
        }
    };

    recognition.onend = () => stopListening();
    recognition.onerror = (e) => {
        console.error('Speech recognition error:', e.error);
        stopListening();
        // Fallback to text
        document.getElementById('query-input').focus();
    };
}

function toggleListening() {
    if (state.isListening) {
        stopListening();
    } else {
        startListening();
    }
}

function startListening() {
    if (!recognition) {
        document.getElementById('query-input').focus();
        return;
    }
    try {
        recognition.start();
        state.isListening = true;
        document.getElementById('mic-btn').classList.add('listening');
        document.getElementById('voice-transcript').style.display = 'block';
        document.getElementById('voice-transcript').textContent = 'Listening...';
    } catch (e) {
        console.error('Failed to start listening:', e);
    }
}

function stopListening() {
    state.isListening = false;
    document.getElementById('mic-btn').classList.remove('listening');
    try { recognition?.stop(); } catch (e) { }
}

function speak(text) {
    if (!synthesis) return;
    synthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.95;
    utt.pitch = 1;
    utt.onend = () => { state.isSpeaking = false; };
    state.isSpeaking = true;
    synthesis.speak(utt);
}

function speakAnswer() {
    if (!state.lastAnswer || !state.lastAnswer.answer_found) return;
    const subject = state.subjects.find(s => s.id === state.activeSubjectId);
    const prefix = `Based on your ${subject?.name || ''} notes, here's what I found. `;

    // Add citation info to speech
    let citationSpeech = '';
    if (state.lastAnswer.citations && state.lastAnswer.citations.length > 0) {
        const c = state.lastAnswer.citations[0];
        citationSpeech = ` As stated on page ${c.page} of your notes.`;
    }

    speak(prefix + state.lastAnswer.answer + citationSpeech);
}

function stopSpeaking() {
    if (synthesis) synthesis.cancel();
    state.isSpeaking = false;
}

// ═══════════════════════════════════════════════════════════════════════
// POMODORO
// ═══════════════════════════════════════════════════════════════════════
function setupPomodoro() {
    document.getElementById('pomodoro-btn').addEventListener('click', togglePomodoro);
    updatePomodoroDisplay();
}

function togglePomodoro() {
    if (state.pomodoroRunning) {
        clearInterval(state.pomodoroInterval);
        state.pomodoroRunning = false;
        document.getElementById('pomodoro-btn').textContent = '▶ Start Focus';
    } else {
        state.pomodoroRunning = true;
        state.pomodoroSeconds = 25 * 60;
        document.getElementById('pomodoro-btn').textContent = '⏹ Stop';
        state.pomodoroInterval = setInterval(() => {
            state.pomodoroSeconds--;
            updatePomodoroDisplay();
            if (state.pomodoroSeconds <= 0) {
                clearInterval(state.pomodoroInterval);
                state.pomodoroRunning = false;
                document.getElementById('pomodoro-btn').textContent = '▶ Start Focus';
                // Notify
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification('🍅 Pomodoro Complete!', { body: 'Time for a 5 minute break.' });
                }
                addXP(20, 'Pomodoro complete');
            }
        }, 1000);

        // Request notification permission
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }
}

function updatePomodoroDisplay() {
    const mins = Math.floor(state.pomodoroSeconds / 60);
    const secs = state.pomodoroSeconds % 60;
    document.getElementById('pomodoro-time').textContent =
        `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════
// MODE TABS
// ═══════════════════════════════════════════════════════════════════════
function setupTabs() {
    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const mode = tab.dataset.mode;
            document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById(`${mode}-view`).classList.add('active');
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════
// AUTHENTICATION STATE & LOGIC
// ══════════════════════════════════════════════════════════════════════════
const AUTH_TOKEN_KEY = 'askmynotes_token';
const AUTH_USER_KEY = 'askmynotes_user';

function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
}

function getAuthUser() {
    try {
        const u = localStorage.getItem(AUTH_USER_KEY);
        return u ? JSON.parse(u) : null;
    } catch {
        return null;
    }
}

function setAuthSession(token, user) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

function clearAuthSession() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
}

function showAuthAlert(msg, type = 'error') {
    const alertEl = document.getElementById('auth-alert');
    if (!alertEl) return;
    alertEl.textContent = msg;
    alertEl.className = `auth-alert ${type}`;
    alertEl.style.display = 'block';
}

function clearAuthAlert() {
    const alertEl = document.getElementById('auth-alert');
    if (!alertEl) return;
    alertEl.textContent = '';
    alertEl.style.display = 'none';
}

function switchAuthMode(mode) {
    clearAuthAlert();
    const signupForm = document.getElementById('signup-form');
    const loginForm = document.getElementById('login-form');
    if (!signupForm || !loginForm) return;

    if (mode === 'signup') {
        signupForm.style.display = 'block';
        loginForm.style.display = 'none';
    } else {
        loginForm.style.display = 'block';
        signupForm.style.display = 'none';
    }
}

function showHome(user) {
    const authEl = document.getElementById('auth-container');
    const homeEl = document.getElementById('home-container');
    const appEl = document.getElementById('app');

    if (authEl) authEl.style.display = 'none';
    if (appEl) appEl.style.display = 'none';
    if (homeEl) homeEl.style.display = 'block';

    const studentName = user?.name || 'Student';
    const initial = studentName.charAt(0).toUpperCase();

    const homeName = document.getElementById('home-user-name');
    const homeHeroName = document.getElementById('home-hero-name');
    const homeAvatar = document.getElementById('home-user-avatar');

    if (homeName) homeName.textContent = studentName;
    if (homeHeroName) homeHeroName.textContent = studentName;
    if (homeAvatar) homeAvatar.textContent = initial;
}

function showHome(user) {
    const authEl = document.getElementById('auth-container');
    const homeEl = document.getElementById('home-container');
    const appEl = document.getElementById('app');

    if (authEl) authEl.style.display = 'none';
    if (appEl) appEl.style.display = 'none';
    if (homeEl) homeEl.style.display = 'block';

    const studentName = user?.name || 'Student';
    const initial = studentName.charAt(0).toUpperCase();

    const homeName = document.getElementById('home-user-name');
    const homeHeroName = document.getElementById('home-hero-name');
    const homeAvatar = document.getElementById('home-user-avatar');

    if (homeName) homeName.textContent = studentName;
    if (homeHeroName) homeHeroName.textContent = studentName;
    if (homeAvatar) homeAvatar.textContent = initial;
}
function showDashboard(user) {
    const authEl = document.getElementById('auth-container');
    const homeEl = document.getElementById('home-container');
    const appEl = document.getElementById('app');

    if (authEl) authEl.style.display = 'none';
    if (homeEl) homeEl.style.display = 'none';
    if (appEl) appEl.style.display = 'flex';

    const studentName = user?.name || 'Student';
    const initial = studentName.charAt(0).toUpperCase();

    const nameEl = document.getElementById('user-display-name');
    const avatarEl = document.getElementById('user-avatar-initial');

    if (nameEl) nameEl.textContent = studentName;
    if (avatarEl) avatarEl.textContent = initial;

    // Load subjects
    loadSubjects();
}

function showAuth(mode = 'login') {
    const authEl = document.getElementById('auth-container');
    const homeEl = document.getElementById('home-container');
    const appEl = document.getElementById('app');

    if (appEl) appEl.style.display = 'none';
    if (homeEl) homeEl.style.display = 'none';
    if (authEl) authEl.style.display = 'flex';

    switchAuthMode(mode);
}
function setupAuth() {
    const switchLoginBtn = document.getElementById('switch-to-login');
    const switchSignupBtn = document.getElementById('switch-to-signup');

    if (switchLoginBtn) {
        switchLoginBtn.addEventListener('click', () => switchAuthMode('login'));
    }

    if (switchSignupBtn) {
        switchSignupBtn.addEventListener('click', () => switchAuthMode('signup'));
    }

    // ── Sign Up ────────────────────────────────────────────────

    const signupForm = document.getElementById('signup-form');

    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearAuthAlert();

            const name = document.getElementById('signup-name').value.trim();
            const email = document.getElementById('signup-email').value.trim();
            const password = document.getElementById('signup-password').value;
            const confirmPassword = document.getElementById('signup-confirm-password').value;

            if (!name || !email || !password) {
                showAuthAlert('Please fill in all required fields.');
                return;
            }

            if (password.length < 6) {
                showAuthAlert('Password must be at least 6 characters.');
                return;
            }

            if (password !== confirmPassword) {
                showAuthAlert('Passwords do not match. Please verify.');
                return;
            }

            const btn = document.getElementById('signup-btn');
            btn.disabled = true;
            btn.innerHTML = '<span>Creating account...</span>';

            try {
                const res = await fetch(`${API}/api/auth/signup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password }),
                });

                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data.error || 'Failed to sign up');
                }

                // Signup only creates the account.
                // User must login before entering Home.
                clearAuthSession();
                switchAuthMode('login');

                showAuthAlert(
                    'Account created successfully. Please login to continue.',
                    'success'
                );

                const loginEmail = document.getElementById('login-email');

                if (loginEmail) {
                    loginEmail.value = email;
                }

            } catch (err) {
                showAuthAlert(err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>Sign Up</span>';
            }
        });
    }

    // ── Login ──────────────────────────────────────────────────

    const loginForm = document.getElementById('login-form');

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearAuthAlert();

            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;

            if (!email || !password) {
                showAuthAlert('Please enter your email/username and password.');
                return;
            }

            const btn = document.getElementById('login-btn');
            btn.disabled = true;
            btn.innerHTML = '<span>Signing in...</span>';

            try {
                const res = await fetch(`${API}/api/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password }),
                });

                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data.error || 'Invalid credentials');
                }

                // Save authenticated user
                setAuthSession(data.token, data.user);

                // Login → Home
                showHome(data.user);

            } catch (err) {
                showAuthAlert(err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>Login</span>';
            }
        });
    }

    // ── Dashboard Logout ───────────────────────────────────────

    const logoutBtn = document.getElementById('logout-btn');

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            const token = getAuthToken();

            if (token) {
                try {
                    await fetch(`${API}/api/auth/logout`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    });
                } catch {
                    // Non-fatal
                }
            }

            clearAuthSession();
            showAuth('login');
        });
    }

    // ── Home Page → Dashboard ─────────────────────────────────

    const homeDashboardButtons = [
        document.getElementById('home-dashboard-btn'),
        document.getElementById('home-hero-dashboard-btn'),
        document.getElementById('home-cta-dashboard-btn')
    ];

    homeDashboardButtons.forEach(btn => {
        if (btn) {
            btn.addEventListener('click', () => {
                const user = getAuthUser();

                if (user && getAuthToken()) {
                    showDashboard(user);
                } else {
                    showAuth('login');
                }
            });
        }
    });

    // ── Explore Features ──────────────────────────────────────

    const exploreBtn = document.getElementById('home-explore-btn');

    if (exploreBtn) {
        exploreBtn.addEventListener('click', () => {
            document.getElementById('home-features')?.scrollIntoView({
                behavior: 'smooth'
            });
        });
    }

    // ── Dashboard → Home ──────────────────────────────────────

    const dashboardHomeBtn = document.getElementById('dashboard-home-btn');

    if (dashboardHomeBtn) {
        dashboardHomeBtn.addEventListener('click', () => {
            const user = getAuthUser();

            if (user && getAuthToken()) {
                showHome(user);
            } else {
                showAuth('login');
            }
        });
    }

    // ── Home Logout ────────────────────────────────────────────

    const homeLogoutBtn = document.getElementById('home-logout-btn');

    if (homeLogoutBtn) {
        homeLogoutBtn.addEventListener('click', async () => {
            const token = getAuthToken();

            if (token) {
                try {
                    await fetch(`${API}/api/auth/logout`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    });
                } catch {
                    // Non-fatal
                }
            }

            clearAuthSession();
            showAuth('login');
        });
    }
}

// INIT
// ═══════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize authentication handlers
    setupAuth();

    // 2. Check if student already has an active session
    clearAuthSession();
    showAuth('login');

    // Setup modules
    setupUpload();
    setupTabs();
    setupVoice();
    setupPomodoro();
    updateGamificationUI();

    // Subject creation
    document.getElementById('add-subject-btn').addEventListener('click', createSubject);
    document.getElementById('subject-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createSubject();
    });

    // Query submit
    document.getElementById('send-btn').addEventListener('click', () => {
        const input = document.getElementById('query-input');
        const q = input.value.trim();
        if (q) {
            sendQuery(q);
            input.value = '';
        }
    });

    document.getElementById('query-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            document.getElementById('send-btn').click();
        }
    });

    // Enable send button on input
    document.getElementById('query-input').addEventListener('input', (e) => {
        document.getElementById('send-btn').disabled = !e.target.value.trim() || !state.activeSubjectId;
    });

    // Mic button
    document.getElementById('mic-btn').addEventListener('click', toggleListening);

    // Generate quiz
    document.getElementById('generate-quiz-btn').addEventListener('click', generateQuiz);

    // Retry quiz
    document.getElementById('retry-quiz-btn').addEventListener('click', generateQuiz);

    // Add XP flash animation style
    const style = document.createElement('style');
    style.textContent = `
    @keyframes xpFlash {
      0% { transform: scale(1); }
      50% { transform: scale(1.15); box-shadow: 0 0 20px rgba(108,92,231,0.4); }
      100% { transform: scale(1); }
    }
  `;
    document.head.appendChild(style);
});
