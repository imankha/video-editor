# T6920: Attached intro card missing from every DOWNLOADED reel on Fly - import-time IndexError in intro_card_geometry

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-08-12
**Updated:** 2026-08-12

## Problem

**User report (2026-08-12, staging, imankh@gmail.com):** clicking Preview/Play on the reel
"Brilliant Dribble and Assist" (final_video id 38, inside the "Game Highlights at Legends Mar 28"
collection) correctly shows the Athlete Intro Card pre-roll, but the DOWNLOADED file has no intro
card at the start.

**Live-reproduced during filing (2026-08-12, staging, single machine `d8933d5f417308`, release
v484 = current master):**

- `GET /api/downloads/38/intro-playback` resolves the intro correctly: card id 1 "New card 1",
  duration 4.0s, photo key present, presigned previewUrl works, field_values complete
  (full_name "Mehdi Khabazian", position CAM, class 2031, team West Coast ECNL). This is what
  the in-app player shows -> preview LOOKS right.
- `GET /api/downloads/38/file` returns a 16.83s file that starts DIRECTLY on game footage
  (frames sampled at 0.5s/2.0s/3.9s/4.5s = all field play, no card) and ends with the branded
  outro (frame at 15.5s). The concat ran and joined exactly 2 segments - `[reel][outro]`,
  intro silently dropped. Byte-identical across two runs (deterministic, not transient).

**Root cause (staging traceback captured at 2026-08-12T14:18:29Z during the repro):**

```
[serve_time_video] intro card build raised; serving without intro: 4
  File "/app/app/services/serve_time_video.py", line 35, in _try_build_intro_card
    from app.services.player_intro import build_intro_card
  File "/app/app/services/player_intro.py", line 54, in <module>
    from app.services.intro_card_geometry import MOTION, STAGGER_ORDER, ...
  File "/app/app/services/intro_card_geometry.py", line 596, in <module>
    Path(__file__).resolve().parents[4]
IndexError: 4
```

`intro_card_geometry.py:595-598` computes `_JS_PATH` (the target path for the GENERATED JS
mirror, `src/frontend/src/utils/introCardGeometry.js`) at MODULE IMPORT TIME:

```python
_JS_PATH = (
    Path(__file__).resolve().parents[4]
    / "src" / "frontend" / "src" / "utils" / "introCardGeometry.js"
)
```

- In the repo checkout the file sits 5 levels deep (`<root>/src/backend/app/services/...`), so
  `parents[4]` = repo root. Works locally, in CI, and in the /dotask containers.
- In the deployed Fly image (`src/backend/Dockerfile`: `WORKDIR /app` + `COPY . .`) the file is
  `/app/app/services/intro_card_geometry.py` - its `.parents` sequence has only 4 entries
  (indices 0-3), so `parents[4]` raises `IndexError: 4` and the whole module import fails.
- `player_intro` imports the geometry module at ITS import (line 54), and
  `serve_time_video._try_build_intro_card` imports `player_intro` lazily inside its
  non-fatal try/except (by design, epic decision 9) - so the crash is swallowed per-request,
  logged once, and the download degrades to `[reel][outro]`. Nothing ever 500s, nothing
  surfaces to the user. **The intro burn path has NEVER executed successfully on any Fly
  deployment.**
- Playback egresses never import the Python renderer (the pre-roll is DOM-rendered from the
  `intro-playback` payload; the geometry contract on that side is the generated JS mirror),
  which is exactly why preview/in-app play show the card while every download drops it.

**Why this wasn't caught by T6860 (same symptom, closed 2026-08-12):** the burn ladder fails at
the FIRST broken rung. Until T6860, that rung was the R2 image download (transfer-client
failure, also Fly-only); its traceback ended there, masking this import crash sitting one rung
below. T6860 fixed the image download - my repro log shows the image now downloads fine
(`Downloaded global object from R2: .../intro/ac737271....png`) - which EXPOSED this crash as
the new first-broken-rung. Two consecutive Fly-only failures in the same ladder is the pattern
to note: nothing in CI or local verification executes this code from the deployed image layout.

`git log -S "parents[4]"` -> the line shipped in c806e2a5 (T5210, 2026-08-05) and has never
been touched since. Broken on Fly since the day the renderer landed.

## Solution

Two halves: the one-line-class fix, and the verification the user explicitly asked for.

### A. Fix the import-time path assumption

`_JS_PATH` is dev-time tooling only - it's used by the JS-mirror generator
(`python -m app.services.intro_card_geometry` regenerates the frontend mirror) and never by any
serve-time code path. Make it lazy:

- Move the path computation out of module level into a `_js_path()` helper (or directly into
  `render_js_mirror()` / the `__main__` block - wherever it's actually consumed).
- If the helper runs somewhere the repo layout doesn't exist (e.g. someone invokes the
  generator inside the image), let it raise with a CLEAR message - do NOT return a fallback
  path (no-silent-fallbacks rule). Import of the module itself must never touch the filesystem
  layout.
- Sweep for siblings: grep the backend for other module-level `parents[N]`/`__file__`-relative
  path escapes above the `app/` package root that would break under `/app/app/...`
  (at filing, `intro_card_geometry.py:596` is the only `parents[4]`; verify nothing else
  assumes repo-depth at import).

### B. Regression guard

The failing geometry is "module imports fine at repo depth, dies at image depth", so a normal
unit test can't catch it by importing. Options for the implementer (pick at least the first):

1. **Direct unit guard on the mechanism:** a test that asserts importing
   `app.services.intro_card_geometry` and `app.services.player_intro` does no repo-root path
   derivation at import time - simplest form: copy the module into a temp dir 2 levels deep
   and importlib-load it (it should import; calling the generator there should raise the clear
   error). This pins the lazy-path property directly.
2. **Smoke test at the seam:** extend the serve-time compose test to assert
   `_try_build_intro_card` produces a segment (not None) for a stock card - already covered
   locally; the gap is layout, not logic. So option 1 (or the live matrix in C) is the real guard.

### C. Live verification matrix (explicit user requirement)

> "the AI should drive Playwright to look at preview, shared link, copy link, and download for
> all reels to ensure the intro card is expected and consistent."

Drive the app AS the real account (drive-app-as-user skill / staging `dev-login` with
X-Test-Mode - the filing repro proves this works headless against staging) for
imankh@gmail.com / profile 9fa7378c on staging AFTER the fix deploys. For EVERY reel in My
Reels (36 at filing; exactly one - id 38 - has a card attached, the rest must show NO intro
anywhere), verify all four surfaces against the EXPECTED behavior per surface:

| Surface | How to drive | Expected (card attached) | Expected (no card) |
|---|---|---|---|
| Tile hover quick-preview | hover the tile | NO intro (by design - T6860 round 4 pinned this; do not "fix" it) | no intro |
| In-app full play (Play button) | click Play, watch pre-roll | intro pre-roll plays, correct name/facts, then reel | straight to reel |
| Download (kebab -> Download) | trigger download, ffprobe + frame-sample the file | `[intro][reel][outro]`: starts on the card (~4s), correct name, outro at end | `[reel][outro]` |
| Copy link -> shared page playback | copy link, open logged-out, play | intro pre-roll before reel | straight to reel |
| Shared page download | the shared page's download control | composed `[intro][reel][outro]` via `GET /shared/{token}/download` | `[reel][outro]` |

Evidence per criterion: duration arithmetic (reel duration + card duration + 2.4s outro) AND at
least one extracted frame proving the card is visually present at t~1s with the athlete's name.
Frame extraction beats duration alone - this filing found the duration arithmetic muddied by a
stored-vs-actual reel duration mismatch (stored 12.33s vs ~14.4s of footage in the file);
don't let that stall the verdict, the frames are unambiguous.

Also verify at least one no-card reel end-to-end so the matrix proves ABSENCE where absence is
expected, not just presence.

**Prod note:** the intro-card epic has not deployed to prod yet; this fix must land before (or
with) that deploy, and the matrix should be re-run once on prod after that deploy - same
`/app/app` layout, same masked-until-now code path.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/intro_card_geometry.py` - `_JS_PATH` at :595-598 (THE fix site);
  `render_js_mirror()` / `__main__` are its only consumers
- `src/backend/app/services/player_intro.py` - imports geometry at :54 (crash propagation
  point; no change expected)
- `src/backend/app/services/serve_time_video.py` - `_try_build_intro_card` :30-41 (the
  non-fatal swallow that hid this; no change expected, maybe a WARNING-level upgrade note)
- `src/backend/app/services/intro_egress.py` - burn-mode resolver (proven working; no change)
- `src/backend/app/routers/downloads.py` - `download_file` :664 (owner download egress, repro
  endpoint)
- `src/backend/app/routers/shares.py` - `GET /{share_token}/download` :856ish (second burn
  egress, equally broken, must be in the verify matrix)
- `src/backend/tests/` - new regression guard (see B)
- `src/backend/Dockerfile` - `WORKDIR /app` + `COPY . .` (the layout that breaks `parents[4]`;
  reference only, do not change)

### Related Tasks
- T6860 (STAGING) - same user-visible symptom, fixed the two rungs ABOVE this one (R2 transfer
  client, facts freshness). Its round-1 fix is what exposed this crash. This task closes the
  reopened user report.
- T5210 - introduced the line (2026-08-05).
- T5220 - wired the egresses + the non-fatal ladder this hides inside.
- **Adjacent known gap, NOT this task:** the edge share page's footer download anchor
  (`src/frontend/functions/shared/[token].js:239`) still points at the raw `video_url`,
  bypassing intro/outro composition entirely (flagged in
  `docs/testing/release-map-2026-08-10.md` §7). If the Playwright matrix exercises THAT link
  it will fail for a different reason - file/point to a separate task rather than folding it
  in here, but the matrix must note which download control it drove.

### Technical Notes
- Non-fatal-by-design (epic decision 9) is correct and stays; the lesson is T6860's own note:
  "the non-fatal degrade must NOT be the steady state." Consider logging the intro drop at
  ERROR with a distinctive tag (already is) - the real gap is that nothing executes the burn
  path from the deployed layout before a user does.
- The render cache `_CARD_CACHE_DIR` (/tmp/rb_intro_cards) never gets written on Fly today
  (import dies first) - no stale-cache concern from this fix.
- Repro artifacts from filing (staging): downloaded file + frames + captured traceback in the
  filing session's scratchpad; the traceback is quoted in full above - that's the durable copy.
- Staging log buffer is ~100 lines and the machine autosuspends - to catch serve-time logs,
  trigger the request and pull `fly logs --no-tail` within seconds (what worked here).

## Implementation

### Steps
1. [ ] Branch `feature/T6920-intro-card-fly-layout-import`
2. [ ] Make `_JS_PATH` lazy in `intro_card_geometry.py`; clear error if layout absent; sweep
       for sibling module-level repo-depth escapes
3. [ ] Regression guard (B.1): shallow-depth import test for geometry + player_intro
4. [ ] Relevant test set locally (geometry parity, player_intro build, serve_time compose,
       T6860 guards - ~10 tests)
5. [ ] Merge -> staging auto-deploy
6. [ ] Playwright/API matrix (C) against staging as imankh@gmail.com: all 36 reels x
       {hover-preview, full play, download, copy-link playback, shared-page download},
       evidence per criterion (frames + durations)
7. [ ] Mark STAGING; matrix re-run on prod rides the next prod deploy

## Acceptance Criteria

- [ ] `GET /api/downloads/38/file` on staging returns `[intro][reel][outro]` - card visible in
      extracted frames at t~1s with "Mehdi Khabazian", duration ~= 4.0 + reel + 2.4
- [ ] `GET /shared/{token}/download` for a share of reel 38 composes the same way
- [ ] No `[serve_time_video] intro card build raised` lines in staging logs during the matrix
- [ ] Import of `app.services.player_intro` succeeds from a shallow (image-layout) path;
      regression test pins it
- [ ] Full surface matrix (C) green for all reels: intro present on exactly the surfaces that
      should have it, absent everywhere else (hover-preview stays intro-free by design)
- [ ] No-card reels verified intro-free on all surfaces
