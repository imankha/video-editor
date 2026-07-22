# Dual-Camera Shared Games Epic

**Status:** TODO
**Started:** —
**Created:** 2026-07-19

## Goal

At most youth games there are TWO cameras — one parent per team — usually standing right next
to each other, each operator following their own kid's side of the action. Today each family
only ever sees their own footage, so action on the far side of the field is compressed mush
(the exact problem the Upscale Quality epic fights pixel-by-pixel; this epic fights it at the
source: *someone else already filmed that moment better*).

The feature: the parent who sets up a camera creates a **Shared Game** (name, date, time,
location), gets a link, and texts/emails it to the other team's camera parent. Each side
uploads their own footage to the shared game from their own account. In Annotate, each user
can **toggle between the two cameras** at the same game moment. Once the Movement Tracking
epic lands, the system can **suggest (and auto-switch to) the better camera** for any given
timestamp.

Side effect that matters: every shared-game link is an organic acquisition channel — the
other team's parent has to sign up to join. This is the first feature where inviting a
stranger (not a teammate) is the core loop.

## Non-Goals (this epic)

- **Shared annotations.** Each parent annotates their own kid in their own account. Clip
  sharing between accounts stays on the existing teammate-share rails. Nothing in this epic
  reads or writes another user's annotations.
- **More than 2 cameras.** Schema allows N members, product caps at 2 for now.
- **Auto-trim / auto-editing across cameras.** T5560 only *suggests/switches* during
  playback; multi-camera auto-cut reels are a future epic.
- **Live/near-real-time collaboration.** Propagation of the other camera is
  refresh-on-load, not push.

## Architecture Decisions (reference from task files, don't duplicate)

1. **Coordination in Postgres, playback data local.** The Shared Game is a small Postgres
   coordination object (`shared_games` + `shared_game_members` + `shared_game_videos`,
   T5500) — cross-account state MUST live in Postgres (per-user SQLite is per-account by
   construction). Each member keeps a **normal local game row** in their profile DB; it is
   the single source of truth for that member's annotations, clips, and reels, linked by
   `games.shared_game_id`.
2. **The other camera propagates as references, never copies.** Game sources are globally
   content-addressed (`games/{blake3}.mp4`, no env/user prefix). Registering the remote
   camera into a member's account = inserting `game_videos` rows (with `camera` set) +
   `game_storage_refs` for the remote blake3 keys — the same T2830/T2850 game-reference
   mechanism teammate shares use. R2 holds ONE copy of each source regardless of how many
   accounts reference it.
3. **`camera` is a new axis on `game_videos`, orthogonal to `sequence`.** `sequence` remains
   "halves concatenated in time" within one camera; `camera` = the shared-game
   `member_index` that uploaded it (0 = creator, 1 = joiner; plain non-shared games are all
   `camera 0`). Local schema: `game_videos.camera INTEGER NOT NULL DEFAULT 0`, uniqueness
   `(game_id, camera, sequence)` (profile_db migration in T5520). A member's **primary
   camera** is their own `member_index`; if they haven't uploaded yet, the only camera
   present is primary-by-default.
4. **Time model: one shared wall-clock, per-video offsets.** Each `shared_game_videos` row
   carries `wall_offset` = seconds on the shared game clock at which that video's t=0
   occurs (slot-0's first video defines wall_offset 0 by convention). This ONE model
   handles per-half videos, different recording start times, and one camera rolling through
   halftime while the other stops — no special cases. All cross-camera mapping is:
   `virtual t → (video, local t) → local t + wall_offset = shared t → containing video on
   the other camera → its virtual t`. No containing video = a **coverage gap** (toggle
   disabled/clamped there).
5. **Annotations stay keyed to the member's primary-camera virtual timeline.** The
   `(game_id, end_time, video_sequence)` natural key and every existing clip flow are
   untouched by camera toggling; viewing another camera is a *display mapping*. The ONE
   deliberate extension is T5550: `raw_clips.camera` stamps which camera a clip should be
   **extracted** from (you clip what you were looking at), with times still stored in
   primary-camera terms and mapped at export time.
6. **Alignment is gesture-persisted and shared.** Audio cross-correlation *suggests* the
   offsets (the two cameras stand next to each other — near-identical audio makes this
   unusually reliable); a human confirms/nudges; the confirmed offsets are written to
   Postgres via a surgical endpoint from the confirm gesture (never reactively). Either
   member may re-adjust; last write wins.
7. **Reuse the share/claim machinery, don't parallel-build.** Invite tokens follow the
   `shares.py` token pattern; the no-account join path follows the
   `pending_teammate_shares` / T2915 link-snapshot deferred-resolution pattern; the join
   materialization routes through the T2830/T2850 game-reference helper and stamps
   `shared_by` provenance exactly like `materialize_game_share` (T5330 NUF-blindness).
   **Coordinate with the Share the Game epic** (T5720 public game link + T5730 claim flow,
   which superseded T4910): whichever lands first owns the token-landing-claim plumbing; the
   other reuses it.
8. **Quest provenance nuance:** a game row created at *join* is shared-in content
   (`shared_by` set — onboarding stays blind to it, T5330). But a member later uploading
   their OWN camera to that game is a genuine upload and SHOULD count for `upload_game`.
   T5500's design doc must settle the mechanism (recommended: quest probe counts games
   having ≥1 `camera = own member_index` video, independent of `shared_by`).
9. **Expiry:** each member holds their own `game_storage_refs` for both cameras' sources; a
   source is reclaimable only when NO live refs remain (verify against the sweep — T4820
   lesson: status must track R2 reality; guard ref insertion with `head_object`).
10. **Movement profiles are per-source, keyed by blake3** (coordinate with T5460 so the
    artifact key is source-addressed): computed once, valid for every account referencing
    that source — the auto-best-camera comparison (T5560) gets the second camera's profile
    for free.

## UX Flows (settled here; UI Designer refines visuals per task)

1. **Create** — entry points: (a) the Add Game flow ("Two cameras at this game? Invite the
   other team's camera") and (b) an existing game card's menu ("Invite the other camera",
   pre-fills metadata and binds that game as slot 0). Modal collects: game name (required),
   date (required, default today), time + location (optional). Result screen = share sheet:
   `navigator.share` on mobile, copy-link fallback, prefilled message ("Join my ReelBallers
   shared game: {name}, {date} — upload your camera and we both get both angles").
2. **Join** — `/shared-game/{token}` shows a game-info card (name, date/time, location,
   creator's display name, camera slots + status) with one CTA: signed-in → "Join this
   game"; signed-out → sign-up/sign-in, claim completes after auth (deferred resolution).
   Optional (stretch, reuse T4840/T4890 patterns): edge-rendered OG unfurl so the text
   message shows the game name/date.
3. **Slots** — both members see the shared game as a normal game card plus a two-row camera
   status block: "Your camera — 2 videos ✓" / "Sam's camera — waiting". Upload CTA routes
   through the EXISTING Add Game upload path bound to the shared game + own slot.
4. **Sync** — once both slots have video and offsets are unconfirmed, the game card and
   Annotate show a "Sync cameras" banner → auto-suggestion runs → side-by-side confirm UI
   at one shared moment with a ± nudge control → Confirm persists offsets.
5. **Toggle (Annotate)** — a flip-camera button in the player controls + `C` keyboard
   shortcut; switch preserves the playhead via the wall-clock mapping; when the other
   camera has no coverage at the playhead the button is disabled with a tooltip ("Sam's
   camera doesn't cover this moment"). Toggle is session state, never persisted
   (no-persisted-view-state rule).
6. **Best camera (post-Movement-Tracking)** — a subtle "better angle available" badge on
   the toggle when the other camera's activity score meaningfully beats the current one,
   plus an opt-in "Auto camera" mode during playback that switches at state boundaries.

## Tasks (implement strictly in order — each builds on the last)

| ID | Task | Status |
|----|------|--------|
| T5500 | [Shared Game Entity + Invite/Join Backend](T5500-shared-game-backend.md) | TODO |
| T5510 | [Create + Join UX](T5510-create-join-ux.md) | TODO |
| T5520 | [Upload Binding + Cross-Account Camera Propagation](T5520-upload-binding-propagation.md) | TODO |
| T5530 | [Camera Time Alignment (audio auto-suggest + manual confirm)](T5530-time-alignment.md) | TODO |
| T5540 | [Annotate Camera Toggle](T5540-annotate-camera-toggle.md) | TODO |
| T5550 | [Clip Extraction From the Active Camera](T5550-clip-from-active-camera.md) | TODO |
| T5560 | [Auto Best-Camera Suggestions](T5560-auto-best-camera.md) | TODO |

Dependency notes: T5560 is additionally **BLOCKED by T5460** (Movement Tracking Modal job —
per-source profiles). T5550 is the only task that touches the export pipeline; T5540 ships
user value without it (view-only toggle).

## Completion Criteria

- [ ] A user can create a shared game, send the link, and the other parent can join
      (including the no-account → sign-up path)
- [ ] Both members upload their own footage; each sees both cameras on their game
- [ ] Cameras are time-aligned (audio auto-suggest verified, manual nudge works)
- [ ] Camera toggle in Annotate preserves the game moment; coverage gaps handled gracefully
- [ ] Creating a clip while viewing camera B extracts camera B's pixels
- [ ] (Post-T5460) Better-camera badge + auto-camera playback live behind profile presence
- [ ] Migrations for all three schema changes runnable via admin endpoint
- [ ] `.claude/knowledge/` docs updated (annotate.md, backend-services.md,
      persistence-sync.md, modal-gpu.md if T5560 touches profile keying)

## References

- Sharing rails: `src/backend/app/services/pg.py` (`shares`/`share_games`/
  `pending_teammate_shares` DDL), `src/backend/app/routers/shares.py` (token pattern),
  `src/backend/app/services/materialization.py` (provenance), T2830/T2850 game-reference
  helper, T2915 link-snapshot pattern, [Share the Game epic](../team-game-share/EPIC.md)
  (T5720/T5730 — overlapping token/claim plumbing; superseded T4910)
- Multi-video timeline: `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js`
  (`buildFullVideoTimeline`), [.claude/knowledge/annotate.md](../../../.claude/knowledge/annotate.md)
- Upload/dedupe: `src/backend/app/routers/games_upload.py` (blake3 upload/finalize)
- Movement profiles: [movement-tracking/EPIC.md](../movement-tracking/EPIC.md) (artifact
  format, T5460 keying)
- Audio alignment: cross-correlation of audio RMS envelopes (scipy.signal) — see T5530 for
  the validation protocol
