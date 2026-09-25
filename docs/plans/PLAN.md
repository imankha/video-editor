# Project Plan

> **DONE rows are archived** to [PLAN-archive.md](PLAN-archive.md) (moved 2026-08-03) to keep this file short. When a task hits DONE, move its row there under the same headings.

## Current Focus

**2026-09-24 addition, unplaced — [T11050](tasks/T11050-annotate-clip-lane-click-seek.md):
Annotate's clips-lane click didn't move the playhead.** Reported live by imankh@gmail.com.
The thin video scrub row seeks correctly; the clips lane background (My Athlete/Team tracks,
or the single mobile lane) had no click handler at all -- a dead click target, unlike Focus/
Overlay's crop/highlight lanes which already do something on background click. Impact 5 /
Complexity 2, Tier M. Implemented same session; fresh-context Reviewer approved (MINOR-only
findings, addressed before commit).

**2026-09-22 addition, unplaced — [T11020](tasks/T11020-spotlight-custom-color-eyedropper.md):
Spotlight color picker gets a full spectrum + eyedropper, so a parent can match their
uniform.** User-requested directly in session. Frontend-only (backend already stores/renders
`highlight_color` as an opaque hex string, confirmed by trace before implementation). Impact 5 /
Complexity 3, Tier M. Implemented same session.

**2026-09-21 addition, unplaced — [T10880](tasks/T10880-pulsating-guidance-audit.md):
Pulsating next-action guidance, funnel playthrough audit.** Seed observation: in Spotlight (Focus
mode), when the user hasn't clicked any player-detection tracking box yet, the next one to click
should pulsate — no screen currently draws the eye to the recommended next action anywhere in the
funnel. Impact 5 / Complexity 2 as scoped (audit + ranked candidate list only, no implementation);
likely spawns higher-impact follow-up tasks once locations are prioritized. Left here for triage
rather than self-inserted into a milestone.

**2026-09-21 addition, unplaced — [T10950](tasks/T10950-spotlight-frame0-detection-boxes-missing.md):
Spotlight can show zero player-tracking boxes at a clip's opening frame.** Reported live by
imankh@gmail.com after a Framing export. Player detection samples only 4 points per highlight
region (first 2s); if the literal first sample whiffs (frame 0 is a known weak frame for vision —
same reason poster selection avoids it), no boxes render there even though later samples in the
same region have real detections. Recommended fix is a frontend-only fallback to the nearest
sample-with-boxes in `OverlayContainer.jsx`. Impact 4 / Complexity 2 — S/M-tier, no implementation
done yet (user declined to implement this session, filed for later pickup). Related but distinct
from T10870 (that one messages around a *project-wide* zero-detection fallback; this is a
*partial*, single-sample miss within an otherwise-successful region).

**2026-09-20 addition, unplaced — [T10790](tasks/T10790-add-footage-attach-422-required-sequence.md):
"Add footage to game" 422s on every real attempt (live on master since 2026-09-07, not
dev-specific).** Found incidentally while doing live verification for T10770. Impact 9 / Complexity
2 — a one-line Pydantic fix (`VideoReference.sequence` required → optional) plus a boundary-level
test. Needs a placement decision (bugs-before-features policy suggests it jumps the queue given a
core action is fully broken); left here for triage rather than self-inserted into a milestone.

**NEXT DEPLOY = [Milestone: Deploy Candidate](#milestone-deploy-candidate-user-ordered-2026-09-17-the-next-deploy) (user-ordered 2026-09-17).** Filed from the user's own staging
run: three crash paths to re-verify (T10230), two clip-upload bugs (T10250/T10260), upload-failure
observability (T10270, the "do we have enough logging" answer is no), pricing single-source
(T10210, merged; the 12.99/22.99/32.99 reprice T10220 is deferred until AFTER the build), the landing overclaim (T10170), the home-tab / Annotate-editor /
Overlay-panel UI finalization (T10280/T10290/T10310), uploaded-clip game linking (T10300), the
Tutorial Redesign core (T7620/T7630/T7640 as epic children in the milestone, LAST: after every other task is implemented and the UI approved; the advanced tier is T10330 in "Guided Mode: next iteration"),
the video reshoot (T10320, in-app + site, after guided mode), and T9720/T9730 as the gate. Bugs before features; that section's row
order is the sequence. **2026-09-19 addition: the [Play Editor Autosave + mobile trim layout](#milestone-play-editor-autosave--mobile-trim-layout-user-ordered-2026-09-19) epic (T10600-T10630)** — user-ordered removal of the editor's Update/Save button plus the portrait trim-layout fix; its position relative to the candidate is the user's call.

**Durability Hardening Campaign (2026-07-17): CORE COMPLETE, re-verified 2026-09-17.** The
campaign's original "TOP PRIORITY" set — **T4320** (durable clip gestures, incl. the T5310
`POST /api/profiles` create source-fix), **T4310** (upload-side CAS) and **T4315**
(restore-if-newer), i.e. the entire [durability-sync epic](tasks/durability-sync/EPIC.md), plus
its standalone sibling **T5840** (credits → Postgres) — are **ALL DONE**, deployed 2026-07-18
through 2026-07-28 prod (T4320's own PLAN.md/archive row had gone missing despite being merged and
shipped; recovered 2026-09-17, see PLAN-archive.md). This section had gone unupdated for two
months and was still describing all four as upcoming/sequenced work; it wasn't. Two siblings from
the original campaign are still genuinely open: **T4400** (backend-authoritative export — client
state clobbers surgical edits, DB≠video), now sequenced inside the [Export Write-Path Unification
epic](tasks/export-write-path/EPIC.md) behind T4370→T4380→T4390 (strict order, all four still
TODO, see Milestone B), and **T2260** (data-loss detection/recovery on reconnect,
`tasks/session-scaling/T2260-data-loss-detection-recovery.md`, also still TODO). Point-fixes from
the original 2026-07-24 arshia incident (grantee-DB sync, `TrackedConnection` owner tracking,
move_reels `require_fresh`) shipped alongside the epic itself.

**UI Runway (user-ordered 2026-08-03): CLOSED 2026-08-17.** Every near/mid-term UI-visible task landed, then the tutorials were reshot against settled screens (T5140, deployed 2026-08-17 prod) — see the UI-runway note at the end of Milestone TOP below for what's now unblocked.

**Phase: Feature** — Season Highlights & Collections epic: My Reels becomes the curation home (annotate → publish → rank → share). Spec: [season-highlights-spec.md](season-highlights-spec.md) · Tech notes: [season-highlights-tech-notes.md](season-highlights-tech-notes.md)

**Landing Page:** Already live at `reelballers.com`

### Next Work: September 12-13 Evaluation Handoff

**NEXT BATCH (user-ordered 2026-09-13): 20 live tasks in T9770-T9970 + T10010.** Work this batch
before the older pending backlog below. The [integration epic and ID
mapping](tasks/evaluation-2026-09-13/EPIC.md) carries all 27 imported tasks and the [full source
plan](tasks/evaluation-2026-09-13/source/plan.md); its **Reconciliation and scope decisions**
section records what was verified against code and the decisions taken 2026-09-13.

**Reconciliation result (2026-09-13).** Both the Sept 9-10 and the Sept 12-13 evaluations tested
**staging**, not prod - the evaluator's 88-credit account is only producible by master-side code
(T8120's `quest_upfront` grant), and prod was pinned at build 4290 / `d9621161`. Findings are
therefore LIVE against master, and four of the evaluator's quoted strings were confirmed still
present in the tree. **4 imported tasks dropped as already-shipped or duplicated** (T9910, T10000,
T10020, T10030), **1 folded** (T9940 into T9860), **2 deferred to their own epic** (T9980, T9990).

**User decisions 2026-09-13:**

- **Deploy first.** Prod was 744 commits / 12 days behind master with 138 tasks sitting at STAGING,
  including 34 from the Sept 9-10 walkthrough. Deployed before starting this batch.
- **Vocabulary: Clip and Reel both stand.** "Highlight" is a MODIFIER, not a third object. This
  REVERSES the intake's proposed Clip -> Highlight rename (source N02/N06) and leaves the 2026-09-10
  object model intact. Standing rule: **short form in controls** (`Clips`, `Reels`), **long form in
  prose** (highlight clip, highlight reel). Never one sibling carrying the modifier while its
  sibling does not - today's `Clips` tab beside the `Highlight Reels` noun is the actual defect.
- **AI Focus becomes Framing**, lifting the 2026-09-10 override. That override's recorded reason was
  that the name should say the reframing is automatic. It is not: framing is manual crop keyframes
  joined by a spline. Mode noun = **Framing**; screen instruction = "Frame your athlete" (a sentence
  cannot be a mode name - it has to work in a tab, a switcher and a status chip).
- **Relocate the AI claim to where the AI actually runs.** "AI" appears in exactly ONE parent-facing
  place today (the mode name), and that is the one step with no AI in it - which is why users report
  the app "has no AI". Real AI: `AIVideoUpscaler` (Real-ESRGAN, every framing export) and YOLO player
  detection on a T4 GPU (Spotlight). Name those steps: "Finding players", "Enhancing video".
  **Name the step, never promise the outcome** - no "Enhanced to HD" or equivalent quality claim
  until T9970 has measured whether it holds.
- **Statuses: T8470's Draft/Shared stands** (2026-09-10 override upheld). Take source N11 as
  PRESENTATION only, not a new state machine: add a plain-language second half to each existing
  state - `Draft / Not exported yet`, `Private / Ready to watch`, `Shared / Anyone with the link`.
  `draftStage.js` remains the single source and T9600 keeps its job.
- **Capture window = 6s before + 2s after** (8s total, replacing today's 9+3=12). The code was never
  broken: `DEFAULT_CLIP_BEFORE=9` + `DEFAULT_CLIP_AFTER=3` straddling the tap produced exactly the
  0:00-0:06 the evaluator reported at a 0:03 tap. Only the word "previous" was false. The post-roll
  is deliberate (parents tap AFTER they see the play), so 2s of it is preserved. Copy becomes
  "Captures 6 seconds before and 2 after".
- **Spotlight stays optional, but encouraged.** Its real reason - 22 kids in the same kit, and this
  is how anyone watching knows which one is yours - is the strongest sentence in the product and is
  currently written as a definition rather than a reason.
- **Every stage states its point in one sentence, and no explanation may use the feature's own name
  as the reason for the feature.** The framing copy failed this test ("so you can focus the clip
  around your player" is circular), and so does every other screen: they teach the mechanics and
  never state the point. T9860 owns the sweep.
- **One UI iteration, not several.** All copy-shaped work folds into T9860 so six tasks do not each
  edit their own corner and reintroduce the exact inconsistency both evaluations found.

**Sequence:** P1 repairs (T9770, T9790, T9800, T9810, T9820, T9840, T9920; T9780 after T9770) ->
T9860 copy and concept sweep -> the P2 UX tier -> T9970 quality benchmark and T10010 telemetry, both
independent and startable any time -> the existing release gate T9720 (which absorbed T10020).
T9980/T9990 follow afterwards in the [Capability Discovery
epic](tasks/evaluation-2026-09-13/EPIC-discovery.md).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T10860 | [Update shared version: re-point share token to moved final_video_id after private re-export](tasks/T10860-update-shared-version-repoint-token.md) | 4 | 6 | 0.7 | TODO | [ ] | **Split out of T10180 item 4 by the Architect's design gate, 2026-09-21** (`T10180-design.md` §5, user-approved). The only backend piece of T10180's original scope - a CAS-safe re-point of an existing share token to a NEW `final_video_id` after a private re-export, needing live proof against a real backend that T10180's frontend-only work could not provide. Depends on T10180 shipping first. |
| T10870 | [Tell the user when auto-spotlight falls back to a centered default](tasks/T10870-surface-detection-fallback-message.md) | 4 | 2 | 2.0 | TODO | [ ] | **Found live 2026-09-21 while QA'ing T10180.** A dim/dusk clip's player detection ran but found zero usable bounding boxes; `useHighlightRegions.js` correctly falls back to a centered default (not a fabricated box, per the no-silent-fallbacks rule) but only logs a `console.warn` - the user sees a plain centered box with no explanation. S/M-tier: surface that warning as a real, non-blocking UI message. |
| T10180 | [Result-surface Publish -> visibility-review -> link-ready UI](tasks/T10180-result-publish-visibility-review-link-ready.md) | 6 | 7 | 0.9 | TODO | [ ] | T9880 GATED_DISCOVERY follow-up (decision record: `tasks/evaluation-2026-09-13/T9880-decision-record.md`). The original T12 target flow (visibility-review before link creation, separate link-ready state with selectable fallback text, ~9 new copy strings) doesn't exist yet - only `CollectionShareModal`'s collection-scoped version does. Also picks up the dropped T10000 scope (surface existing Download on the private result view). L-tier, Architect gate required (new UI pattern, cross-surface). |
| T10190 | [Result-surface title consistency, back-to-game backlink, copy centralization](tasks/T10190-result-title-consistency-backlink-copy.md) | 5 | 5 | 1.0 | TODO | [ ] | T9890 GATED_DISCOVERY follow-up (decision record: `tasks/evaluation-2026-09-13/T9890-decision-record.md`). Smaller than the original T13 brief feared: entry points already funnel to one `CollectionPlayer`, E51 does not reproduce, loading/recovery already met (T9470). Real gaps: result title diverges (clip name vs game name) across entry points, no "back to game plays" backlink, 5 copy strings uncentralized. Coordinate with T9860 (merged) on the title-promotion decision. |

*T10170 moved to the Deploy Candidate milestone (2026-09-17, user order: kill bugs and finalize the streamlined UI before the next deploy).*

**Dropped from the intake 2026-09-13** (rationale in
[EPIC.md](tasks/evaluation-2026-09-13/EPIC.md); task files retained as provenance):

| Imported | Why it was dropped |
|------|------|
| T9910 | Credit/storage policy is already ANSWERED: T9680's decision record is complete on all six questions and was verified against production 2026-09-12; T9750 fixed the rounding rule; T9760 explains the credit discrepancy. Residual copy work is T9650, already on the board. |
| T10000 | Premise is stale - the Collection Download epic (T4945/T4946/T4947) shipped and is archived, so download capability exists. The evaluator simply could not find it, which is discoverability. Folded into T9880. |
| T10020 | Duplicates T9720, the existing end-to-end and failure-path release check. Merge the new checklist into T9720 rather than running two gates. |
| T10030 | Overlaps T9730 (product review and traceability sign-off). Both need real participants, which are not currently queued. |
| T9940 | Folded into T9860 - it is the same AI/capability copy problem, and splitting it would produce two passes over the same strings. |

### Production Reported Bugs

Bugs reported by users on production. Populated from Postgres `bug_reports` table via task board API. Use "Copy Kickoff Prompt" to investigate.

**Full triage pass 2026-09-14** (first pass since T10090 restored task-board connectivity):
6 real reports (51-53, 55-57) processed into the rows below, plus T10121/T10122 split out of the
bug-52 (T10120) expert investigation and T10130 filed from a user request that same investigation
gated. Bug 54 is a QA test artifact (`[QA TEST - T9400 investigation, safe to ignore]`, reporter
imankh@gmail.com) - no task needed, safe to clear from the board directly. **User directive: bugs
before features** - this batch takes priority over the pending P2 UX tier noted in Current Focus
above; row order below IS the sequence, ranked by infrastructure depth per the task-management
skill's bug-prioritization rule (data durability first, then unreachable-but-intact data, then pure
UI).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

*Bug 46p: the NULL-description half shipped as [T7560](tasks/T7560-bug-report-null-description.md); the UI-confusion half (inert quest step + triple prompt) is [T7840](tasks/T7840-quest-step-actionable-empty-state.md) under Next Up.*

### Milestone TOP: Durable Sync — stop active prod data loss

Row order IS the sequence (2026-08-24): **2026-08-31 P0 insert (bug 47p investigation): T8160 + T8170 jump the queue - prod upload OUTAGE (every fresh upload fails since the ~2026-08-30 deploy; root cause reproduced: T7950's orphan reclaim aborts its own just-created multipart because R2 ListMultipartUploads returns different UploadId strings per call). T8180 (ghost annotate session) follows T8150.** Then **T8110** (inserted at the top 2026-08-31 by user order - admin panel test-account filter + whole-DB column sort), then the Upload Failure Integrity epic, then the drop-off-investigation P1 bugs (T7590/T7580/T7540/T7520 + outreach T7610 + smaller findings), then the activation follow-ups from the CapCut/best-practices review (user: liked, not priorities), then the admin-dashboard audit bugs (T7960/T7970/T7980/T7990/T8000 - user-ordered 2026-08-28, must ship with the current build, placed above JIT Migration). **2026-08-31 insert (user-approved): T8150 (P1 vanishing-game bug) + the First-Clip Funnel epic (T8120-T8140) sit directly after T8110 - the activation-cliff work from the ux-investigator prod investigation ([theory doc](ux/UX-annotate-first-clip-2026-08-31.md)); the Tutorial Redesign epic gained the binding Help-button directive the same day (see its EPIC.md).** Table must stay CONTIGUOUS - a non-table line between rows breaks the task board's parser and hides every row after it.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
*Admin Auth Hardening epic (T8300, T8290) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
*First-Clip Funnel epic (T8120, T8130, T8140) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
*T7690 (share-back attribution audit) DECIDED 2026-09-03 — audit delivered, all 5 proposals approved, split into the [Share-Back Attribution epic](tasks/share-back-attribution/EPIC.md) (moved to its own milestone after Final Polish, below).*
*Tutorial Redesign (guided essential path: epic + T7620/T7630/T7640) and its four blocking prerequisites (T8390/T8400/T8370/T8380) moved AFTER the "Next Up" section — user order 2026-09-02: finish every Next Up task first. See the "Tutorial Redesign: guided essential path" section below Next Up.*
*JIT Migration epic (T5083, T5085, T5087) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
*T7610 (stuck-user outreach) moved to the Milestone: Final Polish section (2026-09-01, user order); still WAITING ON USER on booking link + send timing.*
*Collection Download epic (T4945/T4946/T4947) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
*T7190/T7200/T7210/T7220 are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
*The Upload Failure Integrity epic (T7480/T7470/T7490/T7500), T7360, T7820, T7510, T7590, T7580, T7540, T7520, T7530, T7550, T7560, T7570, and T7600 are complete — rows archived to [PLAN-archive.md](PLAN-archive.md). T7580's "Create Reel" copy on the Overlay finish button was later reversed by T7700 per user request; the Focus/Export naming from T7580 stands elsewhere. T7600 shipped its idempotency fix; the orphan-audit + rank-pool-question items split off into [T7830](tasks/T7830-sweep-orphan-audit-rankpool-question.md).*

**UI Runway CLOSED 2026-08-17.** All near/mid-term UI-visible work landed first — including [T6630](tasks/player-intro/T6630-overlay-text-add-remove-drag-ux.md) (STAGING, merged 2026-08-08) — and the tutorial reshoot ([T5140](tasks/T5140-reshoot-tutorial-videos.md), archived to [PLAN-archive.md](PLAN-archive.md)) shipped in the 2026-08-17 prod deploy, closing the runway. NOT gated on the reshoot and still open on their own schedules: [T6500](tasks/T6500-overlay-font-catalogue.md) (pushed out 2026-08-09, polish-only), T5750 (evidence-gated), Multi-File Ingest & Prep (deprioritized 2026-07-31), Movement Tracking + Dual-Camera milestones (post-reshoot features — when one lands, the affected quest gets a touch-up reshoot, not a full redo), the UI Pass epic row (all children shipped; row open only for ledger reconciliation). **Exception (user-ordered 2026-08-10):** [T6350](tasks/T6350-move-reels-half-apply-on-sync-failure.md)/[T6345](tasks/T6345-postgres-migration-runner-skips-version-gaps.md)/[T6410](tasks/T6410-migration-swap-discards-unsynced-writes.md) were refactor/durability work with no visible UI change that landed BEFORE the reshoot rather than after — shipped in the 2026-08-13 prod deploy, archived to [PLAN-archive.md](PLAN-archive.md) (Milestone TOP section). [T6441](tasks/tile-video-preview/T6441-hover-preview-in-overlay-drafts.md) also moved ahead of T5140 (bundled into the same pre-reshoot session, small enough to not delay it) and is likewise archived. T6680/T6690/T6700 (all UI-visible) also gated the reshoot and are now archived (2026-08-13 prod deploy); T6710 (design-gated at the time) landed too — the Overlay quest's text-editor rail work (T6480/T6600/T6610/T6630/T6640) was on-screen in the current tutorial and has since landed too (archived, 2026-08-13 prod deploy).

**Now unblocked — the "after the reshoot" group is ready to start:** the **admin-dashboard audit bugs** (T7960/T7970/T7980/T7990/T8000, user-ordered 2026-08-28 — 4 correctness bugs found auditing the admin analytics panel against a screenshot, plus a scaling assessment for thousands of users; must ship with the current build) are FIRST. Then the [JIT Migration epic](tasks/jit-migration/EPIC.md) (T5081-T5089, user-ordered 2026-08-04; **re-affirmed 2026-08-28** — signups growing, the bulk sweep is outgrown; target: JIT live in the next deploy, that deploy's post-migrate is the LAST manual run, then delete the bulk machinery + applied migration files; rows now in the table above) — not a UI-runway member, placed immediately after the admin-audit bugs and ahead of Preview Video Improvements. [Collection Download](tasks/collection-download/EPIC.md) (above) is complete already. Relative order between JIT Migration and Preview Video Improvements not yet specified by the user. **T7140 (renumbered from T7020 2026-08-17, previously "first after the reshoot") was deprioritized out of this group entirely on 2026-09-01 by user order, then moved again on 2026-09-02 (user order) to the For Launch — Infrastructure section, next to T2580 (Faststart Upload Validation).** **The [SEO Content & Landing Value Props epic](tasks/seo-content/EPIC.md) is NOT part of this group** — per the Priority Policy (growth work sits behind infrastructure bugs) it is sequenced after Milestone TOP finishes entirely, not merely after the reshoot; see the SEO & Organic Discovery section below.

|  | **[Preview Video Improvements](tasks/preview-video-improvements/EPIC.md)** | 6 | 5 | 1.2 |  |  | Filed 2026-08-17, taking over the PLAN.md slot T7020 (unrelated task, renumbered to T7140) used to hold. **Merges the former Tile Video Preview epic** (design settled 2026-08-03; T6420/T6441 shipped and archived, T6440 carries forward unchanged below) rather than running two epics for one feature surface — see EPIC.md's merge note. Two user asks (2026-08-17): remove the hover-preview's artificial reveal delay, and give mobile a tap-to-select-plays-preview trigger, **replacing** T6430's never-built in-viewport-scroll-autoplay design (T6430 marked SUPERSEDED in place, not deleted). Not started. |
| T7160 | ↳ [Mobile: tap-to-select plays preview](tasks/preview-video-improvements/T7160-mobile-tap-select-plays-preview.md) | 7 | 5 | 1.4 | TODO | [ ] | Epic child 2/3, depends on T6420 + T7170. Supersedes T6430. First tap on an eligible tile selects it and starts its inline preview (reusing T6420's WARM/REVEAL machinery + single-active registry, triggered by tap instead of hover); second tap opens it. Neither tile type actually has this scheme today (ReelTile: single tap goes straight to full player; DraftTile: long-press reveals actions, modal preview not inline) — this is new design, not a wire-up. L-tier, Architect gate required; task file lists 4 open design questions including a real ReelTile tap-to-play-speed tradeoff to confirm with the user. |
| T6440 | ↳ [Autoplay-previews setting + data-saver](tasks/preview-video-improvements/T6440-autoplay-setting-data-saver.md) | 3 | 2 | 1.5 | TODO | [ ] | Epic child 3/3, depends on T6420 (+T7160 for touch, was T6430). Moved unchanged from the merged Tile Video Preview epic. "Autoplay previews" toggle (default ON) in the existing settings surface, persisted gesture-based - Netflix shipped without this and had to add it under user pressure. Data-saver guardrail for metered connections (sideline cellular is exactly this audience). |

### Milestone: Highlight-First + Single-Clip Editor + Quest Removal (user request 2026-09-24, ships in the Deploy Candidate)

**Filed 2026-09-24 from a user request:** "The point is to get users intuitively making
highlights." Two epics. [Highlight-First Annotate Flow](tasks/highlight-first/EPIC.md): editing a
play requires a star rating, "Brilliant" becomes "Highlight", Done on a Highlight play offers Make
Highlight Now / Keep Annotating, Create clip / Frame CTAs leave Annotate, mode bar becomes Annotate
/ Frame Highlight / Add Spotlight gated on the selected play's clip. [Single-Clip Editor: remove
Reels and multi-clip editing](tasks/single-clip-editor/EPIC.md): Reels tab + Create reel deleted,
Framing/Spotlight become one-clip-only, ~4,000 production LOC removed; Reels returns later as a
post-publish stitcher ([T11300](tasks/T11300-reels-v2-post-publish-stitcher.md), ICE, NOT next
version). **This reverses the 2026-09-13 vocabulary ruling** (Highlight as modifier only; mode noun
Framing) and changes screens the Tutorial Redesign core, T10320 and T9720 anchor to. **All 55
questions answered 2026-09-24** (decision artifact https://claude.ai/artifact/CWHnjGEUCzqMhgeyQGrzwB;
rulings copied into each EPIC.md and task file). **Placement (R1, owner): part of the Deploy
Candidate, before the Tutorial Redesign core (T7620/T7630/T7640), T10320 and T9720**, which must
be re-derived against these screens. Table must stay CONTIGUOUS.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Highlight-First Annotate Flow](tasks/highlight-first/EPIC.md)** | 9 | 6 | 1.5 | TODO |  | Rating becomes the gesture that makes a highlight. T11100 design gate first; T11120 -> T11130 strict (same files). |
| T11100 | ↳ [UX design gate: editor layout, rating modal, Highlight popup, mode bar](tasks/highlight-first/T11100-ux-design-gate.md) | 8 | 2 | 4.0 | DECIDED | [ ] | Decided 2026-09-24 after 4 rounds: P2 palette, A2 editor layout, rate modal (only when unrated), B3 in-place choice card (Make Highlight Now / Back to Editing, closes editor, toast), D2 mode bar. Mockups https://claude.ai/artifact/FFGqtZQnE4a9n9PHjANaeA |
| T11110 | ↳ [Rating 5 becomes "Highlight", in gold](tasks/highlight-first/T11110-brilliant-to-highlight-rename.md) | 6 | 3 | 2.0 | WIP | [x] | UI labels + backend derived names + gold for rating 5; rating 2's Amber Yellow collides with gold (H15). Persisted ids (`brilliant_clip`, `annotate_brilliant`, `brilliant_count`) unchanged. |
| T11150 | ↳ [Play editor hierarchy (time, name + rating, details) and no "clip" wording in Annotate](tasks/highlight-first/T11150-play-editor-hierarchy-no-clip-word.md) | 7 | 4 | 1.8 | TODO | [ ] | Owner ruling 2026-09-24. All 5 editor layouts; tags + notes behind Details; Play category / sport placement is H16. Before T11120 (same files). |
| T11120 | ↳ [Unrated Done opens the "Rate this play" modal](tasks/highlight-first/T11120-require-rating-gate.md) | 8 | 4 | 2.0 | TODO | [ ] | A gate, never a write: picking a rating in the modal is the gesture and continues the exit. 7 in-editor exits + 4 outside paths mapped; H5 decides which open it. |
| T11130 | ↳ [Highlight popup: Make Highlight Now / Highlight Later; remove Create clip + Frame CTAs](tasks/highlight-first/T11130-done-popup-highlight-choice.md) | 9 | 5 | 1.8 | TODO | [ ] | Reuses the T10450 Frame Now / Frame Later handlers, ref-guarded. Highlight Later toast, exactly: "Highlight moved to clips so you can edit it later". |
| T11160 | ↳ [Team plays become highlights like any other](tasks/highlight-first/T11160-team-plays-become-highlights.md) | 5 | 3 | 1.7 | TODO | [ ] | Owner ruling 2026-09-24. Audit: nothing blocks it except a caption; downstream questions T1-T5 (star counts, ranking, intro card, recap split, auto-export fallback). |
| T11140 | ↳ [Mode bar: Frame Highlight / Add Spotlight, gated on the selected play's highlight](tasks/highlight-first/T11140-mode-bar-rename-and-gating.md) | 7 | 3 | 2.3 | TODO | [ ] | Today Framing opens the most recent clip, not the selected play's. Switcher-only label keys (MODE_NAMES feeds ~30 strings). |
|  | **[Single-Clip Editor: remove Reels and multi-clip editing](tasks/single-clip-editor/EPIC.md)** | 8 | 7 | 1.1 | TODO |  | Dependency order below. No schema migration unless R3 picks the split option. |
| T11200 | ↳ [Read-only census of multi-clip drafts and reels (all envs)](tasks/single-clip-editor/T11200-multiclip-data-census.md) | 7 | 3 | 2.3 | TODO | [ ] | Counts drive R3. Walks every profile DB from R2 read-only, plus archive JSON and Postgres share tokens. |
| T11210 | ↳ [Characterization: single-clip Modal golden + delete dead endpoints](tasks/single-clip-editor/T11210-characterize-and-delete-dead-endpoints.md) | 5 | 3 | 1.7 | WIP | [ ] | `/chapters`, `/concat-for-overlay`, `POST /api/projects`, `preview-clips`, `ProjectCreationSettings.jsx` have zero callers. |
| T11220 | ↳ [Legacy multi-clip data: keep drafts reachable, block re-edit/restore of multi-clip reels](tasks/single-clip-editor/T11220-legacy-multiclip-data-handling.md) | 8 | 5 | 1.6 | TODO | [ ] | No user may lose a draft or published video. Depends on T11200 + R3/R4. |
| T11230 | ↳ [Remove Reels building surfaces (Reels tab, Create reel, from-clips)](tasks/single-clip-editor/T11230-remove-reels-building-surfaces.md) | 7 | 4 | 1.8 | TODO | [ ] | Deleted, not hidden: it assembles raw clips into an editable project, which Reels v2 will not. |
| T11240 | ↳ [Remove multi-clip UI from Framing and Spotlight](tasks/single-clip-editor/T11240-remove-multiclip-editor-ui.md) | 7 | 6 | 1.2 | TODO | [ ] | Clip sidebar, library/upload modals, cockpit Clips sheet, multi-clip export branch. ~1,700 LOC. |
| T11250 | ↳ [Remove multi-clip backend: clip-management endpoints + export N>1 branches](tasks/single-clip-editor/T11250-remove-multiclip-backend-export.md) | 6 | 6 | 1.0 | TODO | [ ] | Single-clip export already runs through `_export_clips`; delete the N>1 branches, keep the module. Modal untouched (R10). |
| T11260 | ↳ [Remove multi-clip highlight carry, clip boundaries, Spotlight gates](tasks/single-clip-editor/T11260-remove-multiclip-highlight-carry.md) | 5 | 4 | 1.3 | TODO | [ ] | After T11220: carry code is what keeps legacy multi-clip highlights alive. |
| T11270 | ↳ [Collapse clip selection to "the clip" (mechanical)](tasks/single-clip-editor/T11270-collapse-clip-selection.md) | 3 | 3 | 1.0 | TODO | [ ] | Move-only commit. |
| T11280 | ↳ [Reel vocabulary sweep on published, share, legal and landing copy](tasks/single-clip-editor/T11280-reel-vocabulary-sweep.md) | 6 | 3 | 2.0 | TODO | [ ] | Noun per R2. Landing recruiting-reel page claims multi-clip assembly (R7). |
|  | **[Remove the Quest System](tasks/quest-removal/EPIC.md)** | 6 | 5 | 1.2 | TODO |  | Owner ruling 2026-09-24: no more quests; keep only what a future opt-in Guided mode needs (all derivable from games/clips/exports/published/shares). Quests still pay 80 of the 88 welcome credits, so T11170 moves that grant first with the ledger strings frozen. Open G1-G6. |
| T11170 | ↳ [Welcome credits no longer depend on quests](tasks/quest-removal/T11170-welcome-credits-decouple.md) | 8 | 2 | 4.0 | TODO | [ ] | Never rename `quest_upfront` / `questbank:` or every account is paid again. Fresh signup must still end at the advertised total. |
| T11175 | ↳ [Reroute funnel analytics off the quest achievements endpoint](tasks/quest-removal/T11175-funnel-analytics-reroute.md) | 5 | 3 | 1.7 | TODO | [ ] | The achievements POST is also the admin-funnel bridge; move ~15 event families to funnel events with per-session dedup. |
| T11180 | ↳ [Delete the quest system, frontend](tasks/quest-removal/T11180-delete-quests-frontend.md) | 4 | 3 | 1.3 | TODO | [ ] | Pure deletion (~2,000 LOC); quest UI is already gone. Re-key TutorialVideoModal by topic. |
| T11185 | ↳ [Delete the quest system, backend (+ optional table drops)](tasks/quest-removal/T11185-delete-quests-backend.md) | 4 | 4 | 1.0 | TODO | [ ] | Pure deletion (~2,200 LOC), never deployed before T11180. v005/v006 read `completed_quests`: guard before any table drop. |
| T11300 | [Reels v2: stitch published highlights into a college highlight reel](tasks/T11300-reels-v2-post-publish-stitcher.md) | 8 | 8 | 1.0 | ICE | [ ] | NOT next version (user 2026-09-24). Reuses collections' play-as-one, stitched download, intro/outro compose, share links. |

### Milestone: Deploy Candidate (user-ordered 2026-09-17: THE next deploy)

**Filed 2026-09-17 from the user's own staging run** plus a scan of every open row above Revenue
Record Integrity. Goal, in the user's words: "a tight plan to get this build out to users. Previous
versions struggled with ease of use and intuitiveness. This should be the version that lets users
fulfil on the promises they signed up for without getting lost." Rule for membership: **kill bugs
and finalize the streamlined UI**; features that are not part of that story stay out (T10180,
T7160/T6440, Universal Upload leftovers T8838/T8872/T8892 are NOT in, pending the user's word).
Everything already at STAGING ships with this candidate automatically and is not re-listed.

**Row order IS the sequence** (user rulings 2026-09-17 applied): (1) crash + upload bugs, (2) the
pricing single-source refactor (merged) and the landing overclaim, (3) UI finalization, (4) the
Tutorial Redesign core (epic row + its three children; the leftover half is T10330 in the "Guided Mode: next
iteration" section) - **user order: not before every
other task in this milestone is implemented AND the UI approved, because guided mode anchors to the
final screens**, (5) the tutorial videos, shot after guided mode ships so they show the real UI, (6)
the release gate. **The 12.99/22.99/32.99 reprice (T10220) is deliberately AFTER this build** (user
ruling 2026-09-17; reading B, credits get cheaper) - see the "After the Deploy Candidate" table right
below. Nothing here is code work for the AI until the user assigns it: this milestone was prepared as
a consolidated plan (user instruction 2026-09-17). **Prod read-only check 2026-09-17** (backing
T10270): `daily_counters` since the 2026-09-13 deploy shows 13 game uploads succeeded / 0 recorded
failures (2026-09-14: 8, 2026-09-16 and 17: 0), zero `*_upload_failed` rows in `user_actions`, and
no bug reports after #57 (2026-09-13, already triaged) - but the audit in T10270 shows whole failure
classes (clip batch endpoint, pre-prepare client deaths, credits-after-prepare) record nothing, so
"0 recorded" is not "0". T10190 and T8872 were considered and left OUT (user ruling). Table must stay
CONTIGUOUS.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Tutorial Redesign: guided essential path](tasks/tutorial-redesign/EPIC.md)** | 9 | 7 | 1.3 | TODO |  | Split 2026-09-17 (user order: build the epic in concert with this milestone): the essential-path core (T7620 design, T7630 core, T7640 matrix + rollout) is front-loaded HERE, sequenced last before the videos and the gate; everything else is T10330 in the "Guided Mode: next iteration" section. User rulings 2026-09-17 (recorded in EPIC.md's 2026-09-17 section): when Help is ON the app is FULLY guided (no per-step "Not now"; the exit is closing Help, which must be one obvious tap and re-openable at any time); multiple options at a fork are fine (game video vs. clip at the start); the guide derives what to show from where the user is plus what they have done, and ANTICIPATES likely next intents and explains them; each fork option carries a one-line consequence caption; default ON for anyone who has not EXPORTED yet, OFF for anyone who has (amends D1's "published" to "exported"); tutorial videos come back in-app via the Help panel (T10320), so T7630 must NOT delete `TutorialVideoModal`. The approved T7620 design already is a facts-driven rule engine with fork F1 as its headline example; the remaining implementation-time work is re-deriving all 69 rules' copy from `displayNames.js` (pre-T9860 vocabulary). Do not start until every other task in this milestone is implemented and the UI is approved by the user. |
| T7620 | ↳ [Architect design: guided-tour engine + steps](tasks/tutorial-redesign/T7620-guided-tour-design.md) | 8 | 4 | 2.0 | DECIDED | [ ] | Epic 1/3, design gate (user approval). Engine (shade portal, data-tutorial-target registry, re-anchoring, step advance via existing gesture handlers, interrupt/resume, escape hatches), full step table incl. mobile anchoring, state model (toggle + step bookmark, existing-accounts default = explicit user decision), quest reconciliation, failure-mid-tour behavior. |
| T7630 | ↳ [Implement engine + essential-path steps](tasks/tutorial-redesign/T7630-guided-tour-implementation.md) | 9 | 6 | 1.5 | TODO | [ ] | Epic 2/3, **RE-SCOPED 2026-09-17 to the essential-path CORE** (engine, ladder L1-L5, forks F1/F3/F5/F8, Help chip + panel with toggle / ladder / Watch the walkthrough / Report a problem, stall pulse, consequence captions, default ON until first export, quest PANEL deletion, copy re-derived from `displayNames.js`); the post-publish advanced tier, F6/F7, legacy cleanup and the admin readout moved to T10330 (next iteration). **In the Deploy Candidate milestone (2026-09-17), sequenced LAST: do not start until every other milestone task is implemented and the UI approved by the user. The four directive deltas are RULED (EPIC.md 2026-09-17 section): fully guided when on with Help-close as the only exit; default ON until the first export; consequence captions on fork options; videos return via the Help panel so `TutorialVideoModal` stays.** **Prerequisite chain fully cleared 2026-09-17 (re-verified against PLAN-archive.md): R3,R4 -> T8360 -> T8370 -> T8380 are ALL DONE (deployed 2026-09-13 prod), T7620 design DECIDED/approved — nothing left blocking this task from starting.** T7620 design APPROVED 2026-09-02 (GUIDANCE_MAP spine, 69 rules incl. post-publish advanced tier + fork F8). **STALE VOCABULARY WARNING (found 2026-09-17): this row's own target-attribute guidance below is now WRONG — do not trust it, re-derive from `displayNames.js`/`MODE_NAMES` at implementation time instead.** It says "Focus (not Framing)"; T9860 (merged, STAGING) later renamed the DISPLAY name "AI Focus" -> **Framing** (2026-09-13 user decision, PLAN.md Current Focus) while internal file/component names stay `Focus*` (T7700/T9320 precedent: never rename internals for UI consistency) — so the guided tour's user-facing copy must say "Framing", not "Focus", even though `data-tutorial-target` attributes may still live on `Focus*`-named components. Original (now-superseded) guidance for reference only: "Clip Out Play" (not Create Reel, T8760), "Build New Reel" (not Create Highlight Reel, not New Highlight Reel — renamed again by T8780), Published/In Progress Reels tabs (not My Reels/Highlights); REUSE T8390's existing `data-tutorial-target="focus-publish"` — these narrower nouns should ALSO be re-verified against `displayNames.js` before use, not assumed current. Engine + target attributes + toggle/bookmark persistence (gesture-written only); e2e drives the full guided path; a failing guided step surfaces the real error, never traps. |
| T7640 | ↳ [Screen-size matrix + quest reconciliation + rollout](tasks/tutorial-redesign/T7640-screen-size-matrix-rollout.md) | 7 | 4 | 1.8 | TODO | [ ] | Epic 3/3 (front-loaded with T7630 into the Deploy Candidate, 2026-09-17), blocked by T7630 **AND by T8370+T8380 (user directive 2026-09-02: clip upload + the Clips-screen Add Video entry ship before the tutorial launches - the guided path's pre-cut branch needs them live)**. Step-by-width screenshot matrix (320/375/428/768/1280+, keyboard open/closed, safe areas), real-device iPhone pass on the two mobile-cliff steps, quest reconciliation (**NOTE: T8690 SHIPPED — the quest_1-4 watch-video steps are ALREADY hidden behind `TUTORIAL_VIDEOS_ENABLED=false`; reconcile the remaining steps vs the guided tour, don't re-retire videos**), default-on rollout, user walkthrough on staging as final gate. |
| T10320 | [Re-bake instructions and reshoot the tutorial videos for the new flow and vocabulary](tasks/T10320-reshoot-tutorial-videos-v3.md) | 7 | 5 | 1.4 | TODO | [ ] | **Ruling 2026-09-17: videos come back IN-APP as well as on the site** (amends the epic's 2026-08-31 "no more videos" directive; recorded in EPIC.md). Entry point is the Help panel, never the retired quest steps (the gate is mirrored server-side, T9410). Two extra asks from the user: (a) the current video sometimes gets CUT OFF when the narration is about a button below the fold - audit the capture spec + the player's sizing so the target is on screen when named; (b) the video plays too small - size the encodes and the player for each surface it plays on (in-app modal on phone and desktop, landing launcher). Vocabulary drift is ~15 renames; shoot only after every other candidate task, including guided mode, is on staging. |
| T9720 | [End-to-end and failure-path release check](tasks/T9720-end-to-end-and-failure-path-release-check.md) | 7 | 5 | 1.4 | TODO | [ ] | **The release gate for this candidate** (moved here 2026-09-17). Runs upload -> two plays -> framed clip -> effects -> private save -> reopen -> authorized test publication, plus direct-clip and multi-clip reel, desktop and mobile, normal and fullscreen, then slow network, interrupted upload, failed render, navigation during preview load, duplicate clicks and mid-flow reload. Fixture `wcfc-carlsbad-trimmed.mp4` CONFIRMED local 2026-09-17 (47,989,792 bytes, 89.32s). T9740 landed 2026-09-13. Absorbs T10020's checklist. Add the guided mode (T7630) and the new upload dialogs (T10250/T10260) to its path. Check whether it should become a permanent staging-gate lane (`STAGING-GATE.md`; machine scaled to 4x/4096 first). |
| T9730 | [Product review and traceability sign-off](tasks/T9730-product-review-and-traceability-signoff.md) | 6 | 3 | 2.0 | TODO | [ ] | Closes the candidate (moved here 2026-09-17). Marks every item from the Sept 9-10 and Sept 12-13 evaluations AND this milestone exactly one of fixed (with evidence) / verified not reproducible / deferred with rationale / overridden by decision. Depends on T9720. Publish as an artifact. |

#### After the Deploy Candidate (user-ordered 2026-09-17)

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T10220 | [Rebalance monetization: 12.99 / 22.99 / 32.99 ladder](tasks/T10220-reprice-credit-packs.md) | 7 | 2 | 3.5 | STAGING | [ ] | User: lowest 12.99, middle 22.99, max 32.99, keep the discount curve, on the site and in the app. After T10210 this is a `pricing.json` edit; Stripe needs no dashboard work (inline amounts). **Rulings 2026-09-17: deferred until AFTER this build ships, and reading B** - keep incentivizing bigger packs: 12.99 = 340 credits (today's best-value rung becomes the entry), 22.99 = 690, 32.99 = 1,120, each rung cheaper per credit than the last. Consequence to state at implementation: the derived storage anchor moves from 5c to 4c, so upload/extension charges cost ~25% more credits (users get more credits per dollar, storage costs more of them). The single-source refactor it depends on (T10210) is merged. |

### Milestone: Play Editor Autosave + mobile trim layout (user-ordered 2026-09-19)

**Filed 2026-09-19 from the mobile trim audit** (decision artifact https://claude.ai/artifact/2oxojEQTrAhJhfG23UmJus: live 393x852 reproduction of the Edit/Mark Play sheet hiding the video, and the Focus export bar wrapping its captions one word per line, with the ui-designer's option ledger). User ruling: "get rid of the update button" — the play editor stops being a submit-form; every control persists on its own gesture (the SURGICAL pattern CLAUDE.md endorses and `ClipDetailsEditor` already uses; reactive `useEffect` persistence stays banned). First task is the Architect design gate, the rest are UX. **Strict order T10600 -> T10610 -> T10620** (shared files: `AnnotateFullscreenOverlay.jsx`, `AnnotateModeView.jsx`, `AnnotateContainer.jsx`); T10630 is file-disjoint and may run in parallel. Placement relative to the Deploy Candidate is the user's call — it is UI finalization of the Annotate editor, the same story as T10290/T10310 above. Table must stay CONTIGUOUS.

*Play Editor Autosave + mobile trim layout epic (T10600, T10610, T10620, T10630) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Milestone: Focus Result Loop (user-ordered 2026-09-19)

**Filed 2026-09-19 from the user's own session.** Two halves of one complaint about what happens
AFTER a framing render: the app forgets the video it just made you, and the one action that says
"no spotlight" walks you through the Spotlight editor anyway. Both are Focus-side only, frontend
only, no schema. **Strict order T10650 -> T10660** (shared file `src/frontend/src/screens/FocusScreen.jsx`,
so they cannot run in parallel). T10650 carries the user's two design rulings (D1/D2 in the task
file); T10660 carries the verified root cause and supersedes T9740's readiness-poll mechanism.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Milestone: Clip Ready Screen (user-ordered 2026-09-19)

**Filed 2026-09-19 from the user's own post-export screenshot** (epic: [tasks/clip-ready-screen/EPIC.md](tasks/clip-ready-screen/EPIC.md);
decision artifact https://claude.ai/artifact/9w4SKRvSbdNzMLpwFxNWKF, approved same day, variant V2 +
video-controls option 3; full spec with per-state Tailwind strings in `tasks/clip-ready-screen/design-proposal.md`).
Three complaints: no play/pause or fullscreen on the finished video; the "saved to your drafts" line +
"Save draft" link + its caption are redundant and confusing; the three real choices "don't look fun".
Follow-up ruling: the published-reel player gets the same controls. Frontend only, no schema. **The two
tasks are file-disjoint and may run in parallel**; neither touches `FocusScreen.jsx`/`OverlayScreen.jsx`,
so both are clear of T10650/T10660. Design gate already satisfied (user approval), Reviewer required on both.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Milestone: Rating Unset State (user-ordered 2026-09-19)

**Filed 2026-09-19 from a screenshot-driven question about the Annotate rated badge.** T10610
(merged same day) made the rated badge unconditionally green, since create-at-tap now seeds every
play with a real default rating (`NEW_PLAY_DEFAULT_RATING = 4`). User saw this, was told it
reverses a decision made hours earlier, and ruled explicitly for a true null rating over a
session-only "touched" flag: a play can have NO rating on record until the user picks one, which
needs a schema change (`raw_clips.rating` currently `NOT NULL`). Design approved 2026-09-19 (recommended
option taken on every open question except the TSV round-trip fix, deferred). **Strict order
T10700 -> T10710** (T10710 stops the frontend from seeding a default rating, which 500s every
Mark-play tap until T10700's migration is live on staging).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Milestone: Mobile Annotate timeline zoom (user-ordered 2026-09-20)

**Filed 2026-09-20 from a staging phone screenshot.** The Annotate plays track renders a full game across ~280 px on a phone, so plays collapse into an unreadable green smear. `TimelineBase` already has zoom, scroll sync and a touch `MobileScrollbar`; Annotate just pins `timelineScale={1}`. Mockup artifact: https://claude.ai/artifact/JorjZij5XGKnYQMr6myHri. File-disjoint from T10760/T10770. T10800 (player letterbox) was found on the T10780 phone test and is file-disjoint from it.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Milestone: Focus on a landscape phone (user-ordered 2026-09-21)

**Filed 2026-09-21 from the user's own staging screenshot** (epic: [tasks/focus-landscape/EPIC.md](tasks/focus-landscape/EPIC.md); design approved same day, [design doc](tasks/focus-landscape/T10840-design.md); mockup artifact https://claude.ai/artifact/FMzKSFwwAKLsZ8hRJuzVCx, 6 artboards incl. an interactive cockpit). A phone held sideways gets `sm:` tablet CSS driven by JS that says phone: the crop box is scrolled off the top, a 224 px clip rail shows one row and a disabled `Transition:` control, the action band takes 27% of the viewport for a credit-rounding sentence, and ~900 px of content stacks into a **812 x 334** viewport (measured: 77 px of height and 79 px of width go to system chrome before our first pixel). `useIsLandscape()` has existed since Annotate and Focus never read it. Fix is a distinct cockpit layout entered automatically on rotation, plus a hint on each side of the flip. Frontend only, no schema. **Strict order T10830 -> T10840 -> T10850** (all three touch `modes/FocusModeView.jsx`). 16 settled decisions D1-D16 in the design doc; D1/D2/D3/D6/D7/D10-D14 summarized in EPIC.md.

*Focus on a landscape phone epic (T10830, T10840, T10850) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Hotfix (user-reported live 2026-09-19 / 2026-09-20)

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Admin panel correctness (user-reported live 2026-09-22)

| ID | Task | Impact | Complexity | Ratio | Status | Design | Notes |
|----|------|--------|-----------|-------|--------|--------|-------|
| T11010 | [Admin upload attempt/success pairs + funnel that reads as users](tasks/T11010-admin-upload-pairs-and-funnel-user-counts.md) | 6 | 2 | 3.0 | STAGING | [ ] | Filed and implemented 2026-09-22 from a live prod admin screenshot. Three read-side defects: (1) `clip_upload_attempted` was registered by T8370 and reserved by T8380 but emitted by NOTHING, so every direct-upload account read "0 tried / N succeeded"; (2) the Games pair mixed grains - `game_created` is per GAME, `game_upload_succeeded` is per VIDEO FILE, so a multi-angle game showed success exceeding attempts ("1 / 5"); (3) the funnel LOOKED like event counts (114%/138%/700%) though both endpoints already `COUNT(DISTINCT user_id)` - caused by `FunnelChart.jsx` looking up `framing_opened`/`framing_exported` when the backend derives keys from the LABEL (`focus_opened`/`focus_exported`), so those rows were a hardcoded 0; by `clip_uploaded` never being listed in `STAGES`; and by step-over-step conversion on non-nested steps. Fix: one new `game_upload_attempted` event (`daily_col: None`, **no migration**) emitted alongside `clip_upload_attempted` from the SAME `prepare_upload` seam keyed on the request's explicit `kind` (user decision: no duration/size threshold - `kind` is already authoritative and validated to a closed set); cells drop the words "tried"/"succeeded" per user decision (the `/` carries it); funnel keys corrected, Clip Uploaded stage added, percentages become share of signed-up so no row can exceed 100%. **Known limitation, disclosed:** the game pair has no history and is not backfillable (synthesising attempts would be fabricated data), so pre-existing accounts read `0 / N` until they upload again. **Does NOT replace [T7465](tasks/investor-analytics/T7465-journey-flow-graph.md)** - that journey graph is still the real answer; this is the cheap honesty fix. |
| T11060 | [test_shared_game_extension.py depends on leaked user context](tasks/T11060-shared-game-extension-test-isolation.md) | 3 | 2 | 1.5 | TODO | [ ] | Found by T10220 proof verifier 2026-09-24, pre-existing on master. 8 tests fail with `No user context set` when the file runs alone (setup reaches `ensure_database` without a context); they pass in CI only because earlier tests leak context. Breaks curated relevant-set runs. Fix the fixture, not production. |
| T11070 | [CI "Ruff (changed files vs master)" step lints nothing](tasks/T11070-ci-ruff-changed-files-step-lints-nothing.md) | 5 | 2 | 2.5 | STAGING | [ ] | Found 2026-09-24 by T8650 proof verifier; user: file and do. The backend job runs in src/backend, so the repo-root pathspec `src/backend/**/*.py` matches nothing and `xargs -r` skips ruff: the step silently passes on every branch. Anchor with `:(top)`, and make it a per-file ratchet (changed files may not gain errors; new files must be clean) so the 239-error frozen backlog does not fail every branch. |

## Single-Server Priority (2026-07-18; durability re-escalated 2026-07-24)

The stack is currently ONE server. **Correction (2026-07-24): the durability epic is NOT safely
deferred to multi-server.** It was parked on the belief that its failure needs two live machines,
but arshia lost a 400-credit grant AND 5 published reels on the *single-server* stack — via deploy
machine-replacement (a local-only write dies when the machine is swapped) and R2-error stale
force-push (a writer builds on a stale local copy and overwrites newer cloud state). So the
*silent-data-loss* half of the old epic is now the **TOP** milestone below (the deeper
two-machines-both-live race in T4310 is still partly multi-server, but its single-server face is
real and included). The lower-priority format/concurrency tasks split out to the
[Write Correctness epic](tasks/write-correctness/EPIC.md).

### Milestone A: Do Now — user-reported single-server bugs (no blockers)

The class that has twice destroyed real prod data (arshia's profiles 2026-07-17; his credits + 5
reels 2026-07-24). Point-fixes already landed (branch `fix/admin-credit-grant-r2-sync`:
grantee-DB sync, `TrackedConnection` owner tracking, move_reels `require_fresh`, + the 5 reels
recovered); these tasks are the general guarantees behind those point-fixes.

**Moved ahead of the tutorial reshoot (user-ordered 2026-08-10):** [T6350](tasks/T6350-move-reels-half-apply-on-sync-failure.md), [T6345](tasks/T6345-postgres-migration-runner-skips-version-gaps.md), and [T6410](tasks/T6410-migration-swap-discards-unsynced-writes.md) shipped in the 2026-08-13 prod deploy — archived to [PLAN-archive.md](PLAN-archive.md) (Milestone TOP section). None were UI-visible, but the user chose to land them before the reshoot rather than after.

*T6530 (intro card discoverability UX, DECIDED - split into T6660/T6670/T6680/T6690) moved to the Milestone: Final Polish section (2026-09-01, user order).*

*T6780 and T6770 are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Milestone 0: Tooling first — make the staging gate trustworthy (DONE)

Do this before the feature bugs: right now "is staging green?" can't be answered by one run, so
every derisk is manual. Fixing it de-risks all the rest.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Next Up

Standalone, immediately actionable — no epic prerequisites.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Fast App Update (speed up new version load)](tasks/fast-app-update/EPIC.md)** | 7 | 5 | 1.4 | TODO |  | HIGH PRIORITY (user-ordered 2026-09-09), filed from the same walkthrough as T9320/T9330/T9350: "update version takes so long", then "create an epic/tasks to speed up new version load". Goal: cut the wall-clock from "a new build is live" to "the user is running it" from minutes to seconds, WITHOUT reintroducing a blocking interstitial (T8460 deleted it deliberately) and without reloading anyone mid-work (T9310 Gap A). Three legs, one child each: time to notice (a waiting bundle never self-activates - `registerType:'prompt'` + a no-op `onNeedRefresh` make `checkServerVersion` the sole activator, and it is throttled to 5 min; T9310's Part 1 verdict recorded that for an idle tab making no API calls the window is "effectively unbounded" and called that acceptable in steady state - this epic reopens that judgement because the user has now asked for fast), time to fetch (the SW precaches the whole new build before it can go `waiting`; nobody has measured how much a one-line deploy actually re-downloads, and the fact that installs routinely blow past the 10s `SW_INSTALL_TIMEOUT_MS` is evidence this leg is not small - it is also the only leg that scales with the user's connection, i.e. sideline cellular), and time to activate (quiescence wait + `flush-verify` + `skipWaiting`->`controllerchange`->full reload, with a 3.5s Safari escalation that may be the NORMAL path rather than the exception). T9340 gates the other three. Already done and not to be redone: T9310 shipped Gaps A/B/C and explicitly deferred D. |
| T9380 | ↳ [Shrink time-to-activate](tasks/fast-app-update/T9380-shrink-time-to-activate.md) | 5 | 4 | 1.3 | ICE | [ ] | Epic 4/4, blocked on T9340. Three questions, in order: (1) is the 3.5s `SW_ACTIVATE_TIMEOUT_MS` Safari escalation the NORMAL path or the exception - if normal, detect the condition and go straight to the manual bust-and-reload instead of waiting for an event that will not come; (2) what does the quiescence wait actually cost - seconds is worth paying to not reload someone mid-gesture, minutes means the condition is satisfied by the wrong events and needs narrowing (never removing); (3) does the reload have to be a full cold boot at all - the ambitious end, likely rejected, and route/scroll restoration is a perceived-latency win rather than a real one, to be judged as such. Do NOT "clean up" `updateGateStore`'s dynamic imports of exportStore/uploadStore - static caused a production-only Rollup TDZ crash. Real Safari device testing required if the escalation path is touched. M-tier for 1+2; L with an Architect gate for 3. |
*Cross-Profile Game Attribution epic (bug 37p; sole child T5830) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
| T10340 | [reset_user_id() doesn't actually clear a leaked user-context contextvar](tasks/T10340-reset-user-id-contextvar-leak.md) | 4 | 2 | 2.0 | TODO | [ ] | Found during T10270's Branch CI fix. `app/user_context.py`'s `reset_user_id()` uses `ContextVar.set()`+`.reset(token)`, which restores whatever value was active BEFORE the `.set()` call, not "unset" -- a no-op whenever an earlier test in the same process already set the var and never cleared it. Fix: give `_current_user_id` a real `_UNSET` sentinel default (mirrors `_current_impersonator_id`'s existing pattern) so `reset_user_id()` can just `.set(_UNSET)` directly. Contained to 4 functions in one file; run the full backend suite before landing since it's shared test infra. |
| T10350 | [Upload/app log drain to R2 (D2 follow-up to T10270)](tasks/T10350-upload-log-drain-to-r2.md) | 3 | 4 | 0.8 | TODO | [ ] | T10270 shipped D1 (durable Postgres record) only, per its own design's D1/D2 split. D2 is a raw Fly log drain (Vector -> R2, TTL'd) so `[UPLOAD_FAILURE]`/`[UPLOAD_BEACON]` lines survive past Fly's retention window. Infra work, no app code. Not urgent - D1 already answers the acceptance criteria on its own. |
| T10540 | [Game poster/thumbnail races the first clip save, caches the wrong frame forever](tasks/T10540-game-poster-stale-vs-first-clip-race.md) | 4 | 4 | 1.0 | TODO | [ ] | Found live while testing T10520/T10530 (unrelated): a freshly uploaded game's thumbnail never reflected the play marked+saved during upload — it stayed on a visibly different framing. `Explore`-agent investigation (medium-high confidence, not yet log-confirmed): `poster.py`'s `_choose_game_poster_frame` falls back to a fixed `GAME_POSTER_FALLBACK_OFFSET_SEC=60.0` frame when a game has zero `raw_clips` yet; the activation handler fires `warm_game_source_poster_background` essentially immediately on upload-complete, almost certainly before the user's multi-step mark/rate/save flow lands a clip. `ensure_game_source_poster` cache-checks R2 first with **no re-generation and no invalidation hook anywhere** on `raw_clips` insert/rating (unlike reel drafts' `invalidate_draft_poster`, which has no game-poster analog) — so the fallback frame sticks forever once cached. `list_games`'s `warm_visible_game_sources` reproduces the same race independently on every Games-tab load. Suggested fix direction: invalidate + re-warm the cached poster key at the first-clip-save write path; needs an Architect/expert pass first (touches a shared R2-cached asset with two independent fire-and-forget warmers) — not yet designed or implemented. |
| T10990 | [Big lag on the first Portrait/Landscape switch of a Focus session](tasks/T10990-focus-first-aspect-switch-lag.md) | 4 | 3 | 1.3 | TODO | [ ] | User report 2026-09-21 (prod). Investigated with T10980: the gesture is 3 sequential round trips (~100 ms in dev), nothing first-time-only on the frontend; the only first-write-only server path is the `.sync_pending` retry in `db_sync.py`. Prod log buffer was too short to inspect the report window. Re-test after T10980 (the pre-fix selector made the first click a no-op), then capture request timings on staging. |
*T7290/T7320/T7330/T7340/T7350/T7370/T7380/T7390 are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*


### Parent Walkthrough Remediation (2026-09-09 handoff)

**Filed 2026-09-10** from an external first-time-parent walkthrough of **staging** run 2026-09-09/10
(`reel-ballers-staging.pages.dev`, desktop Codex in-app browser), plus Andrew's supplied feedback and
screenshots. Archive:
`C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md` + `01-bugs.html` B1-B11 + `04-ux-change-specifications.html` UX-01..18 +
`03-naming-consistency.html` N01-N47). The run was against **current** staging, so these are live
findings, not stale ones. No source-code or network diagnosis was performed by the reporter: every
item is an observation, and the mechanism is ours to establish.

**Row order is execution order, user-chosen 2026-09-10: bugs, then naming, then UX restructuring.**
T9400 leads because a broken "Report a problem" is the channel every other bug arrives through.

**Four decisions taken at filing (each stated with its conflict, then chosen anyway):**

1. **Adopt the full report naming model** (Shared Vocabulary epic), with two binding overrides: mode
   names stay **AI Focus** / **Spotlight** (T9320, shipped 2026-09-09; N16/N18 overridden), and
   statuses are **not** re-modelled (T8470's Draft/Shared stands; N22 overridden). The model
   deliberately reverses T8130 (Add Play), T8760 (Clip Out Play) and part of T8555 ("In Progress"
   tab prefixes) - recorded as decisions, not drift.
2. **Re-hierarchize the post-Focus action bar** (T9590). This reverses T8390's flat four-action bar
   and the product owner's 2026-09-08 "Publish Now"/"Add Spotlight Now" pairing, and moves T9110's
   Overlay bar with it so the two stay consistent.
3. **Keep Draft/Shared statuses**; T9600 only removes the contradictory extra labels found on one card.
4. **File all seven decision and verification tasks** (T9670-T9730) rather than relying on the tier
   policy and the staging gate.

**Deduped out before filing** (already shipped or in flight; verify on staging before implementing
anything that touches them): the "Step N of M" copy and the AI Focus/Spotlight renames (T9320), the
four home-tab guidance screens (T9390), direct clip upload and its entry point (T8370/T8380),
video-first upload with optional metadata (T8700/T8500), cost disclosure before file selection
(T8500), and the draft-preview modal consolidation (T8535). Several tasks below are expected to
shrink once re-verified; that is a good outcome and should be recorded, not implemented around.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|

*T9720 (release gate) and T9730 (traceability sign-off) moved to the Deploy Candidate milestone (2026-09-17) - they close that milestone.*

### First Reel Funnel (walkthrough remediation)

**User-ordered 2026-09-03.** Walkthrough remediation: a fresh account must reach a shared reel
with zero dead ends. Source: the 2026-09-02 first-time-parent staging walkthrough + UX designer
expert review ([artifact](https://claude.ai/code/artifact/79e0afa6-666f-44ea-9e42-7c39939e3e2e)),
decisions in [EPIC.md](tasks/first-reel-funnel/EPIC.md).

*All 15 children are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Clip Upload & Reel Completion (split out of Tutorial Redesign, user order 2026-09-04)

**User question 2026-09-04: why was T8370 filed under "Tutorial Redesign" when it isn't
tutorial-building work?** Correct catch — T8390/T8400/T8370/T8380 were filed FROM the
T7620 guided-tour design round only because the guided tour needs them live to anchor its
steps to; each is independently justified in its own task file as a real product fix
("standalone... a product win on its own" for T8390/T8400; T8370 closes a real observed
failure — pre-cut clips uploaded as nonsense "games", credits burned for nothing). Split
into this standalone epic so it competes and reads on its own merits, sequenced BEFORE
Tutorial Redesign (the dependency always ran this direction — T7630/T7640 were blocked ON
these, never the reverse, so nothing about the work itself changes). Row order = the
existing dependency order from T7620-design.md 18.3: R3, R4 -> T8370 -> T8380.

**Next Up's gate is now moot for this epic.** The old Tutorial-Redesign gate text required
every UI-visible Next Up task to "ship" first — checked 2026-09-04, and T8200/T8210/T8220/
T8230/T8240/T8260/T8270/T8280/T8310/T8320/T8330 are ALL already STAGING (merged, deployed
to staging, awaiting user promotion to DONE). That prerequisite is satisfied; it no longer
blocks anything here or in Tutorial Redesign itself.

**Pre-flight note for T8390/T8400 (added 2026-09-04):** both were filed 2026-09-02, before
T8520/T8530/T8540 shipped (merged 2026-09-04). T8530's shared `usePublishProject` hook +
draft preview player and T8540's Share-primary player action may have already
substantially or fully satisfied "Focus gets a publish exit" and "publish lands on the
reel with share at hand" — re-verify against the CURRENT shipped code before implementing
either (same pattern as the T8490-vs-T8600 pre-flight check earlier this session). A task
that turns out to already be satisfied gets closed with a note recording why, not
implemented redundantly. See the pre-flight note appended to each task file.

**File-ownership note (UPDATED 2026-09-04):** T8380 and T8400 both touch
`ProjectManager.jsx` and the published-reels surface — now **`PublishedReelsPanel.jsx`**
(renamed from DownloadsPanel by **T8555, which SHIPPED**, replacing T8545's three-tab
redesign with the four-tab IA: Games / In Progress Clips / In Progress Reels / Published).
**The landing surface has LANDED — no wait remains** for either task; they build directly
against the shipped four-tab structure. T8390 (Focus publish exit) and T8370 (pre-cut clip
upload) also SHIPPED tonight.

*Both gaps closed — T8390 (Focus publish exit), T8400 (publish lands on the reel), T8370 (pre-cut
clip upload) and T8380 (Clips-screen Add Video entry) are all DONE, rows archived to
[PLAN-archive.md](PLAN-archive.md). This epic never had its own child task files (see task
descriptions for how each satisfies this epic's two stated gaps).*

### Milestone: Universal Upload & Angles (user-ordered 2026-09-05, before Tutorial Redesign)

**Filed 2026-09-05 from the approved concept** (decision artifact with mockups + real-footage
analysis: https://claude.ai/code/artifact/3a4411ea-3034-4235-a6fe-078f73b61e9b). One universal
intake replaces Per Game / Per Half (any files or a whole camera folder, auto-ordered from
embedded recording times with filename fallback), an optional client-side shrink (crop-to-field
+ re-encode via WebCodecs; a 50 GB 8K DJI game becomes a 3-12 GB upload), and overlapping
sideline phone clips become switchable "angles" in Annotate (derived minimal lanes, violet UI,
Fix-timing nudge), plus Add footage from inside Annotate. Settled design decisions live in
[EPIC.md](tasks/universal-upload/EPIC.md); row order is the strict dependency order. T8830 is a
go/no-go spike gating T8840-T8860; a NO-GO sends the shrink tasks back to the user for re-scope.
**Shrink integration moved (2026-09-08):** T8845/T8850/T8860 now live in the
[Video Pre-Shrink milestone](#milestone-video-pre-shrink) (Pre-Shrink Integration epic),
sequenced after a Pre-Shrink Research epic that finishes the open shrink research first.
Tutorial note: T7640's screenshot matrix runs AFTER this milestone lands or the guided tour will
anchor to the deleted Per Game / Per Half toggle - reconcile at T7640 time.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|

*T8836 (survey, DONE 2026-09-17 - user confirmed T9070, deferred T9080) — row archived to
[PLAN-archive.md](PLAN-archive.md). T8840 (standalone shrink tool) relocated to the Video
Pre-Shrink milestone below — user direction 2026-09-17: the whole shrink-tool track is deferred
until after Tutorial Redesign, so it now sits with the rest of that work instead of here.*

### Milestone: Publish Load Performance (user-ordered 2026-09-08, before Tutorial Redesign)

**Filed 2026-09-08 from `published.har` analysis** (41 requests, waterfall + findings:
https://claude.ai/code/artifact/25370533-d3ce-4381-8d31-66feedac679c). The Publish screen sits
blank ~4.9s after mount — NOT video weight (zero `.mp4` bytes in the capture). Seven unrelated
endpoints (`admin/me`, `health`, `rank/confidence`×2, `collections/summary`, `intro-cards`,
`bootstrap`) resolve in near-perfect lockstep 3.6s after firing, then four more repeat the
pattern for ~0.9s — the documented **T6200 blocking-event-loop signature** (`app/utils/offload.py`),
not yet root-caused for this specific burst. Two things the user asked about were checked and are
**already correct, no task filed**: `+faststart`/moov-to-front is universal across every encoder
and enforced pre-upload (`storage.py` `FaststartCheck`), and preview video already loads
poster-first + hover-only (`TilePreviewVideo.jsx`, zero video bytes at mount confirms it). Full
findings in [EPIC.md](tasks/publish-load-performance/EPIC.md).

*Publish Load Performance epic (T9120, T9130, T9135, T9140) is complete — rows archived to
[PLAN-archive.md](PLAN-archive.md). T9120's row was found stuck at WAITING ON USER despite every
downstream child already DONE — corrected 2026-09-17.*

### Guided Mode: next iteration (Tutorial Redesign epic, the half that does not ship in the Deploy Candidate)

**Renamed and split 2026-09-17** (user: "re-name the latter and make sure the tasks are built in
concert; whatever supports our next deploy moves to the front-loaded one and whatever is left
remains in the next iteration"). The epic's design (T7620), the essential-path core (T7630,
re-scoped) and the matrix + rollout (T7640) now sit as children of the epic row inside the
[Deploy Candidate milestone](#milestone-deploy-candidate-user-ordered-2026-09-17-the-next-deploy).
This section holds only what the next deploy does not need. History that still applies: the
2026-09-02 "every UI-visible Next Up task ships first" gate is satisfied; T8560 folded into
T7620/T7630; the four blocking prerequisites (T8390/T8400/T8370/T8380) are DONE.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T10330 | [Guided mode, next iteration: post-publish advanced tier, remaining forks, ledger cleanup](tasks/tutorial-redesign/T10330-guided-mode-advanced-tier-and-cleanup.md) | 6 | 5 | 1.2 | TODO | [ ] | Carved out of T7630 along the design's own deferral boundary (`T7620-design.md` §19): the post-publish advanced tier A1-A10 (21 `rung: 'A'` rules, Help-chip menu mode, fork F8's "show me what else" answer, one-earned-nudge-per-set engagement), fork F7 (F6 is obsolete under the no-dismissal ruling and gets deleted), the legacy cleanup the core leaves in place (`POST /quests/panel-collapsed`, `modalOcclusion.js`, the dead `TUTORIAL_VIDEOS_ENABLED` flags on both sides, old quest-panel e2e), the voice-readiness audit, and a per-rule engagement readout in admin. Blocked by T7630 + T7640 live and user-approved. |

### Revenue Record Integrity (sequenced AFTER the Tutorial Redesign group)

**User order 2026-09-03.** Filed the same day from the prod revenue-reconciliation
investigation, then deliberately sequenced behind the tutorial work: the accounting hole is
real but bounded (one $3.99 payment, one deleted account), while the tutorial group is the
growth lever. Nothing here blocks or is blocked by the tutorial tasks, and no task in this
epic has a UI surface that would gate the tutorial group. **Pull-forward exception:** T8660
(Stripe receipts, Cmplx 2, independent of the other five) is the one row worth taking early
if a dispute ever lands, since a receipt is the standard dispute defence and we currently
send none.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Revenue Record Integrity](tasks/revenue-integrity/EPIC.md)** | 7 | 4 | 1.8 | TODO |  | Filed 2026-09-03 from a prod investigation: the admin Revenue Reconciliation panel showed local $0.00 vs Stripe $3.99, cause "Unknown". Root cause proven read-only against prod PG + live Stripe: a real customer paid $3.99 on 2026-08-24 (`pi_3U7p5aIxob3dHqK01QfOa5qu`, fulfilled - `daily_counters.credit_purchases` = 1 that day) and the account was later DELETED, which wipes `user_segments` (the only local revenue value) and `credit_transactions` (the only local payment ids). Stripe keeps the charge forever, so our books lost money that was really earned. User decision 2026-09-03: no refund, chargeback risk accepted - this epic is about never losing the RECORD again. Holes: no per-payment local financial record at all; deletion destroys revenue history with no warning and no audit row (we could not determine who deleted the account, when, or via which path); the drifted row is permanently un-healable (`set_total_spent` needs a `user_segments` row that no longer exists, so heal returns false and the red row returns every run); every admin revenue figure is `SUM(total_spent_cents)` so it can only drift downward, invisibly; `increment_total_spent` is a bare UPDATE that logs success on 0 rows matched; no Stripe receipts (`receipt_email` never set, so no dispute defence and no identity trail after deletion); drift is only ever seen if a human clicks. Design follows standard practice (research + sources in EPIC.md): money records are append-only and outlive the customer record, personal data is what gets erased - GDPR's legal-obligation carve-out and CCPA's transaction/legal-obligation exemptions both apply PER DATA CATEGORY, so retaining a pseudonymous financial row is the compliant answer, not the violation. Identity found in our own docs, not our DB: the deleted payer is bigajosue@gmail.com, the headline casualty of the 2026-08 upload outage ([T7470](tasks/upload-integrity/T7470-upload-failure-cascade-delete.md) documents the same user id paying at 04:03 then losing 4 uploads; the 05:00 admin impersonation in the residue IS that investigation). That a financial record survived only in prose is part of what this epic fixes. Also blocks a downstream trap: [T7610](tasks/T7610-stuck-user-outreach.md)'s approved win-back copy for this user promises "your credits are intact, and I've added 50 extra credits to your account" against an account that no longer exists. |
| T8620 | ↳ [Append-only payments ledger + Stripe backfill](tasks/revenue-integrity/T8620-payments-ledger.md) | 7 | 5 | 1.4 | STAGING | [x] | Epic 1/6, foundation. New append-only Postgres `payments` table (signed amounts, one row per money event, unique on `(stripe_object_id, kind)` so a webhook redelivery is a no-op - this also closes the documented refund-idempotency gap at payments.py:425), written in the 4 existing `if result["applied"]` fulfillment branches + the refund branch, plus a re-runnable Stripe backfill script so history is complete from go-live (the 2026-08-24 orphan backfills into a row whose user_id matches no user - that IS the tombstone). Amount comes from what Stripe captured, never from the repricing-sensitive `CREDIT_PACKS` constant. Same pass fixes `increment_total_spent`'s silent no-op (upsert or rowcount + CRITICAL). Postgres track: needs `_SCHEMA_DDL` + `POST /api/admin/migrate-postgres` after deploy; check unmerged siblings for a colliding version number. |
| T8630 | ↳ [Deletion preserves the financial record and is auditable](tasks/revenue-integrity/T8630-deletion-preserves-financial-record.md) | 7 | 4 | 1.8 | WIP | [x] | Epic 2/6, depends on T8620. Ledger rows survive deletion (stamped `account_deleted_at`, never filtered out of revenue); new `account_deletions` audit table records user_id, when, actor (self/admin/script), path, and whether money was attached - answering every question the 2026-09-03 investigation could not. `delete_user.py` refuses a paying account without a new `--force-paid`, and refuses a bulk run containing one BEFORE deleting anything. The CCPA self-serve endpoint is NOT blocked (an erasure right is not refused), it just stamps + audits. Privacy policy and the in-app delete confirmation must state that transaction records are retained and why: retaining silently is the compliance problem, retaining with a stated basis is the answer. |
| T8640 | ↳ [Reconciliation understands deleted accounts](tasks/revenue-integrity/T8640-reconciliation-deleted-account-cause.md) | 5 | 3 | 1.7 | TODO | [ ] | Epic 3/6, depends on T8620+T8630. New `DriftCause.ACCOUNT_DELETED`, classified before dispute/refund (`test_mode_era` cannot catch it - that branch needs `pi_count == 0`). Classifier STAYS PURE: the new fact arrives as a parameter, never a DB read inside it. Preferred resolution is to delete UI rather than add it - once the reconciler compares against the T8620 ledger, the row reconciles by construction and needs no acknowledge gesture (fallback: durable acknowledgement on `account_deletions`). Also: a heal that returns `healed: false` must be VISIBLE on its row instead of silently refreshing, and an id-only row shows "account deleted <date>" instead of a bare grey UUID. Keep the `set(local) |
| T8650 | ↳ [Revenue totals read the ledger, not the per-user cache](tasks/revenue-integrity/T8650-revenue-totals-from-ledger.md) | 6 | 3 | 2.0 | STAGING | [ ] | Epic 4/6, depends on T8620. All four `SUM(total_spent_cents)` reads (admin.py 1318/1479/1945/1983) move to `SUM(payments.amount_cents)`, which is already net because refunds are negative rows. Deleting an account must stop changing a historical revenue figure for a month that already closed. Grand totals sum the ledger with NO user join (a deleted payer belongs to no cohort and no origin, which is correct for a cohort chart and wrong for a total); any grouped view that cannot attribute a payment shows the unattributed remainder rather than quietly dropping it. `total_spent_cents` stays as the per-user display cache and is documented as such at every definition site. |
| T8655 | ↳ [Remove the dead credit-amount-to-price map](tasks/revenue-integrity/T8655-remove-dead-credit-price-map.md) | 2 | 1 | 2.0 | TODO | [ ] | Filed 2026-09-24 from T10220 proof verification. `CREDIT_AMOUNT_TO_CENTS` lacks the T780 ladder (40/85/180), but its only reader `_compute_money_spent_cents` has had no production caller since T3450 (admin revenue reads `total_spent_cents`, recorded at real price), so nothing is under-reported today. Delete the dead map, helper, unused `purchase_credit_amounts` aggregate and their pin tests. After T10220 merges. |
| T8657 | ↳ [Admin "paying" filter selects users from the ledger](tasks/revenue-integrity/T8657-paying-filter-reads-ledger.md) | 3 | 1 | 3.0 | STAGING | [ ] | Found 2026-09-24 by T8650 proof verifier; user: file and do. After T8650, `filter=paying` still selects payers via `total_spent_cents > 0` then sums ledger revenue, so a cache/ledger disagreement (reconciliation heal, backfill-only history) mis-selects. Select payers from the ledger via T8650's per-user subquery. After T8650 merges (same admin.py code). |
| T8670 | ↳ [Scheduled reconciliation with a drift alert](tasks/revenue-integrity/T8670-scheduled-reconciliation-alert.md) | 4 | 3 | 1.3 | TODO | [ ] | Epic 6/6, depends on T8640. Drift is currently only ever seen if a human opens the panel and clicks - this one sat unnoticed for 10 days. Weekly pass reusing the SAME pure classifier (thin caller, no second implementation) on the existing background scheduler, single-machine so a multi-machine Fly app does not alert N times. Alerts ONLY on `unknown` drift plus pending disputes; after T8640 every other cause is an explained state. CRITICAL log first, admin email via existing Resend as the upgrade, no new alerting dependency. Read-only: healing stays an explicit admin gesture. **Overlaps T1702** (Monetization + Intelligence, which already scopes Stripe revenue tracking + weekly alerts) - whichever lands second folds in rather than shipping two schedulers. |
| T8675 | ↳ [Dispute webhook writes ledger rows](tasks/revenue-integrity/T8675-dispute-webhook-ledger-rows.md) | 4 | 3 | 1.3 | TODO | [ ] | Follow-up split from T8620 design gate (user ruling 2026-09-24): no live dispute webhook exists, so a newly lost dispute leaves the ledger above Stripe net until a backfill re-run. Handle the Stripe dispute event, write a negative `dispute_lost` row idempotently, move the cache only on a new row. Depends on T8620. |

### Milestone B: Single-server data correctness (needs the export harness first)

Real single-server data bugs, but each needs the export golden harness [T4370](tasks/export-write-path/T4370-export-golden-harness.md) or its epic in place first — so **T4370 is the actual unlock** for this milestone:

- [T4390](tasks/export-write-path/T4390-finalize-publish-single-writers.md) (imp 9) — the finalize-a-reel DB step is copy-pasted 5×, one missing version/duration → inconsistent reel records. *(export-write-path epic)*
- [T4430](tasks/T4430-ffmpeg-params-probe-consolidation.md) (imp 8) — `-shortest` truncation live in 2 render paths → truncated exported video. *(needs T4370)*
- [T4420](tasks/T4420-single-interpolation-module.md) (imp 7) — 4 diverging crop-interpolation copies → local vs Modal export crop differently. *(needs T4370)*
- [T4340](tasks/write-correctness/T4340-canonicalize-segments-at-write.md) (imp 7) — segments_data stored in two formats → the inverted-clip / wrong-recap render class. *(write-correctness epic, a pure single-server data bug)*
- [T4350](tasks/write-correctness/T4350-reexport-retransform-highlights.md) (imp 6) — highlights drift onto the wrong moments after a re-export. *(write-correctness epic; after T4340)*

### Milestone C: Editor correctness (epic-gated)

Single-server bugs sitting inside sequenced epics — do their prerequisite first:

- [T4450](tasks/keyframe-unification/T4450-shared-keyframe-track.md) (imp 7) — the "can't delete the first keyframe" bug. *(keyframe-unification; needs T4440 dead-code sweep first)*
- [T4500](tasks/editor-decoupling/T4500-selectedproject-selector.md) (imp 6) — stale selectedProject → wrong name/ratio after a rename. *(editor-decoupling; needs T4470–T4490 first)*

### Code Quality & Refactoring (2026-07-03 audit)

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
*Write Correctness & Concurrency epic (T4330/T4340/T4350/T4355/T4360) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
|  | **[Export Write-Path Unification](tasks/export-write-path/EPIC.md)** | 9 | 7 | -- |  |  | One implementation per export/publish operation, behind a characterization harness. STRICT order. The T4010/T4020/T4110/rank-sweep incident class, removed structurally. |
| T4400 | ↳ [Backend-Authoritative Export (mark-exported)](tasks/export-write-path/T4400-backend-authoritative-export.md) | 9 | 6 | 1.5 | TODO | [ ] | Export still trusts CLIENT state: full-state PUT can clobber newer surgical edits (two tabs; T4020 class — guarded only by frontend conventions incl. an always-false predicate); multi-clip renders the payload then stamps DB exported WITHOUT reconciling (DB ≠ rendered video). Backend snapshots its own blobs; client sends no keyframes. Gate: verify no hook state exists that gestures never persisted. |
| T4410 | ↳ [Export Pipelines → Services + Sweep Unification](tasks/export-write-path/T4410-export-pipelines-to-services.md) | 9 | 8 | 1.1 | TODO | [ ] | routers/export/ = 5,878 L (YOLO, ffmpeg, a 640-line _export_clips in a router); duplicate send_progress/callback/sync pairs (only one sync is T4110-durable); sweep auto-export is a parallel universe (no job record, own ffmpeg/R2/status literals). Slices: merge helper pairs → code motion → dispatcher shape → sweep onto shared rails (T4160 semantics preserved as parameters). |
| T4420 | [One Crop-Interpolation Module (4 Catmull-Rom Copies)](tasks/T4420-single-interpolation-module.md) | 7 | 4 | 1.8 | TODO | [ ] | Rendering-identity math ×4 (app/interpolation.py canonical + upscaler + 2 Modal copies) — divergence = local vs Modal exports crop differently. Package canonical into the Modal image; parity fixtures captured from all copies FIRST (existing divergence = a finding to surface). Also: GPU-param on process_framing_ai (kills the L4 200-line copy) + delete the _optimized benchmark file. Modal redeploy (ask). Depends on T4370. |
| T4430 | [FFmpeg Encode-Params + Probe Consolidation](tasks/T4430-ffmpeg-params-probe-consolidation.md) | 8 | 7 | 1.1 | TODO | [ ] | ~55 hand-built ffmpeg arg lists in 13 modules; libx264 block ×15 in one file that ignores its own helper; `-shortest` truncation fix documented in one path, still live in two (output-correctness split); CRF drift 18/23/32 unnamed; 6+ ffprobe implementations each defaulting "30/1". Named encode profiles + one probe (raises on failure); -shortest migration is an isolated, golden-verified behavior commit. Depends on T4370. |
|  | **[Keyframe System Unification](tasks/keyframe-unification/EPIC.md)** | 8 | 6 | -- |  |  | Finish migrating overlay onto framing's keyframe systems (controller, resolveTargetFrame, flat-list rules). STRICT order. Absorbs T3810 + T3820. |
| T4440 | ↳ [Dead Keyframe/Timeline Code Deletion Sweep](tasks/keyframe-unification/T4440-dead-code-deletion-sweep.md) | 6 | 2 | 3.0 | TODO | [ ] | Delete the dead parallel stack that still absorbs fixes: OverlayTimeline + HighlightLayer + components/Timeline (no importers), useHighlight (T3810), name-colliding container wrappers, framingStore corpses (clipStates/videoFile/markExported), annotateHasSelectedClip + its reactive writer, ReferenceError-if-rendered OverlayVideoOverlays. ~800+ lines; grep-prove each. |
| T4450 | ↳ [Shared KeyframeTrack Rendering](tasks/keyframe-unification/T4450-shared-keyframe-track.md) | 7 | 4 | 1.8 | TODO | [ ] | CropLayer vs RegionLayer keyframe rendering forked; delete gating diverged into THE "can't delete first keyframe" bug (highlight path still enforces the dead permanent-keyframe model). One KeyframeTrack; flat-list delete rule uniform; the gating change is the single intended diff. |
| T4460 | ↳ [Overlay onto Keyframe Controller](tasks/keyframe-unification/T4460-overlay-onto-keyframe-controller.md) | 9 | 7 | 1.3 | TODO | [ ] | **Stage 2 gate.** useHighlightRegions re-implements the whole lifecycle (own snap window 5-vs-10 + own parallel fix for the resolveTargetFrame identity bug + fps=30). Controller grows region-scoped tracks; T3820's snap direction decided by user here; payload-parity tests per gesture (persistence semantics = the T350-class risk). |
|  | **[Editor State Decoupling](tasks/editor-decoupling/EPIC.md)** | 8 | 6 | -- |  |  | Kill cross-screen timing contracts + duplicate state (T1670-family breeding ground). Independent except T4530 last. |
| T4470 | ↳ [FramingContainer: One Next-State per Gesture](tasks/editor-decoupling/T4470-framing-single-nextstate.md) | 8 | 4 | 2.0 | TODO | [ ] | 8 hand-mirror sites rebuild segments/crop payloads to fight React batch timing ("won't have the new value yet"); trim handler mirrors a stale value today. Pure computeNext per gesture → hook + store + API from the same object; batching workarounds deleted; surgical payloads unchanged. |
| T4480 | ↳ [Kill clipMetadata Event-Bus + One Overlay Loader](tasks/editor-decoupling/T4480-clipmetadata-bus-removal.md) | 7 | 4 | 1.8 | TODO | [ ] | clipMetadata = stored derived data AND a cross-screen message consumed by an effect whose first act is a store write; fires "fresh export" on ordinary loads. Plus two duplicate 60-line overlay-data loaders (5 setters already wired twice). Explicit navigation payload (pendingNavigation pattern); one loadOverlayData; clipMetadata derived via selector. |
| T4490 | ↳ [Working-Video State Machine](tasks/editor-decoupling/T4490-working-video-state-machine.md) | 8 | 6 | 1.3 | TODO | [ ] | Working-video truth spread across 2 stores + project fields + 4 OverlayScreen guard refs + a 65-line reconcile effect with reactive recovery — the T1670/stuck-loading locus. One {status,video} machine in projectDataStore, one loadWorkingVideo action (dedup + bounded retry); FramingScreen stops writing overlayStore; all refs deleted. |
| T4500 | ↳ [selectedProject → id + Selector](tasks/editor-decoupling/T4500-selectedproject-selector.md) | 6 | 4 | 1.5 | TODO | [ ] | selectedProject is an independently-fetched snapshot of projects[]; rename patches only the list → ProjectContext (both editors) serves stale name/ratio/URL. Store selectedProjectId; derive via selector; detail fields merge into the list entry (or the extra fetch dies). |
| T4510 | ↳ [Annotate API Data → gamesDataStore](tasks/editor-decoupling/T4510-annotate-data-to-store.md) | 7 | 5 | 1.4 | TODO | [ ] | gameVideos/tags/share state in container useState with two mount-restore effects re-syncing parallel copies (T1540/T4060 bug class, onboarding surface). Store keyed by gameId, raw shape + selectors + deduped fetch actions; restore effects deleted; upload-completion writes at the upload-event site. |
| T4520 | ↳ [Reactive-Effect Cleanup Batch](tasks/editor-decoupling/T4520-reactive-effect-cleanups.md) | 6 | 4 | 1.5 | TODO | [ ] | Ten verified small violations, one commit each: audio auto-toggle race → gesture; toast dismissal via identity-watching effects ×2 → gesture wrappers; clip-selection triple-owner; getFilteredKeyframesForExport duplicated verbatim; FramingScreen triple load/restore paths → one loadClipIntoEditor; gamesDataStore stored derivations + version counter; hasFramingEdits ×3; setGlobalAspectRatio stale transform path; useState-initializer side effect; export-dirty slice factory. |
| T4530 | ↳ [Editor-Mode Isolation Harness](tasks/editor-decoupling/T4530-mode-isolation-harness.md) | 6 | 4 | 1.5 | TODO | [ ] | LAST in epic. Per-mode mount helpers (real captured API fixtures) proving each mode loads with zero sibling-mode state + regression checks that keep the timing-contract table empty. Overlay mounting alone IS the epic's proof. |
| T4540 | [frameMath + Canonical Framerate](tasks/T4540-framemath-canonical-framerate.md) | 7 | 3 | 2.3 | TODO | [ ] | getFramerate() stub always returns 30; `\ |
| T4560 | [Frontend Primitives Sweep](tasks/T4560-frontend-primitives-sweep.md) | 6 | 4 | 1.5 | TODO | [ ] | Five mechanical consolidations: formatTime ×9 (divergent null/rounding); EDITOR_MODES + KeyframeOrigin constants exist with ZERO imports while raw literals circulate (~15 files / 31 sites — absorbs T301/T302/T303; flips T4290 lint to error); createStrictContext (Crop≡Highlight contexts); Modal primitive that enforces no-backdrop-close + Spinner (31/48 hand-rolled); apiJson helper (exemplar store migration). |
| T4570 | [useEditorScreenShell + Shared Shortcuts](tasks/T4570-editor-screen-shell.md) | 6 | 5 | 1.2 | TODO | [ ] | Framing/Overlay screens are 1,100-line siblings with character-identical shell blocks; Overlay re-implements keyboard inline with DIFFERENT arrow-key semantics than framing's shared hook. Shell hook for the identical 20%; Overlay onto useKeyboardShortcuts (arrow behavior = user decision, applied to both). No full screen merge. After the decoupling epic. |
| T4580 | [usePlaylistPlayback](tasks/T4580-useplaylistplayback.md) | 5 | 4 | 1.3 | TODO | [ ] | Recap + highlights playback hooks return the same 15-key interface with line-identical cores; story playback repeats the rAF core a third time. One engine with an advanceStrategy seam (virtual vs per-clip); ended-advance + pendingSeek race pinned by tests; manual playback pass on all three surfaces. |
| T4590 | [historyStack Extraction](tasks/T4590-historystack-extraction.md) | 5 | 4 | 1.3 | TODO | [ ] | The only undo (useSegments trimHistory, bespoke, already patched once) gets its stack mechanics extracted to a pure historyStack module BEFORE keyframe undo is built from scratch as a second system. Behavior byte-identical; undo-vs-persistence semantics documented for the next consumer. |
| T4600 | [regionTrack Interval Engine](tasks/T4600-regiontrack-engine.md) | 8 | 7 | 1.1 | TODO | [ ] | **Stage 2 gate.** Sorted-non-overlapping-intervals model ×3 (annotate clips / overlay regions / framing segments): same id-generation, overlap, clamping, percent layout. Waves: layout → overlap/creation → boundary drag (characterize per-mode semantics first) → segments adoption depth decided in design (T3120 precedent: partial adoption is a valid outcome). After keyframe epic. |
| T4610 | [require_admin Router Dependency](tasks/T4610-admin-router-dependency.md) | 7 | 2 | 3.5 | TODO | [ ] | ~25 imperative _require_admin() calls — one forgotten = open admin endpoint. Router-level Depends + a meta-test iterating router.routes so FUTURE handlers are covered automatically. Security-shaped, tiny. **Do this BEFORE T5940** — its meta-test becomes the safety net for the split, and doing it after means applying the dependency 8 times instead of once. |
| T5950 | [Verify cross-machine CAS conflict (blocked: 1 box)](tasks/T5950-cross-machine-cas-conflict-verification.md) | 6 | 3 | 2.0 | TODO | [ ] | **BLOCKED until we run more than one backend machine — not actionable today.** Prod runs a SINGLE Fly machine, so a CAS conflict cannot occur as deployed, and the single-container dev stack cannot produce one either. User call 2026-07-26: "we are still on 1 box so I'm not worried about it." The durability epic's guards (T4310 CAS upload, T4315 restore-if-newer, T5870 pending/failed/conflict + honest Retry) are all unit-tested and red-verified, but the human-facing sequence has never run against a REAL conflict: two machines write the same user DB -> second refused -> conflict banner -> Retry does restore-if-newer -> **user is TOLD their local changes were replaced** -> page reloads so render matches disk. That last mile is exactly what T5870 round 1 got wrong (silently discarded the edit and reported success); now fixed + unit-covered both sides, never exercised for real. Pick up when we scale out. |
| T5940 | [Split admin.py into cohesive sub-routers](tasks/T5940-split-admin-router-cohesion.md) | 5 | 5 | 1.0 | TODO | [ ] | Divergent Change, measured: admin.py is 1880 LOC / 34 endpoints / ~10 unrelated domains, changed by **25 distinct task ids across 50 commits** (T525…T5760). The frontend ALREADY found these seams (components/admin/ is split into AnalyticsDashboard, RevenueReconciliation, CreditGrantModal, UserTable, …) — only the backend is monolithic. Analytics alone is ~700 LOC of aggregation logic inline in the router with no services/analytics.py. **Honest scoping: this would NOT have prevented the T5840×T4315 conflict that prompted it** (both edited the credit-grant code specifically — same feature, not accidental adjacency); justify it on Divergent Change, not on that conflict. What weak cohesion DID cost there was blast radius + one real trap: tests/test_persistence_risk_coverage.py mixes middleware-sync tests with admin-refresh tests, so a whole-file resolution silently drops the other task's durability work — splitting that test file is the part with genuine safety value. Sub-routers under routers/admin/ mounted on the same prefix so every URL is byte-identical. BINDING process rules: route-table snapshot test BEFORE any motion; one sub-router per mechanical commit <200 lines; motion never mixed with behavior change (the analytics service extraction is a separate later commit); no dynamic router auto-discovery (greppability). Sequence AFTER T4610 and AFTER T5840 lands. |
| T4620 | [fetch_or_404 + Enums + queries Straggler](tasks/T4620-fetch-or-404-enums.md) | 6 | 4 | 1.5 | TODO | [ ] | ~45 hand-rolled existence checks / 34 "not found" wordings → per-entity helpers (frontend error-string grep first); finish constants.py adoption (games.py imports GameStatus then writes literals; missing enums for storage/export-type/mode/share; absorbs T304/T305); projects.py:338 hand-rewrites latest_working_clips_subquery with a divergent tiebreak — decide correct ordering with a test (T1532 class). |
| T4630 | [R2StreamProxy Service](tasks/T4630-r2streamproxy-service.md) | 7 | 5 | 1.4 | TODO | [ ] | Streaming proxy ×4; the pooled-httpx TTFB fix reached 1 of 4 (games/clips/projects still pay per-request client latency); retry generator duplicated verbatim; must carry T1690's don't-commit-before-R2 fix everywhere. One service; TTFB measured before/after; scrubbing verified on all four surfaces. |
| T4640 | [games.py Services: Activation + One Share Flow](tasks/T4640-games-services-extraction.md) | 6 | 6 | 1.0 | TODO | [ ] | activate_game = 185-LOC handler orchestrating 3 datastores with a deliberate mid-handler commit, guarded only by bug26p comments; share vs share_playback copy-paste ~130 lines incl. except-pass revoke paths. GameActivationService (invariants from T4360 enforced between named steps) + one share_game_flow. Depends on T4360. |
| T4650 | [raw_clips Write-Path Consolidation](tasks/T4650-rawclips-write-path-consolidation.md) | 7 | 5 | 1.4 | TODO | [ ] | Bulk save_annotations_to_db (full-table UPDATE/INSERT/DELETE, own boundaries-version copy) coexists with the gesture path (clips.py save/update). Caller census → legit-bulk keeps a renamed import path using the ONE extracted version logic; illegitimate callers route through gestures. Unclear callers escalate, not guessed. After T4270. |
| T4660 | [open_sqlite Factory + game_display Service](tasks/T4660-sqlite-factory-game-display.md) | 5 | 2 | 2.5 | TODO | [ ] | Connection PRAGMA recipe copy-pasted 4 ways — privacy.py connects with NO busy_timeout/PRAGMAs (lock errors under sync load); game display naming ~100 lines byte-identical in projects.py + downloads.py (naming rules just churned in T4160/T4190). One factory + one game_display module. |

### Keyframe Identity Cleanup (follow-ups from crop/overlay duplicate-keyframe fix)

From the [code quality audit](audit-2026-07-03-code-quality.md) (directives: DRY / sync model / dependence minimization), user-approved 2026-07-03. Bug tier is in the Bugs section above (T4200-T4280). Guardrails land first; epics run in listed order internally; standalone tasks are independent. Epics with **Stage 2 gates** (T4460, T4600) need design approval before implementation.

T3810 (Delete Dead useHighlight Hook) fully absorbed into [T4440](tasks/keyframe-unification/T4440-dead-code-deletion-sweep.md) — no standalone row; see T4440's description for scope.

Surfaced while fixing the keyframe-identity divergence (display snaps an edit to a nearby keyframe, but the surgical persistence sent the raw clicked frame/time, so the backend accumulated near-duplicate keyframes that, on delete, stripped a permanent boundary). Root fix + profile_db v014 heal shipped on branch `fix/crop-keyframe-dup-snap`; these are the remaining DRY/UX cleanups.

### Milestone: Final Polish

**Deprioritized 2026-09-01 (user order)** — held below the active milestones for cleanup/hardening work that isn't blocking anything else right now.

*T7140 (faststart remux) moved to the For Launch — Infrastructure section (2026-09-02, user order), next to T2580 (Faststart Upload Validation).*

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T7610 | [Stuck-user re-activation: segmented hint emails + Discord invite](tasks/T7610-stuck-user-outreach.md) | 8 | 2 | 4.0 | WIP | [ ] | **All copy decisions closed 2026-09-17** — bigajosue re-decided as a start-over invitation (his account was deleted, found 2026-09-03; no false credit claims, 50 credits now grant on re-signup instead of pre-send), ojedalucas19 stays a plain re-engagement (he never noticed the outage), new 14-user cohort approved onto existing segment templates, and the booking-link plan is replaced by a standing Discord invite (`https://discord.gg/abmtZacgsD`) in every email. P1, the only lever recovering the existing 14 users. **HOLD (user decision 2026-08-29): do not send to ANY segment until the next prod deploy**, timing choice not a technical blocker. **HARD SEND GATE (user directive 2026-08-24): NO email until T7480+T7470+T7540+T7490+T7590 verified live on PROD** — satisfiable, all 5 deployed 2026-08-26, mobile upload verified by a real user (mostafaali452010); remaining before send: log gate-verification evidence in the task file, confirm the Discord invite is never-expire/unlimited-uses, and T7880 must reconcile rooom1h's/finneganscudder's stranded uploads first. 5 of the 14 original recipients already got a 2026-08-18/19 win-back email — their copy reads as a follow-up, not first contact. |
| T6530 | [UX pass: how should the intro card feature actually be surfaced?](tasks/player-intro/T6530-intro-card-discoverability-ux.md) | 7 | 4 | 1.8 | DECIDED | [x] | **Moved here from Milestone A 2026-09-01 (user order).** Research + written proposal (22 live screenshots) delivered 2026-08-08, reviewed and decided by the user the same day. Split into 4 implementation tasks: T6660 (naming, final pick "Athlete Intro Card"), T6670 (card selector inline create flow), T6680 (default card before user creates one, design-gated), T6690 (non-active-profile dead end fix). Full decision record in the task file. No code from this task itself - see the 4 children. |
| T8950 | [Audit the credit pricing model for high-resolution/high-fps source files](tasks/T8950-pricing-model-high-resolution-audit.md) | 6 | 3 | 2.0 | TODO | [ ] | Filed 2026-09-05 from live-testing feedback, related to the Universal Upload epic but not one of its ordered tasks. Cost is already purely byte-size-based (no formula bug), but the epic's own DJI evidence (50 GB/game, 8K/60fps) prices out to ~18 credits at current constants vs ~2 credits today for a typical 3GB upload - open questions are calibration + surrounding UX (credit-purchase copy for double-digit charges, whether `MARGIN`/`R2_RATE_PER_GB_MONTH` still make sense), NOT the real-time shrink-step cost preview (already speced in T8850, explicitly out of scope here to avoid duplication). |

### Milestone: Share-Back Attribution

Filed 2026-09-03 from [T7690's audit](tasks/T7690-share-back-surfaces-audit.md) (decision
artifact: https://claude.ai/code/artifact/3e8c3067-2381-4d61-85c9-990ef69bce4e). A working
"make your own reel" viral CTA already exists (`BrandedEndCard`, UTM-tracked) but only fires
on 2 of 4 share surfaces; all 5 tasks below extend or link existing mechanism, none is new.
User-approved 2026-09-03. Row order = priority order (Impact/Complexity), not a dependency
chain — independently shippable, run in any order.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Share-Back Attribution](tasks/share-back-attribution/EPIC.md)** | 6 | 3 | 2.0 |  |  | Closes the gaps T7690 found between where the existing viral-loop CTA fires and where it should. All frontend/copy, one small backend filename change (T8440); no schema, no new mechanism. |
| T8410 | ↳ [Teammate-tag share page: add the "make your own reel" CTA](tasks/share-back-attribution/T8410-teammate-tag-share-cta.md) | 7 | 2 | 3.5 | TODO | [ ] | Highest-impact gap: the teammate-tag page is the exact same-team-parent audience the growth thesis names, and today it's a bare "Sign in to watch" gate with zero brand story. Reuse `BrandedEndCard` verbatim (same component the reel/collection share pages already use). |
| T8420 | ↳ [Game-link share page: add the same CTA alongside the claim button](tasks/share-back-attribution/T8420-game-link-share-cta.md) | 6 | 2 | 3.0 | TODO | [ ] | "Add this game to your account" is a much bigger ask than "try this template" — adds the lighter, existing end-card CTA alongside it, not replacing it. |
| T8430 | ↳ [Link the header wordmark on the game-link and teammate-tag pages](tasks/share-back-attribution/T8430-share-page-wordmark-link.md) | 3 | 1 | 3.0 | TODO | [ ] | Both pages show a "REEL BALLERS" wordmark that goes nowhere. One-line link-wrap fix, land first (touches the same header block T8420 edits). |
| T8440 | ↳ [Brand the download filename](tasks/share-back-attribution/T8440-branded-download-filename.md) | 2 | 1 | 2.0 | TODO | [ ] | `generate_download_filename` produces plain `{name}_final.mp4` while the ffmpeg metadata already carries brand info invisibly. Zero-cost, never-intrusive fix per the CapCut watermark lesson. |
| T8450 | ↳ [Unfurl descriptions: add a soft CTA line](tasks/share-back-attribution/T8450-unfurl-description-cta.md) | 4 | 3 | 1.3 | TODO | [ ] | Ranked last on purpose: all 4 unfurl templates name-drop the brand with no CTA, but adding one risks mobile truncation pushing off the actual who/what info. Needs a real length check per template before deciding to add/shorten/skip. |

### Milestone: Video Pre-Shrink

Filed 2026-09-08 (user direction) from the state of the Universal Upload shrink track:
the standalone tool T8840 merged (PR #368) but its real-hardware acceptance is still open,
auto-crop is automated but untuned, every speed/quality number comes from one laptop and
one 8K folder, and nobody has the production numbers on which file sizes and connection
speeds actually stop users uploading. The thesis to prove with numbers: total time (shrink
+ upload) must go DOWN while visual quality on the players is NOT sacrificed, across ALL
file types, and the pre-shrink must be net-positive for every video type and size (on a
slow connection it should spend MORE time shrinking, because that still saves total time).
Two epics, strictly sequenced: **Pre-Shrink Research** finishes the research (goal
definition first, then the real-folder run, auto-crop on DJI then other cameras, the
all-types benchmark + production survey, the cost model + size-cap bitrate rule, tweening
auto-crop, and T8836's two undecided cheap wins), then **Pre-Shrink Integration** ports the
proven pipeline into the app - the three integration tasks were MOVED here from Universal
Upload with their IDs and content intact. Picked up AFTER Share-Back Attribution.
**Also after Tutorial Redesign (user direction 2026-09-17): the whole shrink-tool track,
including T8840 itself, is explicitly deferred until Tutorial Redesign ships** - this
milestone was already sequenced after it in row order, and now that's a stated decision, not
just a position. T8836 is DONE (user decided 2026-09-17: T9070 confirmed, T9080 deferred,
relocated here from Universal Upload & Angles alongside T8840).

**Epic 1 - Pre-Shrink Research** (order = dependency + "what defines success first"):

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Pre-Shrink Research](tasks/pre-shrink-research/EPIC.md)** | 8 | 6 | 1.3 |  |  | Finish the pre-shrink research so integration is a port of a PROVEN pipeline. Instrument = `scripts/shrink-tool/` (never imported by app code; `pipeline/` stays DOM-free for T8845). No new telemetry: production questions are answered from `user_actions` (T7510 reasons, T8838 census rows) and per-profile `games`/`pending_uploads`. Inputs already settled (T8830/T8832/T8834/T8836/T8838, design R11 + §4.2, T5650 §9) are tabled in EPIC.md - do not re-derive. |
| T8840 | ↳ [Standalone browser shrink tool (fully working, zero app integration)](tasks/universal-upload/T8840-shrink-pipeline-core.md) | 7 | 7 | 1.0 | WAITING ON USER (deferred) | [x] | **Relocated here 2026-09-17 from Universal Upload & Angles** - the whole shrink-tool track is deferred until after Tutorial Redesign. Merged PR #368, commit 0343215e - unit/smoke-tested (34/34 + 32/32 real-browser checks) and 3-lens reviewed in-container; standalone tool has no app deploy, so the user's own real-hardware test IS the test phase (50GB DJI folder + second machine, recipe in `scripts/shrink-tool/README.md`). Not formally an Epic-1 child (T9010 below is), placed here because T9010 directly depends on it. Acceptance = the user runs the written test recipe on the real 50 GB folder AND a second machine and says it works. 11 binding caveats in the file. |
| T9000 | ↳ [Upload-failure analysis: which file-size x connection-speed combinations stop users uploading (sets the milestone goal)](tasks/pre-shrink-research/T9000-upload-failure-size-speed-analysis.md) | 8 | 3 | 2.7 | TODO | [ ] | FIRST on purpose: defines success for the whole milestone. Read-only mining of prod: `game_created` (attempts) vs `game_upload_succeeded` vs `game_upload_failed:{reason}` by size bucket x inferred-bandwidth bucket x platform (bandwidth is not recorded server-side - parts go straight to R2 - so infer from prepare->finalize elapsed and from `pending_uploads` part progress). Deliverable: the matrix + ONE goal line ("a X GB game must upload on Y Mbps in Z hours, output under C GB") written into EPIC.md. Names any non-inferable dimension's would-be beacon; builds none. |
| T9010 | ↳ [Run T8840's test recipe on the real 50 GB DJI folder and a second machine (T8840's open acceptance)](tasks/pre-shrink-research/T9010-verify-shrink-tool-real-folder-run.md) | 8 | 3 | 2.7 | TODO | [ ] | T8840's acceptance was never a test suite: the user runs `scripts/shrink-tool/README.md`'s recipe (steps 1-7) on the real folder + one other machine. Four `*.shrunk.mp4` outputs already exist under `formal annotations/u14 adonis/DJII Compressed/` but the README results table is empty - record it. Checks design R1 (mdat >4 GB at Sharp on the 24-min segment), R3/R11 (color + compression A/B), R10 (LRF vs MP4 framing). Defects are filed, not fixed here. Produces the real Sharp timing + output sizes T9040 needs. T8840's status stays the user's call. |
| T9020 | ↳ [Tune auto-crop on the real DJI folder (parameter sweep + ball-in-frame check)](tasks/pre-shrink-research/T9020-tune-auto-crop-dji.md) | 7 | 4 | 1.8 | TODO | [ ] | `pipeline/autoCrop.js` (grid 24x14, threshold 15% of max cell variance, 3% padding, 8 samples at 160x90 over the middle 80%) has only been validated on synthetic blobs. Build ground truth from YOLO on the `.LRF` proxies (T5650 §9 detected the ball in every tested frame; ultralytics is in the backend venv), sweep grid/threshold/padding/sample count/resolution, score by 100% ball-in-rect + players-in-rect + kept-area. Commit new defaults + tests + a `qa/autocrop-sweep.mjs` harness (T9060 reuses it). Pipeline stays DOM-free. |
| T9030 | ↳ [Trial auto-crop on other camera sources (Trace, Veo, iPhone, existing fixtures)](tasks/pre-shrink-research/T9030-auto-crop-other-camera-sources.md) | 6 | 4 | 1.5 | TODO | [ ] | Auto-crop has only seen a fixed tripod DJI lens. Run T9020's harness on the Legends/Trace exports (tracked camera pans: expect near-full-frame, verify it is not a confident nonsense rect), the phone clip (10 s, handheld), `test.short/`, and a Veo export if the user can supply one. Per-source verdict (usable / correct no-op / harmful + mitigation) in the README + EPIC.md; a >90%-area -> `null` guard if the data supports it. No per-source branches on one anecdote. |
| T9040 | ↳ [Benchmark shrink-time + upload-time vs visual quality across ALL file types (with a production file-type survey)](tasks/pre-shrink-research/T9040-benchmark-time-vs-quality-all-file-types.md) | 9 | 6 | 1.5 | TODO | [ ] | The core thesis, with numbers. (1) Production survey from per-profile `games` rows (size/duration/dims/fps -> bitrate buckets) joined with the T8838 census (`capability_impression:shrink_*`) - extends T9000's read-only script, adds no telemetry. (2) Matrix: source type x preset (Sharp/Small) x machine -> shrink wall-clock (encode-bound: output pixels / probe `pixelsPerSecond`), output bytes, upload time per T9000 bandwidth bucket, total vs upload-original, break-even bandwidth per source, player-REGION SSIM/VMAF + stills for the user's blind A/B (whole-frame PSNR rewards blur). Legends (4.67 Mbps) included as the negative case. Written to `docs/plans/research/pre-shrink-benchmark.md`. |
| T9050 | ↳ [Cost model: when NOT to shrink, and the size-cap-driven bitrate rule](tasks/pre-shrink-research/T9050-cost-model-when-not-to-shrink.md) | 8 | 5 | 1.6 | TODO | [ ] | Replaces the two-constant gate (`shouldOfferShrink`: >= 3 GB AND >= 10 Mbps) with a pure, unit-tested `pipeline/decision.js` `decideShrink(...) -> {mode: client |
| T9060 | ↳ [Tweening auto-crop: a keyframed crop path that follows the play](tasks/pre-shrink-research/T9060-tweening-auto-crop-follow-the-play.md) | 7 | 7 | 1.0 | TODO | [ ] | One static rect per segment must stay nearly full-field-wide to keep every play, and the resolution cap is width-driven (design R11). Evolve to a crop PATH: constant size (encoder dims are fixed per segment - a pan, not a zoom), keyframed centres from the variance heuristic per time window, smoothed (1-euro/EMA, velocity + acceleration bounds, never jitters, never lags the ball out of frame - widen instead). `cropScale.createCropScaler.transform` evaluates the path per `frame.timestamp`; manifest round-trip + resume; plain rects still valid. New `pipeline/cropPath.js` + `autoCrop.suggestCropPath`, all DOM-free so T8845 ports them. Verdict in EPIC.md: worth carrying or not. |
| T9070 | ↳ [Extract the `stss` keyframe index client-side (T8836 row 2)](tasks/pre-shrink-research/T9070-stss-keyframe-index-client-side.md) | 4 | 2 | 2.0 | TODO | [ ] | **CONFIRMED 2026-09-17** (was provisional). T8836 measured it free: the same ftyp+moov parse `probeShrinkCapability` already does (16-124 ms incl. both 17 GB files) yields keyframe times (0006: 274/8196 samples; Legends: 2650/79489). Add `keyframeTimesSec` to the shared `src/frontend/src/utils/shrinkCapability.js` result (explicit `null` for all-sync tracks); the tool's `probeContainer` consumes the same function. In-memory only, no persistence, no beacon. Feeds T8850's filmstrip seeks and a future mid-segment resume. |
| T9080 | ↳ [Poster + preview frames from the `.LRF` proxy at upload time (T8836 row 3)](tasks/pre-shrink-research/T9080-lrf-proxy-poster-frames.md) | 4 | 3 | 1.3 | TODO | [ ] | **DEFERRED 2026-09-17, not vetoed** (was provisional) - user: kick to a later milestone dealing with uploads; already lives here. T8836 measured 224 ms/frame (70 load + 94 seek + 60 draw/JPEG) for a ~210 KB 1280x720 JPEG from the frame-synced `.LRF` proxy, vs `poster.py`'s ~5 remote seeks per game. At the upload gesture, when the intake paired a proxy (EPIC decision 2 keeps them client-side), send one validated JPEG with finalize and skip the server seeks; proxy-less uploads stay byte-identical (server path is the only fallback). No schema change. Needs T9010's R10 verdict (proxy framing matches the MP4). |

**Epic 2 - Pre-Shrink Integration** (BLOCKED by Epic 1 in full; the three tasks below were moved from Universal Upload on 2026-09-08, IDs and content intact):

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Pre-Shrink Integration](tasks/pre-shrink-integration/EPIC.md)** | 7 | 5 | 1.4 |  |  | Port the PROVEN pipeline into the app: worker + client API, offer card + crop step, upload-queue integration with the binding fallback. Hard chain T8845 -> T8850 -> T8860. Design decisions (Universal Upload EPIC.md decisions 2/4/5/6, artifact screens E + F) still govern; research outputs (T9050 decision rule, T9060 crop path, T9070/T9080) are named inputs. |
| T8845 | ↳ [Port the approved standalone shrink tool into the app (worker + client API)](tasks/pre-shrink-integration/T8845-port-shrink-tool-into-app.md) | 7 | 4 | 1.8 | TODO | [ ] | Filed 2026-09-07; moved 2026-09-08. Starts ONLY after the Pre-Shrink Research epic is complete (T9010 = the user's T8840 sign-off, the gate it always had). Mechanical: `git mv` the pipeline modules (as they stand after research - incl. `decision.js`/`cropPath.js` if adopted) into `src/frontend/src/services/shrink/`, wrap in `shrinkWorker.js` + `shrinkClient.js`, `capability.js` turns the tool's "too slow" verdict into the Modal fallback, add mp4box/mp4-muxer to the app. Behaviour proven identical via the tool's own smoke fixture. Blocks T8850/T8860. |
| T8850 | ↳ [Shrink UI: offer card + crop step + presets](tasks/pre-shrink-integration/T8850-shrink-ui-crop-step.md) | 7 | 5 | 1.4 | TODO | [ ] | Moved 2026-09-08. **Gated on T8845.** Offer card only when the gate says so (T9050's `decideShrink` if landed, else total > 3 GB AND source bitrate > ~10 Mbps, EPIC decision 4 as amended 2026-09-07) AND capability true (never gates Add Game); full-modal crop step over a preview frame (DJI .LRF proxies power previews for free), per-segment filmstrip with per-segment automated crops as the default rect (decision 5 as amended 2026-09-08; a moving rect if T9060 was adopted), two presets Sharp/Small with live size/time/credit estimates. Artifact screens E + F are the spec, incl. the "you can still zoom in later" reassurance copy. |
| T8860 | ↳ [Shrink upload integration + fallback](tasks/pre-shrink-integration/T8860-shrink-upload-integration.md) | 7 | 5 | 1.4 | TODO | [ ] | Moved 2026-09-08. **Gated on T8845 + T8850.** Two-slot pipeline (segment i shrinks while i-1 uploads), phase-aware progress, credits from ACTUAL uploaded bytes, shrunk file flows through the untouched normal upload path (hash/probe/activate), binding fallback: any shrink error -> toast + upload originals, already-shrunk segments stay shrunk, loud logging; Modal fallback bounded by T9050's cost rule (it uploads the original first, so it never saves upload time). Manual e2e on the real 50 GB DJI folder recorded. |

### Upscale Quality

Make far-side-of-field action look good — the #1 quality ceiling for Trace/Veo footage (far-side crops are ~206x366 px of compressed mush; per-frame Real-ESRGAN can't recover detail a single frame doesn't contain). Strategy: build a quality testbed FIRST (no upscale change ships without a testbed run proving it), harvest cheap encode/denoise wins, A/B heavier GAN models, then the headline bet — temporal video super-resolution (FlashVSR/SeedVR2), which aggregates detail across frames. Ships behind crop-size routing so near-side clips stay on the cheap pipeline. Epic tasks are STRICTLY ordered. Research basis + decision gates: [tasks/upscale-quality/EPIC.md](tasks/upscale-quality/EPIC.md).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Upscale Quality](tasks/upscale-quality/EPIC.md)** | 9 | 7 | 1.3 |  |  | Testbed-proven upscale improvements for far-side action: quick wins → model A/B → temporal VSR → routed integration → (conditional) domain fine-tuning. |
| T4700 | ↳ [SR Quality Testbed](tasks/upscale-quality/T4700-sr-quality-testbed.md) | 8 | 5 | 1.6 | TODO | [ ] | Standalone eval harness at `src/backend/experiments/sr_testbed/`: fixed 10-12 clip set (far/mid/near, day/night, manifest-pinned crop keyframes), `Pipeline` plug-in interface, exact prod-replica + lanczos baselines, synthetic (PSNR/SSIM/LPIPS vs ground truth) + real (MUSIQ/NIQE + flicker ratio) tracks, blind-A/B HTML report with zoomed focus-box stills + jersey/face hallucination checklist, generic Modal GPU runner. Blocks the whole epic. |
| T4710 | ↳ [Encode + Denoise Quick Wins](tasks/upscale-quality/T4710-encode-denoise-quick-wins.md) | 6 | 2 | 3.0 | TODO | [ ] | Three cheap prod losses: final encode is CRF 23/fast while chunks are CRF 18 (last step = lowest quality — GPU detail thrown away at encode); Modal path missing bt709 color tags (local path sets them; some players render washed out); `dni_weight` denoise blend unused (`realesr-general-wdn-x4v3` companion model) while far crops are block-noise the GAN sharpens. Prove in testbed, then flip flags in video_processing.py + bake wdn weight into the image. |
| T4720 | ↳ [GAN Model A/B Evaluation](tasks/upscale-quality/T4720-gan-model-ab-evaluation.md) | 6 | 3 | 2.0 | TODO | [ ] | Measure (not estimate) RealESRGAN_x4plus / SwinIR-L GAN / Real-HAT vs the compact prod model on our clips, via `spandrel` auto-loading (sidesteps the dead arch-file backends in ai_upscaler). Full matrix on Modal T4 + L4 timing; recommendation table with LPIPS/MUSIQ/flicker/blind-win-%/s-per-frame/$-per-clip/VRAM. Eval only; "wait for VSR" is a valid verdict. |
| T4730 | ↳ [Temporal VSR Prototype (FlashVSR / SeedVR2)](tasks/upscale-quality/T4730-temporal-vsr-prototype.md) | 9 | 6 | 1.5 | TODO | [ ] | The ceiling-changer: one-step diffusion VSR fuses sub-pixel detail across frames — the only real fix for 30-80px far-side players. FlashVSR v1.1 primary (~17fps @ 768x1408 on A100, ~10x our current throughput), SeedVR2-3B secondary. Modal L40S, weights on a Volume. Hard gates: >=70% far-side blind wins, ZERO jersey/face hallucinations, <=$0.15 + <=3x wall-clock per 10s clip, license review. Go/no-go for T4740. |
| T4740 | ↳ [Production Integration + Crop-Size Routing](tasks/upscale-quality/T4740-production-integration-routing.md) | 8 | 5 | 1.6 | TODO | [ ] | BLOCKED by T4730 go. New Modal function (same progress-generator contract as process_clips_ai) + routing in modal_client: min-crop < FAR_SIDE_CROP_THRESHOLD (300) AND VSR_ENABLED → heavy pipeline on L40S; near-side stays on cheap T4 path. Loud deliberate fallback to standard pipeline on heavy failure (never a failed paid export); `[UPSCALE_COST]` telemetry; comparison endpoint gets the new option; staging-first. |
| T4750 | ↳ [Domain Fine-Tuning (conditional)](tasks/upscale-quality/T4750-domain-finetune.md) | 7 | 8 | 0.9 | TODO | [ ] | CONDITIONAL — only if T4730/T4740 leave a named gap. HR/LR dataset from OWN-account near-side footage (YOLO-harvested player crops; consent boundary is hard); Veo/Trace-matched synthetic degradation validated by blind-sort vs real far crops; fine-tune the shipped model (Real-ESRGAN recipe or VSR LoRA); same testbed gate — hallucination checklist especially (plausible wrong jersey numbers are worse than blur). |

### Milestone: Framing/Overlay Clarity

Outcome-first UX pass on the two steps where non-technical parents fall off. P0 guarantees a zero-effort valid export and kills keyframe jargon; P1 fixes button naming, hides pro readouts, makes hints replayable; P2 adds presets + clearer manual affordances. Each phase is independently shippable.

*The original P0-P2 pass and the 2026-08-25 naming/UX round (T7700, T7710, T7720) are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Milestone: Playwright Suite Health

User ran the full local Playwright suite 2026-08-25 (`npx playwright test`, no filter): 348 passed / 144 failed / 23 skipped / 34 did not run, 4.6 hours wall-clock. Two-part directive, both required: (1) fix every real issue the failures reveal, (2) cut a full run to somewhere in the 5-20 minute range (clarified 2026-08-25 — not a strict 10-minute ceiling), driven by removing REDUNDANT coverage ("no code paths should be checked twice" — user's words), not brute-force deletion or added Playwright parallelism alone. Full triage (all 144 failures categorized, 8 concrete bugs identified with exact file:line fixes, slow-test duration data): [docs/testing/playwright-triage-2026-08-25.md](../testing/playwright-triage-2026-08-25.md).

*T7730, T7740, T7750, T7760, T7770, T7780, T7790, and T7800 are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T10640 | [Fix stale "Export" locator in T4880 mobile reachability spec](tasks/T10640-fix-t4880-export-locator.md) | 3 | 1 | 3.0 | TODO | [ ] | Discovered 2026-09-19 verifying T10630: the Framing CTA's name changed to "Generate Framing" (N19) but the spec still looks for "Export", so it stalls to its full 3-minute timeout instead of failing fast. Not a CI blocker (spec isn't in branch-ci.yml) but wastes local verification time on every Focus/Overlay task. One-line locator fix. |

### SEO & Organic Discovery

Growth work on the marketing site (`src/landing`), which shipped as static Astro on 2026-07-24. Not a bug milestone -- per the Priority Policy below it sits behind open infrastructure bugs, but it is genuinely actionable and the feedback loop is measured in weeks, so starting it early matters more than finishing it fast. **The SEO Content & Landing Value Props epic (below) is sequenced to start after Milestone TOP (the Durable Sync campaign) finishes** -- it is growth work, not a UI-runway or infrastructure item, so it does not queue alongside T7020/JIT Migration/Collection Download despite also following the reshoot chronologically.

Ordered: instrumentation first so we can measure what we fix; then the two user-visible stalls we already traced; then the structural infra wins.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Investor-Grade Analytics](tasks/investor-analytics/EPIC.md)** | 8 | 5 | 1.6 |  |  | Filed 2026-08-20 from the user's investor-readiness requirements (2.1 instrument the full funnel visit→signup→upload→tag→export→share→repeat; 2.2 activation = first shared reel ≤14d with drop-off localization; 2.3 seasonality-adjusted cohort retention curves that visibly flatten, clip-library as the structural retention asset; 2.4 attributed MoM organic growth). Four binding user directives (2026-08-20): in-house only (no external analytics tools — subscriptions + privacy), keep it light (extend the existing `record_milestone`→`user_actions`/`daily_counters` system), aggregates only (counts + first/latest timestamps, never per-event rows in shared stores), and NO new Postgres data (new state lives in flat `analytics.sqlite`, drip.sqlite precedent). The survey found the system further along than assumed — `user_actions.first_at` already supports activation math and `user_usage_daily` (v022) is already the per-user retention spine — so the epic is mostly REPORTS over existing PG (read-only) plus two light additions: an admin-triggered rollup sweeping per-user `user_action_log` into aggregate cohort×action×week rows, and a first-party cookie-free visit beacon for the invisible top of funnel. Research brief (a16z/Sequoia/Lenny benchmarks, seasonality practice) embedded in EPIC.md. T7420 is pure-read and can start immediately; T7400→T7410 unlock the rest. |
| T7400 | ↳ [analytics.sqlite store + on-demand cohort rollup sweep](tasks/investor-analytics/T7400-analytics-sqlite-rollup.md) | 8 | 5 | 1.6 | TODO | [ ] | Epic 1/6. Flat `analytics.sqlite` (env-prefixed R2 key, single-writer, etag-asserted upload — drip.sqlite precedent; NOT in the 3 migration tracks, no _SCHEMA_DDL change) + admin-triggered sweep reducing each user's existing `user_action_log` to `rollup_action_weekly(cohort_week, action, week_index, distinct_users)` — aggregate rows only, raw events never leave the per-user DBs. Full-rebuild idempotent reruns; failed user DBs counted loudly, never silently skipped. Unlocks action-level cohort retention (T7430) without a PG event table. |
| T7410 | ↳ [First-party visit beacon (landing + app, aggregate-only)](tasks/investor-analytics/T7410-first-party-visit-beacon.md) | 7 | 3 | 2.3 | TODO | [ ] | Epic 2/6, depends on T7400's store module. The funnel's first stage (visit→signup) is invisible today: the landing emits nothing and the CF/zaraz sink is inert without its token. Tiny cookie-free beacon on landing + app pre-auth + share pages → unauthenticated buffered `POST /api/t` → `visit_daily(day, source, page_class)` counts in analytics.sqlite. Source buckets mirror `_determine_origin` priority (invite > referral > click-ID social > seo > direct) in ONE shared constant. No cookies/IDs/IP stored — quotable on the kids-privacy page. Supersedes T3000. |
| T7420 | ↳ [Activation & funnel drop-off report](tasks/investor-analytics/T7420-activation-funnel-report.md) | 8 | 3 | 2.7 | TODO | [ ] | Epic 3/6, ZERO dependencies — pure read of existing PG (`user_actions.first_at` + `user_segments.acquired_at`), can start immediately. Per monthly cohort: activation rate (share_completed ≤14d; secondary export_completed ≤7d), stage conversion + median inter-stage days (upload→tag→export→share), and non-activated users' furthest-stage stall distribution — the "where exactly are the drop-offs" number. Maturing (<14d) cohorts labeled, never blended. Benchmarks printed beside actuals (30% median / 50%+ great). CSV export. |
| T7430 | ↳ [Retention curves & triangle, seasonality-adjusted](tasks/investor-analytics/T7430-retention-cohort-curves.md) | 9 | 4 | 2.3 | TODO | [ ] | Epic 4/6. THE investor chart ("show me your cohort retention"). Weekly triangle + overlaid retention curves from the EXISTING `user_usage_daily` spine — classic AND unbounded/activity-based toggles (unbounded is the headline for a seasonal product), day-30/60/90 columns, WAU + WAU/MAU series (never DAU/MAU). Seasonality: season-cohorts (Fall/Spring join windows as named constants), season-over-season return rate as the long-horizon headline, off-season weeks shaded not dropped, coverage-start marker (usage data begins at v022's deploy). Action-level toggle (export habit, clip-library usage) reads T7400's rollup. Small-N cells render raw fractions, not misleading %s. |
| T7440 | ↳ [Organic growth & attribution report + investor export](tasks/investor-analytics/T7440-organic-growth-report.md) | 7 | 3 | 2.3 | TODO | [ ] | Epic 5/6. Assembles existing attribution (`user_segments.origin`/utm, `referrals`, share-origin) into the narrative: MoM signups by source bucket (organic/community/referral/social/partnerships/paid + an explicit unattributed bucket — never silently folded into organic), organic-only growth rate, YoY where data allows, referral loop share→view→signup + K-factor estimate with dark-social caveat, visit→signup conversion once T7410 lands, explicit ~$0 paid-spend line. Absolute counts printed next to every %. CSV + print-clean — this report IS the hand-to-investor artifact. |
| T7450 | ↳ [Flow-event coverage: clip-library & repeat-usage signals](tasks/investor-analytics/T7450-compounding-value-event-coverage.md) | 5 | 2 | 2.5 | TODO | [ ] | Epic 6/7, independent + small. Requirement 2.3's structural-retention asset (collections/season library) has no FLOW_EVENTS coverage. Add `collection_viewed` / `ranking_vote_cast` / `collection_shared` (confirm against real endpoints; verify nothing double-counts) through the existing `record_milestone` path — server-side, gesture-traceable, `daily_col: None` so PG daily_counters untouched; rows land only in the existing `user_actions` upsert + per-user `user_action_log`, which T7400's rollup then surfaces in T7430's clip-library retention view. T3570 stays standalone. |
| T7455 | ↳ [Editor-open event coverage: per-open Focus/Overlay/Annotate entries with clip context](tasks/investor-analytics/T7455-editor-open-event-coverage.md) | 6 | 3 | 2.0 | TODO | [ ] | Filed 2026-08-27 from the user's "which users opened a clip in Focus/Overlay" audit. `framing_opened`/`overlay_opened` fire only via the quest achievement bridge: once per page-load session (questStore dedup Set), EMPTY context (quests.py:472 passes `{}`), so per-open counts and "which clip" are unanswerable. Fix: fire `record_milestone` from the real open gesture per open with `{project_id, clip_id}` context, drop the two keys from ACHIEVEMENT_TO_MILESTONE (no double-count; quest steps untouched); add `annotate_opened` (new — nothing fires between upload and clip_created) and add `overlay_opened` to FUNNEL_STEPS + admin FunnelChart (both currently missing it). All `daily_col: None`, existing `user_actions` upsert + `user_action_log` only — zero new PG state. |
| T7465 | ↳ [Journey Flow graph replaces the admin bar funnel](tasks/investor-analytics/T7465-journey-flow-graph.md) | 7 | 4 | 1.8 | TODO | [ ] | Filed 2026-09-02 (user request, direction approved via design mock). Replace the admin FunnelChart (independent ever-did-X counts producing 322%/500% neighbor ratios) with a Sankey-style journey graph: nodes = stages, ribbon width = users whose next first-touch step after A was B, gray peel-offs = journeys ending there; counts conserved by construction. Pure read of existing `user_actions.first_at` + `user_segments.acquired_at` (zero new events, zero PG state, no migration) folded per user with canonical-order tiebreak; new read-only `/api/admin/analytics/journey` (origin/date/exclude-test filters + compact/full node sets) + hand-rolled SVG `JourneyFlowChart.jsx` (no chart lib). Late-instrumented events (T7890 et al) badged `partial` via an `EVENT_INSTRUMENTED_AT` registry, never silently thin. v1 = first journeys (labeled); repeat-transition fidelity deferred to a T7400-rollup aggregate table if ever needed. Coordinates with T7455 (`annotate_opened` becomes a node once it exists). Design in task file + mock artifact. |
| T7460 | ↳ [Success-criteria scorecard (goal vs actual, green/yellow/red)](tasks/investor-analytics/T7460-success-criteria-scorecard.md) | 8 | 4 | 2.0 | TODO | [ ] | Epic 7/7, capstone (goes last — composes the query functions T7420/T7430/T7440/T7400 build). User-defined success criteria (2026-08-20) in their own admin dashboard: 6 cards, each goal + current number + RAG chip. Targets: 1,000 WAU by month 6 (stretch 2,000, 4-wk trailing, in-season WoW ~10%); signups +15% MoM >=90% organic; activation 40%+ export<=14d (PRIMARY metric per these criteria — share<=14d stays tracked as the value-moment) + biggest drop-off shrinking MoM; 30%+ of activated active at D30 + in-season 50%+ WoW return; in-season WAU/MAU>=40% + median 2+ exports/mo (via T7400's rollup_engagement_monthly distribution summaries — per-user rows never stored); 25%+ signups via shared links/referrals. Goals = named constants in success_criteria.py (no DB, no editor); off-season criteria render grey "paused" never false red; small-N suppresses to "insufficient data". TARGET_DATE default 2027-02-28 (month 6 from filing — user to confirm). |
| T7467 | ↳ [Deploy-comparison view (segment any metric by deploy, before vs after)](tasks/investor-analytics/T7467-deploy-comparison-view.md) | 7 | 5 | 1.4 | TODO | [ ] | Filed 2026-09-02, prompted by a manual investigation (curl /api/version + git show + hand-written Postgres query) needed just to answer "upload success rate since the last deploy." Adds a `deploys` log table (deployed_at, commit_sha, build_number, env) to T7400's analytics.sqlite, appended automatically by `scripts/deploy_production.sh` right after its backend health-check verify; a `since_deploy` param on the existing report endpoints (pulse card's `upload_success_rate` + at least one of T7420/T7430/T7440) resolving to a before/after pair via the deploy log; and an admin-UI deploy picker rendering each as absolute counts + delta%, small-N suppressed per T7460's honesty convention. Day-granularity is the disclosed ceiling — `daily_counters`/`user_actions` have no per-event timestamp centrally, so a deploy's exact instant can't be sliced more finely; stated in the UI, not solved. Zero new Postgres state (deploys table lives in analytics.sqlite alongside T7400's rollups). Depends on T7400; sequenced after T7460 and T7465 since it layers onto the same report endpoints/components those are actively shaping. |
|  | **[SEO Content & Landing Value Props](tasks/seo-content/EPIC.md)** | 7 | 4 | 1.8 |  |  | Filed 2026-08-16. Sequenced after Milestone TOP (the Durable Sync campaign) completes — growth work sits behind open infrastructure bugs per the Priority Policy; not a member of the post-reshoot queue (T7020/JIT Migration/Collection Download) even though it also follows the reshoot chronologically. Sell everything the product does (feature-inventory audit) + give thin content coverage its missing pages. T7110 → T7120 strict order. Owner gates in [seo-owner-checklist.md](../marketing/seo-owner-checklist.md). T6370 stays a standalone sibling (indexing/GSC side). |
| T7110 | ↳ [Landing homepage — sell all four value stories (copy overhaul)](tasks/seo-content/T7110-landing-value-props.md) | 7 | 3 | 2.3 | TODO | [ ] | Epic child 1/2. Filed 2026-08-16 from the marketing proposal built on [feature-inventory.md](../marketing/feature-inventory.md). Homepage sells only "editing grind removed"; the share→claim loop, kids'-privacy stance, season-builds-itself story, and half the broadcast-package stack (slow-mo, intro cards, text overlays) are absent or undersold, and two live claims overrun the inventory ("generate reels from simple queries"; "auto-frames to follow your player"). 8 changes C1–C8 with final copy embedded in the task file: hero subhead, Elevate rewrite, new share-loop + season sections, reusable TrustStrip component, Celebrate tonight-payoff line, accuracy fixes, 3 FAQs + FACTS entries (privacySummary, pricingPerSecond). src/landing only; merge gate = user copy approval (master push auto-deploys the site). |
| T7120 | ↳ [SEO content expansion — comparisons, use-case & privacy pages, guide bodies](tasks/seo-content/T7120-seo-content-expansion.md) | 6 | 5 | 1.2 | TODO | [ ] | Epic child 2/2. Depends on T7110 (TrustStrip, FACTS, link targets). Content-side complement to T6370's indexing diagnosis (thin/duplicative pages): Phase A adds /vs/hudl, /vs/veo, /vs/trace, /vs/imovie with the honest they're-cameras-we're-the-editor framing + works-with cross-links; Phase B adds /share-team-highlights (the loop's citable deep page) and /kids-privacy (the page an AI engine quotes for "is it safe for kids"); Phase C reuses TrustStrip + privacy FAQs across for-parents/recruiting/sport pages (raises per-page unique text — feeds T6370 Part C); Phase D writes bodies for the five guide outlines in data/guides.ts — GATED on owner outline approval per [seo-owner-checklist.md](../marketing/seo-owner-checklist.md); Phase E (optional) VideoObject schema builder. App-subdomain robots/soft-404 work stays in T6370 — not duplicated here. |
*T6370 is complete (merged 2026-08-17, already part of the 2026-08-19 prod deploy — status was left stale at STAGING) — row archived to [PLAN-archive.md](PLAN-archive.md).*

#### Video Load Latency (from HAR 2026-06-17)

Traced from `Downloads/localhost.har`: the framing clip *appeared* to take ~4.3s due to a cold over-fetch from R2. **Debunked by the T3760 spike (2026-06-18):** that 4.3s was a HAR misread (`receive` time = playback-stream duration, not TTFF). Measured cold TTFF is 266 ms; the over-fetch is harmless. T3760 closed WON'T-FIX. The per-file tag/JS "downloads" the user noticed are a dev-mode Vite artifact (bundled+gzipped in prod) and are NOT a bottleneck — no task created for them.

> **Coordination:** T3760 + T3770 ship on branch `feature/perf-page-load` (separate conversations, disjoint files). They're part of the wider perf batch with the quest tasks — see [perf-batch-har-2026-06-17.md](tasks/perf-batch-har-2026-06-17.md).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### For Alpha - Video Streaming

Fix playback stalls observed on staging (2026-06-02). Video proxy bottleneck (~590 KB/s) causes buffering during game playback. Must fix before alpha testers hit this.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### For Alpha - Polish (IN_PROGRESS)
[tasks/for-alpha/EPIC.md](tasks/for-alpha/EPIC.md)

Goal: Get user feedback. Core functionality works, performance is acceptable, onboarding doesn't block users.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Lifecycle Email Drip](tasks/lifecycle-drip/EPIC.md)** | 8 | 6 | 1.3 |  |  | Filed 2026-08-19; placed in For Alpha by the user 2026-08-19 (automates the manual win-back campaign of 2026-08-18/19 — 8 users hand-segmented by funnel stage). Design gate: EPIC.md needs user approval before T7230 starts (open items: physical mailing address for CAN-SPAM footer; seed-copy review). Day 1/3/7/14 post-signup emails, NEVER static: at send time the system resolves the user's funnel stage from `user_actions` (Annotate → Framing → Overlay → Publish, same model as the admin panel + the manual campaign) and sends that stage's copy for that day, pointing at the next-step tutorial (assets.reelballers.com/tutorials/*). ZERO new Postgres fields/rows (user directive 2026-08-19 — PG is the costliest part of the stack; tick only READS users/user_actions): state is writer-partitioned per EPIC §3 — send log/claims in a dedicated `drip.sqlite` (tick machine is its ONLY writer, R2-persisted with etag-asserted upload), templates = 28-cell R2 JSON doc (4 days × 7 stages) edited live in the admin panel with If-Match CAS, unsubscribes = per-user R2 marker objects (PUT-only, race-free from any app server). No deploy to change an email. At-most-once via single-writer + claim-upload-BEFORE-send ordering on UNIQUE(user_id, drip_day); 48h send windows (missed = skipped forever, no catch-up blasts to old users); tick = a separate DAILY Fly scheduled machine (one-shot `python -m app.drip_tick`, isolated from app servers — revised 2026-08-19 from an in-process loop after user review; EPIC §5 has the rejection rationale incl. auto_stop=suspend timer starvation and the T7090 OOM precedent); every email carries the support-first framing ("reply and tell us where you got stuck") + RFC 8058 one-click unsubscribe. Strict task order. |
| T7230 | ↳ [Drip stores + seed copy (drip.sqlite, R2 templates doc, unsubscribe markers)](tasks/lifecycle-drip/T7230-drip-schema-templates.md) | 7 | 2 | 3.5 | TODO | [ ] | Epic 1/5. **Rewritten 2026-08-19 (was a Postgres migration): NO migration, NO _SCHEMA_DDL change — grep-provable.** services/drip_store.py: drip.sqlite schema (drip_sends UNIQUE(user_id,drip_day), PRAGMA user_version, created lazily by the tick — never enters the per-user CAS/sync machinery) + R2 helpers (etag-asserted upload refuses a second writer loudly) + templates-doc get/put + unsubscribe-prefix list; checked-in 28-cell seed JSON (4 drafted verbatim; tone matrix for the rest; every body carries the support line) uploaded via If-None-Match:* so a re-seed can never clobber admin edits. Confirm env-prefixed R2 keys so staging/prod never share drip state. |
| T7240 | ↳ [Stage resolver + template selection/render engine](tasks/lifecycle-drip/T7240-stage-resolver-selection-engine.md) | 7 | 3 | 2.3 | TODO | [ ] | Epic 2/5. Pure services/drip_engine.py: resolve_stage (coarse 7-bucket ladder over user_actions; clip_created OR annotation_completed → clipped — prod shows either without the other), select_template (disabled → None), render_template ({{var}} whitelist per stage; unresolved token = DripRenderError, fail loudly never send), build_context (read-only default-profile reads via the sweep's set-context pattern). Test fixtures = real shapes from the manual campaign's users. |
| T7250 | ↳ [Unsubscribe endpoint + compliance footer](tasks/lifecycle-drip/T7250-unsubscribe-compliance.md) | 7 | 3 | 2.3 | TODO | [ ] | Epic 3/5, MUST precede any live send. HMAC-tokened public /api/email/unsubscribe, GET (human click, confirmation page) + POST (RFC 8058 one-click for Gmail/Yahoo native button), no login, idempotent, constant-time verify, writing the R2 marker drip/unsubscribed/{user_id} (PUT-only, race-free from any app server — no DB write at all); new _build_drip_email shell (clones _build_update_email + unsubscribe link + physical-address line) + send_drip_email (Resend, List-Unsubscribe + List-Unsubscribe-Post header pair, dev log-only mode). OPEN: COMPANY_MAILING_ADDRESS env value from user (CAN-SPAM). Admin bulk-email shell untouched. |
| T7260 | ↳ [Drip tick + idempotent send pipeline + admin dry-run](tasks/lifecycle-drip/T7260-drip-scheduler-send-pipeline.md) | 8 | 5 | 1.6 | TODO | [ ] | Epic 4/5. Tick = Fly scheduled machine (`fly machine run <image> --schedule daily "python -m app.drip_tick"`, own process/memory so it can never take down an app server; exactly one runner regardless of fleet size; deploy_production.sh gains `fly machine update --image` since fly deploy skips machine-run machines). Entrypoint gated DRIP_EMAILS_ENABLED (unset = exit 0). run_drip_tick(now, dry_run): download drip.sqlite + templates doc + unsubscribe set → window query off users.created_at (PG READ-ONLY; LEFT JOIN segments — segmentless users still drip) → suppression chain (test patterns, DRIP_SUPPRESSED_EMAILS, is_admin, unsubscribe markers) → stage → template → claim batch locally + UPLOAD BEFORE FIRST SEND (etag mismatch = abort loudly, zero sends) → render+send → sent/failed + final upload (failed keeps claim, CRITICAL log, no auto-retry). Admin surface is READ-ONLY: POST /api/admin/drip/run is dry-run only (manual live run = fly machine start of the tick machine — same machine, single-writer holds); GET /api/admin/drip/sends reads a downloaded COPY of drip.sqlite. Crash-between-claim-upload-and-send, etag-abort, zero-catch-up-blast, dry-run-writes-nothing all test-proven. |
| T7270 | ↳ [Admin panel: template editor + send log](tasks/lifecycle-drip/T7270-admin-template-editor.md) | 6 | 4 | 1.5 | TODO | [ ] | Epic 5/5. The "easy to update" deliverable: 4×7 template grid (one glance = who gets what when), editor modal mirroring BulkEmailModal (char caps, Send-test-to-me with sample vars + real unsubscribe footer, explicit-save gesture, no backdrop close), send log + "Preview next tick" dry-run view. Backend = CRUD onto the R2 templates doc with If-Match etag CAS (concurrent admin tabs: loser gets 409 "reload and re-apply", never a silent clobber); enabled=false is the only off switch (no delete/create — cells are the fixed universe). Then run the EPIC rollout sequence. |
| T3750 | [Redo All E2E Tests](tasks/T3750-rewrite-new-user-flow-e2e.md) | 7 | 4 | 1.8 | TODO | [ ] | (Moved from Framing/Overlay Clarity; hold until now.) Audit + redo the full E2E suite, not just onboarding: rewrite new-user-flow.spec.js to the 3-quest flow + new event gestures + Export Highlight/Add Spotlight selectors; expect framing->overlay auto-advance; fix gallery/My Reels specs for Collections + ranking-game changes; sweep regression-tests.spec.js label selectors. |
| T1970 | [Annotate Mehdi Source Files](tasks/alpha-marketing/T1970-annotate-mehdi-source-files.md) | 8 | 2 | 4.0 | TODO | [ ] | Annotate, frame, and export Mehdi's game footage end-to-end to produce demo clips and before/after examples |
|  | **[Landing Page Polish](tasks/landing-page-redesign/EPIC.md)** | 7 | 4 | 1.8 |  |  | Before/after examples from Mehdi footage + tutorial video |
| T2330 | ↳ [Before/After Examples](tasks/landing-page-redesign/T2330-before-after-section.md) | 10 | 5 | 2.0 | TODO | [ ] | Add more before/after examples to existing section: diverse positions (keepers, defenders), synced loops |
| T3300 | ↳ [Build Tutorial Video for Landing Page](tasks/T3300-tutorial-video-landing-page.md) | 8 | 3 | 2.7 | TODO | [ ] | Build tutorial video and add to landing page |
|  | **[Analytics: Attribution & Access Visibility](tasks/analytics-attribution-viz/EPIC.md)** | 7 | 5 | 1.4 |  |  | Surface origination & access from existing tables: split games uploaded vs accessible, and a full attribution graph (who invited whom + ad campaign roots). |
| T3550 | ↳ [Games Uploaded vs Accessible](tasks/analytics-attribution-viz/T3550-games-uploaded-vs-accessible.md) | 6 | 3 | 2.0 | TODO | [ ] | Split admin "Games" into games uploaded vs games accessible (differ due to sharing). Add accessible count via share_games/shares join; show both in UserTable + UserDetailPanel. |
| T3560 | ↳ [User Attribution Graph](tasks/analytics-attribution-viz/T3560-attribution-graph.md) | 7 | 6 | 1.2 | TODO | [ ] | Node-link attribution graph: users + ad-campaign/origin roots as nodes, referrals as edges, colored by origin. Own lazy-loaded page (code-split) linked from main analytics so the graph lib/payload never slows the main page. New /attribution-graph endpoint + AttributionGraph.jsx (adds first graph viz lib). |
| T3570 | [Track Annotation Playback Frequency](tasks/T3570-annotation-playback-frequency-event.md) | 5 | 2 | 2.5 | TODO | [ ] | Add non-achievement `annotation_playback_started` flow event (once per playback session) so user_actions counts rewatch frequency. Existing `annotations_played` achievement only fires once ever. Feeds lifecycle-email classifier. |
|  | **[Lifecycle Onboarding Emails](tasks/lifecycle-emails/EPIC.md)** | 8 | 6 | 1.3 | SUPERSEDED |  | SUPERSEDED 2026-08-19 (user-approved) by the [Lifecycle Email Drip epic](tasks/lifecycle-drip/EPIC.md) above — same day-N funnel-stage emails, but the drip epic's design is newer and settled (zero new Postgres state, drip.sqlite + R2 templates, RFC 8058 unsubscribe, Fly scheduled-machine tick) where this one predates those decisions (email_sends PG migration, in-process loop). T3595 survives independently below. |
| T3580 | ↳ [Lifecycle Email Engine](tasks/lifecycle-emails/T3580-lifecycle-email-engine.md) | 8 | 6 | 1.3 | SUPERSEDED | [ ] | SUPERSEDED by T7230/T7240/T7260 (drip stores + stage resolver + tick). Its funnel-stage classifier concept lives on as `resolve_stage` in T7240; the `email_sends` PG table is explicitly rejected by the drip design. |
| T3590 | ↳ [Day 7/14/30 Content & Personalization](tasks/lifecycle-emails/T3590-lifecycle-email-content.md) | 8 | 5 | 1.6 | SUPERSEDED | [ ] | SUPERSEDED by T7230's 28-cell template doc + T7270's admin editor (per-stage copy is data, not code, in the drip design). |
| T3595 | [Share Viewer Opt-In & Viewer Bucket](tasks/T3595-share-viewer-optin-bucket.md) | 7 | 6 | 1.2 | TODO | [x] | **Survives the lifecycle-emails supersession — independent value** (viewer leads, not user drips). Opt-in CTA on shared link viewer pages ("learn how to make clips like this?"); opted-in viewers stored as leads + one-time how-to email. Passive viewers never emailed. share_viewer_leads table buckets viewers separately from users; converted_user_id links viewer->signup. Today share_viewed is sharer-attributed only. NOTE: Game Pools' join flow will add a second viewer→member conversion path — coordinate attribution when both exist. |
| T3290 | [Tune NUF for Returning Users](tasks/T3290-tune-nuf-returning-users.md) | 8 | 4 | 2.0 | TODO | [ ] | Differentiate new user flow for returning users vs first-timers. Conversation needed to scope. |
*T5080 (standalone JIT-migration row) was promoted 2026-08-04 into the [JIT Migration epic](tasks/jit-migration/EPIC.md) (T5081-T5089) — rows live in Milestone TOP; the old tasks/T5080-jit-migration.md file no longer exists.*

---

## Priority Policy

**Bugs are always the first priority, especially infrastructure bugs (sync, data integrity, schema).** New features and structural changes should not begin until known bugs are resolved. The order is:

1. **Infrastructure bugs** - Sync failures, data loss, orphaned records, schema issues
2. **Test failures** - Broken tests indicate regressions; fix before adding more code
3. **UI/UX bugs** - Visible issues that affect the user experience
4. **Pre-deployment blockers** - Structural changes (T85) that must happen before real users
5. **New features** - Only after the above are clear

**Bug prioritization within a tier:** Rank by **infrastructure depth** — the deeper the bug (more systems depend on the affected layer), the higher the priority. A silent sync failure is worse than a slow sync, which is worse than a broken test.

When suggesting the next task, always check the Bug Fix Sprint section first. Do not recommend feature work while bugs remain open.

### Epic Prioritization

**Epics compete with other epics and standalone tasks at the milestone level.** Each epic gets aggregate Impact/Complexity/Priority scores based on the collective value and effort of its tasks.

- **Milestone level:** Epics and standalone tasks are ordered by Priority (Impact / Complexity). Higher priority = do first.
- **Within-epic level:** Tasks are ordered by **dependency** — foundational layers first, since all tasks in an epic touch similar code. DB/model changes before API, API before UI.
- **Impact over complexity:** When prioritizing within a milestone, favor high-impact work even if it's harder. The priority formula (Impact / Complexity) naturally rewards this.

---

## Completed Tasks

See [DONE.md](DONE.md) for all completed, superseded, and won't-do tasks.

---

### Epic: Auth Integrity (IN_PROGRESS) -- BUG FIX
[tasks/auth-integrity/EPIC.md](tasks/auth-integrity/EPIC.md)

Goal: Eliminate orphaned accounts by removing guest accounts entirely. Users must sign in (Google or OTP) before using the app.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Alpha Marketing

Final pre-alpha polish: source material, analytics review, returning-user experience, and landing page refinement.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T1980 | [Alpha Outreach Email](tasks/alpha-marketing/T1980-alpha-outreach-email.md) | 9 | 3 | 3.0 | TODO | [ ] | "Save your best moments before you lose the videos" — email with demo clip link, feature screenshots, CTA to app |
| T1990 | [Alpha List](tasks/alpha-marketing/T1990-alpha-list.md) | 9 | 1 | 9.0 | TODO | [ ] | Contact list for alpha outreach: Zack, Arshia, Chris Choie, WhatsApp group, John Gleaves, Jack's dad, Jett's dad, current team, Shannon |

### For Launch — Infrastructure

Outreach to our network once alpha milestone is complete. Ordered: create source material first, then compose email, then send.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Session Scaling Epic](tasks/session-scaling/EPIC.md)** | 8 | 5 | 1.6 |  |  | Session pinning + write-back R2 sync + data loss recovery. Makes per-user SQLite correct and fast at multi-machine scale. |
| T2250 | ↳ [Write-Back R2 Sync](tasks/session-scaling/T2250-write-back-r2-sync.md) | 8 | 5 | 1.6 | TODO | [ ] | Move R2 sync from blocking-per-gesture to periodic background (~3 min). Sync on sign-out, export, session invalidation. Writes respond in <5ms instead of ~200ms. |
| T40 | ↳ [Single Active Session Handoff](tasks/session-scaling/T40-single-active-session-handoff.md) | 8 | 5 | 1.6 | TODO | [ ] | Auto-signout old device on new login, sync R2 before 401, retry on failure, "signed in elsewhere" UX. Orchestrates device handoff end-to-end. |
| T2260 | ↳ [Data Loss Detection & Recovery](tasks/session-scaling/T2260-data-loss-detection-recovery.md) | 7 | 4 | 1.8 | TODO | [ ] | Detect version gaps on reconnect after crash. Auto-grant goodwill credits, notify user with clear explanation. |
| T1537 | ↳ [Consolidate Achievement POSTs (fire-and-forget analytics)](tasks/session-scaling/T1537-consolidate-achievement-posts.md) | 5 | 3 | 1.7 | BLOCKED | [ ] | Depends on T2250 (write-back). The achievement POST's ~610ms is synchronous `record_milestone` (Postgres + user.sqlite); it's already FE fire-and-forget so the user feels none of it. Fold the achievement INSERT into the action handler AND make the milestone emit fire-and-forget — a persistence-model change deferred until sessions are single-machine + write-back. Design ready: [T1537-design.md](tasks/T1537-design.md). Moved here from the Quests Latency epic. |
|  | **[Analytics System (OpenPanel)](tasks/analytics/EPIC.md)** |  |  |  |  |  | Replace CF Web Analytics with self-hosted OpenPanel: 41 events, 4-tier dashboards, credit-economy metrics, computed intelligence (churn/LTV/tiers), alerts |
| T1700 | ↳ [Foundation](tasks/analytics/T1700-foundation.md) | 6 | 5 | 1.2 | TODO | [ ] | Deploy OpenPanel VPS, SDK integration (frontend + backend), 8 activation events, L1 Daily Pulse dashboard, remove CF Web Analytics |
| T1701 | ↳ [Core Analytics](tasks/analytics/T1701-core-analytics.md) | 6 | 5 | 1.2 | TODO | [ ] | Full 41-event taxonomy, L2 Weekly Health dashboard (7 sections), session replay, quest funnels, admin panel -> OpenPanel links |
| T1702 | ↳ [Monetization + Intelligence](tasks/analytics/T1702-monetization-intelligence.md) | 6 | 5 | 1.2 | TODO | [ ] | Credit events, Stripe revenue tracking, nightly analytics engine (churn risk, engagement tiers, credit health, LTV), hourly/weekly alerts, viral attribution |
| T1703 | ↳ [Optimization](tasks/analytics/T1703-optimization.md) | 5 | 4 | 1.3 | TODO | [ ] | L3 deep-dive template, feature release protocol, aha moment regression, magic number testing (requires 200+ users) |
|  | **[R2 CDN Video Serving](tasks/r2-cdn/EPIC.md)** | 4 | 5 | 0.8 |  |  | Custom domain + HMAC auth + HTTP/2 + CDN caching. Presigned URL streaming done in T3250; this epic adds edge infrastructure. Re-scoped 2026-06-18 (T3760): latency justification debunked (measured TTFF 266 ms, seeks don't stall even saturated); surviving value = caching + egress-at-scale + auth = low-urgency infra. Impact 9->4. Depends on T3250. |
| T2550 | ↳ [CDN + Auth Worker](tasks/r2-cdn/T2550-r2-custom-domain-cdn.md) | 4 | 4 | 1.0 | TODO | [ ] | Custom domain (`cdn.reelballers.com`) + HMAC auth Worker + HTTP/2 + CDN caching. Auth-only Worker (no byte proxying). **Re-scoped 2026-06-18 (T3760):** HTTP/2 6-socket-cap latency story is empirically weak (seeks don't stall even saturated; R2 TTFB ~150 ms). Surviving value = CDN caching + egress-at-scale + HMAC auth, not a latency fix. Impact 8->4. |
| T2570 | ↳ [Remove Fly.io Video Proxy](tasks/r2-cdn/T2570-remove-flyio-video-proxy.md) | 4 | 3 | 1.3 | TODO | [ ] | Delete proxy endpoints made redundant by T3250 + CDN path. After CDN stable 2+ weeks. |
| T2580 | ↳ [Faststart Upload Validation](tasks/r2-cdn/T2580-faststart-upload-validation.md) | 6 | 2 | 3.0 | TODO | [x] | Validate faststart on upload, auto-remux if needed, store is_faststart flag. Prevents non-faststart regression after T3250 drops proxy moov windows. |
| T7140 | [Remux uploaded game videos with faststart (moov at front)](tasks/T7140-game-video-faststart-remux.md) | 6 | 4 | 1.5 | TODO | [ ] | **Moved here 2026-09-02 (user order)** from Milestone: Final Polish. **Deprioritized 2026-09-01 (user order)** — moved out of Milestone TOP, no longer sequenced first-after-reshoot; the Game Pools epic's upload-post-processing rail depends on this task's Modal-dispatch redesign, so Game Pools now waits for T7140 here too (resequenced with it, 2026-09-01 user order — see that milestone's sequencing note). **Renumbered from T7020 on 2026-08-17** (T7020's PLAN.md slot became the Preview Video Improvements epic below; no content change, see the task file's top note). Was sequenced first after T5140 (DONE, deployed 2026-08-17 prod; user-ordered 2026-08-15) — deliberately held out of the next deploy for more thorough testing, not blocked on anything technical. A synchronous version was prototyped and worked (commit `7f2aeb4e`, CI green, reliability-hardened — fixed a real retry-classifier gap found live-testing it) but added ~as much wall-clock to `finalize_upload` as the original upload itself (measured 65-78s remux on a 278MB test, matching a 58.5s upload) because the remux round-trips the file through R2 twice more. User reviewed a design note comparing that against dispatching the remux to Modal (mirrors T4945's `stitch_members` pattern, keeps the response near-instant, never adds upload-time cost) and prefers the Modal-dispatch redesign — full comparison + sequence diagrams: [design artifact](https://claude.ai/code/artifact/27a9f3e5-38fb-44bd-8dcb-50655873f81c). The prototype branch is deleted (2026-08-14) — its reusable pieces (retry-classifier fix, moov-probe helpers, fail-open remux module) are embedded verbatim in the task file's "Preserved Implementation" section, so no checkout is needed when this is picked back up. |
| T2270 | [Session Inactivity TTL](tasks/T2270-session-inactivity-ttl.md) | 5 | 2 | 2.5 | TODO | [ ] | Expire sessions after N days of inactivity using last_seen_at. Absorbs T420 inactivity portion. Depends on T1190. |
| T3440 | [Cache CORS Preflight Responses](tasks/for-launch/T3440-cors-preflight-caching.md) | 5 | 1 | 5.0 | TODO | [ ] | No Access-Control-Max-Age header -- browser fires OPTIONS preflight on every cross-origin request. 826ms overhead (17.8% of page time). One-line fix: add max_age=7200 to CORSMiddleware. |
| T1730 | [Performance Optimization Pass](tasks/for-launch/T1730-performance-optimization-pass.md) | 7 | 5 | 1.4 | TODO | [ ] | Pre-launch audit: slow endpoints, UI jank, bundle size, slow queries, unnecessary R2 round-trips |
| T2650 | [Move Sweep Auto-Export to Modal](tasks/T2650-sweep-to-modal.md) | 7 | 4 | 1.8 | TODO | [ ] | Sweep runs FFmpeg/recap on Fly.io via asyncio.to_thread — violates fast-server principle. Move auto-export compute to Modal; server becomes lightweight orchestrator (DB queries + Modal RPC). |

### Epic: Video Load Reliability (IN_PROGRESS) -- BUG FIX
[tasks/video-load-reliability/EPIC.md](tasks/video-load-reliability/EPIC.md)

Goal: Robust video loading — no misleading format errors, no oversized preloads, no CORS spam. Ordered by severity to user experience. Orchestrator-driven; each task gets its own branch and merges only after its before/after test proves effectiveness.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Epic: For Launch (IN_PROGRESS)
[tasks/for-launch/EPIC.md](tasks/for-launch/EPIC.md)

Goal: Make money, virality, super polished. Most tasks here are yet to be generated based on alpha feedback.

#### Features

Scale, performance, and reliability — must be solid before feature work.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Overlay 2](tasks/overlay-2/EPIC.md)** |  |  |  |  |  |  |
| T2180 | ↳ [Manual Telestration](tasks/overlay-v2/T2180-manual-telestration.md) | 6 | 5 | 1.2 | TODO | [ ] | Phase 2: freeze frame + draw arrow/circle/line, hold 1-2s, resume. Recruiting use case. CPU-only. |
| T2130 | ↳ [Player Label Overlay](tasks/overlay-v2/T2130-player-label-overlay.md) | 8 | 5 | 1.6 | TODO | [ ] | Name/number text tag following player tracker. Auto-positions, "minimal" and "broadcast" style presets. |
| T2140 | ↳ [Screen-Anchored Event Overlays](tasks/overlay-v2/T2140-screen-anchored-event-overlays.md) | 7 | 4 | 1.8 | TODO | [ ] | Score bug, GOAL/ASSIST badge, match metadata, time of play. Timestamp-triggered, corner-anchored. |

#### Marketing

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T445 | [Vehicle Window Cards](tasks/T445-business-cards.md) | 6 | 2 | 3.0 | TODO | [ ] | Design + print cards to place on vehicle windows at games promoting reelballers.com with QR code. Targets parents already at the field. |
| T1930 | [Influencer Marketing](tasks/marketing/T1930-influencer-marketing.md) | 8 | 4 | 2.0 | TODO | [ ] | Identify top influencers that youth soccer parents follow who align with video technology use. Outreach strategy + partnership plan. |

#### Completed

- T1150 Fix Pending Sync Retry No-Op — DONE
- T1152 Persist Sync-Failed State — DONE
- T1160 Clean Up Unused DB Rows — DONE
- T1170 Size-Based VACUUM on Init — DONE
- T1180 Fix NULL video_filename Root Cause — DONE
- T1200 Modal Job ID Logging & Retry — DONE
- T1380 Recover Orphaned Jobs Per-User at Startup — DONE
- T1390 Process Modal Queue Per-User at Startup — DONE
- T1130 Multi-Clip Stream Not Download — DONE
- T1120 Framing Video Cold Cache — DONE
- T1020 Fast R2 Sync — DONE
- T1010 Slow fetchProgress Response -- DONE

### Movement Tracking (Activity Timeline for Annotate)

Annotating a full game is the product's biggest time sink — only ~55-65% of a match is effective playing time; the rest is throw-in walks, resets, subs, and halftime. Paid opt-in at upload runs a Modal job producing a per-game movement profile (per-second activity score + ACTIVE/DEAD/EMPTY states); Annotate renders it as an activity layer (y proportional to movement) and smart playback skims dead time / skips halftime. Science project first: testbed + human-labeled ground truth + KPI gates (headline: >=99.5% play preservation — never speed past a goal) BEFORE anything touches the app. Signals: compressed-domain motion vectors, optical flow with camera-motion compensation, YOLO player tracking (weights already in our Modal image), tiny learned fusion + temporal smoothing. Epic tasks are STRICTLY ordered. Full research basis, library survey, label taxonomy, and decision gates: [tasks/movement-tracking/EPIC.md](tasks/movement-tracking/EPIC.md).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Movement Tracking](tasks/movement-tracking/EPIC.md)** | 8 | 7 | 1.1 |  |  | Testbed-proven dead-time detection: labeling env + ground truth → classical signal bake-off → detection/fusion tuning to KPI gates → Modal job + profile artifact → Annotate activity layer → smart playback → paid opt-in. |
| T7060 | ↳ [Motion Testbed + Labeling Env + Dataset](tasks/movement-tracking/T7060-motion-testbed-labeling.md) | 8 | 5 | 1.6 | TODO | [ ] | Renumbered from T5430 on 2026-08-15 — that ID collided with an already-merged, unrelated task (overlay touch targets) reusing the same number; see `project_planmd_status_drift_batched_commits` memory / PLAN.md sweep. The instrument: `experiments/motion_testbed/` (sr_testbed pattern), keyboard-driven HTML labeler (A/D/E state stamping at 4x), 8 games labeled across veo-static/follow/phone cameras (5 dev / 3 held-out, labels committed, media gitignored), G1-G6 metrics harness + HTML report, inter-annotator kappa, trivial baselines. Blocks the whole epic. |
| T7070 | ↳ [Classical Signal Bake-off](tasks/movement-tracking/T7070-classical-signal-bakeoff.md) | 7 | 5 | 1.4 | TODO | [ ] | Renumbered from T5440 on 2026-08-15 (ID collision, see T7060's row). CPU-only signals measured on labeled games: bitstream motion vectors (mv-extractor/PyAV, near-free), frame diff/MOG2, DIS optical flow — each with camera-motion compensation on/off per camera class. ROC-AUC comparison, cost curve vs sampling rate, per-second feature cache for T7080. |
| T7080 | ↳ [Detection + Fusion + Smoothing → Gate](tasks/movement-tracking/T7080-detection-fusion-tuning.md) | 9 | 7 | 1.3 | TODO | [ ] | Renumbered from T5450 on 2026-08-15 (ID collision, see T7060's row). The go/no-go: YOLO+ByteTrack semantic features (player count nails EMPTY/halftime) fused with classical features via tiny classifier + hysteresis/HMM decode; tune G1 first (>=99.5% play preservation) then maximize dead capture; leave-one-game-out on dev, single frozen-recipe run on held-out; error analysis + Modal cost projection <=$0.50/game. |
| T5460 | ↳ [Modal Movement Job + Profile Persistence](tasks/movement-tracking/T5460-modal-movement-job.md) | 8 | 6 | 1.3 | TODO | [ ] | BLOCKED by T7080 go. `analyze_movement` Modal fn (reuses baked yolov8x, generator progress, presigned-URL sampled decode of 90-min input) + `call_modal_movement` unified dispatch + local engine; msgpack profile artifact in R2 with storage ref; profile_db `movement_profiles` table + migration; admin/dev trigger + GET endpoint; testbed-parity test so prod recipe can't drift. |
| T5470 | ↳ [Annotate Activity Layer](tasks/movement-tracking/T5470-annotate-activity-layer.md) | 7 | 4 | 1.8 | TODO | [ ] | Canvas area-sparkline over the Annotate timeline (y = normalized score, max-pool downsampling so goal spikes survive), DEAD tinted / EMPTY hatched, session toggle. Read-only derived display — zero persistence; no profile = no layer, no errors. UI Designer pass required. |
| T5480 | ↳ [Smart Playback](tasks/movement-tracking/T5480-smart-playback.md) | 8 | 5 | 1.6 | TODO | [ ] | Pure client playbackRate state machine: 1x through ACTIVE, configurable 2-8x skim through DEAD (2s lead-in back to 1x), hard-skip EMPTY >2min with toast + undo; protected zones ±10s around top-decile spikes (never skip a goal); manual interaction suspends smart control. Exhaustively unit-tested pure hook + real-browser verify. |
| T5490 | ↳ [Upload Opt-in + Paid Add-on Gating](tasks/movement-tracking/T5490-upload-optin-pricing.md) | 6 | 5 | 1.2 | TODO | [ ] | LAST deliberately (dogfood free internally first): opt-in checkbox at Add Game with price, entitlement on existing credits rails (no parallel payment path), dispatch-on-upload-complete, auto credit-back on hard failure, admin free-flag for beta accounts, funnel analytics. |

### Game Pools — Multi-Feed Shared Games

A game becomes a pool: up to 50 contributors — parents from BOTH teams — add their Veo/Trace cameras and iPhone clips through one link pasted in the team WhatsApp; every feed aligns to one game clock (audio-fingerprint autosync, manual line-up fallback); each family picks the best camera per play of their kid. Cross-team pooled angle-picking is competitive white space (Trace MultiCam is single-team + own hardware; Veo can't multi-cam), and every link is organic acquisition — the other team's parents sign up to join. Rent-model storage: the uploader's charge covers everyone for 30 days, then continued access is per-member per-feed. REDESIGNED 2026-08-19 from the two-camera draft (same task IDs, generalized scope); normative specs live in the epic folder: [UX-SPEC.md](tasks/dual-camera/UX-SPEC.md) (every changed screen) + [ALIGNMENT.md](tasks/dual-camera/ALIGNMENT.md) (algorithm + real-file evidence). **2026-09-03 scope amendment (user directive, recorded in EPIC.md Captured requirements): the single-owner path is first-class — "Add Video" on your OWN game adds overlapping feeds (auto timestamp alignment, separate layer over the Veo/Trace reference, per-clip feed choice at annotation) with NO pool sharing required; T5510's share-modal-only entry is amended at design time.** Epic tasks are STRICTLY ordered: [tasks/dual-camera/EPIC.md](tasks/dual-camera/EPIC.md).

**Sequencing (user-approved 2026-08-19, bugs → UI/UX → infra):** (1) NOW, before the epic: T7280 + T7170 (small pure-UX wins) and land the in-flight T7290 (same GameTile surface as §4's chips). (2) **Named prerequisites:** [T6770](tasks/T6770-game-refcount-derived-set.md) (the rent model depends on cross-ACCOUNT ref counting — fix the drifting counter first) and [T6780](tasks/T6780-guard-asymmetries-detections-materialization.md) part B (the join flow reuses the materialization copy-game path with its unguarded below-head writes); both are bug-class and go first per the Priority Policy. (3) [T7140](tasks/T7140-game-video-faststart-remux.md) remains a named prerequisite — this epic's upload-post-processing rail reuses its Modal-dispatch moov-probe redesign (ALIGNMENT.md's `align_feed` and T7310's proxies ride the same pattern). **Resequenced 2026-09-01 (user order):** T7140 was deprioritized to the Milestone: Final Polish section (placed right before Upscale Quality), so Game Pools now waits for it there instead of first-after-reshoot — this epic effectively moves down with it. (4) Then the epic, UI-forward children first (T5495 → T5498 ship user-visible upload UX for everyone, weeks before any pool backend). JIT Migration slots either just before T5500's schema work (its migrations are then born JIT) or after the whole epic — not between the epic's children.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Game Pools — Multi-Feed Shared Games](tasks/dual-camera/EPIC.md)** | 9 | 8 | 1.1 |  |  | One link pools both teams' footage: N feeds on one game clock, per-feed lanes in Annotate, per-clip camera picking at export, rent-model storage, autosync by audio. Value→UX→architecture→task trace table in EPIC.md. |
| T5495 | ↳ [Add Game Overhaul](tasks/dual-camera/T5495-add-game-overhaul.md) | 7 | 6 | 1.2 | TODO | [ ] | Video OPTIONAL at create (awaiting-video games; T1180 zero-video exception), folder upload with contiguous-segment detection, client-side mvhd creation_time parse, metadata-ordered EDITABLE role chips — and "Per Half" + the whole Video Format control REMOVED, evidence-based: 16/16 real multi-file uploads (incl. all sarkarati prod half-pairs) carry embedded creation_time that orders halves correctly; File.lastModified banned (ordered a real pair wrong). ALIGNMENT.md § Half-order evidence. |
| T5498 | ↳ [Crop Before Upload](tasks/dual-camera/T5498-crop-before-upload.md) | 6 | 7 | 0.9 | TODO | [ ] | Full-screen client-side crop stage for ≥4K sky-heavy sources (the DJI class): crop handles + filmstrip sanity-scrub, why-line + LIVE size/credit recompute as the rect moves, WebCodecs on-device re-encode (uncropped bytes never leave the machine; charged on cropped size), honest fallback when the browser can't encode. |
| T5500 | ↳ [Pool Entity + Invite/Join Backend](tasks/dual-camera/T5500-shared-game-backend.md) | 7 | 5 | 1.4 | TODO | [x] | Postgres: shared_games (per-SIDE invite tokens, side names, sport + team-name snapshots, wall-clock origin as a stored constant) + members (cap 50) + feeds + feed_videos (wall_offset/source/confidence/creation_time); public status endpoint; join binds a profile + derives game info from the claimed side (invert Home↔Away only cross-team, opponent from the sharer's team); claim-through-signup on the T5730 rails; shared_by provenance (T5330). |
| T5510 | ↳ [Invite / Status / Join / No-Video UX](tasks/dual-camera/T5510-create-join-ux.md) | 8 | 6 | 1.3 | TODO | [ ] | Entry ONLY inside the Share game modal (zero new chrome for basic users); invite sheet with Anyone-default one-tap link + optional side tags + team-name capture (saved to profile, prefills cross-team opponents); public pool status page (counts pre-join, never names); join confirm (whose athlete + which team, consequence lines); pool tile chips; no-video Annotate setup panel (upload-or-share, bug-27p pattern). |
| T5520 | ↳ [Feed Propagation + Rent + Live Sync](tasks/dual-camera/T5520-upload-binding-propagation.md) | 8 | 7 | 1.1 | TODO | [x] | profile_db migration: `game_videos.feed_id` + `games.shared_game_id` (+ `raw_clips.feed_id` for T5550); refresh-on-load + ~60s/focus poll materializes reference rows + per-feed storage refs (initial window copies the uploader's expiry; head-guarded T4820); RENT ENFORCED at the presign/stream path (your own live ref required — no free-riding); sweep recount audited to provably cover cross-ACCOUNT refs; cancel rails at every upload stage. |
| T5530 | ↳ [Alignment: Autosync + Line-Up View](tasks/dual-camera/T5530-time-alignment.md) | 7 | 6 | 1.2 | TODO | [ ] | ALIGNMENT.md cascade: per-blake3 cached envelope + fingerprints, fingerprint coarse match + GCC-PHAT fine, verdict ladder (manual authoritative, offsets NEVER fabricated), export-time-stamp classifier (order-only, never seeds windows); Modal `align_feed` beside the mov-atom probe; line-up view with waveform strips (slide with the nudge), comparison-camera selector among lined-up feeds, short-clip variant, no-audio state. |
| T5540 | ↳ [Camera Lanes + Main + Prefer Pill](tasks/dual-camera/T5540-annotate-camera-toggle.md) | 9 | 6 | 1.5 | TODO | [ ] | Per-feed lanes (clips PACK — non-intersecting share a lane, intersecting split); Main lane = resolved default (a covering clip wins → member's preference spans → reference feed) with owner-named segments + visible pin strip; "Prefer this camera from here" pill is the ONLY preference gesture (member-local feed_preferences); tap/C-key switching preserves the moment (session-only); coach-mark on first multi-feed render; short-viewport chip fallback. |
| T5550 | ↳ [Per-Clip Picker + Extraction](tasks/dual-camera/T5550-clip-from-active-camera.md) | 7 | 7 | 1.0 | TODO | [x] | `raw_clips.feed_id` stamp; picker strip of FULL-coverage cameras only (partial coverage omitted entirely — never a truncated export); Main tile first, tap = pick + preview, "Use Main instead" undo; export resolves the picked feed through a Python `feed_time_map` twin (shared test vectors, loud failure on inconsistency); `_export_brilliant_clip` honors the pick. |
| T7300 | ↳ [Per-Feed Keep Checklist](tasks/dual-camera/T7300-per-feed-keep-checklist.md) | 6 | 5 | 1.2 | TODO | [ ] | Rent UX: per-feed rows (owner, size, cost; pre-check ONLY own feed + explicit clip picks — never pre-bill), "Keep nothing for now" as a first-class informed exit, consequence line (what stops playing, what stays), hash-selective extend (today's extend re-refs every hash), per-feed storage_status, clip feeds cost the 1-credit minimum (no recap surcharge). |
| T7310 | ↳ [Preview Proxies](tasks/dual-camera/T7310-preview-proxies.md) | 5 | 5 | 1.0 | TODO | [ ] | EVIDENCE-GATED (only if real pools feel slow): 480p renditions generated by the mov-atom Modal job, blake3-keyed beside the source; Annotate/preview surfaces stream the proxy, Framing/export ALWAYS resolve the full-res master; shipped .LRF proxies (T5495) use the same rendition slot. |
| T5560 | ↳ [Auto Best-Camera Suggestions](tasks/dual-camera/T5560-auto-best-camera.md) | 6 | 6 | 1.0 | BLOCKED | [ ] | BLOCKED by T5460 + T5540. Per-source (blake3) movement profiles score feeds — other members' profiles come free; "Main" earns the "Auto" name (Wand2) only when this ships; conservative hysteresis (never strobe, never switch away from a goal); the manual preference pill stays the override. |

### Deprioritized (evidence-gated / narrow-audience)

Moved here 2026-08-14 (user-ordered), after Movement Tracking + Dual-Camera Shared Games -- not gating anything, pick up if evidence/audience changes.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T5750 | [Perspective/keystone correction in Framing (acquisition-corrections family)](tasks/T5750-perspective-keystone-correction.md) | 4 | 6 | 0.7 | TODO | [ ] | **EVIDENCE-GATED — do not implement until >=2 real user clips show keystone distortion rotation can't fix.** Third member of the acquisition-corrections family (per-clip, fix-it-not-creative, before-crop): T5640 rotation fixed camera ROLL; this fixes off-axis aim (yaw/pitch -> converging goalposts, trapezoidal skew) via FFmpeg `perspective` homography. Canonical order dewarp -> perspective -> rotate -> crop; T5640 coordinate contract + safe-area clamp generalize to the composed transform. Prereq architecture (extract T5640's triple-site rotate-before-crop insertion into ONE shared corrections builder) belongs to T5657's design gate — whichever lands second inherits it. UX candidate: drag-2-vertical-guides (Lightroom Guided-Upright style, consistent with the straighten tool). Filed 2026-07-22 to name the family + reserve design constraints, not to schedule work. |
|  | **[Multi-File Ingest & Prep](tasks/prepare-stage/EPIC.md)** | 3 | 8 | 0.4 | TODO |  | DEPRIORITIZED 2026-07-31 (user): "most users won't need this." Impact 6 -> 3, so Priority 0.8 -> 0.4 ("consider if it's worth doing at all"), and the block moves to the bottom of Next Up. The deprioritization is an AUDIENCE judgment, not a technical one: the core customer is a soccer parent with a phone or a Veo, and multi-file 62GB 8K drone ingest serves a narrow slice of that. Nothing here is wrong or blocked — the design spike is still valid and the 50-200x reduction still holds if it is ever picked up. Child scores are unchanged: they express value RELATIVE to each other inside the epic, while the epic row is what competes at milestone level (see Epic Prioritization). Revisit if real users start arriving with multi-file/high-res footage. PARTIAL SUPERSESSION (user-approved 2026-08-19): the Game Pools epic pulled several pieces forward — folder upload + metadata ordering (T5495), crop-before-upload (T5498), and the proxy/preview rendition slot (T7310) absorb T5651/T5652's ingest surface and T5654's annotate-on-proxy; see per-child notes below. The unique remaining value here is T5653's client trim/assemble workspace and T5655's conform-crop-from-master. Reconcile scopes against the Game Pools task files before picking ANY child up. Original scope: Bring in large, multi-file, non-Veo footage (62GB 8K DJI folder) without uploading the raw monster. Relevant video drops 50-200x (50GB -> <1GB) via edit-on-proxy + manual trim + conform-crop-from-master. Design spike DONE (hands-on ffmpeg + YOLO on the real footage): [study](research/T5650-dji-8k-ingest-reduction-study.md) (section 0 = locked decisions). Decisions: manual client trim (auto-trim dropped); dual-asset pipeline (upload LRF+MP4, Annotate+Framing-preview on LRF, Framing conforms crop ROI from MP4, upscale only when native crop < target); new `VideoMode.MULTI_FILE` ("Multiple Files") -> client-side Prep (assemble, manual trim, low-fi LRF preview + "annotate this" markers, stream-copy trim+concat, resumable dual-asset upload); use shipped .LRF else generate. Pairs with T5640 (rotation) + T5657 (fisheye de-warp). |
| T5651 | ↳ [Proxy/master asset pairing data model + credit accounting](tasks/prepare-stage/T5651-proxy-master-data-model.md) | 6 | 5 | 1.2 | SUPERSEDED | [ ] | **SUPERSEDED 2026-08-19 by T7310's blake3-keyed rendition slot** (Game Pools epic) — one proxy store, not two. Reopen only if frame-accurate proxy/master credit accounting turns out to need more than the rendition slot. |
| T5652 | ↳ [`MULTI_FILE` mode + client-side Prep workspace shell](tasks/prepare-stage/T5652-multifile-mode-prep-shell.md) | 6 | 5 | 1.2 | TODO | [ ] | Epic 2/7. Third `VideoMode` ("Multiple Files") beside Full Game / Per Half -> folder pick -> full-screen client-side Prep shell (file rail + timeline + preview + Create). Full Game / Per Half stay byte-identical. Engine is T5653. |
| T5653 | ↳ [Client assemble/trim/concat + resumable dual-asset upload](tasks/prepare-stage/T5653-client-assemble-trim-upload.md) | 7 | 8 | 0.9 | TODO | [ ] | Epic 3/7 (hardest). Auto-order by timestamp + drag; manual multi keep-range trim; STREAM-COPY concat both proxy+master (ffmpeg.wasm/WebCodecs, lossless, keeps 8K); resumable dual-asset upload. Validate browser ceiling on the real 62GB folder; cross-codec/fallback explicit. |
| T5654 | ↳ [Annotate reads the proxy (LRF)](tasks/prepare-stage/T5654-annotate-on-proxy.md) | 6 | 4 | 1.5 | SUPERSEDED | [ ] | **SUPERSEDED 2026-08-19 by T7310** (Game Pools epic): Annotate/preview stream the rendition, Framing/export always resolve the master — the same invariant, one implementation. |
| T5655 | ↳ [Framing conform-from-master + upscale-only-as-needed](tasks/prepare-stage/T5655-framing-conform-upscale-as-needed.md) | 7 | 6 | 1.2 | TODO | [ ] | Epic 5/7. Framing preview on proxy; export conforms crop ROI x clip window from the MASTER (native, never whole 8K); AI upscale runs ONLY when native crop < target (8K crops usually already >=1080p -> skip). Shares filter-stage design with T5640/T5657. |
| T5656 | ↳ [Prep markers -> Annotate clip candidates](tasks/prepare-stage/T5656-prep-markers-to-annotate.md) | 5 | 4 | 1.3 | TODO | [ ] | Epic 6/7. "Annotate this" markers dropped during the low-fi Prep preview persist on the game and surface in Annotate as pre-seeded clip candidates (human-in-loop, not auto-clips). |
| T5657 | ↳ [Fisheye de-warp + horizon level](tasks/prepare-stage/T5657-fisheye-dewarp-level.md) | 5 | 6 | 0.8 | TODO | [ ] | Epic 7/7. Lens de-warp (OpenCV cv2.fisheye / ffmpeg lenscorrection |

### Epic: Post Launch (TODO)
[tasks/post-launch/EPIC.md](tasks/post-launch/EPIC.md)

Improvements after real user traffic. Target audience: highly engaged soccer parents with enough
technical ability to use the app. Reach them where they already spend attention. Landing Page
Redesign core tasks (hero, nav, visual foundation) in For Alpha -- polish tasks (how-it-works,
features cut, sample reels, FAQ) deferred to For Launch. Pricing dropped (freemium model).

| ID | Task | Status | Pri | Migr | Description |
|------|------|------|------|------|------|
| T710 | [Share with Coach](tasks/post-launch/T710-share-with-coach.md) | TODO | 1.2 | [x] | Coach account type + sharing: roster uploads, assign annotations to players, clip ratings, notes, send-back flow. Absorbs T1060 (Coaches View) |
| T720 | [Art Frames](tasks/T720-art-frames.md) | TODO | 1.1 | [x] | Draw on frozen clip frames (like a telestrator); shown during Play Annotations with a pause |
| T2170 | [Glow & Arrow Primitives](tasks/overlay-v2/T2170-glow-arrow-primitives.md) | TODO | 1.5 | [ ] | Soft radial glow aura + floating arrow pointer for wide shots. |
| T2190 | [Extended Presets](tasks/overlay-v2/T2190-extended-presets.md) | TODO | 2.5 | [ ] | "Recruiting" (minimal + persistent label) and "Social" (pulse + glow + broadcast name) presets. |
| T2200 | [Outline Trace Primitive](tasks/overlay-v2/T2200-outline-trace-primitive.md) | TODO | 0.7 | [ ] | Edge-detect player silhouette outline. Expensive to compute, premium-feel. |
| T2210 | [Spotlight Cone Primitive](tasks/overlay-v2/T2210-spotlight-cone-primitive.md) | TODO | 1.2 | [ ] | Darken/desaturate everything outside player region. High-drama cinematic effect. |
|  | **[Overlay 3](tasks/overlay-v2/EPIC.md)** |  |  |  | Composable overlay system: player labels, pulse rings, score bugs, event badges, presets. Clips look like pro TikTok/IG edits. |
| T2100 | ↳ [Composable Overlay Architecture](tasks/overlay-v2/T2100-composable-overlay-architecture.md) | TODO | 1.3 | [ ] | Refactor single ellipse into composable primitive system with common config, composition engine, stacking rules |
| T2120 | ↳ [Pulse Ring Primitive](tasks/overlay-v2/T2120-pulse-ring-primitive.md) | TODO | 2.3 | [ ] | Animated scale + opacity loop for dramatic moments (goals, big saves). 1-2s duration. |
| T2150 | ↳ [Overlay Presets System](tasks/overlay-v2/T2150-overlay-presets-system.md) | TODO | 2.0 | [ ] | One-click templates: "Spotlight", "Goal", "Custom". Wire up multiple primitives at once. |
|  | **[On Fire: NBA Jam heat effects](tasks/on-fire/EPIC.md)** | TODO | 0.7 |  | Filed 2026-09-08 as a thought experiment for the "spice it up" tail of the roadmap, AFTER Overlay 3 (T2100 is a hard prerequisite). NBA Jam's rule (3 consecutive baskets, "He's heating up" at 2, "He's on fire" at 3, flaming ball, burning net) mapped onto a reel: per-region heat level off/heating/fire, flames anchored to the spotlight ellipse with a trail along the spline velocity, and an auto-escalation preset across a 3-clip reel. Audit verdict: there is NO player tracker today (spotlight motion between keyframes is Catmull-Rom interpolation; YOLO samples 4 frames per clip, person-only, no track ids) and every effect must be mirrored in SVG preview + backend numpy + Modal inline numpy (T5250 dropped glow/pulse for this), so v1 = sprite-sheet flames driven by a pure placement function with a parity test, exactly NBA Jam's own technique. Ball flames are evidence-gated behind a recall spike on Focus OUTPUT video (COCO class 32; no ball detection exists anywhere in src/). Original art only, no announcer audio, no new Postgres state, no migration for Phase 1. |
| T9210 | ↳ [Flame asset pipeline + heat placement spec (mirrored x3)](tasks/on-fire/T9210-flame-assets-and-placement-spec.md) | TODO | 1.3 | [ ] | Epic 1/6. Offline deterministic sprite generator (original art: plume, trail, ember, smoke, ring, burst; 24-frame loops), pure `heat_placements(t, level, anchor, velocity, radius, ...)` in 3 mirrored copies + `TestModalInlineParity`, spline velocity helper (central difference). Ships inert. |
| T9220 | ↳ [Per-region heat level: data key, action, settings UI](tasks/on-fire/T9220-region-heat-level-data-and-ui.md) | TODO | 1.7 | [ ] | Epic 2/6. First per-region style field: additive `heat` key on the region dict in `highlights_data` (no migration, T4355 precedent), `set_region_heat` action with CAS bump, Off/Heating/Fire control on the active region in OverlaySettingsCard, carry-forward preserves it. |
| T9230 | ↳ [Render the fire in all three paths (preview, backend, Modal)](tasks/on-fire/T9230-render-fire-three-paths.md) | TODO | 0.9 | [ ] | Epic 3/6. SVG `<image>` layer with screen blend in HighlightOverlay; numpy sprite blend in `_process_frames_to_ffmpeg` and Modal `_render_highlight` (sprites shipped as bytes per call, T5225 pattern); fire ring replaces the stroke; reveal-envelope fade; frame-level parity test + preview-vs-export QA spec. Modal redeploy gate. |
| T9240 | ↳ ["NBA Jam mode" auto-escalation preset + goal burst](tasks/on-fire/T9240-nba-jam-mode-preset.md) | TODO | 1.5 | [ ] | Epic 4/6. One-gesture preset via T2150: play 1 off, play 2 heating, play 3+ fire (fans out surgical `set_region_heat` actions, nothing stored twice); burst in the last 0.4 s of a fire region or at T2140's GOAL badge; optional "{Name} is on fire" text beat via T2130/T2140. No audio. |
| T9250 | ↳ [Dense tracking for feet fire + scorch footprints](tasks/on-fire/T9250-dense-tracking-feet-fire.md) | TODO | 0.7 | [ ] | Epic 5/6. New Modal `track_region_modal` (Ultralytics ByteTrack, person-only, every frame of fire regions on the WORKING video), athlete track picked by IoU with the user's ellipse, 1-euro smoothed feet, spline gap-bridge under 0.5 s, derived `heat_tracks` region key, scorch decals, credit-estimated GPU cost. Shares design with T2160/T2220. |
| T9260 | ↳ [Ball on fire: recall spike, then possession + shot trail (evidence-gated)](tasks/on-fire/T9260-ball-on-fire-spike.md) | TODO | 0.4 | [ ] | Epic 6/6. Stage 1 = measure COCO class 32 recall inside hand-labeled possession windows on 10 real Focus-output videos at imgsz 640/1280; GATE >= 80% or close with numbers. Stage 2 = Kalman ball track, possession (ball within 0.6 x bbox height of feet for 3 frames), shot detection on release speed, ball_flame + shot_trail placements. Never ship a blinking ball flame. |
|  | **[PWA Epic](tasks/pwa/EPIC.md)** |  |  |  | Background export + push notifications + background uploads + share target + offline playback |
| T443 | ↳ [Background Export Tracking](tasks/pwa/T443-background-sync.md) | TODO | 1.4 | [ ] | Export survives app close -- service worker tracks Modal job, notifies on completion. |
| T444 | ↳ [Push Notifications & Badges](tasks/pwa/T444-push-notifications-badges.md) | TODO | 1.6 | [ ] | Push for export complete + shared clips received. Badge count on app icon for pending items. |
| T447 | ↳ [Background Fetch for Uploads](tasks/pwa/T447-background-fetch-uploads.md) | TODO | 2.0 | [ ] | Multi-GB game uploads survive app close/switch. Parents upload at the field on cellular. THE differentiator. |
| T448 | ↳ [Share Target API](tasks/pwa/T448-share-target-api.md) | TODO | 2.3 | [ ] | Receive videos FROM camera roll directly into Reel Ballers upload flow. Eliminates file picker friction. |
| T449 | ↳ [Offline Reel Playback](tasks/pwa/T449-offline-reel-playback.md) | TODO | 2.0 | [ ] | Cache exported reels for offline viewing + persistent storage. Show reels without cell signal. |
| T1910 | ↳ [Tutorial Video](tasks/for-launch/T1910-tutorial-video.md) | TODO | 2.7 | [ ] | Record walkthrough video: upload game, annotate clips, frame, overlay, export. Embeddable on landing page and in-app onboarding. |

---

## Environment Configuration

### Credentials (Found)

**R2 Storage** (in `.env`):
```
R2_ENABLED=true
R2_ACCESS_KEY_ID=4f5febce8beb63be044414984aa7a3b4
R2_SECRET_ACCESS_KEY=***
R2_ENDPOINT=https://e41331ed286b9433ed5b8a9fb5ac8a72.r2.cloudflarestorage.com
R2_BUCKET=reel-ballers-users
```

**Modal GPU** (in `~/.modal.toml`):
```
token_id=ak-Gr72Vz5gr7MYVpcUowSeDB
token_secret=***
```

### Fly.io Secrets (for T100)

```bash
fly secrets set --app reel-ballers-api-staging \
  R2_ENABLED=true \
  R2_ACCESS_KEY_ID=4f5febce8beb63be044414984aa7a3b4 \
  R2_SECRET_ACCESS_KEY=<from .env> \
  R2_ENDPOINT=https://e41331ed286b9433ed5b8a9fb5ac8a72.r2.cloudflarestorage.com \
  R2_BUCKET=reel-ballers-users \
  MODAL_ENABLED=true \
  MODAL_TOKEN_ID=ak-Gr72Vz5gr7MYVpcUowSeDB \
  MODAL_TOKEN_SECRET=<from ~/.modal.toml> \
  ENV=staging
```

---

## Task ID Reference

IDs use gaps of 10 to allow insertions:
- `T10-T79` - Feature tasks (complete)
- `T80-T99` - Pre-deployment blockers + bug fix sprint
- `T100-T199` - Deployment epic
- `T200-T299` - Post-launch features + polish
- `T400-T430` - User Auth epic (T400=Google, T401=OTP, T405=D1, T420=sessions, T430=settings)
- `T500-T525` - Monetization epic
- `T1700-T1705` - Open Panel Analytics epic
- `T2100-T2220` - Overlay System v2 epic
- `T2250-T2260` - Session Scaling epic
- `T2300-T2380` - Landing Page Redesign epic
- `T2400` - Grace Period for Expired Games
- `T2410-T2430` - Expired Game Experience epic
- `T2450-T2470` - Auto-Export Reliability epic
- `T2480` - Modal Spline Interpolation
- `T2550-T2570` - R2 CDN Video Serving epic
- `T2670` - Upload Slow Connection Optimization
- `T2680` - Remove Video Link Import (legal)
- `T2750` - Unified Multi-Video Experience
- `T2800-T2860` - Team Sharing Alpha epic
- `T2880-T2885` - Games List Performance epic
- `T2890` - Cache Warming Efficiency (standalone, warming system upgrade)
- `T2900-T2910` - Invite & Referral epic
- `T2915` - Sport Inheritance Through Invite (link snapshot: referrals.inherited_sport v017 + shares.sharer_default_sport v018; NOT a users.default_sport mirror)
- `T2920` - Migration System Infrastructure (standalone)
- `T2930` - Postgres Data Locality Audit (standalone)
- `T3000-T3020` - Analytics 1 epic (CF Web Analytics + Postgres event log + admin migration)
- `T3030` - Cross-Origin Fetch Credentials (bug fix)
- `T3080` - Sync User Activity to SQLite (dual-write activity to per-user SQLite)
- `T3050` - Multi-Video Blank Video (bug fix, no error handling on dual video elements)
- `T3060` - Make It Load Fast (Playwright perf benchmarks against prod)
- `T3260` - Edit Game Metadata Post-Upload
- `T3270` - Clip Boundary Visual Indicator (Annotate mode)
- `T3450-T3490` - Analytics Power-Up epic (normalize schema, action log, fill tracking gaps, admin redesign)
- `T3290` - Tune NUF for Returning Users (differentiate returning vs first-time)
- `T3300` - Build Tutorial Video for Landing Page
- `T3070` - Brand Messaging Audit (emails, preloading, landing page high concept)
- `T3420` - Profile Critical-Path Endpoints (375ms per-request baseline, auth/me 1774ms, bootstrap 741ms)
- `T3430` - Parallelize Game Load (4 sequential requests -> 1 game bootstrap endpoint)
- `T446-T449` - PWA new tasks (Screen Wake Lock, Background Fetch, Share Target, Offline Playback)
- `T3540` - Framing "In Progress" Visual Ambiguity (progress strip half-fill + wording)
- `T3550-T3560` - Analytics: Attribution & Access Visibility epic (games uploaded vs accessible, user attribution graph)
- `T3570` - Track Annotation Playback Frequency (recurring usage event)
- `T3580-T3590` - Lifecycle Onboarding Emails epic (day 7/14/30 engine + content/personalization)
- `T1516` - Suppress Export-Job Analytics During Impersonation (split from T1515; stamp impersonated flag on export job, skip completion milestone)
- `T3595` - Share Viewer Opt-In & Viewer Analytics Bucket (consent-based how-to email for opted-in viewers; viewer leads bucketed separately from users)
- `T3600-T3640, T3670` - Season Highlights & Collections epic, DONE (metadata freeze, collections tab, live shares, ranking, "Top Plays" + dynamic smart collections). T3635 (reel order editor) moved to For Alpha - Polish. T3650/T3660/T3680 dropped (custom mix rename, quest rework, stitch).
- `T6190-T6200` - **Project-open latency (HAR 2026-07-28)** — T6190 removes redundant frontend fetches on reel open; T6200 investigates the backend request serialization the same HAR exposed
- `T7400-T7467` - Investor-Grade Analytics epic (analytics.sqlite rollup + visit beacon + activation/retention/growth reports + clip-library events + success-criteria RAG scorecard + journey-flow graph + deploy-comparison view; in-house only, aggregates only, no new Postgres state)
- `T9210-T9260` - On Fire epic (NBA Jam heat effects for Overlay; Post Launch, after Overlay 3; sprite-based flames on the spotlight ellipse, auto-escalation preset, dense tracking, evidence-gated ball flame)
- `T1536, T1537, T3760, T3770` - **Perf batch (HAR 2026-06-17)** — coordinated rollout across 2 branches / 3 conversations. See [perf-batch-har-2026-06-17.md](tasks/perf-batch-har-2026-06-17.md). Branch `feature/perf-quests-latency`: **T1536 DONE (deployed 2026-06-18)** as a correctness/DRY cleanup — HAR re-attribution showed `/progress` had no above-baseline server cost; **T1537 moved to the [Session Scaling epic](tasks/session-scaling/EPIC.md)** (BLOCKED on T2250 write-back, since its fix needs fire-and-forget analytics). Branch `feature/perf-page-load`: T3760 (framing clip cold-load over-fetch, re-opens T2560 clamp on latency grounds) + T3770 (StrictMode duplicate page-load fetch confirm, disjoint files).

See [task-management skill](../../.claude/skills/task-management/SKILL.md) for guidelines.
