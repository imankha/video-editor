"""The ONE serve-time compose helper (T5220 design §4).

Three passes now want to run over a downloaded reel at serve time: the
branded outro (shipped, T3950), the player intro (this task, T5220), and
T6360's future metadata/cover-art stamping. `compose_serve_time` is the
single place that opens the reel, builds whichever cards are requested,
joins `[intro?, reel, outro?]` in ONE `ffmpeg_concat.concat_segments` pass,
and applies the (currently no-op) metadata seam -- instead of three separate
open+concat+stream passes.

NON-FATAL AT EVERY RUNG (design §4.2's fall-through ladder): a failed intro
build, a failed outro build, or a failed concat all degrade gracefully to
"serve whatever we can" -- this function returns True whenever ANYTHING
playable can be served (even the bare reel), and False ONLY when the reel
itself could not be read at all. It NEVER raises -- callers can rely on the
HTTP-200-always contract the branded outro already established.
"""

from __future__ import annotations

import logging
import os
import shutil

from app.services import ffmpeg_concat

logger = logging.getLogger(__name__)


def _try_build_intro_card(
    intro, info: dict, tmp_intro_path: str, report: dict | None = None,
) -> str | None:
    """Non-fatal: build the intro card MP4 to `tmp_intro_path` from `intro`
    (an `IntroSpec`), matched to the reel's own probe `info`. Returns the
    path on success, None on ANY failure (never raises).

    `report`: OPTIONAL out-dict threaded to `build_intro_card` so an OOM/SIGKILL
    of the render surfaces `degraded_reason` distinctly (T7090 fix #3)."""
    try:
        from app.services.player_intro import build_intro_card
        if build_intro_card(intro.card, intro.field_values, intro.image_path,
                            info, tmp_intro_path, report=report):
            return tmp_intro_path
        logger.warning("[serve_time_video] intro card build returned False; serving without intro")
    except Exception as e:
        logger.error(f"[serve_time_video] intro card build raised; serving without intro: {e}", exc_info=True)
    return None


def _try_build_outro_card(info: dict) -> str | None:
    """Non-fatal: get (or build) the cached branded-outro card matched to the
    reel's own probe `info`. Returns the cached card path on success, None on
    ANY failure or when the outro is disabled (never raises)."""
    try:
        from app.services.branded_outro import outro_enabled
        if not outro_enabled():
            return None
        from app.services.branded_outro import _get_or_build_card
        card_path = _get_or_build_card(info)
        if card_path is None:
            logger.warning("[serve_time_video] outro card build returned None; serving without outro")
        return card_path
    except Exception as e:
        logger.error(f"[serve_time_video] outro card build raised; serving without outro: {e}", exc_info=True)
        return None


def _apply_metadata_hook(served_path: str, out_path: str, metadata_hook) -> None:
    """Identity copy-through so callers always find the composed bytes at
    `out_path` (copies `served_path` into place when the concat was a no-op and
    `served_path` is still the raw reel).

    T6360 SHIPPED its metadata/cover-art stamping as a SEPARATE post-compose
    ffmpeg `-c copy` pass at the ROUTER (`download_metadata.apply_download_metadata`,
    run over this function's `out_path`), NOT through this `metadata_hook` seam:
    a router-level pass keeps stamping out of the T4947 collection-download cache
    (so a profile rename reflects on the next download without stale-artist cache
    poisoning) and stays independently testable/failing. `metadata_hook` is
    therefore always None and retained only for signature back-compat."""
    if metadata_hook is not None:
        logger.info("[serve_time_video] metadata_hook is deprecated; T6360 stamps at the router")
    if served_path != out_path:
        shutil.copyfile(served_path, out_path)


def compose_serve_time(
    reel_path: str,
    out_path: str,
    *,
    intro=None,
    outro: bool = True,
    metadata_hook=None,
    report: dict | None = None,
) -> bool:
    """Compose `[intro?, reel, outro?]` into `out_path` in ONE
    `ffmpeg_concat.concat_segments` pass.

    `intro`: an `IntroSpec` (see `intro_egress.py`) or None -- None means no
      intro segment is attempted at all.
    `outro`: whether to attempt the branded outro (still internally respects
      `branded_outro.outro_enabled()`, i.e. the `BRANDED_OUTRO_ENABLED` flag).
    `metadata_hook`: T6360 SEAM (design §10) -- a documented no-op today.
    `report`: OPTIONAL out-dict. When supplied, `report["full_fidelity"]` is set
      True only if EVERY expected segment landed -- the intro (when an `intro`
      was passed), the outro (when `outro` and the flag are on), and the concat
      itself. A non-fatal degradation still returns True (the reel is served) but
      sets `full_fidelity=False`, so a caller that CACHES the bytes (T4947) can
      refuse to freeze a transiently-degraded artifact. Existing callers that
      pass nothing are unaffected.

    Returns True if `out_path` was written with AT LEAST the reel (i.e. any
    non-fatal degradation still counts as success as long as the reel is
    served) -- False ONLY if NOTHING could be produced (the reel itself is
    unreadable), in which case the caller should stream `reel_path` raw.
    NEVER raises.

    T4945 SEAM (design §10): a future collection-stitch download calls this
    with the STITCHED file as `reel_path` and ONE `intro` = the collection's
    resolved card as the FIRST segment of the WHOLE stitch (not per-member);
    `outro=True` gives the single trailing outro exactly as today. Do NOT
    per-member prepend -- T4945 is TODO, nothing built here beyond this note.
    """
    if report is not None:
        report["full_fidelity"] = False  # flipped True below only on a clean pass

    try:
        probe = ffmpeg_concat.probe_media(reel_path)
    except Exception as e:
        logger.error(f"[serve_time_video] reel unreadable, cannot compose: {e}", exc_info=True)
        return False

    from app.services.branded_outro import outro_enabled

    tmp_dir = os.path.dirname(out_path) or "."
    segments: list[str] = []

    expected_intro = intro is not None
    intro_path = None
    intro_report: dict = {}
    if expected_intro:
        intro_path = _try_build_intro_card(
            intro, probe, os.path.join(tmp_dir, "_compose_intro.mp4"), report=intro_report)
        if intro_path:
            segments.append(intro_path)

    segments.append(reel_path)

    expected_outro = bool(outro) and outro_enabled()
    outro_path = None
    if outro:
        outro_path = _try_build_outro_card(probe)
        if outro_path:
            segments.append(outro_path)

    concat_ok = True
    if len(segments) == 1:
        # Nothing to join -- serve the reel itself, straight through.
        served = reel_path
    else:
        concat_ok = ffmpeg_concat.concat_segments(segments, out_path, probe)
        if concat_ok:
            served = out_path
        else:
            logger.error("[serve_time_video] concat failed; degrading to reel-only")
            served = reel_path

    _apply_metadata_hook(served, out_path, metadata_hook)
    if report is not None:
        report["full_fidelity"] = (
            concat_ok
            and (intro_path is not None or not expected_intro)
            and (outro_path is not None or not expected_outro)
        )
        # T7090: surface an infra-level intro kill (OOM/SIGKILL) distinctly, so a
        # caller (e.g. the T4947 collection cache) can tell a shipped-but-degraded
        # artifact apart from a transient miss. `full_fidelity` is already False.
        if intro_report.get("degraded_reason"):
            report["degraded_reason"] = intro_report["degraded_reason"]
    return True
