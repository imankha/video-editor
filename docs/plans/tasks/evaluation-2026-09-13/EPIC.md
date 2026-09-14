# September 12–13 evaluation: next implementation batch

Filed 2026-09-13 at the user's request. All 27 source tasks are queued under unique project IDs T9770–T10030. This is planning work only. Main [PLAN.md](../../PLAN.md) is the execution queue; each project task owns its current outcome record. The unchanged [source plan](source/plan.md) retains all six epics, shared implementation contracts, source coverage and detailed sequencing. Source Markdown and standalone HTML briefs plus all assets are included.

## Reconciliation and scope decisions (2026-09-13)

Filed the same day the intake arrived. Every one of the 27 imported tasks was checked against the
working tree before any of it was scheduled. **This section, not the imported table below, is the
current state.** The mapping table and the `source/` package are retained as provenance.

### Which build was evaluated

The package does not say, and it decides whether the findings are current. It is answerable from
the evidence: the evaluator's account opened with **88 credits**, which only master-side code
produces (8 `new_account_bonus` + 80 `quest_upfront`, added by T8120). Production could not have
produced it - prod was pinned at build 4290 / `d9621161` (2026-09-01), which predates that grant,
and that gap is exactly what T9760 filed.

**Conclusion: the evaluator tested staging, so the findings are live against master.** Confirmed by
grepping four of the evaluator's quoted strings, all still present in the tree on 2026-09-13:
`clipConstants.js:52,56,67,71` (star threshold), `OverlayModeView.jsx:1198` (export required),
`ModeSwitcher.jsx:94` (Select a reel first), `displayNames.js:336` (Pick your player).

Note this is the SECOND staging evaluation in a week. The Sept 9-10 walkthrough produced T9400-T9760
(34 of them at STAGING and undeployed at the time of this intake). Overlap was therefore expected and
had to be established item by item rather than assumed.

### Per-task verification result

| Group | Tasks | Finding |
|---|---|---|
| **Confirmed live** | T9770, T9780, T9800, T9810, T9820, T9840, T9860 | Evidence located in the tree; see each PLAN.md row for the file and line. |
| **Reproduce or re-measure first** | T9790, T9920 | T9790 was observed once and never reproduced (T9470 covers the same shape). T9920's surface is restructured by T9500 and T8600, both at STAGING. |
| **Dropped** | T9910, T10000, T10020, T10030 | Already answered or duplicated existing board rows. Rationale in the table below. |
| **Folded** | T9940 | Into T9860 - same AI/capability copy, and splitting it would mean two passes over the same strings. |
| **Deferred** | T9980, T9990 | Moved to [EPIC-discovery.md](EPIC-discovery.md), to run after this batch. |
| **Net new, kept** | T9830, T9850, T9870, T9880, T9890, T9900, T9930, T9950, T9960, T9970, T10010 | Genuine scope, scheduled behind the P1 repairs. |

Two of the "confirmed live" entries deserve their reasoning recorded, because a prior task appears
to contradict them:

- **T9770 vs T9700.** T9700 ticked "selected player survives reopen", but that pass came from the
  `t9620diag.html` dev-only harness, and its single live reopen probe covered Focus crop handles and
  speed, not a Spotlight player. A permissive harness fails OPEN
  (`feedback_harness_must_match_production_geometry`). The gap is real; verify on a real reopen.
- **T9780 vs T9700.** T9700 states outright that it did not run a live byte comparison ("no full paid
  export was run in-container") and relied on architecture instead. The preview-to-export binding has
  never actually been checked against output bytes.

### Dropped, with rationale

| Imported | Why |
|---|---|
| T9910 | Credit/storage policy is ANSWERED. T9680's decision record is complete on all six questions and was verified against production 2026-09-12; T9750 fixed the rounding rule; T9760 explains the credit discrepancy. Residual copy work is T9650, already on the board. |
| T10000 | Premise is stale. The Collection Download epic (T4945/T4946/T4947) shipped and is archived, so download capability exists - the evaluator could not FIND it, which is discoverability. Folded into T9880. |
| T10020 | Duplicates T9720, the existing end-to-end and failure-path release check. Merge the new checklist into T9720 rather than running two gates. |
| T10030 | Overlaps T9730 (product review and traceability sign-off). Both need real participants, not currently queued. |

### Product decisions (user, 2026-09-13)

The intake proposed reversing three naming calls made on 2026-09-10. Two were taken, one was
rejected, and one was taken in a different form than proposed. Recorded here so the history reads as
decision rather than drift, per the epic convention.

1. **Clip and Reel both stand. The proposed Clip -> Highlight rename is REJECTED** (source N02/N06).
   "Highlight" is a modifier, not a third object: a reel is a series of clips, and everything the
   product makes is a highlight. The 2026-09-10 object model (Game / Play / Clip / Reel / Published)
   is intact and the five STAGING shared-vocabulary children stand.
   **Standing rule:** short form in controls (`Clips`, `Reels`), long form in prose (highlight clip,
   highlight reel). Never one sibling carrying the modifier while its sibling does not - today's
   `Clips` tab beside the `Highlight Reels` noun is the actual defect, and it is small.

2. **AI Focus becomes Framing. The 2026-09-10 override is LIFTED.** That override's recorded reason
   was that the name should say the reframing is automatic. It is not: framing is manual crop
   keyframes joined by a spline, with no tracking in it. Mode noun is **Framing**; the screen
   instruction is "Frame your athlete". The intake's own label is not used as the mode name, because
   a sentence cannot serve in a tab, a switcher and a status chip.

3. **Relocate the AI claim to where the AI runs.** Diagnosis: "AI" appears in exactly ONE
   parent-facing place today, the mode name, and that is the one step with no AI in it. This is why
   users report the app "has no AI" while the code is full of it. Real AI: `AIVideoUpscaler`
   (Real-ESRGAN, runs on every framing export) and YOLO player detection on a T4 GPU (drives
   Spotlight). Both currently hide behind the generic word "Rendering" or say nothing at all.
   Name those steps: **"Finding players"**, **"Enhancing video"**.
   **Name the step, never promise the outcome.** No "Enhanced to HD" or equivalent quality claim
   until T9970 has measured whether it holds - fixing a credibility problem with a second unverified
   promise would put us back where we started.

4. **Statuses: T8470's Draft/Shared stands** (2026-09-10 override UPHELD). Source N11 is taken as
   PRESENTATION only, not a new state machine: each existing state gains a plain-language second
   half - `Draft / Not exported yet`, `Private / Ready to watch`, `Shared / Anyone with the link`.
   `draftStage.js` remains the single source and T9600 keeps its job.

5. **Capture window becomes 6s before + 2s after** (8s total, replacing 9+3=12).
   **The code was never broken.** `DEFAULT_CLIP_BEFORE=9` + `DEFAULT_CLIP_AFTER=3` straddle the tap
   and correctly produced the 0:00-0:06 the evaluator reported at a 0:03 tap. Only the word
   "previous" in `MARK_PLAY_HELPER` was false. The post-roll is deliberate - parents tap AFTER they
   see the play - so 2s of it is preserved rather than going to a literal 8+0. Copy becomes
   "Captures 6 seconds before and 2 after". Constants and copy change together.

6. **Spotlight stays optional, but encouraged.** Its real reason - 22 kids in the same kit, and this
   is how anyone watching knows which one is yours - is the strongest sentence in the product and is
   currently written as a definition rather than a reason.

7. **Every stage states its point in one sentence, and no explanation may use the feature's own name
   as the reason for the feature.** The framing copy fails this test today ("so you can focus the
   clip around your player" is circular, so a parent who did not already know ends up no wiser), and
   so does every other screen: they teach the mechanics and never state the point. The honest answers
   exist and are concrete - framing is needed because wide sideline footage has to become a
   phone-shaped video and someone must choose what survives the crop.

8. **One UI iteration, not several.** All copy-shaped work folds into **T9860**, which becomes the
   single copy and concept sweep across every screen. Six tasks each editing their own corner is how
   the mixed vocabulary both evaluations found got there in the first place. Single cutover or not
   at all.

### Deploy decision

Prod was **744 commits / 12 days behind master**, with 138 tasks at STAGING including 34 from the
Sept 9-10 walkthrough - so every fix from the previous evaluation was invisible to real users, and
both evaluations had been measuring code nobody had shipped. Deployed 2026-09-13 before starting
this batch (backend build 4290 -> 5068; Postgres migrated 25 -> 28).

## Execution sequence

Start T9770, T9790, T9800, T9810, T9820, T9840 and T9920 (core repairs); T9780 follows T9770. Run T10020 after all eight listed prerequisites are implemented and verified. T9910 policy, T9970 quality and T10010 telemetry audits can begin independently when inputs exist; T9940 capability copy does not wait for tracking.

Then simplify the first-result flow: T9830 → T9850; coordinate T9860 vocabulary with T9870 → T9880/T9890, T9900 progress, T9930 upload/home and T9950 framing. T9960 follows reliable selection/output. Repeat applicable T10020 gate checks for each release slice. Validate value through T10010 and T10030 with real research inputs. Optional T9980/T9990/T10000 discoveries retain their prerequisite gates and must produce separately scoped build decisions. Do not delay deterministic repairs for speculative tracking or an unreproduced stale-completion incident.

Row order identifies the next batch and default sequence, but a blocked row does not prevent an independent READY task from starting. Existing WIP and deployment safety prerequisites still apply. This batch precedes the older pending backlog; earlier work keeps its history and status.

## Integration rules

- Preserve every source task's requirements, dependencies, acceptance criteria and uncertainty. No imported task is marked implemented. TODO is the board lifecycle state; the separate readiness field determines whether work may start. Blank Impact/Cmplx/Pri cells mean unestimated repository scores; source P1/P2/P3 is preserved explicitly and is not an invented impact/complexity ratio. Migration requirements remain to be established.
- Reconcile the related prior tasks listed in each project brief against actual code, tests and deployed versions. Record verified coverage and remaining scope; do not automatically close either task or repeat a shipped implementation. In particular, T9760 records a backend deployment lag, so identify the evaluated/current build before inferring a code regression.
- The new source vocabulary uses “highlight” and proposes framing labels. The existing September 10 decisions retain AI Focus / Spotlight, Draft / Shared statuses, and the Game / Play / Clip / Reel model. T9860 must record an explicit reconciliation of these conflicts, including any chosen reversal, before broad renaming. Queuing this handoff alone does not silently settle those product conflicts. Dependent copy changes consume that decision.
- Keep original B01–B08/R1–R7/N01–N12 references scoped to this evaluation; they are not the earlier walkthrough's B1–B11/N01–N47. Preserve private replay, continued marking, precise trim, optional Spotlight and no compulsory reels.
- The approximate 5-per-100 baseline and target 75 remain unverified. Discovery is not a production implementation; research materials are not executed sessions. Policy, pricing, tracking, publication and download claims require evidence. Tests not run remain not run.
- Update each project brief and PLAN.md together. Keep source/ immutable as imported evidence so its manifest hashes and equivalent HTML/Markdown formats remain valid; source statuses describe the original handoff, not current execution.

## Project mapping

| Source | Project task | Epic | Priority | Initial readiness | Project prerequisites |
| --- | --- | --- | --- | --- | --- |
| T01 | [T9770 — Persist Spotlight selection, settings and timing](T9770.md) | EP01 | P1 | READY | None |
| T02 | [T9780 — Bind saved preview to the correct effects export](T9780.md) | EP01 | P1 | WAITING_FOR_DEPENDENCIES | T9770 |
| T03 | [T9790 — Stop old export completions hijacking reload](T9790.md) | EP01 | P1 | READY | None |
| T04 | [T9800 — Remove false export-required loading warning](T9800.md) | EP01 | P1 | READY | None |
| T05 | [T9810 — Repair both game-invitation entry points](T9810.md) | EP01 | P1 | READY | None |
| T06 | [T9820 — Correct rating and clip-creation helper immediately](T9820.md) | EP02 | P1 | READY | None |
| T07 | [T9830 — Offer Create highlight and Save play only as explicit outcomes](T9830.md) | EP02 | P1 | WAITING_FOR_DEPENDENCIES | T9820 |
| T08 | [T9840 — Make capture ranges and source clocks consistent](T9840.md) | EP02 | P1 | READY | None |
| T09 | [T9850 — Replace stale onboarding with route-aware next actions](T9850.md) | EP02 | P1 | WAITING_FOR_DEPENDENCIES | T9830 |
| T10 | [T9860 — Apply one vocabulary and stable highlight identity](T9860.md) | EP03 | P2 | READY | None |
| T11 | [T9870 — Autosave edits and retain finished private results](T9870.md) | EP03 | P2 | WAITING_FOR_DEPENDENCIES | T9770, T9780, T9790 |
| T12 | [T9880 — Separate private replay, publication and link sharing](T9880.md) | EP03 | P2 | WAITING_FOR_DEPENDENCIES | T9780, T9860, T9870 |
| T13 | [T9890 — Make all result entry points recover and replay consistently](T9890.md) | EP03 | P2 | WAITING_FOR_DEPENDENCIES | T9780, T9860, T9870 |
| T14 | [T9900 — Make progress and saving status readable and persistent](T9900.md) | EP04 | P2 | WAITING_FOR_DEPENDENCIES | T9800 |
| T15 | [T9910 — Verify credit and storage rules; reconcile action copy](T9910.md) | EP04 | P2 | READY | None |
| T16 | [T9920 — Repair narrow and fullscreen editor layouts](T9920.md) | EP04 | P1 | READY | None |
| T17 | [T9930 — Simplify upload and remove fresh-home distractions](T9930.md) | EP04 | P2 | READY | None |
| T18 | [T9940 — Replace unsupported speed and tracking expectations](T9940.md) | EP04 | P2 | READY | None |
| T19 | [T9950 — Simplify manual framing and preview actual output before export](T9950.md) | EP05 | P2 | WAITING_FOR_DEPENDENCIES | T9940 |
| T20 | [T9960 — Make single-athlete Spotlight a clear optional step](T9960.md) | EP05 | P2 | WAITING_FOR_DEPENDENCIES | T9770, T9780 |
| T21 | [T9970 — Establish highlight quality benchmark and calibrated fallback](T9970.md) | EP05 | P2 | READY | None |
| T22 | [T9980 — Investigate automatic athlete tracking before committing to build](T9980.md) | EP05 | P3 | GATED_DISCOVERY | T9970 |
| T23 | [T9990 — Investigate a combined framing and Spotlight export](T9990.md) | EP05 | P3 | GATED_DISCOVERY | T9770, T9780, T9970 |
| T24 | [T10000 — Verify download capability and prepare a bounded delivery decision](T10000.md) | EP05 | P3 | GATED_DISCOVERY | T9780 |
| T25 | [T10010 — Define activation metrics and instrument the missing funnel](T10010.md) | EP06 | P2 | READY | None |
| T26 | [T10020 — Run the cross-feature first-highlight release gate](T10020.md) | EP06 | P1 | WAITING_FOR_DEPENDENCIES | T9770, T9780, T9790, T9800, T9810, T9820, T9840, T9920 |
| T27 | [T10030 — Validate parent success and stage measurable rollout decisions](T10030.md) | EP06 | P2 | WAITING_FOR_RESEARCH_INPUTS | T10010, T10020 |

## Provenance

Imported from the supplied implementation-handoff/plan.md and verified byte-for-byte against reelballers-implementation-handoff.zip. All generated-file SHA-256 values in source/manifest.json were checked before copying. Original reports and MP4 are not included; source report hashes identify provenance only.
