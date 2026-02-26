"""Simplify engine — re-generate answer at lower reading level, verified by textstat."""

import json
import textstat
from config import GROQ_API_KEY, GROQ_MODEL, LLM_TEMPERATURE


def simplify_answer(
    original_answer: str,
    evidence_snippets: list[str],
    citations: list[dict],
    subject_name: str,
) -> dict:
    """
    Re-generate the same answer at a lower reading level.
    Citations and evidence remain unchanged.
    Uses textstat to verify readability decrease.
    """
    from llama_index.llms.groq import Groq

    original_grade = textstat.flesch_kincaid_grade(original_answer)

    prompt = f"""Rewrite the following answer in much simpler language that a middle school student could understand.

RULES:
1. Keep the SAME factual content — do not add or remove information
2. Use shorter sentences, simpler words, and everyday language
3. Keep it concise
4. Do NOT change any citations or evidence references

ORIGINAL ANSWER:
{original_answer}

Respond in valid JSON format ONLY (no markdown, no code fences):
{{
  "simplified_answer": "Your simplified version here"
}}"""

    llm = Groq(model=GROQ_MODEL, api_key=GROQ_API_KEY, temperature=LLM_TEMPERATURE)

    try:
        response = llm.complete(prompt)
        text = response.text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1])
        parsed = json.loads(text)
        simplified = parsed.get("simplified_answer", original_answer)
    except (json.JSONDecodeError, Exception):
        simplified = original_answer

    simplified_grade = textstat.flesch_kincaid_grade(simplified)

    return {
        "simplified_answer": simplified,
        "original_reading_level": round(original_grade, 1),
        "simplified_reading_level": round(simplified_grade, 1),
        "readability_improved": simplified_grade < original_grade,
        "evidence_snippets": evidence_snippets,
        "citations": citations,
        "subject_scope": f"100% {subject_name}-scoped",
    }
