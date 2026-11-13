"""Both-teams analysis with the parent's kit picture attached, so team_0 is always their team.

Usage:
    .venv/Scripts/python run_pinned_both.py

The prompt is PLAY_BY_PLAY from prompts.py with ONE paragraph replaced (the team definition);
everything else, and the schema, is sent unchanged. The answer is filtered to the parent's team
afterwards by analyze_pinned_both.py.

Shares run_team_only.py's limits and its attempts.json, so the cap of 10 model requests covers
both experiments together: no retry on 429, retry only 503 / 403 SERVICE_DISABLED, 10-minute timeout.
Saves to outputs/pinned_both/<label>.json, .usage.json and .steps.json.
"""
import base64
import json
import sys
import time

from google import genai
from google.genai import types

import run_team_only as base
from list_models import load_key
from prompts import PLAY_BY_PLAY, PLAY_BY_PLAY_SCHEMA
from team_only_prompts import TEAMS

OUT = base.HERE / "outputs" / "pinned_both"

_OLD = "First define the two teams by kit colour: team_0 and team_1. Use those same two teams for the whole answer."
_NEW = ("First define the two teams by kit colour. team_0 is always the team wearing the kit in the attached "
        "picture ({kit_words}). The picture shows one outfield player of that team, cropped from this same game; "
        "it only shows the kit, so ignore the particular player and the number on the shirt. team_1 is the other "
        "team. Use those same two teams for the whole answer.")
assert PLAY_BY_PLAY.count(_OLD) == 1
PINNED_PLAY_BY_PLAY = PLAY_BY_PLAY.replace(_OLD, _NEW)

JOBS = [
    ("pinnedA-600-900", "A", 600, 900),   # direct comparison with the baseline and the one-team runs
    ("pinnedB-600-900", "B", 600, 900),   # does the picture flip team_0 to white?
    ("pinnedA-300-600", "A", 300, 600),   # does it hold in another window?
]


def run_job(client, file, label, team, start, end):
    t = TEAMS[team]
    picture = base64.b64encode((base.HERE / t["picture"]).read_bytes()).decode()
    request = dict(
        model=base.MODEL,
        input=[
            {"type": "video", "uri": file.uri, "mime_type": file.mime_type,
             "processing": {"type": "static", "start_offset": f"{start}s", "end_offset": f"{end}s"}},
            {"type": "image", "data": picture, "mime_type": "image/png"},
            {"type": "text", "text": PINNED_PLAY_BY_PLAY.format(kit_words=t["kit_words"])},
        ],
        response_format={"type": "text", "mime_type": "application/json", "schema": PLAY_BY_PLAY_SCHEMA},
    )
    row = {"label": label, "team": team, "kit_words": t["kit_words"], "picture": t["picture"],
           "video": base.VIDEO.name, "model": base.MODEL, "start": start, "end": end, "attempts": 0}
    usage_path = OUT / f"{label}.usage.json"
    interaction = None
    for i in range(4):
        if base.attempts_used() >= base.MAX_MODEL_ATTEMPTS:
            raise base.QuotaStop(f"budget of {base.MAX_MODEL_ATTEMPTS} model requests is used up")
        began = time.time()
        row["attempts"] += 1
        try:
            interaction = client.interactions.create(**request)
            base.record_attempt(label, "ok")
            break
        except Exception as e:
            msg = str(e)
            base.record_attempt(label, msg[:200])
            row.update(ok=False, error=msg[:600])
            usage_path.write_text(json.dumps(row, indent=2))
            if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                raise base.QuotaStop(f"429 on {label}: {msg[:300]}")
            if i == 3 or not any(k in msg for k in base.RETRYABLE):
                print(f"FAIL {label}: {msg[:300]}", flush=True)
                return
            print(f"retryable error on {label}, waiting: {msg[:120]}", flush=True)
            time.sleep(min(60, 8 * 2 ** i))

    row.pop("error", None)
    usage = base.dump(interaction.usage)
    row.update(ok=interaction.status == "completed", status=interaction.status,
               seconds=round(time.time() - began, 1), interaction_id=interaction.id, usage=usage)
    text = interaction.output_text or ""
    try:
        parsed = json.loads(text)
        row["plays"] = len(parsed.get("plays", []))
        text = json.dumps(parsed, indent=2)
    except ValueError:
        row["json_valid"] = False
    (OUT / f"{label}.json").write_text(text, encoding="utf-8")
    (OUT / f"{label}.steps.json").write_text(
        json.dumps([base.dump(s) for s in (interaction.steps or [])], indent=2, default=str)[:400_000],
        encoding="utf-8")
    usage_path.write_text(json.dumps(row, indent=2))
    print(f"{'ok  ' if row['ok'] else 'FAIL'} {label}: {row['seconds']}s plays={row.get('plays')} "
          f"in={usage.get('total_input_tokens')} out={usage.get('total_output_tokens')} "
          f"think={usage.get('total_thought_tokens')}", flush=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    todo = [j for j in JOBS if not (OUT / f"{j[0]}.json").exists()]
    if not todo:
        print("every job already has an answer")
        return
    print(f"model requests used so far: {base.attempts_used()} of {base.MAX_MODEL_ATTEMPTS}", flush=True)
    client = genai.Client(api_key=load_key(),
                          http_options=types.HttpOptions(api_version="v1beta", timeout=600_000))
    file = base.get_file(client)
    try:
        for job in todo:
            run_job(client, file, *job)
    except base.QuotaStop as e:
        print(f"STOPPED: {e}", flush=True)
        sys.exit(2)
    if all((OUT / f"{j[0]}.json").exists() for j in JOBS):
        client.files.delete(name=file.name)
        (base.OUT / "upload_state.json").unlink()
        print("all jobs answered; uploaded file deleted", flush=True)


if __name__ == "__main__":
    main()
