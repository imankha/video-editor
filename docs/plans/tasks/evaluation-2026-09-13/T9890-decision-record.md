# T9890 Decision Record — Make all result entry points recover and replay consistently

**Task:** T9890 (source T13 / EP03) · **Mode:** GATED_DISCOVERY · **Author:** dotask worker
**Date:** 2026-09-15 · **Verdict:** REAL SCOPE — do not implement here; file a scoped task.

Investigation deliverable. No production code was written for T9890 (GATED_DISCOVERY: "any
production build needs a recorded decision and separately scoped tasks"). Reconciliation,
current-state map, per-AC status, and the build recommendation follow. A GATED_DISCOVERY task is
complete when its decision deliverable is complete; the proposed feature stays unimplemented.

## 1. What was verified before deciding

- **Dependencies merged/STAGING** (verified against `git log`, not just the PLAN annotation):
  T9780 (`b0a604068`), T9860 (`7ceb5fbf0`), T9870 (`4664a5742`) — all landed.
- **Related work reconciled** (PLAN-archive.md, both DONE/deployed 2026-09-13):
  - **T9470** (`9e6c9dba`, PR #398): finished-draft Preview now opens the player shell
    **immediately** with a loading state, dedupes in-flight requests, and **scopes the async
    result to the item/page that asked for it** (a late result is cancelled, not rendered over the
    wrong screen). This already satisfies most of T13's loading/recovery AC on the store-driven
    (`DraftReelPreview`) path. **Do not reopen.**
  - **T9710** (`9fbe0c90`): verified live on staging — private-draft privacy, publish-with-effects,
    final-link access, save-draft destination all PASS. Publish-without-spotlight FAILS its one-tap
    promise → filed as **T9740** (a FocusScreen export-trigger bug, not a T9890 concern).
- **Environment limit:** this container has frontend/vitest but **no backend venv and no Playwright
  browser**, so no live re-drive of the library/continue/completion entry points was possible here
  (same limit recorded for T9630/T9810/T9850/T9880/T9930). T13's own "Practical validation" requires
  exactly that live drive (open via each entry, reload/back/forward, compare artifact IDs across
  entries, play >=2s of the fixture) — so even a candidate fix could not be validated to this AC in
  this container. Findings below are code-evidenced (file:line), not live-reproduced.

## 2. Current behavior (code-evidenced)

Full audit under `.claude/knowledge/annotate.md` + `persistence-sync.md`. Bottom line: the finished
result surface is **already largely consolidated onto `CollectionPlayer`**, and the load-bearing
E51 claim does **not** reproduce.

**Entry points → all resolve `CollectionPlayer`**, but via four independent instantiations with
hand-built reel payloads (drift vector):

| Entry | File:line | Mount | Title fed |
|---|---|---|---|
| Clips/Reels card tap + "Preview" (DraftTile) | `DraftTile.jsx:226/654/747` → `openFinishedReel` | store → `DraftReelPreview` | game name + game clock |
| One-tap publish completion | `handleOverlayExportCompletion.js:142` | store → `DraftReelPreview` | game name + game clock |
| Published tab Play | `ReelTile.jsx:351` / `PublishedReelsPanel.jsx:495` | `IntroStoryPlayer` → CollectionPlayer | `project_name` |
| Focus completion | `FocusScreen.jsx:1448-1468` | CollectionPlayer **direct** (streams working video) | clip name |
| Overlay completion | `OverlayScreen.jsx:1814-1836` | CollectionPlayer **direct** | clip name |
| "Continue where left off" card | `ProjectManager.jsx:1363-1408` | routes to **editor**, not result view | n/a |

Per-AC status:

| T13 Acceptance criterion | Status | Evidence |
|---|---|---|
| All ready-result entries open the same eligible version and title | **PARTIAL** | Same artifact class (`/api/downloads/{id}/stream` finished render) on every finished entry; but **title diverges** — store paths (DraftTile / one-tap / Published) promote the **game name + game clock** over the clip name (`CollectionPlayer.jsx:371-383`), while Focus/Overlay completion previews show the **clip name** (they pass `title=project.name`, no `gameName`). Divergent, and the majority path contradicts S08's "promote the clip name." |
| Loading/failure never implies publication or settings loss | **MET** | Robust state machine: skeleton until first paintable frame (`CollectionPlayer.jsx:487-495`), `onError` → "Couldn't load this video." + **Retry** (`:504/521/523`), stall detection `STALL_MS=10000` (`:251`). Load error never implies publication/settings loss; the publish-failure banner (`DraftReelPreview.jsx:159-176`) is scoped to the publish gesture only. |
| Source preview is labeled and never substituted silently for finished media | **MET (E51 does NOT reproduce)** | Every finished-result Preview/Play opens the finished render, never the annotate source player. "Preview plays" (`displayNames.js:35`, `useAnnotationPlayback`) is an **Annotate-only** control on source footage; it never renders on DraftTile/ReelTile/DraftReelPreview/completion previews (grep-confirmed). E51 is a **naming collision** ("Preview" on a finished card vs "Preview plays" in Annotate), not a wiring bug. |
| Back to marking preserves source context and existing work | **NOT MET** | No "Back to game plays" backlink anywhere. CollectionPlayer closes only via X/Escape → back to ProjectManager (`DraftReelPreview.jsx:197`); the header game name is **static text, not a link** (`CollectionPlayer.jsx:373-380`). No source-annotation context is carried (grep: no `onBackToGame`/"Back to game"). |

**Proposed copy — none exists** (grep `displayNames.js` + components): "Watch finished highlight",
"Watch marked plays", "Loading your highlight…", "Couldn't load the video. Try again.", "Back to
game plays" all **absent**. Current surface uses ad-hoc literals ("Preview video"
`DraftTile.jsx:748`, "Play video" `ReelTile.jsx:352`, "Couldn't load this video."
`CollectionPlayer.jsx:521`) outside `displayNames.js`.

## 3. Decision: REAL scope — file a scoped task

The remaining T9890 work is not a one-function bug. It comprises:

1. **Title-consistency decision + change on the shared `CollectionPlayer` header**
   (`:371-383`) — pick clip-name vs game-name promotion and apply it uniformly across store and
   completion paths. This is a **product-copy/naming decision** that the epic's Integration Rules
   bind to T9860's reconciliation ("record an explicit reconciliation… before broad renaming"),
   and it changes a **shared component also used by Published reels** → cross-surface, behavior-
   adjacent risk. Not a low-risk local fix.
2. **New "Back to game plays" backlink + source-context navigation** from the result view (E44) —
   new UI affordance wiring the result surface back to the source game's annotate/plays view. Net-
   new feature, design-shaped.
3. **Centralized, policy-accurate copy** for the five proposed strings — folds into **T9860**
   (the single copy/concept sweep) per Integration Rules, or must be policy-accurate per the
   epic's no-placeholder-copy rule; not shippable as provisional strings here.
4. *(Optional hardening)* consolidate the **five hand-built reel payloads**
   (`finishedReelNav.js:38-48`, `DraftReelPreview.jsx:93-104`, `FocusScreen.jsx:1450-1456`,
   `OverlayScreen.jsx:1816-1822`, `playerReels.js`) into **one shared shaper** — this is the drift
   vector behind the title divergence. A refactor (characterization tests, <200-line units per the
   refactor rules), not a drop-in.

**Why not implement a slice now:** item 1 is product-gated (T9860 reconciliation) and cross-surface;
item 2 is a new feature; item 3 belongs to the T9860 copy sweep; item 4 is a refactor. None is the
clean, clearly-correct, in-container-verifiable one-function fix the GATED_DISCOVERY carve-out
allows (contrast T10050/T10060). Every candidate also fails T13's own live cross-entry validation in
this container (no backend venv / no Playwright). Shipping any blind would violate the epic's
no-provisional-copy rule.

**Positive findings that shrink the future task (do not redo):**
- E51 "source substituted for finished" does **not** reproduce — no viewer re-architecture needed
  (matches T13 "Out of scope: no new viewer architecture unless necessary").
- Loading/error/retry/recovery (AC2) is **already met** on every caller — T9470 did the heavy half.
- Entry points already funnel to one `CollectionPlayer` — the shared destination T13 asked for
  mostly exists; the gap is title shaping + backlink, not routing.

**Reuse that keeps the future task tractable:**
- `CollectionPlayer` `statusBanner` / header / retry slots — extend, don't rebuild.
- `finishedReelNav.js` snapshot shaper — the natural home for a single payload/title contract.
- `displayNames.js` — centralize the five proposed strings alongside T9860's vocabulary.

**Recommended new task:** Tier **M–L** (L if the payload-shaper consolidation + backlink navigation
are both included), Frontend-only, product-copy-gated on T9860. Core (items 1–2) ~120–200 LOC across
`CollectionPlayer.jsx`, `finishedReelNav.js`, and the completion-preview callers; item 3 rides the
T9860 copy sweep. Live cross-entry validation (library/continue/completion, reload/back/forward,
artifact-ID compare, >=2s playback) is mandatory per T13 and must run where a backend + browser exist.

## 4. Migration / rollback

None. No schema touched, no code shipped. The future scoped task must preserve old saved records and
playable exports (T13 safe-completion rule), keep any navigation gesture-driven (never a reactive
effect), and disable/revert rather than delete persisted work if it regresses the core path.

## BLOCKED

`BLOCKED "T9890 needs new task: result-surface title-consistency on shared CollectionPlayer header
(clip-name vs game-name, product-gated on T9860) + new 'Back to game plays' source-context backlink
(E44) + centralize the 5 proposed copy strings (fold into T9860) + optional single reel-payload
shaper. E51 does NOT reproduce and loading/recovery (AC2) already met (T9470) — routing is fine;
gaps are title shaping + backlink + copy. Live cross-entry validation required; no code shipped per
GATED_DISCOVERY (no backend/browser in-container)."`
