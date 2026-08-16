"""T7090 (Phase 3) -- the PURE, zero-app-dependency intro-card ffmpeg-cmd builder.

The intro card is burned by ONE `ffmpeg -filter_complex` pass. That burn is the
OOM-prone step (looped full-frame inputs decoded into RAM) the T7090 design moves
OFF the 1GB Fly web machine and onto Modal's headroom. To do that WITHOUT drifting
two copies of the filtergraph (the design's top risk, §7), the ffmpeg arg-list
construction lives HERE as a single pure function that BOTH sides call:

  - the app (local fallback, `MODAL_ENABLED=false`) via `player_intro._build_card`
  - the Modal function `compose_serve_time_modal` via this same builder

`build_intro_card_cmd(plan, layer_dir, out_path)` imports ONLY the stdlib. It takes
a plain JSON-serializable PLAN dict (produced app-side by `player_intro._plan_card_render`,
which does all the PIL rasterisation and writes the PNG layers) plus the directory
those PNGs live in, and returns the EXACT ffmpeg command today's `_build_card` built.
The plan references each PNG by RELATIVE filename (never an absolute path), so the
same plan works app-side and inside the Modal container where the layer_dir differs.

The plan schema (all JSON-serializable):

    {
      "duration": float,            # card length in seconds
      "fps_str": str,               # e.g. "30/1" or "30000/1001"
      "pix_fmt": str,               # reel pixel format, matched for -c copy prepend
      "sar": str,                   # reel sample aspect ratio "1/1"
      "timescale": int,             # reel video_track_timescale
      "has_audio": bool,            # reel has an audio stream
      "a_layout": str|None,         # "mono" | "stereo" (only when has_audio)
      "a_rate": int|None,           # audio sample rate (only when has_audio)
      "a_channels": int|None,       # audio channel count (only when has_audio)
      "flash_st": float,            # exit white-flash start
      "flash_d": float,             # exit white-flash duration
      "layers": [ <layer>, ... ],   # ORDERED bottom-to-top
    }

Each layer is one of (each `file` is a RELATIVE filename inside layer_dir):

    {"kind": "bg",     "file": "bg.png"}
    {"kind": "photo",  "file": "photo.png",
       "zexpr": str, "px": int, "py": int, "rw": int, "rh": int, "nframes": int}
    {"kind": "static", "file": "static_overlay.png"}
    {"kind": "text",   "file": "el_0.png",
       "lx": int, "ly": int, "st": float, "fade_d": float, "rise_px": int}

The FIRST layer is always the bg; it seeds the filtergraph base. Every other layer
is a looped full-frame (or cropped) input overlaid in order. This mirrors, arg for
arg, the graph `_build_card` produced before the extraction -- the existing
`tests/test_t7090_intro_memory_collapse.py` and `tests/test_t5210_player_intro.py`
pin that byte-identity.
"""

import os

# T7090 (fix #3): the `degraded_reason` surfaced when an intro-card render
# subprocess is KILLED BY A SIGNAL (kernel OOM SIGKILL/-9) rather than failing
# ordinarily. Canonical home is THIS pure module so both the app-side render
# (`player_intro`, which re-exports it) and the Modal burn (`compose_serve_time_modal`)
# can reference it without importing the heavy player_intro/user_db tree.
INTRO_DEGRADED_KILLED = "intro_card_render_killed"


def build_intro_card_cmd(plan: dict, layer_dir: str, out_path: str) -> list[str]:
    """Build the ffmpeg arg list that burns the intro card described by `plan`,
    reading its PNG layers from `layer_dir`, writing the card MP4 to `out_path`.

    PURE: no app imports, no filesystem writes (only reads `layer_dir` paths that
    the caller already populated). Deterministic given the plan. This is the SINGLE
    builder both the app-side local fallback and the Modal function invoke, so the
    filtergraph can never drift between the two.
    """
    duration = float(plan["duration"])
    fps_str = plan["fps_str"]
    pix_fmt = plan["pix_fmt"]
    sar = plan["sar"]
    timescale = plan["timescale"]
    has_audio = bool(plan["has_audio"])
    layers = plan["layers"]

    def _path(fname: str) -> str:
        # Relative filename -> absolute path in the (app OR Modal) layer dir, then
        # to a forward-slash posix form ffmpeg accepts on every platform.
        return os.path.join(layer_dir, fname).replace("\\", "/")

    inputs: list[str] = []
    parts: list[str] = []
    last = "[base]"
    idx = 0
    text_k = 0  # 0-based text-element counter for the [el{k}]/[t{k}] labels
    #             (matches the old enumerate() index, distinct from the input idx)

    for layer in layers:
        kind = layer["kind"]
        if kind == "bg":
            inputs += [
                "-loop", "1", "-framerate", fps_str, "-t", str(duration),
                "-i", _path(layer["file"]),
            ]
            parts.append("[0:v]format=rgba[base]")
            idx = 1
        elif kind == "photo":
            inputs += ["-i", _path(layer["file"])]
            rw, rh = layer["rw"], layer["rh"]
            px, py = layer["px"], layer["py"]
            nframes = layer["nframes"]
            zexpr = layer["zexpr"]
            parts.append(
                f"[{idx}:v]zoompan=z='{zexpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
                f"d={nframes}:s={rw}x{rh}:fps={fps_str},format=rgba[photo]"
            )
            parts.append(f"{last}[photo]overlay=x={px}:y={py}[withphoto]")
            last = "[withphoto]"
            idx += 1
        elif kind == "static":
            inputs += [
                "-loop", "1", "-framerate", fps_str, "-t", str(duration),
                "-i", _path(layer["file"]),
            ]
            parts.append(f"[{idx}:v]format=rgba[statics]")
            parts.append(f"{last}[statics]overlay=x=0:y=0[withstatics]")
            last = "[withstatics]"
            idx += 1
        elif kind == "text":
            inputs += [
                "-loop", "1", "-framerate", fps_str, "-t", str(duration),
                "-i", _path(layer["file"]),
            ]
            k = text_k  # 0-based label suffix, matching the old enumerate() index
            text_k += 1
            lx, ly = layer["lx"], layer["ly"]
            st, fade_d, rise_px = layer["st"], layer["fade_d"], layer["rise_px"]
            yexpr = (
                f"if(lt(t,{st}),{ly + rise_px},"
                f"if(lt(t,{st + fade_d}),{ly}+{rise_px}*(1-(t-{st})/{fade_d}),{ly}))"
            )
            parts.append(f"[{idx}:v]format=rgba,fade=t=in:st={st}:d={fade_d}:alpha=1[el{k}]")
            parts.append(f"{last}[el{k}]overlay=x={lx}:y='{yexpr}'[t{k}]")
            last = f"[t{k}]"
            idx += 1
        else:
            raise ValueError(f"unknown intro-card layer kind {kind!r}")

    # Exit flash LAST (deterministic final frame -> clean cut to footage).
    flash_st = plan["flash_st"]
    flash_d = plan["flash_d"]
    parts.append(
        f"{last}fade=t=out:st={flash_st}:d={flash_d}:color=white,"
        f"setsar={sar},format={pix_fmt}[v]"
    )
    filter_complex = ";".join(parts)

    cmd = ["ffmpeg", "-y", *inputs]
    audio_idx = idx
    if has_audio:
        cmd += ["-f", "lavfi", "-i",
                f"anullsrc=channel_layout={plan['a_layout']}:sample_rate={plan['a_rate']}"]

    cmd += ["-filter_complex", filter_complex, "-map", "[v]"]
    if has_audio:
        cmd += ["-map", f"{audio_idx}:a"]
    cmd += ["-t", str(duration)]
    cmd += ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
            "-pix_fmt", pix_fmt, "-r", fps_str,
            "-video_track_timescale", str(timescale)]
    if has_audio:
        cmd += ["-c:a", "aac", "-b:a", "128k",
                "-ar", str(plan["a_rate"]), "-ac", str(plan["a_channels"]),
                "-t", str(duration)]
    else:
        cmd += ["-an"]
    cmd += ["-f", "mp4", out_path]
    return cmd
