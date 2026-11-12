"""Run one prompt against each video x each Gemini model; save outputs and token usage.

Usage:
    .venv\\Scripts\\python run_analysis.py                    # 3-highlights prompt, default media resolution
    .venv\\Scripts\\python run_analysis.py --prompt playbyplay  # full play-by-play as JSON
    .venv\\Scripts\\python run_analysis.py --resolution high  # 4x video tokens, better for small jersey numbers
    .venv\\Scripts\\python run_analysis.py --models gemini-3.8-flash gemini-4-hydrogen

Outputs land in outputs/<prompt>/<resolution>/<video>__<model>.md (or .json), with all metrics in results.json.
Then run report.py for the cost tables.
"""
import argparse
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from google import genai
from google.genai import types

from list_models import load_key
from pricing import MODELS
from prompts import PROMPTS

HERE = Path(__file__).parent
VIDEO_DIR = HERE.parent / "formal annotations" / "test.short"
VIDEOS = ["staging-verification-fixture-5min.mp4", "wcfc-carlsbad-trimmed.mp4"]

RESOLUTIONS = {
    "default": None,
    "low": types.MediaResolution.MEDIA_RESOLUTION_LOW,
    "medium": types.MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    "high": types.MediaResolution.MEDIA_RESOLUTION_HIGH,
}


TRANSIENT = ("SERVICE_DISABLED", "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED")


SAVE_LOCK = threading.Lock()


def save_row(results_path: Path, row: dict) -> None:
    """Write each result as it lands, replacing any earlier row for the same video + model,
    so a hung or killed run keeps everything that already finished."""
    with SAVE_LOCK:
        rows = json.loads(results_path.read_text()) if results_path.exists() else []
        rows = [r for r in rows if (r["video"], r["model"]) != (row["video"], row["model"])]
        results_path.write_text(json.dumps(rows + [row], indent=2))


def with_retry(fn, attempts: int = 4):
    """Retry transient API errors. This project intermittently answers 403 SERVICE_DISABLED
    (the Gemini API enablement is still propagating) and 503 under load; both pass on retry."""
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:
            if i == attempts - 1 or not any(t in str(e) for t in TRANSIENT):
                raise
            time.sleep(min(60, 4 * 2 ** i))


def upload(client: genai.Client, path: Path):
    print(f"uploading {path.name} ({path.stat().st_size / 1e6:.0f} MB)...", flush=True)
    start = time.time()
    f = client.files.upload(file=str(path))
    sent = time.time()
    while f.state.name == "PROCESSING":
        time.sleep(2)
        f = with_retry(lambda: client.files.get(name=f.name))
    if f.state.name != "ACTIVE":
        raise RuntimeError(f"{path.name}: upload ended in state {f.state.name}")
    timing = {"video": path.name, "bytes": path.stat().st_size,
              "upload_seconds": round(sent - start, 1), "processing_seconds": round(time.time() - sent, 1)}
    return f, timing


def by_modality(details) -> dict:
    return {d.modality.name: d.token_count or 0 for d in (details or [])}


def run_one(client, model: str, video_name: str, file, prompt_name: str, resolution: str, out_dir: Path) -> dict:
    prompt = PROMPTS[prompt_name]
    row = {"video": video_name, "model": model, "prompt": prompt_name, "resolution": resolution}
    config = types.GenerateContentConfig(media_resolution=RESOLUTIONS[resolution])
    if prompt["schema"]:
        config.response_mime_type = "application/json"
        config.response_json_schema = prompt["schema"]
    contents = [file, prompt["text"]]
    attempts = []  # start time of every attempt; only the successful one is timed

    def call():
        attempts.append(time.time())
        return client.models.generate_content(model=model, contents=contents, config=config)

    try:
        r = with_retry(call)
    except Exception as e:  # one model failing must not lose the others' results
        row.update(ok=False, error=str(e)[:500], attempts=len(attempts))
        try:  # token counting is not under the generation quota, so the input side is still exact
            row["counted_prompt_tokens"] = client.models.count_tokens(model=model, contents=contents).total_tokens
        except Exception as ce:
            row["count_error"] = str(ce)[:200]
        print(f"FAIL {model:24} {video_name}: {row['error'][:110]} "
              f"(counted input: {row.get('counted_prompt_tokens')})", flush=True)
        return row

    u = r.usage_metadata
    prompt_mod = by_modality(u.prompt_tokens_details)
    row.update(
        ok=True,
        seconds=round(time.time() - attempts[-1], 1),  # the successful attempt only, no retry waits
        attempts=len(attempts),
        model_version=r.model_version,
        prompt_tokens=u.prompt_token_count or 0,
        prompt_by_modality=prompt_mod,
        output_tokens=u.candidates_token_count or 0,
        thinking_tokens=u.thoughts_token_count or 0,
        total_tokens=u.total_token_count or 0,
        finish_reason=r.candidates[0].finish_reason.name if r.candidates else None,
    )
    text = r.text or ""
    stem = f"{Path(video_name).stem}__{model}"
    if prompt["schema"]:
        try:
            parsed = json.loads(text)
            row["plays"] = len(parsed.get("plays", []))
            text = json.dumps(parsed, indent=2)
        except ValueError:  # truncated or malformed JSON is a result worth seeing, keep it raw
            row["json_valid"] = False
        (out_dir / f"{stem}.json").write_text(text, encoding="utf-8")
    else:
        (out_dir / f"{stem}.md").write_text(
            f"# {model} on {video_name} ({resolution} resolution)\n\n"
            f"- time: {row['seconds']}s\n- prompt tokens: {row['prompt_tokens']} {prompt_mod}\n"
            f"- output tokens: {row['output_tokens']} + {row['thinking_tokens']} thinking\n\n---\n\n"
            f"{text or '(empty response)'}\n",
            encoding="utf-8",
        )
    print(f"ok   {model:24} {video_name}: {row['seconds']}s, in={row['prompt_tokens']} "
          f"out={row['output_tokens']}+{row['thinking_tokens']} finish={row['finish_reason']}", flush=True)
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", choices=PROMPTS, default="highlights")
    ap.add_argument("--resolution", choices=RESOLUTIONS, default="default")
    ap.add_argument("--models", nargs="+", default=MODELS)
    ap.add_argument("--videos", nargs="+", default=VIDEOS, choices=VIDEOS)
    ap.add_argument("--parallel", type=int, default=1,
                    help="calls in flight at once; keep 1 when the timing numbers matter")
    args = ap.parse_args()

    out_dir = HERE / "outputs" / args.prompt / args.resolution
    out_dir.mkdir(parents=True, exist_ok=True)
    # v1beta: the newest models and model listing are not served on v1 for this key.
    # A call that has not answered in 10 minutes is abandoned (one hung for 20+ minutes without this).
    client = genai.Client(api_key=load_key(),
                          http_options=types.HttpOptions(api_version="v1beta", timeout=600_000))
    results_path = out_dir / "results.json"

    files = {}
    for name in args.videos:
        files[name], timing = upload(client, VIDEO_DIR / name)
        save_row(HERE / "outputs" / "uploads.json", {**timing, "model": "upload"})

    def job(j):
        save_row(results_path, run_one(client, j[0], j[1], files[j[1]], args.prompt, args.resolution, out_dir))

    jobs = [(m, v) for v in args.videos for m in args.models]
    with ThreadPoolExecutor(max_workers=args.parallel) as pool:
        list(pool.map(job, jobs))

    for f in files.values():
        with_retry(lambda: client.files.delete(name=f.name))
    print(f"\nwrote {results_path}")


if __name__ == "__main__":
    main()
