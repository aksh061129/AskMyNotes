"""Study engine — generate MCQs + short-answer questions from subject notes."""

from PIL import ExifTags
import json
from config import GROQ_API_KEY, GROQ_MODEL, LLM_TEMPERATURE
from retriever import retrieve_broad


def generate_study_questions(
    subject_id: str,
    subject_name: str,
    selected_filename: str | None = None
) -> dict:
    """
    Generate 5 MCQs + 3 short-answer questions from the subject's indexed notes.
    Every question is cited to its source chunk.
- 5 Flashcards for quick revision.
- Each flashcard should focus on one important concept or key takeaway from the notes.
- The front should contain a concise concept or topic name.
- The back should contain a concise summary/explanation of that concept using only the notes.
- Keep the explanations short and suitable for quick revision.    """
    from llama_index.llms.groq import Groq

    chunks = retrieve_broad(
    subject_id,
    filename=selected_filename
)


    if not chunks:
        return {
            "subject_name": subject_name,
            "mcqs": [],
            "short_answers": [],
            "error": "No notes indexed for this subject yet.",
            "flashcards": [],
        }

    # Build evidence context
    evidence_parts = []
    for i, c in enumerate(chunks, start=1):
        evidence_parts.append(
            f"[Chunk {i}] (Source: {c['filename']}, Page {c['page']}, Index: {c.get('chunk_index', i-1)})\n{c['text']}"
        )
    evidence_context = "\n\n".join(evidence_parts)

    prompt = f"""You are generating a study quiz for a student based ONLY on their {subject_name} notes.

Selected document:
{selected_filename or "All documents"}
EVIDENCE FROM NOTES:
{evidence_context}

Generate exactly:
- 5 Multiple Choice Questions (MCQs), each with 4 options (A, B, C, D), one correct answer
- 3 Short Answer Questions with model answers
- 5 Flashcards for quick revision.
- Each flashcard should focus on one important concept or key takeaway from the notes.
- The front should contain a concise concept or topic name.
- The back should contain a concise summary/explanation of that concept using only the notes.
- Include important definitions, key points, steps, formulas, or distinctions when present in the notes.
- Keep the explanations short and suitable for quick revision.

RULES:
1. Every question MUST come from the evidence above — no external knowledge
2. If a selected document is provided, every question MUST be based only on that selected document.
3. Do not use information from other documents in the same subject.
4. For each question, cite the actual source filename and page.
5. MCQ distractors should be plausible but clearly wrong based on the notes

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
  ],
"flashcards": [
  {{
    "concept": "...",
    "summary": "...",
    "citation": {{"filename": "...", "page": 1, "chunk_index": 0}}
  }}
]
}}"""

    llm = Groq(model=GROQ_MODEL, api_key=GROQ_API_KEY, temperature=LLM_TEMPERATURE + 0.1)

    try:
        response = llm.complete(prompt)
        text = response.text.strip()

        # Remove markdown code fences if the model adds them
        if text.startswith("```"):
            lines = text.split("\n")

            if lines[0].strip().startswith("```"):
                lines = lines[1:]

            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]

            text = "\n".join(lines).strip()

        # Debug: show exactly what the LLM returned
        print("\n========== STUDY LLM RESPONSE ==========")
        print(text)
        print("========== END STUDY LLM RESPONSE ==========\n")

        parsed = json.loads(text)
        return {
            "subject_name": subject_name,
            "selected_filename": selected_filename,
            "mcqs": parsed.get("mcqs", []),
            "short_answers": parsed.get("short_answers", []),
            "flashcards": parsed.get("flashcards", []),
        }
    except (json.JSONDecodeError, Exception) as e:
      return {
          "subject_name": subject_name,
          "selected_filename": selected_filename,
          "mcqs": [],
          "short_answers": [],
          "flashcards": [],
          "error": f"Failed to generate study questions: {str(e)}",
      }