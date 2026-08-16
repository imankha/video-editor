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
import tempfile
import uuid
from pathlib import Path

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


# =============================================================================
# T7090 Phase 3: Modal-dispatched compose seam
# =============================================================================
def _render_intro_layers_to_dir(intro, reel_probe: dict, layer_dir: str) -> dict | None:
    """App-side PIL render of the intro-card PNG layers into `layer_dir`, returning
    the JSON burn PLAN (or None on failure -- non-fatal). The BURN itself runs on
    Modal; only the (cheap, bounded) rasterisation happens here. Mirrors the local
    compose's "a failed intro degrades to no-intro" contract."""
    try:
        from app.services.player_intro import _plan_card_render
        return _plan_card_render(
            intro.card, intro.field_values, intro.image_path, reel_probe, layer_dir,
        )
    except Exception as e:
        logger.error(
            f"[serve_time_video] intro layer render failed; dispatching without intro: {e}",
            exc_info=True,
        )
        return None


def compose_serve_time_dispatched(
    reel_path: str,
    out_path: str,
    *,
    user_id: str,
    user_prefix: str | None = None,
    intro=None,
    outro: bool = True,
    report: dict | None = None,
) -> bool:
    """T7090 Phase 3: compose `[intro?, reel, outro?]` into `out_path`, running the
    OOM-prone ffmpeg card-burn + concat on MODAL when Modal is enabled, and locally
    (`compose_serve_time`) otherwise.

    This is a DISPATCH SEAM over `compose_serve_time`: the composed bytes, the
    non-fatal ladder, and the `report["full_fidelity"]`/`report["degraded_reason"]`
    contract are identical whichever engine runs.

    `user_id` is the RAW user id whose R2 objects own the reel/intro scratch.
    `user_prefix` is the ALREADY-R2-resolved `{env}/users/{uid}/profiles/{pid}`
    prefix -- pass it EXPLICITLY when the resolving ContextVar is not this request's
    own profile (the SHARE download, whose objects live under the SHARER's profile,
    never the viewer's). When None, the prefix is resolved from `user_id` +
    the current profile ContextVar (owner/collection downloads, where
    `asyncio.to_thread` copies the request context so the ContextVar is still live).

    Modal path (enabled): resolve the R2 prefix, upload the reel to an R2 scratch
    key, app-side render the intro-card PNG layers + upload each, `call_modal_compose`,
    download the composed result to `out_path`, populate `report` from the Modal
    result dict, best-effort delete every scratch key. ANY Modal error (including
    the function being undeployed -- an EXTERNAL dependency, so falling back is
    correct, not a silent internal fallback) logs and falls through to the local
    `compose_serve_time`, so a download is never sunk.

    NEVER raises -- preserves compose_serve_time's HTTP-200-always contract.
    """
    from app.services.modal_client import modal_enabled

    if not modal_enabled():
        # The ONLY path exercised in-container (Modal OFF, T4180). Call through the
        # module attribute so tests patching `compose_serve_time` still intercept.
        return compose_serve_time(reel_path, out_path, intro=intro, outro=outro, report=report)

    try:
        return _compose_via_modal(
            reel_path, out_path, user_id=user_id, user_prefix=user_prefix,
            intro=intro, outro=outro, report=report,
        )
    except Exception as e:
        # Modal is an EXTERNAL dependency; on ANY failure (undeployed function,
        # dispatch error, R2 hiccup) degrade to the local burn rather than sink the
        # download. compose_serve_time is itself never-raise, so this is the safety
        # net, not the happy path.
        logger.error(
            f"[serve_time_video] Modal compose dispatch failed; falling back to local "
            f"compose: {e}", exc_info=True,
        )
        return compose_serve_time(reel_path, out_path, intro=intro, outro=outro, report=report)


def _compose_via_modal(
    reel_path: str,
    out_path: str,
    *,
    user_id: str,
    user_prefix: str | None,
    intro,
    outro: bool,
    report: dict | None,
) -> bool:
    """The Modal branch of `compose_serve_time_dispatched`. Raises on any dispatch
    failure so the caller can fall back to the local compose."""
    from app.services.branded_outro import outro_enabled
    from app.services.modal_client import _resolve_modal_user_id, call_modal_compose
    from app.storage import (
        download_from_r2_global,
        r2_delete_object_global,
        upload_file_to_r2_global,
    )

    if report is not None:
        report["full_fidelity"] = False

    # Probe the reel up front: an unreadable reel can't be composed at all (matches
    # compose_serve_time's False-return), and no scratch work is worth doing.
    try:
        reel_probe = ffmpeg_concat.probe_media(reel_path)
    except Exception as e:
        logger.error(f"[serve_time_video] reel unreadable, cannot dispatch compose: {e}")
        return False

    # Prefer an EXPLICIT sharer prefix (share download); else resolve from the raw
    # user id + the request's own profile ContextVar (owner/collection).
    if user_prefix is None:
        user_prefix = _resolve_modal_user_id(user_id)
    scratch_id = uuid.uuid4().hex
    reel_rel = f"temp/serve_compose/{scratch_id}/reel.mp4"
    out_rel = f"temp/serve_compose/{scratch_id}/composed.mp4"
    scratch_keys: list[str] = []

    layer_dir = tempfile.mkdtemp(prefix="rb_compose_layers_")
    try:
        # --- upload the reel to R2 scratch ----------------------------------
        reel_full = f"{user_prefix}/{reel_rel}"
        if not upload_file_to_r2_global(reel_full, Path(reel_path), content_type="video/mp4"):
            raise RuntimeError(f"could not upload reel to R2 scratch {reel_full}")
        scratch_keys.append(reel_full)

        # --- app-side render + upload the intro-card layers -----------------
        card_plan: dict | None = None
        intro_layer_rels: list[str] = []
        if intro is not None:
            card_plan = _render_intro_layers_to_dir(intro, reel_probe, layer_dir)
            if card_plan is not None:
                for layer in card_plan["layers"]:
                    fname = layer["file"]
                    layer_rel = f"temp/serve_compose/{scratch_id}/{fname}"
                    layer_full = f"{user_prefix}/{layer_rel}"
                    if not upload_file_to_r2_global(
                        layer_full, Path(layer_dir) / fname, content_type="image/png"
                    ):
                        raise RuntimeError(f"could not upload intro layer {layer_full}")
                    scratch_keys.append(layer_full)
                    intro_layer_rels.append(layer_rel)

        # --- dispatch the burn + concat to Modal ----------------------------
        import asyncio

        result = asyncio.run(
            call_modal_compose(
                user_prefix, reel_rel, card_plan, intro_layer_rels,
                bool(outro) and outro_enabled(), out_rel,
            )
        )
        out_full = f"{user_prefix}/{out_rel}"
        scratch_keys.append(out_full)

        # --- download the composed result to out_path -----------------------
        if not download_from_r2_global(out_full, Path(out_path)):
            raise RuntimeError(f"could not download Modal-composed output {out_full}")

        # --- surface the Modal result into `report` (same shape as local) ---
        # An EXPECTED intro whose app-side PIL render failed non-fatally (card_plan
        # is None) was dropped BEFORE dispatch: Modal never saw it, so its
        # `full_fidelity` reflects a no-intro compose and would read True. The LOCAL
        # path returns full_fidelity=False for the identical drop; mirror that here,
        # or the T4947 collection cache would freeze an intro-less video under the
        # normal key (no self-heal). Matches local: an ordinary render drop sets no
        # `degraded_reason` (that marker is reserved for a signal/OOM kill).
        intro_dropped_app_side = intro is not None and card_plan is None
        if report is not None:
            report["full_fidelity"] = (
                bool(result.get("full_fidelity")) and not intro_dropped_app_side
            )
            if result.get("degraded_reason"):
                report["degraded_reason"] = result["degraded_reason"]
        return True
    finally:
        shutil.rmtree(layer_dir, ignore_errors=True)
        for key in scratch_keys:
            try:
                r2_delete_object_global(key)
            except Exception:
                logger.warning(f"[serve_time_video] scratch cleanup failed: {key}")
