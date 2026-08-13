# T4945 Design — Core Stitch + Owner Download

**Status:** AWAITING USER APPROVAL (design gate)
**Tier:** L · **Scope of this doc:** the ONE open question flagged in EPIC.md Decision 1 —
the CPU-only Modal function shape for pure ffmpeg muxing — plus the endpoint's control flow.
Everything else (decisions 1 config-gating / 5 intro-burn reuse / 7 mixed-resolution fallback)
is already resolved in [EPIC.md](collection-download/EPIC.md) and is NOT reopened here.

---

## 1. Current state (verified 2026-08-13, this pass)

- Collections exist only as client-composited **playback** — there is no endpoint that produces
  a single stitched MP4. `GET /api/collections/intro-playback` (`collections.py:760`) resolves a
  collection's members + its own intro card for the in-app player, but never muxes them.
- The muxing engines the epic reuses are all present and unchanged:
  - `evaluate_collection_members(conn, definition)` (`collections.py:655`) → members in canonical
    rank order (`{id, name, duration, filename}`); `select_within_budget` (`:634`) optional trim.
  - `concat_segments(segments, out_path, probe)` (`ffmpeg_concat.py:200`) — ordered N-join,
    `-c copy` first, **auto re-encode fallback on any resolution/pix_fmt/SAR mismatch** (`:238-266`).
    Pure ffmpeg/ffprobe subprocess; no torch, no app-heavy deps.
  - `compose_serve_time(reel_path, out, *, intro, outro)` (`serve_time_video.py:78`) — builds
    `[intro?][reel][outro?]` in ONE concat pass, non-fatal at every rung, HTTP-200-always. Its
    docstring already names the T4945 seam (`:100-105`): call it with the STITCHED file as
    `reel_path` and ONE `intro` = the collection's card.
  - `resolve_intro_for_reel(user_id, profile_id, raw_card_id, total_duration, reel_id, mode)`
    (`intro_egress.py:141`) — opens its OWN read-only connection, downloads the card image, loads
    facts fresh; returns an `IntroSpec` with `.cleanup()`.
- `download_file` (`downloads.py:664`) is the endpoint template: presign+verify → download to a
  per-request temp dir → `compose_serve_time` in `asyncio.to_thread` → stream → `rmtree` in
  `finally`. The intro is resolved **inside** the generator via a helper that opens its own conn
  (`_resolve_download_intro`, `:712`), because the request's DB connection is closed by the time
  the `StreamingResponse` generator body runs.
- Compute switch: `modal_enabled()` (`modal_client.py:340`, env `MODAL_ENABLED`, default false).

## 2. THE open question (EPIC.md Decision 1) — and its resolution

> "No CPU-only (non-GPU) Modal function exists today for pure ffmpeg work — this likely needs a
> new function in `modal_functions/video_processing.py`, not just a call-site branch. This needs
> either a new lightweight Modal function or confirmation that a GPU-class container is an
> acceptable cost for pure muxing."

**The premise is imprecise — a CPU-only Modal function pattern already exists.**
`process_framing_ai_parallel` (`video_processing.py:2178`) is declared `@app.function(gpu=None,
# CPU only …, secrets=[modal.Secret.from_name("r2-credentials")])`. A Modal `@app.function` with
**no `gpu=` argument bills as a plain CPU container** — no GPU cost. The base `image`
(`video_processing.py:30`) already bundles `ffmpeg` + `boto3` + `numpy` — everything a pure muxer
needs, no torch, no weights.

**Resolution:** add a **new CPU-only (`gpu=None`) Modal function** — NOT a GPU-class container.
There is zero GPU cost and the base image already suffices. A GPU-class container for pure muxing
would be pure waste; it is rejected.

## 3. The real design tension (what the user should actually weigh)

`compose_serve_time` builds the intro and outro **cards**, and those engines are deliberately
app-side:

- The branded outro is **NOT inside any Modal function** — a standing T3950 invariant
  (modal-gpu.md, export-pipeline.md). It renders in the router layer with bundled fonts/branding
  assets so no Modal redeploy is needed when the outro changes.
- The player-intro render engine (`player_intro.build_intro_card` + the
  `intro_card_geometry`/treatment contract + bundled fonts) is likewise app-side, and reads the
  card row + profile facts through `resolve_intro_for_reel`.

So the compute split is forced by an existing invariant, not invented here:

| Work | Cost | Where |
|------|------|-------|
| N-member concat + **mixed-resolution re-encode** (the unbounded, arbitrary-size CPU) | heavy, grows with collection size | **Modal** (prod) / local (dev) |
| Card builds (intro + outro) + the final `[card][stitch][card]` join | tiny — cards are seconds long; the join is `-c copy` of 3 already-probe-matched segments | **App server, always** |

This is exactly the server-protection intent of Decision 1: the single shared app server no
longer absorbs the arbitrary-N concat/re-encode; the residual card-compose is bounded,
millisecond-scale, and CANNOT move (fonts/branding/facts + the T3950 invariant live app-side).

**Rejected alternative — port the whole `[intro][members][outro]` render into one Modal pass.**
Would require bundling `player_intro` + `branded_outro` + `intro_card_geometry` + fonts + branding
into the Modal image, duplicating the render engine, and a Modal **redeploy on every card/outro
change** — a direct violation of the T3950 "outro not in Modal" invariant and the DRY/greppability
rules, to save a `-c copy` of three short segments. Not worth it.

## 4. Target control flow

Endpoint: `GET /api/collections/download?scope_type&aspect_ratio&game_id?&tags?&budget_sec?`
(mounted on the existing `collections.py` router, `prefix="/api/collections"`). It runs on the
caller's own session/profile context — `evaluate_collection_members` reads the caller's own
profile DB, so it is implicitly scoped to the user's own reels (**not wide open**; T4946 still
owns the real permission/credit gate before any real release).

**Resolve BEFORE building the generator** (the closed-connection gotcha, same as `download_file`):
members (rank order, optional `select_within_budget` trim), each member's R2 key
(`final_videos/{filename}`), the collection's own `intro_card_id`
(`get_collection_intro_card_id(cursor, collection_intro_settings_key(...))`, mirroring
`get_collection_intro_playback` `:777-790`), `total_duration = sum(member durations)`, user/profile
ids, and the download filename. Empty membership → 404. The intro `IntroSpec` is resolved **inside**
the generator (own read-only conn) exactly like `_resolve_download_intro`.

Then the generator (in `asyncio.to_thread` for the ffmpeg work), branching on `modal_enabled()`:

```
tmp = mkdtemp()
try:
  if not modal_enabled():                       # dev / containers / staging
      for m in members: download final_videos/{m.filename} -> tmp/mN.mp4     # presign + httpx
      probe = probe_media(tmp/m0.mp4)            # reference = top-ranked member (Decision 7)
      concat_segments([tmp/m0..mN], tmp/stitch.mp4, probe)                   # re-encode fallback
  else:                                          # prod
      out_key = f"temp/collection_stitch/{uuid}.mp4"     # disposable, no DB row (invariant)
      call_modal_stitch_members(user_id, [final_videos/{m.filename} ...], out_key)   # NEW fn
      download out_key -> tmp/stitch.mp4         # R2 is the Modal<->app transfer medium
      best-effort delete out_key                 # app-owned scratch, NOT a member source

  intro = resolve_intro_for_reel(...)            # own read-only conn; card image + facts app-side
  compose_serve_time(tmp/stitch.mp4, tmp/out.mp4, intro=intro, outro=True)  # cards app-side
  stream tmp/out.mp4
finally:
  intro.cleanup(); rmtree(tmp)
```

### The new Modal function (proposed)

```python
@app.function(image=image, gpu=None, timeout=1800,
              secrets=[modal.Secret.from_name("r2-credentials")])
def stitch_members(user_id: str, input_keys: list[str], output_key: str) -> dict:
    """Pure CPU ffmpeg muxer: download each member from R2, concat in order
    (copy-join with re-encode fallback on resolution/pix_fmt/SAR mismatch),
    upload the stitched file to output_key. Returns {output_key, duration}."""
```

- Self-contained, matching the existing Modal-function convention: the functions in
  `video_processing.py` do **not** import `app.services.*` (they re-declare `get_r2_client`,
  `_presigned_source_url`, and run ffmpeg via `subprocess`). The concat-with-re-encode-fallback
  logic from `ffmpeg_concat.concat_segments` is **inlined** here (≈40 lines, pure ffmpeg/ffprobe),
  not imported. Keys are per-user (`{user_id}/{key}`) resolved the same way the other functions
  prefix them; `modal_client` resolves the R2 prefix via `_resolve_modal_user_id` before dispatch.
- No new image, no GPU, no weights, no Volume. `image` already has ffmpeg + boto3.
- **Requires a manual Modal redeploy** (backend rule — deploys don't ride the Fly deploy). See
  §6 open question Q3.

## 5. Why a stitch/outro failure can never lose a member reel (structural)

Sources are R2-read-only: members are presigned + downloaded into the per-request temp dir, never
opened for write. The Modal function reads member keys and writes only to a fresh disposable
`temp/collection_stitch/` key — never to a `final_videos/` object. Output lives only in the temp
dir (`rmtree` in `finally`) and the disposable R2 scratch key (best-effort delete). Nothing is
inserted into `final_videos`/`export_jobs`. Every ffmpeg stage is non-fatal (`concat_segments`
returns False, `compose_serve_time` degrades to reel-only) — a failure degrades the download, it
never touches a source. No schema, no migration (EPIC invariant).

## 6. Open questions for approval (design gate)

**Q1 (THE flagged question) — new CPU-only Modal function vs GPU-class container.**
Recommend: **new `@app.function(gpu=None)` `stitch_members` on the base `image`** (§2/§4). Zero GPU
cost; the `gpu=None` pattern already ships (`process_framing_ai_parallel`). GPU-class container
rejected as pure waste.

**Q2 — the compute split.** Recommend: **Modal muxes ONLY the member stitch; the app always
composes intro+outro** (cards stay app-side per the T3950 invariant, §3). The "whole render on
Modal" alternative is rejected (§3). Confirm.

**Q3 — Modal-branch delivery / redeploy.** The Modal branch needs a manual `modal deploy` of the
new function before it works in prod. Dev, `/dotask` containers, and staging all run
`MODAL_ENABLED=false`, and T4946 must land before this endpoint is exposed in a real prod release.
Two options:
  - **(a) Build both branches now** (local + the new Modal function), and schedule the Modal
    redeploy for when T4946 exposes the endpoint in prod. **[recommended]** — satisfies the AC
    ("compute location honors `MODAL_ENABLED`") and keeps the Modal path ready, while the redeploy
    rides the same prod-exposure step T4946 already gates.
  - (b) Ship local-only in T4945 and split the Modal function into a follow-up task. Rejected
    unless the user prefers it: it leaves an AC ("Modal-routed when true") unmet in this task.

## 7. Risks

- **Modal redeploy drift** — a new function that isn't deployed → `RuntimeError("Modal <fn> not
  available")` at dispatch. Mitigated by Q3(a) tying the redeploy to prod exposure + `modal_enabled`
  being false everywhere the redeploy hasn't happened.
- **Inlined concat logic diverging from `ffmpeg_concat.concat_segments`** — the Modal copy must
  stay behavior-equivalent (copy-join, mismatch → re-encode, duration-floor validation). Mitigated
  by a parity note in the Modal function + the same mixed-resolution test exercised against both
  branches (`MODAL_ENABLED` off locally is the only branch CI can run; the Modal branch is verified
  by the inlined-logic unit test + manual deploy check).
- **Large stitched scratch object** written to R2 in the Modal branch — disposable, best-effort
  deleted; NOT the T4947 cache (that's a separate task with its own keying).

## 8. Scope guard (from the task file — do NOT implement here)

No access/permission check beyond minimal session auth (T4946), no credit charge (T4946), no
caching (T4947). Frontend gesture (enable `CollectionHeader.jsx:124`, thread `onDownload` through
`CollectionCard.jsx`, add `downloadCollection` in `useDownloads.js` mirroring `downloadFile:168`)
is in scope for implementation but carries no new design decision.
