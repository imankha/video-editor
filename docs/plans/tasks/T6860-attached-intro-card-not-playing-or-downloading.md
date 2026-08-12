# T6860: Attached intro card neither plays back in-app nor appears in the download

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-08-11
**Updated:** 2026-08-11

## Problem

User report (2026-08-11, top priority for Deploy Candidate): after attaching an intro card
to a reel, the intro does not appear at EITHER egress:

1. **In-app playback** — playing the reel back does not show the intro (T6700/T6710
   IntroPreRoll / IntroStoryPlayer surface)
2. **Download** — the downloaded MP4 does not contain the composed intro (T5220's
   intro+outro single-pass ffmpeg compose)

Reported as two bugs, but both egresses sit downstream of the SAME attach + resolve chain
(`final_videos.intro_card_id` -> `resolve_intro_card_id`/`resolve_intro_for_reel`), so
triage must first establish whether this is one upstream fault (attach never persisted, or
resolution returns None) or two independent downstream faults. Do not assume either.

## Triage order (cheapest discriminator first)

1. **Environment migration state.** Every intro read is `column_exists()`-guarded and fails
   QUIET to no-intro (deploy->migrate window tolerance). If the env where this reproduces
   has not had `POST /api/admin/migrate` run since the intro-epic deploys (needs profile_db
   >= v034 for `final_videos.intro_card_id`, v035+ for intro_cards fields), the entire
   feature silently no-ops while looking healthy. Check `PRAGMA user_version` on the
   affected profile DB first — this alone could explain both symptoms.
2. **Did the attach persist?** After the picker gesture, read the reel's row:
   `SELECT intro_card_id FROM final_videos WHERE id = ?`. If NULL, the bug is the attach
   write path (picker -> PUT), and both symptoms are one bug. Note post-T6680 semantics:
   NULL = no card (no inherit), 0 = explicit opt-out, id = attached.
3. **Does resolution resolve?** `resolve_intro_for_reel` (intro_egress.py:141) ->
   `resolve_intro_card` (intro_cards.py:292). Dangling id (card deleted) logs
   `[intro] ... missing intro_card` and resolves None — check backend logs for that
   warning. T6680 removed the duration gate, so a short clip should NOT suppress an
   explicit attach — if evidence shows a duration gate still firing anywhere on the
   explicit path, that's the bug (and relates to T6850's dead-setting removal).
4. **Then split by egress** only if 1-3 are clean:
   - Playback: DownloadsPanel play -> IntroPreRoll/IntroStoryPlayer (T6700 swap /
     T6710 composite). Does the share/download payload carry the resolved intro
     (`resolve_intro_for_reel` output) to the frontend? Known adjacent history: T5220's
     autoplay-resume bug, T6730's false no-op report (measurement artifact) — verify in a
     real browser, not jsdom (standing rule for player/pointer behavior).
   - Download: `routers/downloads.py` composed-download path (~687-720, ~856-874) —
     confirm the compose actually receives a non-None intro and that the composed variant
     (not the raw file) is what gets served.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/intro_egress.py` — `resolve_intro_for_reel` (141)
- `src/backend/app/services/intro_cards.py` — `resolve_intro_card_id` (173),
  `resolve_intro_card` (292)
- `src/backend/app/routers/downloads.py` — reel payload intro fields (~239-240, ~568-585),
  composed download (~687-720, ~856-874)
- `src/frontend/src/components/DownloadsPanel.jsx` — in-app play entry
- `src/frontend/src/components/IntroPreRoll.jsx` / `IntroStoryPlayer` /
  `useIntroPlayback.js` — playback pre-roll surface (T6700/T6710/T6730/T6740 files)
- Attach write path: the reel intro picker (T5215) -> wherever it PUTs
  `final_videos.intro_card_id` (confirm during triage)

### Related Tasks
- T5215 (attachment + resolution), T5220 (egress integration), T6680 (explicit-only
  pivot — most recent semantics change on this exact path, merged 2026-08-09 ahead of
  hands-on retest), T6700/T6710 (owner playback intro), T6730 (prior "intro seek" report
  that proved a measurement artifact — do NOT assume this report is the same; it names a
  different failure: intro never appears at all)
- T6850 (Deploy Candidate) — if triage finds a live duration gate, these tasks touch the
  same code; sequence them deliberately

### Technical Notes
- Which environment the user saw this on is UNCONFIRMED (local dev / staging) — establish
  it first; it decides whether step 1 (migration state) is even in play.
- Repro account: user's own (imankh@gmail.com, profile 9fa7378c) — use `loginAsRealUser`
  (dev-login) per drive-app-as-user skill for a faithful repro.
- Both fixes (if two) need live-browser evidence per criterion, not just unit tests —
  this epic's history (T5220, T6730) shows both false positives and false negatives from
  synthetic checks.
- M-tier default pipeline; escalate to the expert agent if the first focused fix attempt
  fails (standing rule).

## Implementation

### Steps
1. [ ] Establish env + migration state; repro as the real user, capture
       `final_videos.intro_card_id` after attach + backend logs
2. [ ] Localize: one upstream fault vs two egress faults (triage order above)
3. [ ] Failing test(s) reproducing the fault(s) at the right layer
4. [ ] Fix; live-browser verify BOTH egresses (play shows intro; downloaded file opens
       with the intro composed)
5. [ ] Relevant test set + lint green

### Progress Log

**2026-08-11**: Filed from user report; placed top of Deploy Candidate (user-ordered).

**2026-08-11 (triage v1 — WRONG ENV, superseded):** I first checked PRODUCTION and
found prod profile `9fa7378c` at `PRAGMA user_version=33` (below the intro epic's v034
floor). That is real but IRRELEVANT: the entire Athlete Intro Card epic is **not
deployed to production** (last prod deploy `bce639d0`, 2026-08-03, predates every intro
commit — see `docs/testing/release-map-2026-08-10.md`). The user does not test prod.
Disregard the production-migration framing entirely. (Committed as 28f0f146; kept only
for history.)

**2026-08-11 (triage v2 — STAGING, verified live):** The user tests **staging**
(`https://app-staging.reelballers.com`, API `reel-ballers-api-staging.fly.dev`). I
live-drove the real staging server (running commit `95632aa7` = master HEAD) as the
real user via `dev-login` (email imankh@gmail.com, profile 9fa7378c). Findings:

- **Migration/resolution OK on staging.** Staging profile DB is at v42; reel id=38 has
  `intro_card_id=1` ("New card 1", real 1070x1440 photo, treatment gold, shown_fields
  [position, team], subtitle "State Cup"). `GET /api/downloads` shows
  `intro_card_name: "New card 1"`, `resolved_intro_has_photo: true`.
- **PLAYBACK egress WORKS on the server.** `GET /api/downloads/38/intro-playback` and
  the single-reel share `GET /api/shared/{token}` both return a valid intro payload
  (card + `previewUrl` + field_values {position CAM, class 2031, team West Coast ECNL,
  full_name Mehdi Khabazian}).
- **DOWNLOAD egress BROKEN — reproduced live (this is the real bug).**
  `GET /api/downloads/38/file` returns a **16.833s** MP4 = raw reel **12.333s + outro
  4.5s**, with **NO intro** (should be 20.833s with the 4.0s intro). Frame at t=1.0s is
  reel footage; t=14s is the "Made with Reel Ballers" outro. The single-reel **share
  download** `GET /api/shared/{token}/download` is byte-identical (outro-only). So BOTH
  burn/download egresses drop the intro; BOTH playback egresses keep it.
- **Localized to the server-side BURN path** (`resolve_intro_for_reel(mode="burn")` ->
  `_download_card_image` -> `player_intro.build_intro_card` -> `compose_serve_time`).
  Playback uses `mode="playback"` (presign only) and works; burn downloads the image
  bytes + renders the card, and fails. The outro (also ffmpeg, /tmp cache, but text-only,
  no R2 image download) composes fine.
- **NOT ffmpeg/data/fonts/cache.** The identical code + identical R2 data + identical DB
  produce the intro correctly in a non-Fly container (`compose_serve_time` -> 20.833s,
  3 segments), under BOTH ffmpeg 7.1.5 AND a static ffmpeg 5.1.1 (Fly's Debian-12
  version). Fonts are bundled in the image; both card caches are under `/tmp` (writable).
  So the fault is **Fly-runtime-specific**.
- **Fast-failure signal.** The composed download returns in **~1 second** (outro is a
  cache hit), i.e. the intro build failed BEFORE its multi-second libx264 encode — a
  PRE-encode failure (image byte-download or layout resolution), not a mid-encode OOM;
  the request still 200s (non-fatal degrade), so the machine did not crash.
- **Cannot obtain the Fly server-side error in-container** (no fly CLI/token, no
  docker). Leading hypotheses: (i) `download_from_r2_global` via `get_r2_transfer_client()`
  failing on Fly; (ii) `_get_or_build_card`/`_frame_photo` raising fast on the server
  for a photo+facts card. Expert consult requested for the verdict + fix. Supervisor can
  confirm instantly by grepping the staging logs for `[intro_egress] card image download
  failed for reel_id=38`, `[PlayerIntro] card build failed`, or `[serve_time_video] intro
  card build`.

**Root cause named (per triage step 6):** ONE downstream fault at the **download/burn
egress only** — the intro card build fails on the Fly staging runtime (pre-encode),
degrading non-fatally to no-intro; playback/resolution are healthy. Exact Fly mechanism
pending the server log line above.

**2026-08-12 (round 2 — same reel, DIFFERENT card per egress):** after the R2-sync-client
fix (30f6c08f) made the intro appear in downloads, the user caught a second bug live: the
downloaded card showed a STALE athlete name ("Jordan Vega") while in-app playback showed
the CURRENT name ("Mehdi Khabazian") for the same reel (id=38, card 1).

- **NOT a cache-key bug** (the report's guess): I empirically computed the burn render
  cache key (`player_intro._content_hash`) for the same card with full_name "Mehdi" vs
  "Jordan" -> DIFFERENT hashes (the rendered title is part of the key). A name change
  busts the cache; a fresh-facts request rebuilds correctly.
- **NOT two resolution paths:** both egresses funnel through
  `intro_egress.resolve_intro_for_reel` -> `_load_field_values`; locally both modes
  resolve the same title.
- **Root cause = a FACTS-freshness asymmetry (expert-validated).** The card TITLE = the
  profile's `full_name`, which lives in **user.sqlite**. The burn egress reads the card
  ROW restore-if-newer (`open_profile_db_readonly` -> `ensure_profile_db_local`) but reads
  the FACTS via the OWNER path `get_user_db_connection` -> `ensure_user_database` =
  restore-if-ABSENT only. So a Fly machine holding a stale local user.sqlite bakes an OLD
  full_name into the (correctly hash-keyed) cached card, while playback -- resolved on a
  different, fresh machine -- shows the current name. Strictly cross-machine (a single
  machine renders identical titles for both modes); surfaced right when 30f6c08f's deploy
  restarted machines and churned the fly_machine_id pins.
- **Fix:** `intro_egress._load_field_values` now calls `ensure_user_database_fresh(user_id)`
  (restore-if-newer, WAL-safe via the sidecar guard, read-only -- no upload) before reading
  facts, so ALL live egresses that share this one seam resolve facts from the same
  R2-current truth as the card row. Degrades to the local copy + logs on R2 error (epic
  dec 9). Verified with REAL staging data: a planted stale local user.sqlite ("Jordan
  Vega", version 1) + newer R2 (708) now resolves "Mehdi Khabazian"; the pre-fix read
  returns the stale "Jordan Vega". Both egress modes resolve the same title.

**2026-08-12 (round 3 — two new reports, BLOCKED on live repro + a product/perf decision):**
Cannot reproduce EITHER in-container: the staging FRONTEND host (`app-staging.reelballers.com`)
does not resolve from the worker (only the fly.dev API + prod `app.reelballers.com` do), the
session cookie is `SameSite=None; Partitioned` scoped to the fly.dev API (blocks cross-origin
localhost driving), and there is no local Postgres to run the full stack. Both reports are
visual/interaction bugs that need the real UI. Findings from code + live API:

- **Report 1 "out of sync between the preview and the play in place".** Two surfaces:
  the editor/picker preview reads facts from the CLIENT `profileStore` (populated by
  `GET /api/profiles`), and play-in-place reads from `GET /api/downloads/{id}/intro-playback`.
  Live API RIGHT NOW: both return identical facts (full_name "Mehdi Khabazian", CAM/2031/West
  Coast ECNL) -> no data desync in the current single-machine state. BUT `/api/profiles`
  (`routers/profiles.py:158-160`) reads facts via `get_all_intro_facts`/`get_all_intro_full_names`
  = restore-if-ABSENT (stale-tolerant) -- the SAME class the round-2 fix just closed for the
  egress, now ASYMMETRIC because `/intro-playback` freshens (be19ef7f) and `/api/profiles`
  does not. So the *facts* aspect of this desync is plausibly the round-2 bug on the profiles
  surface. Two blockers to fixing: (a) UNCONFIRMED that facts (not photo/framing or a
  MotionPreview-vs-IntroCardPreview render-parity difference) is what the user saw -- need a
  side-by-side screenshot; (b) `/api/profiles` is a HOT bootstrap endpoint (every app load /
  profile switch), so adding an R2 HEAD (`ensure_user_database_fresh`) there is a real latency
  tradeoff across the whole app -- a product/perf DECISION, not a clear-cut fix.
- **Report 2 "multiple intro cards attached, should be single".** No code path produces
  multiple: `final_videos.intro_card_id` is a single nullable FK; `set_download_intro` is a
  single UPDATE (replaces); the picker is single-select (`selectedId === card.id`, plus one
  "No intro" tile); playback renders ONE `intro` (IntroStoryPlayer); the ReelTile intro badge
  is a mutually-exclusive ternary (one badge). Live: the profile has exactly ONE card (id=1),
  reel 38 attached to it. The only "multiple cards" mechanism is the LIBRARY growing via the
  inline "New card" create flow (by design) -- likely misread as "multiple attached", OR a
  real UI state I cannot see. Need a screenshot of exactly WHERE the user sees multiple
  (picker highlighting / playback / downloads badge / card library).

## Acceptance Criteria

- [ ] Attaching an intro card to a reel, then playing it in-app, shows the intro pre-roll
- [ ] Downloading that reel yields an MP4 that opens with the composed intro
- [ ] Root cause named in this file (one fault or two — stated explicitly, with evidence)
- [ ] Live-browser + real-file evidence attached for both egresses
- [ ] Tests pass
