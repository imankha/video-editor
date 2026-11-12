"""Build the benchmark from the saved results: quality (blank, owner grades), cost, and time,
plus the extrapolation to a 90-minute / 2 GB game at paid API prices.

Usage: .venv\\Scripts\\python report.py [--resolution default]
Reads  outputs/<prompt>/<resolution>/results.json and outputs/uploads.json
Writes outputs/benchmark-<resolution>.md and outputs/grading-<resolution>.csv

Cost = paid list prices (pricing.py) x the token counts the API reported, so it holds at
scale no matter which tier the test calls ran on. Time is what the test calls took.
"""
import argparse
import csv
import json
import subprocess
from pathlib import Path

from pricing import MODELS, PRICING, cost_usd
from prompts import PROMPTS
from run_analysis import VIDEO_DIR, VIDEOS

HERE = Path(__file__).parent
OUT = HERE / "outputs"
BASIS = "staging-verification-fixture-5min.mp4"  # 5 minutes, has an audio track like a real game
GAME_SECONDS, GAME_GB = 90 * 60, 2.0
# For a model we could not call, borrow output size from the nearest model we could.
DONOR = {"gemini-4-argon": "gemini-4-hydrogen", "gemini-4-carbon": "gemini-4-hydrogen",
         "gemini-3.8-flash": "gemini-3.6-flash", "gemini-3-flash-preview": "gemini-3.6-flash",
         "gemini-3.1-pro-preview": "gemini-3.6-flash"}
TITLES = {"highlights": "Prompt 1: three highlight plays (free text)",
          "playbyplay": "Prompt 2: complete play-by-play (JSON, per-player scores)"}


def duration(name: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(VIDEO_DIR / name)],
        capture_output=True, text=True, check=True,
    ).stdout
    return float(out.strip())


def tokens(row: dict) -> tuple[int, int, int]:
    """(non-audio input, audio input, billable output incl. thinking)."""
    audio = row["prompt_by_modality"].get("AUDIO", 0)
    return row["prompt_tokens"] - audio, audio, row["output_tokens"] + row["thinking_tokens"]


def read_write(model: str, row: dict, when: str = "now") -> tuple[float, float]:
    tin, ain, out = tokens(row)
    read = cost_usd(model, tin, ain, 0, when)
    return read, cost_usd(model, tin, ain, out, when) - read


def measured_section(prompt: str, rows: list, dur: dict, grading: list) -> list:
    md = ["### Each call, as measured", "",
          "| Video | Model | Quality (you grade) | Analysis time | Time per video-second | Input tokens | "
          "Output tokens | Thinking tokens | Read cost | Write cost | Read share | Total | Cost per video-second |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in sorted((r for r in rows if r["ok"]), key=lambda r: (r["video"], list(PRICING).index(r["model"]))):
        d = dur[r["video"]]
        read, write = read_write(r["model"], r)
        total = read + write
        extra = "" if r.get("finish_reason") == "STOP" else f" ({r.get('finish_reason')})"
        if "plays" in r:
            extra += f" [{r['plays']} plays]"
        md.append(f"| {Path(r['video']).stem} ({d:.0f}s) | {r['model']}{extra} |  | {r['seconds']:.0f}s | "
                  f"{r['seconds'] / d:.2f}s | {r['prompt_tokens']:,} | {r['output_tokens']:,} | {r['thinking_tokens']:,} | "
                  f"${read:.4f} | ${write:.4f} | {read / total:.0%} | ${total:.4f} | ${total / d:.6f} |")
        ext = "json" if PROMPTS[prompt]["schema"] else "md"
        grading.append({
            "prompt": prompt, "video": Path(r["video"]).stem, "model": r["model"], "quality_1_to_5": "", "notes": "",
            "output_file": f"{prompt}/{r['resolution']}/{Path(r['video']).stem}__{r['model']}.{ext}",
            "analysis_seconds": r["seconds"], "seconds_per_video_second": round(r["seconds"] / d, 3),
            "read_cost_usd": round(read, 5), "write_cost_usd": round(write, 5),
            "cost_per_video_second_usd": round(total / d, 7),
        })
    return md


def game_section(prompt: str, rows: list, basis_seconds: float) -> list:
    """Scale the 5-minute fixture to a 90-minute game.

    highlights: one call over the whole game. Input scales with length, output stays the same.
    playbyplay: output grows with length and would overrun the per-call output cap, so the game
    is cut into 5-minute pieces: 18 calls, each one the size of the measured call.
    """
    by_model = {r["model"]: r for r in rows if r["video"] == BASIS}
    scale = GAME_SECONDS / basis_seconds
    chunked = prompt == "playbyplay"
    how = (f"cut into {scale:.0f} five-minute calls (a play-by-play of 90 minutes is too long for one answer)"
           if chunked else "sent as one call (about half a million input tokens, inside the 1M limit)")
    md = ["", "### Extrapolated to one 90-minute, 2 GB game", "",
          f"The game is {how}. File size does not change the price: Gemini bills by video length, not bytes. "
          "\"est.\" marks a model this key could not call today: its token counts are borrowed from the nearest model in the same "
          "family that did run (input tokens were identical across every model of a family), and it has no time measurement.", "",
          "| Model | Basis | Input tokens | Output + thinking tokens | Read cost | Write cost | Cost per game today | "
          "After announced price change | Batch (half price, today) | Analysis time, calls one after another | "
          + ("Analysis time, all pieces in parallel |" if chunked else ""),
          "|---|---|---|---|---|---|---|---|---|---|" + ("---|" if chunked else "")]
    for model in PRICING:
        row = by_model.get(model)
        donor = by_model.get(DONOR.get(model, ""))
        if model not in MODELS and not (row and row["ok"]):
            continue  # models dropped from the shortlist only appear where they were actually measured
        if row and row["ok"]:
            tin, ain, out = tokens(row)
            basis, secs = "measured", row["seconds"]
        elif donor and donor["ok"]:  # same model family, so the same video costs the same input tokens
            tin, ain, out = tokens(donor)
            basis, secs = "est.", None
        else:
            continue
        if chunked:  # N calls, each identical to the measured one
            g_tin, g_ain, g_out = tin * scale, ain * scale, out * scale
            cost = lambda when: cost_usd(model, tin, ain, out, when) * scale
            read = cost_usd(model, tin, ain, 0) * scale
            serial = f"{secs * scale / 60:.0f} min" if secs else "not measured"
            parallel = f"about {secs:.0f}s | " if secs else "not measured | "
        else:  # one call: input grows, output does not
            g_tin, g_ain, g_out = tin * scale, ain * scale, out
            cost = lambda when: cost_usd(model, round(g_tin), round(g_ain), g_out, when)
            read = cost_usd(model, round(g_tin), round(g_ain), 0)
            serial = f"about {secs * scale / 60:.0f} min (straight-line guess)" if secs else "not measured"
            parallel = ""
        fut = PRICING[model].get("future")
        future = f"${cost('future'):.2f} (from {fut[0]})" if fut else "no change announced"
        md.append(f"| {model} | {basis} | {g_tin + g_ain:,.0f} | {g_out:,.0f} | ${read:.2f} | ${cost('now') - read:.2f} | "
                  f"**${cost('now'):.2f}** | {future} | ${cost('now') / 2:.2f} | {serial} | {parallel}")
    return md


def upload_section() -> list:
    path = OUT / "uploads.json"
    if not path.exists():
        return []
    ups = [u for u in json.loads(path.read_text()) if u["video"] == BASIS]
    if not ups:
        return []
    u = ups[0]
    gb = u["bytes"] / 1e9
    up_rate, proc = u["upload_seconds"] / gb, u["processing_seconds"]
    return ["## Getting a 2 GB game to Gemini (before any analysis starts)", "",
            f"Measured from this machine: the {gb * 1000:.0f} MB fixture took {u['upload_seconds']:.0f}s to upload "
            f"({up_rate:.0f}s per GB) and {proc:.0f}s for Google to process. At that rate a 2 GB game uploads in about "
            f"**{up_rate * GAME_GB / 60:.1f} minutes**. Processing time for a 90-minute file is not measured here; "
            "upload speed depends on the sender's connection, and a server in a data centre would be faster than this one. "
            "The upload itself is free (Files API storage is not billed; files expire after 48 hours).", ""]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--resolution", default="default")
    args = ap.parse_args()
    dur = {v: duration(v) for v in VIDEOS}
    grading = []
    md = [f"# Gemini video-analysis benchmark ({args.resolution} media resolution)", "",
          "Costs are paid list prices applied to measured token counts. "
          "\"Read\" is the cost of the model taking in the video and prompt; \"write\" is its answer plus its thinking tokens.", ""]
    md += upload_section()
    for prompt in PROMPTS:
        path = OUT / prompt / args.resolution / "results.json"
        if not path.exists():
            continue
        rows = json.loads(path.read_text())
        md += [f"## {TITLES[prompt]}", ""]
        md += measured_section(prompt, rows, dur, grading)
        md += game_section(prompt, rows, dur[BASIS])
        failed = [r for r in rows if not r["ok"]]
        if failed:
            md += ["", "### Calls that failed", "", "| Video | Model | Why |", "|---|---|---|"]
            for r in failed:
                e = r["error"]
                why = ("free tier does not include this model (quota 0); needs billing enabled" if "limit: 0" in e
                       else "free-tier daily request limit reached" if "free_tier_requests" in e
                       else e[:160].replace("|", "/"))
                md.append(f"| {Path(r['video']).stem} | {r['model']} | {why} |")
        md.append("")

    (OUT / f"benchmark-{args.resolution}.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    if grading:
        with open(OUT / f"grading-{args.resolution}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(grading[0]))
            w.writeheader()
            w.writerows(grading)
    print("\n".join(md))


if __name__ == "__main__":
    main()
