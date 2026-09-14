# September 12–13 evaluation: next implementation batch

Filed 2026-09-13 at the user's request. All 27 source tasks are queued under unique project IDs T9770–T10030. This is planning work only. Main [PLAN.md](../../PLAN.md) is the execution queue; each project task owns its current outcome record. The unchanged [source plan](source/plan.md) retains all six epics, shared implementation contracts, source coverage and detailed sequencing. Source Markdown and standalone HTML briefs plus all assets are included.

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
