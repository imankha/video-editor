# T11280: Reel vocabulary sweep on published, share, legal and landing copy

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-24
**Updated:** 2026-10-02
**Epic:** [Single-Clip Editor](EPIC.md)

## Problem

With Reels gone until T11300, user-visible copy that calls a single published clip a "reel", or
promises multi-clip assembly, is wrong. Internal identifiers stay (renaming internals for UI
consistency is not done here, T7700/T9320 precedent).

## Solution (noun per R2; recommended "highlight")

| Surface | Location |
|---|---|
| Share copy "Highlight Reel", "Check out my ... highlight reel" | `PublishedReelsPanel.jsx:640,679`; `DraftReelPreview.jsx:184`; `GlobalExportIndicator.jsx:48,234` |
| RecapPlayerModal "Reel started / draft reel" | `RecapPlayerModal.jsx:261,501-502` |
| Toasts "new reel", "your reel" | `displayNames.js:528,583`; `FocusCompletionRecovery.jsx:139`; `App.jsx:655`; `AnnotateScreen.jsx:226` |
| Share email "shared a highlight reel", "Watch Reel" | `src/backend/app/services/email.py:766-780` |
| Marketing "make your own reel(s)" (R11) | `BrandedEndCard.jsx:40`; `SharePageInstallBanner.jsx:14` |
| Admin "Reels" phase tier (optional relabel) | `UserDetailPanel.jsx:91-155`; `admin.py:1980-1988` |
| Legal / pricing "exported reels" (review wording) | `PrivacyPolicy.jsx`, `TermsOfService.jsx`, `BuyCreditsModal.jsx:131` |
| Landing (R7): recruiting-reel page claims multi-clip ordering/assembly | `src/landing` `useCases.ts:34-110`; also check `cameras.ts`, `sports.ts`, `index.astro`, `how-it-works.astro` (194 hits / 24 files; keep "highlight reel" SEO phrasing only where it stays true) |

**"clip" too (owner ruling 2026-09-24, round 2):** "remove the word Clip entirely, that's no
longer a part of the mental model." Annotate's copy is T11150; if H17 rules every parent-facing
screen, this sweep also removes user-visible "clip" from Framing, Spotlight, Home, Published,
share pages and emails. The Home "Clips" tab name and the Highlight Later toast are the
exceptions pending H18.

Rules: no em dashes; never claim autonomous framing/tracking; brand "ReelBallers" unchanged.
Landing ships via the separate landing deploy (`/deploy-landing`).

## Related Tasks
- Depends on: R2, R7, R11; coordinate with T11130's vocabulary (highlight-first epic)
- Downstream: T10320 reshoot, T7630 copy re-derivation
- **Already compliant, leave alone (T10190, merged PR #492):** `displayNames.js`'s
  `RESULT_SURFACE` block ("Watch finished highlight", "Watch marked plays", "Back to game plays",
  etc.) and the `gameId`/`onBackToGame` backlink block in `DraftReelPreview.jsx` (~lines 99-130,
  just above the `:184` "Highlight Reel" share text this sweep is already targeting) contain no
  "reel" or "clip" wording — no edit needed there, don't let a blanket grep-and-replace pass touch
  them.

## Acceptance Criteria

- [x] AC1: No user-visible "reel" for a single published clip in app copy (grep list in PR #549)
- [x] AC2: Landing makes no multi-clip assembly claim (all 12 sports in `sports.ts`, plus
      `comparisons.ts`, `useCases.ts`, `cameras.ts`, `how-it-works.astro`, `index.astro`,
      `about.astro`, `site.ts`, `llms.txt.ts`, `sports.astro`, `works-with/*`)
- [x] AC3: E2E vocabulary specs (`T9530-library-vocabulary.qa`) updated
- [x] AC4 (live addition, 2026-10-01): Published "Top Plays"/"Game Highlights" leftover
      "reel(s)" share-link copy fixed (`CollectionShareModal.jsx`, `collections.py::_context_line`)
- [x] AC5 (live addition): confusing "No credits · effects are free" cost caption reworded to
      "Effects are free -- no credits needed"
- [x] AC6 (live addition, owner ruling "sweep every remaining export instance, no exceptions"):
      "Export" -> "Generate"/"Generation" across instructional/pop-up copy AND landing's own
      product-action copy. Excludes: third-party "export from Veo/Trace/Hudl/GoPro/CapCut"
      references, generic SEO "highlight reel" phrasing, manual-editing-comparison-column text,
      the main app CTA button (already said "Generate Highlight" from unrelated prior work),
      legal copy (separate judgment bucket per this file's own "review wording" note), and
      confirmed-dead/unreachable code paths (`displayMessage` strings never rendered by any view).

## Progress Log

**2026-10-02**: Implemented across ~13 rounds in a single container worker
(`feature/T11280-reel-vocabulary-sweep`), driven by 7 independent fresh-context Reviewer passes
(Opus 5.5) and 2 independent Proof Verifier passes, each confirming the prior round's fixes held
and progressively converging to zero blocking/major findings. Key findings along the way:
- Pass 1-4: landing pages never touched (`how-it-works.astro` etc.), several "reel" strings
  surviving in collection-share/move-reel/ranking UI, stale e2e specs, one regression
  (`OverlayModeView.jsx` briefly reintroduced "clip" during an unrelated fix) — all fixed.
- Proof Verifier pass 1: found AC2 (`sports.ts` never touched despite being named in this task's
  own original scope) and AC6 (partial coverage) incomplete via a real counterfactual test run
  (505/520 pass at head vs 101-105/520 fail against base). Owner ruled: `sports.ts` gets the full
  single-highlight reframe; AC6 gets swept with "no exceptions".
- Pass 5-7: `sports.ts` soccer/football initially missed (fixed), landing-wide "reel"->"highlight"
  consistency gaps (fixed), final MAJOR in `multi_clip.py`/`modal_client.py` connection-lost
  messages (fixed).
- Proof Verifier pass 2: found one more LIVE gap by actually calling the runtime
  `exportProgressLabel` function rather than static reading -- a phase-less "Starting export..."
  message shown on every single generation's progress card, missed by all 7 code-review passes
  because it required runtime verification. Fixed with a proven red-to-green regression test
  (`GlobalExportIndicator.test.jsx`). Also flagged 4 remaining em-dash violations in copy this
  task had already touched; fixed those plus 4 more siblings found while fixing them.
- Two unrelated incidents surfaced and resolved: a CRLF-blob-file whitespace-check false positive
  (`overlay.py`, then self-caught again on `ExportButtonContainer.jsx` — now 3 confirmed CRLF-blob
  files in this repo, see `reference_repo_line_endings_per_file` memory) and a proof-verifier
  subagent accidentally destroying the shared `node_modules` via a worktree-junction cleanup bug
  (2nd recurrence of this exact incident class; repaired via `npm install`, now a standing project
  memory to warn future review/proof agents explicitly).

Final head `e74db658b`, Branch CI green on all jobs. **Merged PR #549 (`2402eb635`), 2026-10-02.**
