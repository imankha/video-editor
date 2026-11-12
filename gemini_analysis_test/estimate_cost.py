"""Estimate what the tagged, highlight-focused play-by-play costs on gemini-4-hydrogen.

Usage:
    .venv/Scripts/python estimate_cost.py --minutes 90 --gb 2
    .venv/Scripts/python estimate_cost.py --minutes 90 --gb 2 --thinking low
    .venv/Scripts/python estimate_cost.py --minutes 90 --gb 2 --mode agentic
    .venv/Scripts/python estimate_cost.py --minutes 90 --gb 2 --chunk-minutes 3 --no-audio --batch

Three ways to run it, all measured on 2026-11-12 with the prompt and schema in prompts.py:

static, default thinking  The recommended baseline. The model gets one frame per second of a
                          5-minute window. Fitted to calls on 89 s and 5-minute windows; thinking
                          is the mean of 10 calls and showed no link to window length.
static, low thinking      One 5-minute call. About 40% cheaper, but it returned half the player
                          entries and 2 highlights where default thinking found 9.
agentic                   The model navigates the video itself. Fitted to two calls (5 and 20
                          minutes). It loaded 7 to 11 times more video tokens than static.
                          ASSUMPTION: those "tool use" tokens are billed at the input price; the
                          free-tier key used for testing produces no bill to confirm it.

Static windows longer than 5 minutes are refused here: a single static call on a 20-minute
video wrote 25 plays, stopped at 05:18 and reported success.
Re-fit the constants when the prompt, the schema, the model or the media resolution changes.
"""
import argparse
import math

# Paid list price, USD per token (https://aistudio.google.com/docs/pricing, 2026-11-12).
PRICE_IN, PRICE_OUT = 1.50 / 1e6, 7.50 / 1e6  # thinking is billed as output

# --- static ---------------------------------------------------------------
S_IN_PER_CALL = 2_700       # the prompt and JSON schema
S_IN_PER_SEC_VIDEO = 75.6   # 70.75 for the frames (1 per second) + 4.85 of timestamp text
S_IN_PER_SEC_AUDIO = 30.3   # only when the file has an audio track
S_ANSWER_PER_CALL, S_ANSWER_PER_SEC = 1_200, 7.78
S_THINK = {"default": 10_612, "low": 1_680}  # per call; default = mean of 10 calls, low = 1 call
S_THINK_SD, S_THINK_N = 3_984, 10            # spread of the 10 default-thinking calls
S_MAX_CHUNK_MIN = 5

# --- agentic --------------------------------------------------------------
A_IN_PER_CALL = 3_322
A_TOOL_PER_CALL, A_TOOL_PER_SEC = 189_650, 603.4   # video + transcript the model chose to load
A_ANSWER_PER_CALL, A_ANSWER_PER_SEC = 2_820, 8.33
A_THINK_PER_CALL = 18_000                          # 19,822 and 16,211 measured
A_SEC_PER_CALL, A_SEC_PER_VIDEO_SEC = 209, 0.087
A_MAX_MEASURED_MIN = 20

# --- time -----------------------------------------------------------------
UPLOAD_SEC_PER_GB = 235             # from the owner's machine
PROCESS_SEC_PER_VIDEO_SEC = 0.065   # Google preparing the file; extrapolated from short clips
S_OUTPUT_TOKENS_PER_SEC, S_OVERHEAD_SEC = 160, 10  # a static call's time tracks its output size

OUTPUT_CAP = 65_536


def estimate(minutes: float, gb: float, mode: str = "static", thinking: str = "default",
             chunk_minutes: float | None = None, audio: bool = True, batch: bool = False) -> dict:
    seconds = minutes * 60
    chunk_minutes = chunk_minutes or (S_MAX_CHUNK_MIN if mode == "static" else A_MAX_MEASURED_MIN)
    if mode == "static" and chunk_minutes > S_MAX_CHUNK_MIN:
        raise SystemExit(f"static windows over {S_MAX_CHUNK_MIN} minutes lose coverage (measured: a 20-minute "
                         "call stopped at 05:18); use --chunk-minutes 5 or less, or --mode agentic")
    calls = math.ceil(minutes / chunk_minutes)
    piece = min(seconds, chunk_minutes * 60)
    discount = 0.5 if batch else 1.0

    if mode == "static":
        tokens_in = calls * S_IN_PER_CALL + seconds * (S_IN_PER_SEC_VIDEO + (S_IN_PER_SEC_AUDIO if audio else 0))
        tool = 0
        answer = calls * S_ANSWER_PER_CALL + seconds * S_ANSWER_PER_SEC
        think = calls * S_THINK[thinking]
        # Two standard deviations: call-to-call scatter (averages out over many calls) plus the
        # uncertainty in the mean itself, estimated from few calls (does not average out).
        sd = S_THINK_SD if thinking == "default" else S_THINK[thinking] * 0.4
        swing = 2 * math.hypot(sd * math.sqrt(calls), calls * sd / math.sqrt(S_THINK_N))
        per_piece_out = S_ANSWER_PER_CALL + S_ANSWER_PER_SEC * piece + S_THINK[thinking]
        serial = (answer + think) / S_OUTPUT_TOKENS_PER_SEC + calls * S_OVERHEAD_SEC
        parallel = (per_piece_out + 2 * sd) / S_OUTPUT_TOKENS_PER_SEC + S_OVERHEAD_SEC
    else:
        tokens_in = calls * A_IN_PER_CALL
        tool = calls * A_TOOL_PER_CALL + seconds * A_TOOL_PER_SEC
        answer = calls * A_ANSWER_PER_CALL + seconds * A_ANSWER_PER_SEC
        think = calls * A_THINK_PER_CALL
        swing = 0.25 * (tool * PRICE_IN / PRICE_OUT)  # two calls only: allow a quarter either way on the load
        per_piece_out = A_ANSWER_PER_CALL + A_ANSWER_PER_SEC * piece + A_THINK_PER_CALL
        serial = calls * A_SEC_PER_CALL + seconds * A_SEC_PER_VIDEO_SEC
        parallel = A_SEC_PER_CALL + piece * A_SEC_PER_VIDEO_SEC

    def total(extra_out=0.0):
        return ((tokens_in + tool) * PRICE_IN + (answer + think + extra_out) * PRICE_OUT) * discount

    return {
        "mode": mode, "thinking": thinking, "calls": calls, "chunk_minutes": chunk_minutes,
        "input_tokens": round(tokens_in), "tool_use_tokens": round(tool),
        "answer_tokens": round(answer), "thinking_tokens": round(think),
        "read_cost": (tokens_in + tool) * PRICE_IN * discount,
        "write_cost": (answer + think) * PRICE_OUT * discount,
        "cost": total(), "cost_low": total(-swing), "cost_high": total(swing),
        "output_per_call": per_piece_out,
        "upload_seconds": gb * UPLOAD_SEC_PER_GB,
        "processing_seconds": seconds * PROCESS_SEC_PER_VIDEO_SEC,
        "analysis_seconds_serial": serial, "analysis_seconds_parallel": parallel,
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, required=True, help="video length")
    ap.add_argument("--gb", type=float, required=True, help="file size; affects upload time only, never cost")
    ap.add_argument("--mode", choices=["static", "agentic"], default="static")
    ap.add_argument("--thinking", choices=["default", "low"], default="default", help="static only")
    ap.add_argument("--chunk-minutes", type=float, default=None,
                    help="length of each window sent to the model (default 5 static, 20 agentic)")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--batch", action="store_true", help="batch API, half price, results within 24 hours")
    a = ap.parse_args()
    if a.mode == "agentic" and a.thinking != "default":
        raise SystemExit("agentic was only measured at default thinking")
    e = estimate(a.minutes, a.gb, a.mode, a.thinking, a.chunk_minutes, not a.no_audio, a.batch)

    print(f"{a.minutes:g} min, {a.gb:g} GB, {a.mode}, {a.thinking} thinking, "
          f"{e['calls']} calls of up to {e['chunk_minutes']:g} min"
          f"{', no audio' if a.no_audio else ''}{', batch' if a.batch else ''}")
    print(f"  cost      ${e['cost']:.2f}   (likely range ${e['cost_low']:.2f} to ${e['cost_high']:.2f})")
    read_detail = f"{e['input_tokens']:,} input tokens"
    if e["tool_use_tokens"]:
        read_detail += f" + {e['tool_use_tokens']:,} tool-use tokens (assumed billed as input)"
    print(f"  read      ${e['read_cost']:.2f}   {read_detail}")
    print(f"  write     ${e['write_cost']:.2f}   {e['answer_tokens']:,} answer + {e['thinking_tokens']:,} thinking tokens")
    print(f"  upload    {e['upload_seconds'] / 60:.1f} min from this machine, then about "
          f"{e['processing_seconds'] / 60:.1f} min of processing at Google (extrapolated)")
    print(f"  analysis  {e['analysis_seconds_serial'] / 60:.0f} min one call after another, "
          f"about {e['analysis_seconds_parallel']:.0f} s with all calls in parallel (set by the slowest window)")
    if a.mode == "static" and a.thinking == "low":
        print("  note: low thinking is one measurement; it found 2 highlights where default found 9")
    if a.mode == "agentic" and e["chunk_minutes"] > A_MAX_MEASURED_MIN:
        print(f"  note: agentic was measured up to {A_MAX_MEASURED_MIN} minutes per call; this is extrapolated")
    if a.mode == "static" and e["chunk_minutes"] not in (5,):
        print("  note: static was measured on 89 s and 5-minute windows; other lengths are interpolated")
    if e["output_per_call"] > OUTPUT_CAP:
        print(f"  WARNING: about {e['output_per_call']:,.0f} output tokens per call exceeds the {OUTPUT_CAP:,} cap")
