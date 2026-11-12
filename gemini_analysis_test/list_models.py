"""List the Gemini models this key can call with generateContent."""
from pathlib import Path

from google import genai
from google.genai import types

HERE = Path(__file__).parent


def load_key() -> str:
    for line in (HERE / ".env").read_text().splitlines():
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("GEMINI_API_KEY missing from .env")


if __name__ == "__main__":
    # Model listing is only permitted on v1beta for this key (v1 returns 403).
    client = genai.Client(api_key=load_key(), http_options=types.HttpOptions(api_version="v1beta"))
    for m in client.models.list():
        if "generateContent" in (m.supported_actions or []):
            print(f"{m.name:50} in={m.input_token_limit} out={m.output_token_limit}  {m.display_name} | {(m.description or '')[:110]}")
