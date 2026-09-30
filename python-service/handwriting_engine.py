import base64
import os
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
VISION_MODEL = os.getenv("GROQ_VISION_MODEL")


def transcribe_handwriting(image_path: str):
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")

    response = client.chat.completions.create(
        model=VISION_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": """
Transcribe this handwritten note accurately.

Rules:
- Preserve the original wording.
- Preserve headings, bullet points and numbering.
- Do not add information that is not visible.
- If a word is unclear, write [unclear].
- Return only the transcribed text.
""",
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_data}"
                        },
                    },
                ],
            }
        ],
    )

    return response.choices[0].message.content