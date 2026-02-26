"""Query engine — dual-gate refusal + grounded LLM response."""

import json
from config import (
    GROQ_API_KEY,
    GROQ_MODEL,
    LLM_TEMPERATURE,
    GATE_1_THRESHOLD,
    get_retrieval_label,
    get_refusal_message,
)
from retriever import retrieve


def _build_evidence_context(chunks: list[dict]) -> str:
    """Format retrieved chunks into a prompt context block."""
    parts = []
    for i, c in enumerate(chunks, start=1):
        parts.append(
            f"[Evidence {i}] (Source: {c['filename']}, Page {c['page']}, "
            f"Chunk #{c['chunk_index']}, Score: {c['score']:.3f})\n{c['text']}"
        )
    return "\n\n".join(parts)


def _call_llm(query: str, evidence_context: str, subject_name: str, conversation_history: list[dict] | None = None) -> dict:
    """Call Groq LLM via LlamaIndex and return structured response."""
    from llama_index.llms.groq import Groq

    llm = Groq(model=GROQ_MODEL, api_key=GROQ_API_KEY, temperature=LLM_TEMPERATURE)

    history_context = ""
    if conversation_history:
        turns = []
        for turn in conversation_history[-4:]:  # last 4 turns
            turns.append(f"User: {turn.get('query', '')}\nAssistant: {turn.get('answer', '')}")
        history_context = f"\n\nPrevious conversation:\n" + "\n\n".join(turns)

    prompt = f"""You are a study assistant. Answer ONLY using the provided evidence from the student's {subject_name} notes.

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
{{
  "answer": "Your grounded answer here",
  "answer_found": true,
  "grounding_percentage": 95
}}"""

    try:
        response = llm.complete(prompt)
        text = response.text.strip()
        # Try to extract JSON from the response
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1])
        parsed = json.loads(text)
        return parsed
    except (json.JSONDecodeError, Exception) as e:
        # Graceful degradation: return evidence-only response
        return {
            "answer": "I found relevant evidence in your notes but could not generate a full answer. Please review the evidence snippets below.",
            "answer_found": True,
            "grounding_percentage": 100,
            "_error": str(e),
        }


def query(subject_id: str, subject_name: str, user_query: str, conversation_history: list[dict] | None = None) -> dict:
    """
    Full query pipeline with dual-gate refusal.

    Returns structured response dict.
    """
    # Retrieve
    chunks = retrieve(subject_id, user_query)

    # ── Gate 1: Hard, Pre-LLM ─────────────────────────────────────────
    if not chunks:
        return {
            "answer": get_refusal_message(subject_name),
            "answer_found": False,
            "citations": [],
            "evidence_snippets": [],
            "retrieval_match_score": 0.0,
            "retrieval_match_label": "Not Found",
            "grounding_percentage": 0,
            "subject_scope": f"100% {subject_name}-scoped",
            "gate_fired": "gate_1",
        }

    top_score = chunks[0]["score"]

    if top_score < GATE_1_THRESHOLD:
        return {
            "answer": get_refusal_message(subject_name),
            "answer_found": False,
            "citations": [],
            "evidence_snippets": [],
            "retrieval_match_score": round(top_score, 4),
            "retrieval_match_label": get_retrieval_label(top_score),
            "grounding_percentage": 0,
            "subject_scope": f"100% {subject_name}-scoped",
            "gate_fired": "gate_1",
        }

    # ── LLM Call ──────────────────────────────────────────────────────
    evidence_context = _build_evidence_context(chunks)
    llm_result = _call_llm(user_query, evidence_context, subject_name, conversation_history)

    # ── Gate 2: Soft, Post-LLM ────────────────────────────────────────
    if not llm_result.get("answer_found", True):
        return {
            "answer": get_refusal_message(subject_name),
            "answer_found": False,
            "citations": [
                {"filename": c["filename"], "page": c["page"], "chunk_index": c["chunk_index"]}
                for c in chunks[:3]
            ],
            "evidence_snippets": [c["text"][:300] for c in chunks[:3]],
            "retrieval_match_score": round(top_score, 4),
            "retrieval_match_label": get_retrieval_label(top_score),
            "grounding_percentage": 0,
            "subject_scope": f"100% {subject_name}-scoped",
            "gate_fired": "gate_2",
        }

    # ── Success ───────────────────────────────────────────────────────
    citations = [
        {"filename": c["filename"], "page": c["page"], "chunk_index": c["chunk_index"]}
        for c in chunks[:3]
    ]
    evidence_snippets = [c["text"][:300] for c in chunks[:3]]

    return {
        "answer": llm_result.get("answer", ""),
        "answer_found": True,
        "citations": citations,
        "evidence_snippets": evidence_snippets,
        "retrieval_match_score": round(top_score, 4),
        "retrieval_match_label": get_retrieval_label(top_score),
        "grounding_percentage": llm_result.get("grounding_percentage", 0),
        "subject_scope": f"100% {subject_name}-scoped",
        "gate_fired": None,
    }
