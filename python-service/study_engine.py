"""Study engine — generate MCQs + short-answer questions from subject notes."""

import json
from config import GROQ_API_KEY, GROQ_MODEL, LLM_TEMPERATURE
from retriever import retrieve_broad


def generate_study_questions(subject_id: str, subject_name: str) -> dict:
    """
    Generate 5 MCQs + 3 short-answer questions from the subject's indexed notes.
    Every question is cited to its source chunk.
    """
    from llama_index.llms.groq import Groq

    chunks = retrieve_broad(subject_id)

    if not chunks:
        return {
            "subject_name": subject_name,
            "mcqs": [],
            "short_answers": [],
            "error": "No notes indexed for this subject yet.",
        }

    # Build evidence context
    evidence_parts = []
    for i, c in enumerate(chunks, start=1):
        evidence_parts.append(
            f"[Chunk {i}] (Source: {c['filename']}, Page {c['page']}, Index: {c.get('chunk_index', i-1)})\n{c['text']}"
        )
    evidence_context = "\n\n".join(evidence_parts)

    prompt = f"""You are generating a study quiz for a student based ONLY on their {subject_name} notes.

EVIDENCE FROM NOTES:
{evidence_context}

Generate exactly:
- 5 Multiple Choice Questions (MCQs), each with 4 options (A, B, C, D), one correct answer
- 3 Short Answer Questions with model answers

RULES:
1. Every question MUST come from the evidence above — no external knowledge
2. For each question, cite which chunk it came from (source filename and page)
3. MCQ distractors should be plausible but clearly wrong based on the notes

Respond in valid JSON format ONLY (no markdown, no code fences):
{{
  "mcqs": [
    {{
      "question": "...",
      "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}},
      "correct": "A",
      "citation": {{"filename": "...", "page": 1, "chunk_index": 0}}
    }}
  ],
  "short_answers": [
    {{
      "question": "...",
      "model_answer": "...",
      "citation": {{"filename": "...", "page": 1, "chunk_index": 0}}
    }}
  ]
}}"""

    llm = Groq(model=GROQ_MODEL, api_key=GROQ_API_KEY, temperature=LLM_TEMPERATURE + 0.1)

    try:
        response = llm.complete(prompt)
        text = response.text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1])
        parsed = json.loads(text)
        return {
            "subject_name": subject_name,
            "mcqs": parsed.get("mcqs", []),
            "short_answers": parsed.get("short_answers", []),
        }
    except (json.JSONDecodeError, Exception) as e:
        return {
            "subject_name": subject_name,
            "mcqs": [],
            "short_answers": [],
            "error": f"Failed to generate study questions: {str(e)}",
        }
