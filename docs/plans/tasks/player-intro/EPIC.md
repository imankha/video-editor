# Epic: Player Intro

Let users attach a **broadcast/recruiting-style player intro** to shared collections and
multiclip videos: add a photo + a few facts about their youth player, and we generate an
animated intro card that plays before the footage.

## Design intent (user direction 2026-07-15)

The point is NOT a data readout — it's **cool animation, seeing your kid up close, and a level of
professionalism** that makes the parent proud to share. Motion and polish are the product. The
**pitch/position diagram from the reference is explicitly OUT of scope** — it's not what makes this
feel good. Lean into an animated, photo-forward, professional card. (This same bar — intros,
outros, and spotlights that *animate* and look premium — is the broader direction; see
[Related work](#related-animation-polish).)

## Visual target

Reference: `C:\Users\imank\Videos\Captures\stafford intro.mp4` (~12s: animated card, then a
white-flash cut into the footage). **The reference contains a real minor's photo + PII, so it is
NOT committed to the repo — view the local file.** Take the *look and feel* from it, minus the
pitch diagram:

- **Cut-out player photo, animated as the hero** (background removed — see
  [T5200](T5200-player-cutout.md)): a close-up of the player that moves — slow push-in / Ken Burns
  / reveal — so the kid is front-and-center. This is the emotional core.
- **Gold field with the player's name tiled as a faint watermark** behind, plus diagonal "hazard
  stripe" broadcast accents in the corners.
- **Stats panel that animates in** (condensed uppercase, small-square bullet before the name):
  Name · Positions + jersey numbers ("Midfielder 6,8,10") · Height · Class (grad year) ·
  Current Club (+ role, e.g. "Captain") · High School. Lines can stagger/fade in for polish.
- Ends on a **white flash** transition into the first reel.

## Product flow

1. **Profile → "Add Player Intro"**: user enters player facts + uploads a photo (one-time setup,
   editable). Optional cut-out/outline treatment on the photo.
2. **On "Share collection" or "Create multiclip video"**: an **"Add intro"** toggle. When on, the
   intro card is prepended to the output.

## Key systems map (from the Add Player Intro systems audit — verified against code)

| Area | Reuse | New work |
|---|---|---|
| Profile fields | Finish **T1610** (`user_db.py:76` `_USER_DB_SCHEMA` profiles table + `profiles.py` models/handlers + `profileStore.js`). Today profiles hold only `id,name,color,sport,is_default` — no athlete PII, no photo. | athlete fields + photo key column + `user_db` migration (next ver **v006**) |
| Photo upload | `app/storage.py` R2 helpers (`upload_to_r2`, `generate_presigned_url`), per-profile key scheme `{APP_ENV}/users/{uid}/profiles/{pid}/...` | Small **image**-upload endpoint (the multipart `uploadManager.js` is video/blake3-specific — overkill); new `intro/` per-profile prefix |
| Cut-out photo | — (greenfield; no image processing exists) | Background-removal service ([T5200](T5200-player-cutout.md)) |
| Intro card gen | **`app/services/branded_outro.py`** — `_build_outro_card` (:195) already builds an MP4 from `ffmpeg -f lavfi color + drawtext + overlay`; `_probe_media` (:141), `_concat_copy`/`_concat_reencode` (:265/:288), per-format card cache, **non-fatal contract**. CPU ffmpeg — no Modal/GPU. | Photo+info card builder that concats **card-first** `[card][main]` (outro appends; intro prepends). Optional `zoompan` Ken Burns. |
| Multiclip prepend | `POST /api/export/multi-clip` → `multi_clip.py:1832` → `_export_clips` (:1191) → `concatenate_clips_with_transition` (:1100); toggle at `ExportButtonContainer.jsx:642` | `include_intro`/`intro_profile_id` on the request body; prepend intro segment before concat |
| Collection share | `collections.py:775` create (stores `collection_definition` JSONB) + `:652` resolve (presigns members, playback-composited — no stitched file). Post-roll precedent: `BrandedEndCard.jsx` on player `onEnded`. | intro flag in `collection_definition`; **pre-roll** card in `CollectionPlayer.jsx` (mirror BrandedEndCard). Coordinate with **T4945** (stitched-MP4 collection download, TODO) for the burned-in case. |
| PII / consent | `privacy.py` `POST /export-data` + `DELETE /delete-account` (`_purge_user_data`); `terms_accepted_at` on PG `users`. | **No COPPA/age/consent logic exists today** — highest-risk area ([T5230](T5230-childrens-data-compliance.md)) |

## Shared design decisions (children reference — do NOT duplicate)

1. **Athlete PII lives in `user.sqlite`** (the `profiles` table), NOT the per-profile
   `profile.sqlite`. But intro **media** (photo, generated card) MUST live under a **per-profile
   R2 prefix** or it 404s cross-profile (persistence-sync landmine).
2. **Card generation reuses the branded-outro engine pattern** (CPU ffmpeg, per-format cache,
   probe-match the target reel, non-fatal — a card failure never sinks the export/share).
3. **Gesture-based persistence** (project rule): profile-edit save + photo upload are explicit
   gesture handlers, never reactive effects.
4. **Compliance posture (see [T5230](T5230-childrens-data-compliance.md) for full analysis + cites):**
   - **COPPA most likely does NOT legally apply** — the service is directed at adult parents and
     the child's data is provided BY the parent, not collected FROM the child (FTC: COPPA "does
     not cover information collected from adults that may pertain to children"). We still adopt a
     children's-data security posture because state privacy/biometric laws, GDPR-K, and future
     COPPA 2.0 reach this data, and it's the right thing.
   - **Data minimization > encryption.** The card shows **Class/grad-year, not birthdate** —
     collect **graduation year / age-band, not full DOB**. Only store DOB if a feature needs it;
     if stored, **application-encrypt it** (defense-in-depth on top of R2 SSE).
   - **Encryption at rest:** R2 already encrypts objects at rest (AES-256 SSE) + TLS in transit —
     that is the baseline. App-level encryption is reserved for DOB (if kept). The **photo** can't
     be meaningfully app-encrypted (must decrypt to render/share) — protect via SSE + per-profile
     access control + the public-exposure warning.
   - **The real risk is PUBLIC EXPOSURE**, not storage. Intros embed in publicly shared
     collections/links; name + high school + club + minor's photo combined is doxxing-adjacent.
     Required mitigations: **parental-consent attestation**, a **"this is publicly visible when
     shared" warning**, identifying fields (full name, high school) **optional**, and
     **retention/deletion** wired into `privacy.py`.
   - **Never** run face-recognition/biometric templating on the photos (the 2025 COPPA amendment
     added facial templates to "personal information"; also state BIPA-class laws). Background
     removal ([T5200](T5200-player-cutout.md)) is segmentation, NOT recognition — fine.

## Decisions (settled)

- **Pitch/position diagram: OUT.** Dropped per user direction — it's not what makes the intro
  feel good. Do not build it, not even as a fast-follow.
- **Animation is core, not optional.** The animated photo hero (push-in/reveal) + staggered
  text-in + white-flash out ARE v1 — the value is the motion + polish, so ffmpeg must actually
  animate (zoompan/xfade/enable-time drawtext), not render a static frame. If plain ffmpeg can't
  hit a premium look, evaluate a richer renderer (e.g. a headless-browser/Remotion-style template)
  in [T5210](T5210-intro-card-generation.md).
- **DOB vs grad-year:** **grad-year/age-band only** (see decision #4). Revisit only if a concrete
  feature needs exact DOB.
- **Cut-out approach:** see [T5200](T5200-player-cutout.md) — server-side segmentation model
  (rembg/u2net-class) with "upload an already-cut PNG" as a fallback.

## Related: animation polish

User direction: the same premium-motion bar applies to **intros, outros, and spotlights** — they
should all *animate* and look professional, not static. This epic covers the intro; the siblings
are their own tasks:
- **[T5240](../T5240-animated-branded-outro.md)** — animate the branded outro (currently a
  near-static card) to share the intro's motion vocabulary.
- **[T5250](../T5250-spotlight-animation-polish.md)** — premium entrance/exit reveal for the
  spotlight overlay.

Cohesion goal: a reel that opens with an animated intro, spotlights with a produced reveal, and
closes with an animated outro should feel like one system.

## Child tasks (implement in order)

| Order | Task | What it does |
|-------|------|--------------|
| 1 | [T5190](T5190-athlete-profile-fields-photo.md) — Athlete profile fields + photo upload + consent | Finish T1610 + add athlete fields (name, positions/numbers, height, grad-year, club, role, high school) + photo upload + parental-consent attestation. Foundation data model. |
| 2 | [T5200](T5200-player-cutout.md) — Player cut-out ("player outline") | Optional background-removal so the photo becomes a clean cut-out like the reference. |
| 3 | [T5210](T5210-intro-card-generation.md) — Intro card generation engine | Generate the intro MP4 from fields + (cut-out) photo, reusing the branded-outro card builder; prepend-first concat. |
| 4 | [T5220](T5220-add-intro-integration.md) — "Add intro" integration | Toggle + prepend in multiclip export and collection share (player pre-roll), incl. the public-exposure warning UX. |
| 5 | [T5230](T5230-childrens-data-compliance.md) — Children's-data compliance hardening | DOB encryption (if kept), retention/deletion in privacy.py, consent record, privacy-policy update, biometric-avoidance guardrail. Must ship before the feature goes public. |

Sequencing rationale: data model first (1); the cut-out (2) feeds the card (3); integration (4)
consumes the card; compliance hardening (5) gates public launch and is threaded through 1 & 4.

## Epic completion criteria

- [ ] A user can add player facts + photo to a profile (gesture-saved), optionally cut-out.
- [ ] An intro card matching the reference layout is generated (non-fatal; probe-matched concat).
- [ ] "Add intro" prepends it to both a multiclip export and a shared collection (pre-roll).
- [ ] Compliance: consent attestation captured; grad-year (not DOB) by default (DOB encrypted if
      kept); public-exposure warning shown; intro fields+photo included in privacy export & purge;
      no biometric/face-recognition on photos.
- [ ] Card/intro failure never sinks an export or share.
