# T9870 — Autosave edits and retain finished private results (design)

**Tier:** M · Frontend-only · No schema · No backend surface · No reactive persistence.

## Reconciliation finding (why the scope is small)

An audit (code-expert + this session) against the working tree shows that **3 of the 4
acceptance criteria and 3 of the 4 "work to perform" items are already satisfied** by the
existing architecture plus the merged dependencies (T9770/T9780/T9790/T9830/T9860):

| Requirement | Already provided by | Evidence |
|---|---|---|
| Ordered autosave of in-progress edits w/ ack, error, retry, old-draft compat (#1, AC2) | Per-gesture **surgical** `/actions` writes via `api/actionClient.js` (per-entity FIFO, `expected_version` threading, 409→reload, optimistic apply+rollback, `onError` toast). No debounce exists or is wanted — each edit gesture persists immediately. | `focusActions.js`, `overlayActions.js`, `actionClient.js`; `FocusContainer.jsx:388` `persistKeyframeEdit`. Backward-compatible: works on any loaded draft. |
| Watch loads the eligible latest export; unexported edits never masquerade (AC3) | `DraftReelPreview` streams `final_video_id` (the finalized export, backend `MAX(version)`), never live edit state; `framing/overlayChangedSinceExport` gates the "re-export needed" prompt. | `DraftReelPreview.jsx:93-104`; `App.jsx:689,696`. |
| Never publish / modify a shared version as a side effect (AC4) | Publish is a **separate explicit gesture** (`usePublishProject` → `POST /downloads/publish`). Autosave/`/actions` never touch publish state. `handleSaveDraft`/`handlePublishLater` are **navigation-only** (persist nothing). | `FocusScreen.jsx:1145-1147` ("Persists NOTHING"); `OverlayScreen.jsx:1625-1632`. |
| Stable named home + ready state + player (#3) | `openFinishedReel` → `DraftReelPreview` (private player, streams even when unpublished); `draftStage.getDraftStatus` gives the Draft / Private / Published axis; completion preview shows the freshly-rendered result. | `finishedReelNav.js:28`; `draftStage.js:91`. |
| Result becomes durably retrievable at export completion (#2, **AC1**) | The **backend finalizer** (`upsert_working_video` / `export_final`, durable_sync) persists the working/final video row at completion, independent of any frontend click. | export-pipeline.md; `OverlayScreen.jsx:1570`. |

## The one genuine gap: AC1 honesty

The result IS durably retained at export completion, but the **completion UI actively contradicts
that**: the quiet post-export "Save draft" affordance is captioned
*"Keep it in your drafts and finish it whenever you want."* (Focus) /
*"Save it as a draft and publish whenever you're ready."* (Overlay) — framing the click as the
thing that saves the work. The evaluator's E30/E31 flow ("clicked **Save draft**, returned to
Clips with Ready to Publish") is exactly this false model: a parent reads it as *"I must Save
draft or lose my highlight."* That is the "redundant Save-draft step" AC1 targets.

The result is already saved. The fix is to **make the completion surface say so**, so leaving with
zero extra clicks is visibly safe — while keeping the explicit control as a fallback (kickoff rule:
don't remove the T9830/T9590 buttons).

## Change (frontend-only)

1. **Retention reassurance line on the completion surface.** Add a small, presentational
   `retentionNote` line to `FocusPublishActionBar` and `OverlayPublishActionBar`
   (`data-testid="…-retention-note"`), rendered above the choice grid. The screen derives the note
   text once from the real project state (`getDraftStatus`) and passes it in — Views stay dumb.
   - Overlay completion (a **final** video exists → Private, ready): *"Private · Ready to watch.
     Only you can see it."* (composed from shipped T9860 vocab: `DRAFT_STATUS` PRIVATE label +
     `DRAFT_STAGE_LABELS.READY` + PRIVATE detail).
   - Focus completion (framing **working** video, still a draft): *"Your edits are saved as a
     private draft. Only you can see it."* (PRIVATE detail).
   - **AC4 guard:** if the project is already **Published**, the note uses a dedicated PUBLISHED
     line ("Saved. This reel is already published, its link is unchanged.") — deliberately NOT the
     shipped `DRAFT_STATUS_INFO[PUBLISHED].detail` ("...until you share a link", which would wrongly
     imply the link isn't shared) — and never claims "only you can see it" nor implies a visibility
     change.

2. **Truthful Save-draft captions.** Reframe `FOCUS_PUBLISH.SAVE_DRAFT_CAPTION` /
   `OVERLAY_PUBLISH.SAVE_DRAFT_CAPTION` so the ghost action reads as "leave; it's already saved,"
   not "save it now." Labels + `data-testid`s unchanged (tests/tutorial anchors depend on them).

3. **One small copy constant block** `RESULT_RETENTION` in `displayNames.js`, composed from
   already-shipped T9860 pieces — this is the task's own AC1 reassurance copy (the brief's
   "Proposed replacement copy" lists exactly these lines), not new product vocabulary.

No new store, no new write path, no `useEffect`→persist, no backend, no schema, no publish call.
Handlers stay navigation-only. The already-durable retention and the already-surgical autosave are
verified, not rebuilt.

## Risks / non-goals

- **Not** rebuilding autosave (would add a banned second write path). Not adding a debounce.
- **Not** T9880 (publish/share separation) or T9890 (result entry-point recovery) or T9900
  (persistent saving-status indicator) — those are separate downstream tasks that depend on this.
- Copy reuses shipped vocabulary; no Clip/Reel/Framing/Draft-Private-Shared re-litigation.
