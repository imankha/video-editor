"""Probe which model ids this key can call with a tiny text request."""
from google import genai

from list_models import load_key

CANDIDATES = [
    "gemini-3.1-pro-preview",
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-flash-latest",
    "gemini-pro-latest",
]

if __name__ == "__main__":
    key = load_key()
    print(f"key shape: prefix={key[:4]}... len={len(key)}")
    client = genai.Client(api_key=key)
    for model in CANDIDATES:
        try:
            r = client.models.generate_content(model=model, contents="Reply with the single word: ok")
            print(f"OK    {model:35} -> {(r.text or '').strip()[:20]!r} (served by {r.model_version})")
        except Exception as e:  # report every failure, this is a probe
            print(f"FAIL  {model:35} -> {str(e)[:160]}")
