"""One-team analysis runs: a kit picture plus colour words fix the team; schema unchanged.

Usage:
    .venv/Scripts/python run_team_only.py            # runs the jobs in JOBS that have no saved answer yet

Hard limits (free-tier key, 20 requests a day):
  - at most MAX_MODEL_ATTEMPTS model requests across all invocations (counted in attempts.json,
    failed ones included);
  - a 429 is never retried and stops the whole run;
  - only 503 UNAVAILABLE and 403 SERVICE_DISABLED are retried;
  - every call has a 10-minute timeout.
Saves to outputs/team_only/<label>.json (raw answer), <label>.usage.json (row with usage) and
<label>.steps.json. The uploaded file is kept between invocations (upload_state.json) and
deleted when every job has an answer.
"""
import base64
import json
import sys
import time
from pathlib import Path

from google import genai
from google.genai import types

from list_models import load_key
from team_only_prompts import PLAY_BY_PLAY_SCHEMA, TEAM_ONLY_PLAY_BY_PLAY, TEAMS

HERE = Path(__file__).parent
VIDEO = HERE / "videos" / "breakers-20min.mp4"
OUT = HERE / "outputs" / "team_only"
MODEL = "gemini-4-hydrogen"
MAX_MODEL_ATTEMPTS = 10
RETRYABLE = ("UNAVAILABLE", "SERVICE_DISABLED")

# (label, team, start s, end s). Ordered so an early quota stop still leaves the key comparison.
JOBS = [
    ("teamA-600-900-run1", "A", 600, 900),
    ("teamB-600-900-run1", "B", 600, 900),
    ("teamA-300-600-run1", "A", 300, 600),
    ("teamA-900-1200-run1", "A", 900, 1200),
    ("teamA-600-900-run2", "A", 600, 900),
    ("teamA-300-600-run2", "A", 300, 600),
    ("teamA-900-1200-run2", "A", 900, 1200),
]


class QuotaStop(Exception):
    pass


def dump(obj) -> dict:
    return obj.model_dump(exclude_none=True) if hasattr(obj, "model_dump") else dict(obj or {})


def attempts_used() -> int:
    p = OUT / "attempts.json"
    return len(json.loads(p.read_text())) if p.exists() else 0


def record_attempt(label: str, outcome: str) -> None:
    p = OUT / "attempts.json"
    rows = json.loads(p.read_text()) if p.exists() else []
    rows.append({"label": label, "at": time.strftime("%Y-%m-%d %H:%M:%S"), "outcome": outcome})
    p.write_text(json.dumps(rows, indent=2))


def get_file(client):
    state = OUT / "upload_state.json"
    if state.exists():
        name = json.loads(state.read_text())["name"]
        try:
            f = client.files.get(name=name)
            if f.state.name == "ACTIVE":
                print(f"reusing uploaded file {name}", flush=True)
                return f
        except Exception as e:  # expired or deleted: upload again
            print(f"stored upload unusable ({str(e)[:80]}), uploading again", flush=True)
    print(f"uploading {VIDEO.name} ({VIDEO.stat().st_size / 1e6:.0f} MB)...", flush=True)
    t = time.time()
    f = client.files.upload(file=str(VIDEO))
    while f.state.name == "PROCESSING":
        time.sleep(3)
        f = client.files.get(name=f.name)
    if f.state.name != "ACTIVE":
        raise RuntimeError(f"upload ended in state {f.state.name}")
    state.write_text(json.dumps({"name": f.name, "upload_and_processing_seconds": round(time.time() - t, 1)}))
    print(f"uploaded in {time.time() - t:.0f}s", flush=True)
    return f


def run_job(client, file, label, team, start, end):
    t = TEAMS[team]
    picture = base64.b64encode((HERE / t["picture"]).read_bytes()).decode()
    prompt = TEAM_ONLY_PLAY_BY_PLAY.format(kit_words=t["kit_words"])
    request = dict(
        model=MODEL,
        input=[
            {"type": "video", "uri": file.uri, "mime_type": file.mime_type,
             "processing": {"type": "static", "start_offset": f"{start}s", "end_offset": f"{end}s"}},
            {"type": "image", "data": picture, "mime_type": "image/png"},
            {"type": "text", "text": prompt},
        ],
        response_format={"type": "text", "mime_type": "application/json", "schema": PLAY_BY_PLAY_SCHEMA},
    )
    row = {"label": label, "team": team, "kit_words": t["kit_words"], "picture": t["picture"],
           "video": VIDEO.name, "model": MODEL, "start": start, "end": end, "attempts": 0}
    interaction = None
    for i in range(4):
        if attempts_used() >= MAX_MODEL_ATTEMPTS:
            raise QuotaStop(f"budget of {MAX_MODEL_ATTEMPTS} model requests is used up")
        began = time.time()
        row["attempts"] += 1
        try:
            interaction = client.interactions.create(**request)
            record_attempt(label, "ok")
            break
        except Exception as e:
            msg = str(e)
            record_attempt(label, msg[:200])
            if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                row.update(ok=False, error=msg[:600])
                (OUT / f"{label}.usage.json").write_text(json.dumps(row, indent=2))
                raise QuotaStop(f"429 on {label}: {msg[:300]}")
            if i == 3 or not any(k in msg for k in RETRYABLE):
                row.update(ok=False, error=msg[:600])
                (OUT / f"{label}.usage.json").write_text(json.dumps(row, indent=2))
                print(f"FAIL {label}: {msg[:300]}", flush=True)
                return
            print(f"retryable error on {label}, waiting: {msg[:120]}", flush=True)
            time.sleep(min(60, 8 * 2 ** i))

    seconds = round(time.time() - began, 1)
    usage = dump(interaction.usage)
    row.update(ok=interaction.status == "completed", status=interaction.status, seconds=seconds,
               interaction_id=interaction.id, usage=usage)
    text = interaction.output_text or ""
    try:
        parsed = json.loads(text)
        row["plays"] = len(parsed.get("plays", []))
        text = json.dumps(parsed, indent=2)
    except ValueError:
        row["json_valid"] = False
    (OUT / f"{label}.json").write_text(text, encoding="utf-8")
    (OUT / f"{label}.steps.json").write_text(
        json.dumps([dump(s) for s in (interaction.steps or [])], indent=2, default=str)[:400_000], encoding="utf-8")
    (OUT / f"{label}.usage.json").write_text(json.dumps(row, indent=2))
    print(f"{'ok  ' if row['ok'] else 'FAIL'} {label}: {seconds}s plays={row.get('plays')} "
          f"in={usage.get('total_input_tokens')} out={usage.get('total_output_tokens')} "
          f"think={usage.get('total_thought_tokens')}", flush=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    todo = [j for j in JOBS if not (OUT / f"{j[0]}.json").exists()]
    if not todo:
        print("every job already has an answer")
        return
    client = genai.Client(api_key=load_key(),
                          http_options=types.HttpOptions(api_version="v1beta", timeout=600_000))
    file = get_file(client)
    try:
        for job in todo:
            run_job(client, file, *job)
    except QuotaStop as e:
        print(f"STOPPED: {e}", flush=True)
        sys.exit(2)
    if all((OUT / f"{j[0]}.json").exists() for j in JOBS):
        client.files.delete(name=file.name)
        (OUT / "upload_state.json").unlink()
        print("all jobs answered; uploaded file deleted", flush=True)


if __name__ == "__main__":
    main()
