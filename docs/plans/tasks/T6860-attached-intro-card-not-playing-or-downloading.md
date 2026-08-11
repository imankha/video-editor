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

## Acceptance Criteria

- [ ] Attaching an intro card to a reel, then playing it in-app, shows the intro pre-roll
- [ ] Downloading that reel yields an MP4 that opens with the composed intro
- [ ] Root cause named in this file (one fault or two — stated explicitly, with evidence)
- [ ] Live-browser + real-file evidence attached for both egresses
- [ ] Tests pass
