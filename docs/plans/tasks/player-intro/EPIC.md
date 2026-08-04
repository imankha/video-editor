# Epic: Player Intro + Rich Text

Let users build a **library of intro cards** — photo + styled text — and attach a chosen card to
any reel or shared collection, with one card set as the profile default. The rich-text system the
cards are built on is **built once and reused** as a text layer on the Overlay timeline.

> **Redesigned 2026-08-03** after user direction. The original epic (2026-07-15) assumed ONE intro
> per athlete, auto-composed from profile fields, burned into a multiclip export. Four of the five
> new requirements break that assumption — see [Redesign delta](#redesign-delta). Visual design
> review + UI mockups: <https://claude.ai/code/artifact/93478a34-c7e5-406f-a56b-3c3724e4b6dd>

## Requirements (user, 2026-08-03)

1. **N intro cards**, stored — each has a title, an image, and user-added text.
2. The user controls the **text, the font, and the font colour**.
3. A **different intro can be attached to every reel or collection**.
4. The user can define a **default** intro.
5. The **text overlay system is reused** in Overlay, where the user selects a range of clips and
   adds that same rich text.

## Design intent (unchanged from 2026-07-15)

The point is NOT a data readout — it's **cool animation, seeing your kid up close, and a level of
professionalism** that makes the parent proud to share. Motion and polish are the product. The
pitch/position diagram from the reference is **out of scope**. Visual reference:
`C:\Users\imank\Videos\Captures\stafford intro.mp4` (~12s: animated card, white-flash into footage).
**The reference contains a real minor's photo + PII, so it is NOT committed — view the local file.**

## Architecture: three layers

```mermaid
graph TB
  subgraph L1["Layer 1 - Text engine (T5180, built once)"]
    TS["TextSpec model<br/>text, font, size, weight, colour,<br/>align, shadow, normalised position"]
    FC["Font catalogue<br/>6 curated TTFs shipped in the repo"]
    PR["text_render.py (Pillow)<br/>TextSpec -&gt; RGBA PNG"]
    RP["RichText.jsx (browser)<br/>TextSpec -&gt; DOM, same TTFs"]
    TS --- FC
    FC --- PR
    FC --- RP
  end
  subgraph L2["Layer 2 - Consumers"]
    IC["Intro card renderer<br/>player_intro.py (T5210)"]
    OT["Overlay text layer<br/>burned at render (T5225)"]
  end
  subgraph L3["Layer 3 - Attach and deliver"]
    LIB["Card library (T5195/T5205)<br/>N cards per profile, one default"]
    ATT["Attachment (T5215)<br/>reel / collection / default"]
    DEL["Delivery (T5220)<br/>serve-time prepend + playback pre-roll"]
  end
  PR --> IC
  PR --> OT
  RP --> IC
  RP --> OT
  IC --> LIB
  LIB --> ATT
  ATT --> DEL
```

**The rule that keeps this honest:** there is **exactly one** text renderer on the backend and
**exactly one** preview component on the frontend, and they read the **same TTF files**. If the
intro card and the Overlay text ever need different code paths to draw a line of text, the design
has failed.

## Decisions (settled 2026-08-03 — user approved)

| # | Decision | Why |
|---|---|---|
| 1 | **The intro is applied at DOWNLOAD and PLAYBACK, never burned at export.** Serve-time prepend mirroring `append_branded_outro`; a React pre-roll on playback surfaces mirroring `BrandedEndCard`. | Swap an intro on any reel instantly and free; every existing reel gets one with no backfill; stored R2 objects stay byte-identical so posters/ranking/share links are untouched. Burning it in would shift poster times, slow-mo section offsets and chapter markers, and cost a re-export + credits per change. |
| 2 | **Card layout = templates with named slots** (~3 templates: `hero-left`, `full-bleed`, `title-only`). Per-slot font/size/colour/align. No free dragging in v1. | Every card looks designed, motion is authored per template, renderer parity is guaranteeable. Free positioning stays possible later without paying for it now. |
| 3 | **Card-first: the athlete profile field set is NOT built.** Cards use free text the user types. | Ships sooner, drops a `user_db` migration and a form from the critical path, and stores less personal data about a minor (directly helps T5230). A "duplicate this card" action covers the retyping cost. |
| 4 | **Overlay text range = free range that SNAPS to clip boundaries.** | "Clips 1-2" is one gesture, "the first 3 seconds" is still possible, and it matches the spotlight-region interaction directly above it on the timeline. |
| 5 | **Backend text rendering = Pillow raster to a transparent PNG**, never ffmpeg `drawtext`, never a headless browser. | Pillow/numpy/OpenCV are already dependencies. Real wrap/tracking/stroke/shadow with exact TTF metrics shared with the browser. One PNG layer feeds BOTH consumers: ffmpeg animates it for the card, OpenCV alpha-blends it per frame for Overlay text. `drawtext` has no wrap and a proven escaping landmine (T5240); a headless browser means Chromium in the Fly AND Modal images. |
| 6 | **6 curated fonts**, shipped as TTFs in the repo, served to the browser via `@font-face` from the same files. | The render container has no font server and the preview must load the identical file, so the catalogue is curated, not a system picker. Six keeps every choice deliberate and the repo light. Licences must be verified per face (OFL or equivalent). |
| 7 | **Cards are PER PROFILE** (`intro_cards` table in `profile.sqlite`), with `is_default` on the card row. | A card names one athlete, and intro media must sit under a per-profile R2 prefix or it 404s cross-profile. Putting the row beside the media removes the split. A future "copy card to another profile" action covers the shared-template case. |
| 8 | **`NULL` and `0` mean different things** on `final_videos.intro_card_id`: NULL = inherit the default, 0 = the user said no intro on this reel. | Without the distinction, opting one reel out is impossible once a default exists. |
| 9 | **Card generation is non-fatal**, exactly like the outro. | A failed card logs loudly and the user still gets their video. It never sinks a download, a share or an export. |
| 10 | **Animation is core, not optional.** The photo hero push-in, staggered text-in and white-flash out ARE v1. | The value is the motion + professionalism, not the data. A static frame is not acceptable. |
| 11 | **Player cut-out (T5200) no longer blocks the card engine.** | A card works with a plain photo; the cut-out is an enhancement whenever it comes up. |

## Data model

```mermaid
erDiagram
  INTRO_CARDS ||--o{ FINAL_VIDEOS : "attached to (nullable)"
  INTRO_CARDS ||--o{ COLLECTION_SHARE : "referenced in definition"
  INTRO_CARDS {
    int id PK
    text name "library label, never shown on the card"
    text template "hero-left | full-bleed | title-only"
    text image_key "per-profile R2 key"
    text image_cutout_key "nullable, T5200"
    blob text_elements "msgpack list of TextSpec, keyed by slot"
    real duration "seconds"
    int is_default "0 or 1, one per profile"
    text created_at
    text updated_at
  }
  FINAL_VIDEOS {
    int id PK
    int intro_card_id "NEW nullable - NULL inherit, 0 none"
    text filename
  }
```

| Thing | Lives in | Migration |
|---|---|---|
| Card library | `intro_cards` table, `profile.sqlite` | **profile_db v034** (T5195) |
| Reel attachment | `final_videos.intro_card_id` | same migration |
| Collection attachment | `shares.collection_definition` JSONB (Postgres) | **none** — the definition already exists |
| Profile default | `intro_cards.is_default` | same migration |
| Card image | `{APP_ENV}/users/{uid}/profiles/{pid}/intro/...` R2 | n/a |
| Overlay text | `working_videos.text_overlays` | **none** — column already exists |

**Resolution order** (every playback and download surface asks the same question):

```
reel.intro_card_id = 0     -> no intro (user opted this reel out)
reel.intro_card_id = NULL  -> the profile's default card, if any
reel.intro_card_id = <id>  -> that card, default ignored
```

## Codebase facts this epic depends on (verified 2026-08-03)

| Fact | Where | Consequence |
|---|---|---|
| `working_videos.text_overlays` BLOB **already exists**, is already returned by `/overlay-data`, and already counts toward `has_overlay_edits` in `projects.py:332`. Nothing writes it, nothing renders it. | `database.py:985`, `overlay.py:1716/1734/1765/1855`, `schemas.py:268-306` | T5225 fills an open socket — **no migration**. The `TextOverlay` stub in `schemas.py` (absolute px `x`/`y`/`fontSize`) is REPLACED by TextSpec, not extended. |
| `append_branded_outro` runs at serve time on `GET /api/downloads/{id}/file`, cached per format in `/tmp`, non-fatal, `-c copy` concat. | `downloads.py:705`, `branded_outro.py` | Decision 1's precedent. T5220 mirrors it in the prepend direction and shares the concat helpers. |
| The overlay render is a **per-frame OpenCV/numpy loop**, not an ffmpeg filter graph. | `modal_functions/video_processing.py:_process_overlay`, `services/local_processors.py:_overlay_sync` | Overlay text must composite an RGBA PNG per frame in BOTH the Modal and local loops (decision 5), and a Modal redeploy is required. |
| Branded-outro card animation is authored entirely inside one cached `filter_complex`; the card is encoded ONCE, so animation is free at export. | `branded_outro._build_outro_card` | T5210 copies this shape exactly. Landmines (`overlay` cannot take a per-frame-resized input; `drawtext` cannot inline an apostrophe) are recorded in `.claude/knowledge/export-pipeline.md`. |
| `OverlayTimeline.jsx` carries two comments reserving the slot: "Future: Additional overlay layer labels (BallGlow, Text, etc.)". | `modes/overlay/OverlayTimeline.jsx:103,153` | T5225 lands where the component already expects it. |
| Collections are **playback-composited** (presigned member list, no stitched file). | `collections.py:775` create, `:652` resolve | Collection intro = pre-roll on playback; the burned-in case only arrives with T4945. |
| profile_db head is **v033**; user_db head **v007**; postgres head **v022**. No unmerged sibling branches. | `app/migrations/` | T5195 takes profile_db **v034**. Re-check for collisions at implementation time (see memory: version collision across branches). |

## Compliance posture (carried forward, retargeted)

The risk is unchanged in kind and slightly reduced in degree — decision 3 means we store **less**
structured data about a minor, but a card still holds a **minor's photo + free text that will be
publicly visible when shared**.

- **COPPA most likely does NOT legally apply** — the service is directed at adult parents and the
  child's data is provided BY the parent, not collected FROM the child (FTC: COPPA "does not cover
  information collected from adults that may pertain to children"). We adopt a children's-data
  posture anyway because state privacy/biometric laws, GDPR-K and future COPPA 2.0 reach this data.
- **Data minimisation > encryption.** Decision 3 removes the structured athlete field set entirely.
  No DOB is collected. If a future feature needs one, it is app-encrypted on top of R2 SSE.
- **Encryption at rest:** R2 AES-256 SSE + TLS in transit is the baseline. The photo can't be
  meaningfully app-encrypted (it must decrypt to render) — protect it via SSE, per-profile access
  control, and the public-exposure warning.
- **The real risk is PUBLIC EXPOSURE, not storage.** Required mitigations: **parental-consent
  attestation** (T5190), a **"this is publicly visible when shared" warning** at card creation and
  at attach time (T5205/T5215), and **retention/deletion** wired into `privacy.py` (T5230).
- **Never** run face-recognition/biometric templating on the photos. Background removal (T5200) is
  segmentation, NOT recognition — fine.

## Redesign delta

| Requirement | Epic before 2026-08-03 | Consequence |
|---|---|---|
| N intro cards | One card, composed from profile athlete facts | Needs a card *library* (table + CRUD + editor UI); the card stops being a pure function of the profile |
| Text/font/colour control | Fixed layout, hard-coded font | Needs a real rich-text model and a renderer that matches the browser preview |
| Per-reel / per-collection attach | A per-export on/off toggle | Needs an attachment column, a collection-definition field, and a resolution order |
| A default | Not modelled | `is_default` on the card row |
| Reuse text in Overlay | Not in the epic at all | New Overlay layer sharing the card's renderer |

## Child tasks (implement in order)

| Order | Task | What it does |
|-------|------|--------------|
| 1 | [T5180](T5180-rich-text-engine.md) — Rich text engine | TextSpec, font catalogue, `text_render.py`, `RichText.jsx`, parity test. Foundation, no user-visible feature. |
| 1 | [T5190](T5190-card-image-upload-consent.md) — Card image upload + consent | Image-upload endpoint under the per-profile `intro/` prefix + parental-consent attestation. Runs parallel with T5180. |
| 2 | [T5195](T5195-intro-card-library.md) — Card library: schema, CRUD, default | `intro_cards` table (profile_db v034), REST CRUD, single-default enforcement. |
| 3 | [T5205](T5205-card-editor-ui.md) — Card editor UI | Library grid + editor stage + per-slot text controls + browser motion preview. |
| 3 | [T5210](T5210-intro-card-generation.md) — Card render engine | `player_intro.py`: card row + PNG text layers -> animated MP4, probe-matched, cached, non-fatal. |
| 4 | [T5215](T5215-intro-attachment.md) — Attachment + resolution | `final_videos.intro_card_id`, collection-definition field, resolution helper, reel + collection pickers. |
| 5 | [T5220](T5220-add-intro-integration.md) — Apply the intro at every egress | Serve-time prepend, playback pre-roll, T4945 stitch seam, public-exposure notice. |
| — | [T5225](T5225-overlay-text-layer.md) — Overlay text layer | Timeline layer + clip-snapping range + burn-in in both render loops. Needs only T5180, so it can run early. |
| 6 | [T5230](T5230-childrens-data-compliance.md) — Children's-data compliance | Consent record, retention/deletion in `privacy.py`, no-face-recognition guardrail, privacy-policy update. Gates public launch. |
| — | [T5200](T5200-player-cutout.md) — Player cut-out | Optional enhancement; no longer blocks T5210. |

```mermaid
graph LR
  T5180["T5180<br/>text engine"] --> T5195["T5195<br/>card library"]
  T5190["T5190<br/>image + consent"] --> T5195
  T5180 --> T5225["T5225<br/>overlay text"]
  T5195 --> T5205["T5205<br/>editor UI"]
  T5195 --> T5210["T5210<br/>render engine"]
  T5210 --> T5215["T5215<br/>attachment"]
  T5215 --> T5220["T5220<br/>apply at egress"]
  T5220 --> T5230["T5230<br/>compliance"]
  T5200["T5200<br/>cut-out"] -.optional.-> T5210
```

## Related: animation polish

The same premium-motion bar applies to intros, outros and spotlights — they should all *animate*
and look professional. Siblings: [T5240](../T5240-animated-branded-outro.md) (animated outro,
DONE — its motion vocabulary is the one T5210 should share) and
[T5250](../T5250-spotlight-animation-polish.md) (spotlight reveal). Cohesion goal: a reel that opens
with an animated intro, spotlights with a produced reveal, and closes with an animated outro should
feel like one system.

## Epic completion criteria

- [ ] A user can create, edit, name and delete **multiple** intro cards on a profile, each with an
      image, a template, and text elements they styled (font, size, colour, alignment).
- [ ] One card can be marked **default**; exactly one default per profile is enforced.
- [ ] A **different card can be attached to each reel and each shared collection**, and a reel can be
      explicitly opted out of intros even when a default exists.
- [ ] The attached card plays before the reel on **every egress**: owner download, share-page
      playback, share-page download, collection playback (+ the T4945 stitch seam).
- [ ] Changing which card is attached to a reel takes effect **without re-exporting**.
- [ ] The **same** rich-text editing produces text on the Overlay timeline over a user-chosen range
      that snaps to clip boundaries, burned into the render.
- [ ] What the editor previews is what the render produces (parity test, not eyeballing).
- [ ] Compliance: consent attestation captured; public-exposure warning shown; card image + text
      included in privacy export & purge; no biometric/face-recognition on photos.
- [ ] Card/intro failure never sinks a download, share or export.
