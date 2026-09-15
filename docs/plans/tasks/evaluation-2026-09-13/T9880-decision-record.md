# T9880 Decision Record — Separate private replay, publication and link sharing

**Task:** T9880 (source T12 / EP03) · **Mode:** GATED_DISCOVERY · **Author:** dotask worker
**Date:** 2026-09-15 · **Verdict:** REAL SCOPE — do not implement here; file a scoped L-tier task.

This is an investigation deliverable. No production code was written for T9880 (consistent with
the GATED_DISCOVERY contract: "any production build needs a recorded decision and separately
scoped tasks"). Reconciliation, current-behavior mapping, and the build recommendation follow.

## 1. What was verified before deciding

- **Dependencies merged/STAGING** (verified against `git log`, not just the PLAN annotation):
  T9780 (`b0a604068`), T9860 (`7ceb5fbf0`), T9870 (`4664a5742`) — all landed.
- **Related work reconciled** (PLAN-archive.md, all DONE/deployed 2026-09-13):
  - **T9670** (no code) settled the **publish-audience contract**: publishing grants no audience
    by itself; sharing a link is a separate gesture. Reflected today in
    `STAGE_REASONS.PUBLISH = "Nobody else can see this until you share a link."`
    (`config/displayNames.js:104`), consumed by both completion action-bar captions and the
    `DraftReelPreview` publish toast. **Do not reopen.**
  - **T9710** verified **live on staging**: private-draft privacy (structural), publish-with-effects
    one-tap, final link access (view+download, scoped to a single `final_videos` row), and
    save-draft destination all PASS.
  - **T9740** coded the publish-without-spotlight one-tap fix (dual-transport completion dedup).
- **Environment limit:** this container has frontend/vitest but **no backend venv and no Playwright
  browser**, so no live re-drive of the publish/share/re-export flow was possible here (same limit
  recorded for T9630/T9810/T9850/T9930). Findings below are code-evidenced, not live-reproduced;
  the two items needing live proof are called out explicitly.

## 2. Current behavior (code-evidenced)

Two distinct result surfaces exist:
- **Private-draft result** → `DraftReelPreview.jsx` wrapping `collections/CollectionPlayer.jsx`
  (opened from `DraftTile` tap / post-export completion). This is the E36 finished-single-highlight
  private view.
- **Published result** → `PublishedReelsPanel.jsx` + `ReelTile` (the "Published" tab). Only
  published reels appear; this surface already owns share/copy-link/download.

Per-AC status:

| T12 Acceptance criterion | Status | Evidence |
|---|---|---|
| Private replay needs no publication | **MET** | `DraftReelPreview` streams `final_video_id` while unpublished; banner "Only you can see this. Publish it to get a share link." (`DraftReelPreview.jsx:187`) |
| Cancel/failure creates no misleading link/audience success | **PARTIAL** | No visibility-review/confirm step exists; publish is one-tap and immediately flips the primary slot Publish→Share (`CollectionPlayer.jsx:391-420`). There is no Cancel path because there is no review step. |
| Copied link confirmed only after clipboard success; fallback text selectable | **PARTIAL** | Success toast fires on real copy (`DraftReelPreview.jsx:136/140`; `PublishedReelsPanel.jsx`), BUT the fallback is a silent `execCommand('copy')` on a hidden input (`useWebShare.js:37-48`) — not selectable text. Only `CollectionShareModal` shows a selectable readonly link input. |
| Recipient in separate session plays intended version | **MET (T9710 live)** | Anonymous `/shared/{token}` grants view+download, scoped to one `final_videos` row. |
| Private re-export does not silently update the link | **MET by construction, UNVERIFIED live** | Share token pins the old `final_videos` id; a re-export INSERTs a new version (`upsert_working_video`). No code re-points an existing token. **Needs live proof** of `POST /api/gallery/{id}/share` behavior when `final_video_id` has moved. |

**The core T12 target flow does not exist:** explicit result-page "Publish and get link" →
visibility review ("Publish X? Anyone with the link can watch. Publishing creates a link; it does
not send it.") → "Publish and create link" → link-ready with "Copy link" / "Share link…".
Grep confirms none of the T12 copy strings exist (`"Publish and get link"`, `"Publish and create
link"`, `"Link ready"`, `"Share link…"`, `"Update shared version"` all absent from `displayNames.js`).
The Copy-link-only-after-link-exists state machine IS built — but only in `CollectionShareModal.jsx`
(collection-scoped), not on the single-highlight result surface.

**Game-invite confusion (B02/N08) is already fixed** by T9810 — that was an *Annotate*-surface
mis-wire (`onShare` vs `onSharePlayback`). No result surface routes to a game email form
(grep: `SharePlaybackDialog` absent from `DraftReelPreview`/`PublishedReelsPanel`/`CollectionPlayer`).

**Download discoverability (dropped T10000 scope):** confirmed the E39 gap. Download renders ONLY
on the Published surface (`ReelTile`/published `CollectionPlayer` get `onDownload`); the private
result view never passes `onDownload`, and the `DraftTile` kebab is Rename / Open in Framing /
Open in Spotlight / Hide from Drafts — no Download. Capability (T4945-T4947 `useDownloads`) exists;
it is not surfaced on the private finished-highlight view.

## 3. Decision: REAL scope — file a scoped L-tier task

The remaining T9880 work is a **new multi-step publish/review/link UI pattern on the result
surface**, not a copy tweak or one-function fix. It requires:

1. A **visibility-review confirmation step** before link creation (new component + copy).
2. A **separate link-ready success state** ("Copy link" / "Share link…") with selectable fallback
   text, splitting the current one-gesture publish→share slot swap.
3. **~9 new copy strings** in `displayNames.js` (all absent today), which must be policy-accurate
   per the epic's no-placeholder-copy rule and consistent with the T9670 audience contract.
4. *(If pulled in)* an explicit **"Update shared version"** affordance + **backend** re-point of an
   existing `gallery/{id}/share` token to a moved `final_video_id` — its own persistence + live
   verification concern (crosses firmly into L-tier).
5. *(Dropped-T10000)* **Download on the private result view** — mechanically small (~1 `onDownload`
   prop from `DraftReelPreview` into `CollectionPlayer` + a `DraftTile` menu item) BUT the private,
   never-published draft may not have a gallery download id / the download endpoint may be
   published-gated; this is **not verifiable in-container** (no backend venv). It lives on the same
   `DraftReelPreview`/`CollectionPlayer` surface being reworked, so it belongs in the same scoped
   task, not a blind partial shipped here.

**Why not implement a slice now:** items 1-3 are genuinely new UI (design-gated, Architect
required per M/L rules); item 4 touches the backend and needs live proof this container can't
produce; item 5's "small" wiring rests on an unverifiable backend download path. Shipping any of
these blind would violate the epic's no-provisional-copy rule and the CLAUDE.md "prove the write
path or fail loudly" persistence rule.

**Reuse that keeps the future task tractable (not from-scratch):**
- `CollectionShareModal.jsx:212-238` — the get-link-then-copy state machine to lift onto the
  result surface.
- `useWebShare.js` — token create + `navigator.share` + clipboard fallback (respects the
  coarse-pointer capability gate; keep it).
- `CollectionPlayer` `statusBanner` / primary-slot / `actionBar` slots — hang new UI here without
  touching the presentational player.
- Publish gesture (`usePublishProject`) + `STAGE_REASONS.PUBLISH` audience copy — settled.

**Recommended new task:** Tier **L**, Architect gate, Frontend (+ Backend iff "Update shared
version" token re-point is included). Estimated core (items 1-3) ~200-350 LOC across ~4-6 files;
full scope (with 4+5) is multi-surface + backend + design-gated.

## 4. Adjacent finding to flag (not T9880)

T9710's still-open live bug — **"Publish without spotlight" does not one-tap on staging**
(`FocusScreen.handlePublish`; the `exportButtonRef.current?.triggerExport()` auto-trigger doesn't
fire, rerouting through Spotlight) — will confuse any result-page publish testing. T9740 coded a
fix but its 4th live-staging re-verify is still owed. This is a FocusScreen export-trigger bug
distinct from T9880's share/link scope; it should be tracked on the T9740 line, not folded here.

## 5. Migration / rollback

None. No schema touched, no code shipped. The future scoped task must preserve old saved records
and playable exports (T12 safe-completion rule) and keep token creation gesture-driven (never a
reactive effect).

## BLOCKED

`BLOCKED "T9880 needs new task: L-tier result-surface Publish→visibility-review→link-ready UI
(reuse CollectionShareModal state machine + useWebShare), + optional Update-shared-version backend
token re-point, + surface existing download on the private result view (E39/T10000). Architect gate
required; no code shipped per GATED_DISCOVERY."`
