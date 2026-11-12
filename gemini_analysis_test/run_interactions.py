"""Play-by-play through the Interactions API, with static or agentic video processing.

Usage:
    .venv/Scripts/python run_interactions.py --video videos/breakers-20min.mp4 --processing agentic
    .venv/Scripts/python run_interactions.py --video videos/breakers-20min.mp4 --processing static
    .venv/Scripts/python run_interactions.py --video <path> --processing static --thinking-level low

static  = the model is given every frame (1 per second) up front, same as generate_content.
agentic = the model navigates the video itself and loads only the parts it decides to look at.
          It runs in the background on Google's side; this script polls until it finishes.

Each run is saved to outputs/interactions/<label>/ (the JSON answer plus a row in results.json).
The label defaults to "<processing>-<thinking level>".
"""
import argparse
import json
import time
from pathlib import Path

from google import genai
from google.genai import types

from list_models import load_key
from prompts import PLAY_BY_PLAY, PLAY_BY_PLAY_SCHEMA
from run_analysis import HERE, save_row, upload, with_retry

POLL_SECONDS = 5
GIVE_UP_SECONDS = 30 * 60


def dump(obj) -> dict:
    return obj.model_dump(exclude_none=True) if hasattr(obj, "model_dump") else dict(obj or {})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, help="path to the video file")
    ap.add_argument("--processing", choices=["static", "agentic"], required=True)
    ap.add_argument("--model", default="gemini-4-hydrogen")
    ap.add_argument("--thinking-level", choices=["minimal", "low", "medium", "high"], default=None,
                    help="omit to use the model's default")
    ap.add_argument("--start", type=int, default=None, help="static only: first second of the video to analyze")
    ap.add_argument("--end", type=int, default=None, help="static only: last second of the video to analyze")
    ap.add_argument("--label", default=None)
    args = ap.parse_args()

    video = Path(args.video).resolve()
    label = args.label or f"{args.processing}-{args.thinking_level or 'default'}"
    processing = args.processing
    if args.start is not None or args.end is not None:  # analyze one window of an uploaded file, no cutting
        processing = {"type": "static"}
        if args.start is not None:
            processing["start_offset"] = f"{args.start}s"
        if args.end is not None:
            processing["end_offset"] = f"{args.end}s"
        label = args.label or f"{label}-{args.start or 0}-{args.end}"
    out_dir = HERE / "outputs" / "interactions" / label
    out_dir.mkdir(parents=True, exist_ok=True)
    client = genai.Client(api_key=load_key(),
                          http_options=types.HttpOptions(api_version="v1beta", timeout=600_000))

    file, timing = upload(client, video)
    save_row(HERE / "outputs" / "uploads.json", {**timing, "model": "upload"})

    request = dict(
        model=args.model,
        input=[
            {"type": "video", "uri": file.uri, "mime_type": file.mime_type, "processing": processing},
            {"type": "text", "text": PLAY_BY_PLAY},
        ],
        response_format={"type": "text", "mime_type": "application/json", "schema": PLAY_BY_PLAY_SCHEMA},
    )
    if args.thinking_level:
        request["generation_config"] = {"thinking_level": args.thinking_level}
    if args.processing == "agentic":
        request["background"] = True  # agentic runs are long; the docs say to run them in the background

    row = {"video": video.name, "model": args.model, "processing": args.processing,
           "thinking_level": args.thinking_level or "default", "label": label,
           "start": args.start, "end": args.end}
    attempts = []

    def call():
        attempts.append(time.time())
        return client.interactions.create(**request)

    try:
        interaction = with_retry(call)
        while interaction.status in ("in_progress", "queued"):
            if time.time() - attempts[-1] > GIVE_UP_SECONDS:
                raise TimeoutError(f"still {interaction.status} after {GIVE_UP_SECONDS}s (id {interaction.id})")
            time.sleep(POLL_SECONDS)
            interaction = with_retry(lambda: client.interactions.get(interaction.id))
    except Exception as e:
        row.update(ok=False, error=str(e)[:600], attempts=len(attempts))
        save_row(out_dir / "results.json", row)
        print(f"FAIL {label} {video.name}: {row['error'][:300]}")
        return

    seconds = round(time.time() - attempts[-1], 1)
    usage = dump(interaction.usage)
    steps = [dump(s).get("type", "?") for s in (interaction.steps or [])]
    row.update(
        ok=interaction.status == "completed", status=interaction.status, seconds=seconds, attempts=len(attempts),
        interaction_id=interaction.id, usage=usage,
        step_types={t: steps.count(t) for t in sorted(set(steps))},
    )
    if interaction.status != "completed":
        row["error"] = json.dumps([dump(e) for e in (getattr(interaction, "errors", None) or [])])[:600]
    text = interaction.output_text or ""
    stem = f"{video.stem}__{args.model}"
    try:
        parsed = json.loads(text)
        row["plays"] = len(parsed.get("plays", []))
        text = json.dumps(parsed, indent=2)
    except ValueError:
        row["json_valid"] = False
    (out_dir / f"{stem}.json").write_text(text, encoding="utf-8")
    (out_dir / f"{stem}.steps.json").write_text(
        json.dumps([dump(s) for s in (interaction.steps or [])], indent=2, default=str)[:400_000], encoding="utf-8")
    save_row(out_dir / "results.json", row)
    with_retry(lambda: client.files.delete(name=file.name))

    print(f"{'ok  ' if row['ok'] else 'FAIL'} {label} {video.name}: {seconds}s status={interaction.status} plays={row.get('plays')}")
    print("  usage:", {k: v for k, v in usage.items() if k.startswith("total") or k == "initial_input_tokens"})
    print("  steps:", row["step_types"])


if __name__ == "__main__":
    main()
