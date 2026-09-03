# Game Pools — Multi-Feed Shared Games Epic

**Status:** TODO (design approved 2026-08-19; supersedes the 2026-07-19 "Dual-Camera
Shared Games" draft of this file — same tasks, generalized scope)
**Created:** 2026-07-19 · **Redesigned:** 2026-08-19
**Companion specs (normative):** [UX-SPEC.md](UX-SPEC.md) (every changed screen, exact
copy/classes/states/gestures) · [ALIGNMENT.md](ALIGNMENT.md) (auto-alignment algorithm
cascade + the 2026-08-19 real-file metadata evidence)

## Goal — the value chain

When a player is far from the camera, quality collapses — and the better pixels usually
already exist: the other team's Veo filmed from the opposite side, and three iPhones
caught the goal up close. **A game becomes a pool**: up to 50 contributors (parents from
BOTH teams) add their cameras and phone clips via a simple link; every feed aligns to one
game clock; each family picks the best camera per play of their kid. Competitive white
space confirmed by research: Trace MultiCam is single-team + own-hardware; Veo can't
multi-cam; nobody does cross-team pooled angle-picking.

Value → UX → architecture → task, one line each:

| User value | UX (UX-SPEC §) | Architecture | Task |
|---|---|---|---|
| Single-clip parent can frame directly, and later organize loose clips into a game | see "Captured requirements" above | explicit upload-time affordance (not a silent duration branch) + a real clip-reparenting mechanism (`raw_clips.game_id` is write-once today, T7010) | not yet filed — T7280 superseded 2026-08-20 |
| Simple upload of anything (halves, folders, clips) with no format quiz | §5b optional video, metadata-ordered role chips (Per Half REMOVED — evidence-backed) | client mvhd creation_time parse; role inference; T1180 zero-video exception | T5495 |
| Giant sky-heavy files get cheap | §5b/6b full-screen crop stage, live size/cost | on-device WebCodecs crop re-encode; cropped bytes are the master | T5498 |
| One link in the WhatsApp chat pools everyone's footage | §1 invite (Anyone default, side-tagged optional), §2 status page, §3 join, §4b no-video Annotate | Postgres pool tables + per-side tokens on shares/claim rails; sport + team-name snapshots | T5500 (backend), T5510 (UX) |
| Everyone sees every camera, cheaply and safely | §4 tiles, §6 live-sync poll | reference propagation (global blake3 media), per-feed storage refs, rent enforcement at presign | T5520 |
| Feeds just line up | §7 line-up view + waveforms; badges | ALIGNMENT.md cascade: fingerprint primary, metadata seed (order-only for export stamps), manual authoritative | T5530 |
| Pick the right camera at any moment | §6 lanes (packed clips), Main default, prefer pill | wall-clock mapping; feed_preferences (member-local) | T5540 |
| The clip exports the best pixels | §8 per-clip picker (full-coverage only) | raw_clips.feed_id + feed_time_map export twin | T5550 |
| Keep only what's worth paying for | §9 keep checklist | per-feed hash-selective extend; per-member rent | T7300 |
| Heavy pools stay fast | §5b dual-asset note | .LRF/generated proxies; preview = proxy, export = master | T7310 (evidence-gated) |
| The app suggests the better camera | §6 Main upgrade to "Auto" | per-source movement profiles (blake3-keyed) | T5560 (blocked by T5460) |

## Captured requirements (not yet assigned a task)

- **Single-owner multi-feed: "Add a video" to MY OWN game, no pool required (2026-09-03,
  user directive).** The user's stated design: a game owner can add additional overlapping
  videos to an existing game (e.g. a full Veo recording plus several iPhone captures of
  the same match); the app figures out the timestamp and lays each video over the
  Veo/Trace reference in a SEPARATE LAYER; when annotating a clip where multiple feeds
  cover the moment, the user chooses which feed. The mechanics are already this epic's
  core (T5530 alignment, T5540 lanes, T5550 per-clip picker) - the DELTA this directive
  adds is scope: none of it may require pool sharing. Today T5510 scopes the entry
  "ONLY inside the Share game modal"; amend at design time so a plain "Add Video" on the
  owner's own game tile/Annotate surface creates additional feeds on a private,
  never-shared game (feeds decouple from "contributors"; a single member owning N feeds
  is the base case, the pool is the multiplayer extension). Fold into T5495/T5510's
  design pass rather than filing a separate task; UX-SPEC needs a section for the
  owner-only entry. Related: the First Reel Funnel epic's T8500 reorders the SAME Add
  Game modal earlier and must stay rebase-friendly with this.
- **Explicit, visible single-clip-vs-full-game choice at upload time (2026-08-20, user
  decision).** T7280 ships as originally scoped — silent duration-based fast path +
  post-hoc inline notice in Framing ("jumped to framing · Treat as full game") — but the
  user is open to a friendlier communication pattern: a lightweight toggle/choice
  surfaced IN the upload modal itself ("What is this? Full game / Single play to frame"),
  duration-defaulted so most people never touch it, rather than inferred silently and
  only surfaced after the fact. Natural home: **T5495** (Add Game overhaul already
  reworks this exact modal for optional-video/folder/role-chip upload) — fold this in
  when T5495 is designed rather than treating it as a separate task.
- **Reorganizing standalone single-clip uploads into a shared/target game later (2026-08-20,
  user decision).** The user explicitly does NOT want this rushed into T7280 — "I'm
  totally in line with integrating this requirement into the Game Pools epic instead of
  quick deploying it." Real constraint: `raw_clips.game_id` is write-once by design (T7010
  — prevents silent game misattribution), so this is a genuine reparenting/merge
  mechanism, not a UI tweak. T7280's fast path already gives every single clip its own
  lightweight game container underneath (same upload pipeline), so nothing is lost by
  waiting — those per-clip game containers are valid future merge targets. Closest
  existing task: **T5520** (upload binding + feed propagation) or **T5500** (pool entity
  backend) — neither currently covers "merge an existing standalone game's clip into
  another game," so this needs explicit design attention (likely a new task) when those
  are picked up, not an assumption that feed-propagation covers it for free.
- **Upload Failure Integrity epic overlap (filed 2026-08-24, P1 active outage — see
  tasks/upload-integrity/EPIC.md).** T7280's eventual successor (the explicit-affordance
  single-clip-upload task above) lands on the SAME upload entry point and the same file
  (`uploadManager.js`) that epic is fixing (failure handlers no longer cascade-delete user
  content; server-side lifecycle logging; client failure beacon). When that successor task
  is designed, confirm the upload-integrity epic has landed first and reuse its guard
  pattern rather than re-introducing a new failure path that can destroy a single-clip
  upload's just-created game the same way T7470 found for full-game uploads.

## Non-Goals (this epic)

- **Shared annotations.** Each family annotates in their own account; clip sharing stays
  on the existing teammate-share rails. Nothing reads/writes another user's annotations.
- **Push infrastructure.** Freshness is a poll while a pool game is open (~60s + focus +
  after own writes) — good enough for "his upload appeared while I annotate."
- **Multi-camera auto-cut reels.** T5560 only suggests/switches during playback.
- **Refund mechanics.** Upload charge is not auto-refunded on withdraw (stated honestly
  in the confirm; product knob, revisit if it stings).

## Architecture Decisions (settled; task files reference, don't duplicate)

1. **Coordination in Postgres, truth-per-family in profile SQLite, bytes on R2.**
   Pool tables: `shared_games` (invite tokens PER SIDE, side names, sport snapshot,
   wall-clock origin as a STORED CONSTANT), `shared_game_members` (cap 50, side,
   joined_at), `shared_game_feeds` (owner, kind full|clip, label, withdrawn/delisted),
   `shared_game_feed_videos` (sequence, blake3, wall_offset + source + confidence +
   `updated_by`/`updated_at` audit columns, creation_time). `shared_game_members` also
   carries `pool_seen_at` (bumped by the open-game gesture; powers the new-camera dot and
   the re-line-up toast — deliberately NOT `games.last_accessed_at`, which presigns also
   bump). Offsets are written PER VIDEO. Each member keeps a normal private `games` row
   (their name, clips, reels) linked by `games.shared_game_id`; the member's
   **preference spans live in their OWN profile.sqlite** (`feed_preferences`, T5540's
   migration — member-scoped by construction, never pool state). ("No new Postgres
   state" was a lifecycle-drip-scoped directive, corrected by the user 2026-08-19 — not
   a rule here.)
2. **Feeds propagate as references, never copies.** Sources are globally
   content-addressed (`games/{blake3}.mp4`); joining/refreshing materializes
   `game_videos` reference rows (new `feed_id` axis, uniqueness `(game_id, feed_id,
   sequence)`) + per-hash `game_storage` refs, head-guarded (T4820). Provenance
   `shared_by` stamps join-created rows (quest-blind, T5330); uploading your OWN feed to
   a pool is a genuine `upload_game`.
3. **One shared wall-clock, per-video offsets** (unchanged from the July draft — it
   survived N feeds and short clips without modification). Coverage = `[offset,
   offset+duration]`; clips are just short feeds. Clock origin = creator's first
   full-length feed; clips-only pools get a provisional origin re-anchored by a constant
   shift when the first full feed arrives.
4. **Alignment: audio is the compelling default; metadata seeds; humans stay
   authoritative.** Full cascade + evidence in ALIGNMENT.md: per-source cached artifacts
   (envelope + fingerprints, blake3-keyed), fingerprint coarse match + GCC-PHAT refine,
   confidence gates, transitive cross-validation. Real-file evidence (prod + local)
   binds two rules: export-rendered files stamp RENDER time (order-only, never seed
   windows/offsets) and `File.lastModified` is banned. Manual line-up (waveform strips,
   whistle anchor, ± nudge, any lined-up camera as the comparison side) writes
   `source='manual'`, never overwritten by auto.
5. **Rent model.** Uploader pays the initial 30-day window (covers the whole pool —
   refs copy the uploader's expiry, teammate-share precedent). After that, continued
   access is per-member per-feed with their own credits; access = your OWN live refs
   (today's `storage_status` semantics, enforced at the media presign path, not just
   UI). Object reclaim only when NO live refs remain anywhere + grace; the sweep's
   authoritative recount must provably cover cross-ACCOUNT refs.
6. **Names are perspectives.** The pool stores canonical facts (sides, date); each
   member's `games.name` derives from their claimed side (invert Home↔Away only for
   other-team joiners; same-team inherits verbatim) and stays freely editable. The
   sharer's team name is captured at share time when missing (saved to their profile +
   the pool side; becomes cross-team joiners' opponent prefill).
7. **Reuse the share/claim machinery** (tokens on `shares.py` rails, claim survives
   signup via the URL-path token, T5730/T2915 patterns) and the materialization
   primitives (`_insert_game_with_videos`, provenance stamping).
8. **Progressive disclosure is a hard requirement.** A basic user (1 game, 1 video) sees
   ZERO new pool chrome (the invite lives inside the Share modal they already open);
   lanes/picker appear only at ≥2 feeds; alignment/manage surfaces sit behind the
   unaligned badge and Manage cameras. §5b's upload upgrades (optional video, folder,
   crop, role chips) are general features for everyone, deliberately outside that claim.
9. **Vocabulary is product surface:** "shared game", "camera", "clips", "line up" —
   never feed/pool/sync in UI (one sanctioned "Auto-synced by sound" banner). "Main" is
   the honest name for the default camera until T5560 earns "Auto". **One concept, one
   name in code too:** route `/shared-game/{token}`, API `/api/shared-games`, tables
   `shared_games*` — "pool" never leaves internal prose.
10. **Movement profiles are per-source (blake3-keyed)** — computed once, valid for every
    account referencing the source; T5560 gets other members' profiles for free
    (coordinate keying with T5460 NOW).

## Tasks (strict order; each hands learnings to the next)

| ID | Task | Status |
|----|------|--------|
| T7280 | Single-clip upload straight to Framing — SUPERSEDED 2026-08-20, folded into this epic (see "Captured requirements" above) instead of shipping standalone; a proper task is not yet filed | SUPERSEDED |
| T5495 | [Add Game overhaul: optional video, folder upload, metadata-ordered role chips, Per-Half removal](T5495-add-game-overhaul.md) | TODO |
| T5498 | [Crop-before-upload: full-screen client-side stage](T5498-crop-before-upload.md) | TODO |
| T5500 | [Pool entity + invite/join backend](T5500-shared-game-backend.md) | TODO |
| T5510 | [Invite, status page, join + no-video Annotate UX](T5510-create-join-ux.md) | TODO |
| T5520 | [Upload binding + feed propagation + rent enforcement + live sync](T5520-upload-binding-propagation.md) | TODO |
| T5530 | [Feed alignment: autosync + line-up view](T5530-time-alignment.md) | TODO |
| T5540 | [Annotate camera lanes + Main + preference pill](T5540-annotate-camera-toggle.md) | TODO |
| T5550 | [Per-clip camera picker + extraction from the picked feed](T5550-clip-from-active-camera.md) | TODO |
| T7300 | [Per-feed keep checklist (rent UX)](T7300-per-feed-keep-checklist.md) | TODO |
| T7310 | [Preview proxies (evidence-gated on real pools feeling slow)](T7310-preview-proxies.md) | TODO |
| T5560 | [Auto best-camera suggestions](T5560-auto-best-camera.md) | BLOCKED by T5460 + T5540 |

Dependency notes: T7280/T5495/T5498 are pool-independent (T5495 before T5510 because the
pool upload modal builds on the reworked Add Game). T5550 is the only export-pipeline
task; T5540 ships user value without it. T7310 gates on evidence, not order.

**Named prerequisites OUTSIDE the epic (user-approved 2026-08-19):** T6770 (derived
ref-set — the rent model multiplies the ref population the drifting counter guards) and
T6780 part B (unguarded materialization writes — the join flow reuses that path) land
BEFORE T5520; T7140 (faststart remux, Modal-dispatch) lands first anyway per standing
order and provides the upload-post-processing Modal rail that `align_feed` (T5530) and
T7310 ride.

## Completion Criteria

- [ ] A parent can create a game with or without video, copy ONE link, paste it in
      WhatsApp; anyone with it can join and upload (cap 50), including through signup
- [ ] Side-tagged links flip the game info correctly; joiner's game derives its name
      from their side and stays editable; sharer's missing team name is captured once
- [ ] Halves/folders/clips upload without a format question; roles inferred from
      metadata, always editable; ≥4K sources get the client-side crop stage
- [ ] Every feed lands on the shared clock: auto by audio where possible, honest badges
      and a manual line-up path everywhere else; offsets never fabricated
- [ ] Lanes/picker appear only at ≥2 feeds; clips pack into minimal lanes; Main plays a
      complete game with zero configuration; per-clip picks export the picked pixels
- [ ] Rent enforced at the media path: initial window covers the pool, then per-member
      per-feed renewal via the keep checklist; reclaim only at zero live refs + grace,
      verified cross-account
- [ ] Live sync: another member's upload appears while annotating (poll), never a reload
- [ ] Basic users see zero new pool chrome anywhere (audited, not asserted)
- [ ] Migrations (postgres pool tables + profile_db feed columns) runnable via the admin
      endpoint; version numbers checked against sibling branches
- [ ] `.claude/knowledge/` docs updated (annotate.md, backend-services.md,
      persistence-sync.md, export-pipeline.md, modal-gpu.md for the alignment job)

## References

- Normative UX: [UX-SPEC.md](UX-SPEC.md) (screen-by-screen; changelog documents every
  design round). Mockups artifact kept in lockstep (session artifact, 2026-08-19).
- Alignment algorithm + evidence: [ALIGNMENT.md](ALIGNMENT.md)
- Sharing rails: `shares.py`, `materialization.py`, T5720/T5730 (game_link + claim)
- Multi-video timeline: `useVirtualTimeline.js`, annotate.md knowledge doc
- Upload/dedupe: `games_upload.py` (blake3 multipart; pending_uploads cancel rail)
- Storage/credits/expiry: `storage_credits.py`, `sweep_scheduler.py` (ref_count drift —
  the recount is load-bearing), credits in Postgres (T5840)
- Prepare-stage epic (T5650 study, T5651–T5657): the §5b folder/crop/dual-asset work
  pulls its locked decisions forward; reconcile scopes when picking those tasks up
- Movement profiles: movement-tracking epic (T5460 keying)
