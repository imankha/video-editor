# ReelBallers implementation plan

## How to hand this to another AI

1. Use this plan to choose a READY task whose prerequisites are actually implemented and verified in the target repository.
2. Give the AI **one `tasks/Txx.html` file** for a literal single-document handoff: full brief, screenshots and schematics are embedded. It does not need the earlier reports, an epic file or this plan to understand that task. It will still need the application repository and any required authorized test fixtures.
3. Alternatively give it `tasks/Txx.md` plus the bundled `assets/` folder. Markdown contains the full task and an inline text schematic; screenshot images are bundled relative assets. Do not make it read both formats. Treat them as two views of the same task, not separate tasks.
4. Implement only the chosen task. Record outcome in that task and update this plan’s status; keep equivalent formats synchronized if reused. A task marked WAITING is not ready just because its priority is high.
5. Run the integrated release gate for each release slice. Discovery tasks deliver decisions/prototypes, not production features; human research cannot be replaced by invented participants.

This package is an implementation specification, not implementation or deployment. No target application repository or original MP4 is included. Everything starts unimplemented. Source reports and the recommendations HTML remain unchanged.

## Priorities, statuses and scope

- **P1:** core correctness/reliability or release verification. Address before increasing traffic through affected paths. These backlog priorities are not a relabeling of the original report’s bug severity.
- **P2:** next workflow, quality, copy and measurement improvements.
- **P3:** optional capability discovery. A production implementation needs a separately recorded go decision and scoped build work.
- **READY:** no task dependency; start repository discovery when the application repository is available.
- **WAITING_FOR_DEPENDENCIES:** required contracts/tests are not yet recorded complete.
- **GATED_DISCOVERY:** prerequisite evidence plus a bounded investigation; never silently interpret as production build authorization.
- **WAITING_FOR_RESEARCH_INPUTS:** real participants/traffic/consented fixtures are required for execution; prepare materials without pretending sessions happened.
- **DONE / BLOCKED:** record verified outcome or precise missing input. Tests not run remain not run.

The supplied baseline of ~5 completed exporters per 100 signups and target 75 are unverified context. No task claims numerical lift or assumes UX explains every dropout. Preserve reliable upload, precise trimming, direct framing, private replay, clear costs, optional Spotlight and the ability to keep marking plays. No compulsory reels or visual redesign.

## Execution sequence

1. **Start core repairs:** T01, T03, T04, T05, T06, T08 and T16. T02 follows T01. Begin T15 policy audit, T21 quality-fixture audit and T25 telemetry audit independently where inputs exist. T18 honest capability copy does not depend on tracking development.
2. **Run core gate:** T26 after its listed P1 prerequisites. Do not postpone deterministic fixes for a speculative tracker or inability to reproduce B06 immediately; document B06 evidence separately.
3. **Simplify the first-result flow:** T07 → T09; coordinate T10 vocabulary with T11 → T12/T13, T14 progress, T17 upload/home and T19 framing. T20 follows reliable selection/output. Each UI slice repeats applicable T26 checks; this is a reusable gate, not only a one-time milestone.
4. **Validate value:** T25 reconciles the metric. T27 prepares/runs real research after the released slice passes the gate. Predefine experiment windows/sample needs from actual traffic; this plan does not authorize production experiments.
5. **Evaluate optional bets:** T22 tracking, T23 combined export and T24 download discovery. A favorable investigation must produce separately scoped implementation tasks before a build/rollout is claimed complete. Do not hold core improvements for these decisions.

## Epic index

| Epic | Priority | Outcome |
| --- | --- | --- |
| [EP01 — Make saved results and key entry points dependable](epics/EP01.md) | P1 | Persist intended effects, show the correct finished artifact, avoid stale navigation and respond truthfully. |
| [EP02 — Create a first highlight without sacrificing continued marking](epics/EP02.md) | P1 | Decouple rating, define source capture precisely and make next steps follow parent intent. |
| [EP03 — Find, replay and deliberately share the finished highlight](epics/EP03.md) | P2 | Give one named result a stable private home, then separate publication and sending. |
| [EP04 — Explain work and costs honestly on usable layouts](epics/EP04.md) | P1–P2 | Repair layout, make progress persistent, verify commercial copy and remove fresh-home distractions. |
| [EP05 — Improve finished quality; investigate larger capabilities](epics/EP05.md) | P2–P3 | Ship guided framing and optional reliable Spotlight; benchmark quality before tracking/consolidation/download commitments. |
| [EP06 — Measure actual value and validate release readiness](epics/EP06.md) | P1–P2 | Count distinct people and playable/viewed results, run integrated regressions and research both parent paths. |

## Task index and dependency graph

Dependencies are finish-to-start implementation contracts. Independent tasks may be prepared concurrently but coordinate shared code ownership below. All tasks are initially unimplemented.

| Task | Epic | Priority / type | Status | Requires |
| --- | --- | --- | --- | --- |
| [T01 — Persist Spotlight selection, settings and timing](tasks/T01.md) · [standalone HTML](tasks/T01.html) | EP01 | P1 / Fix | READY | — |
| [T02 — Bind saved preview to the correct effects export](tasks/T02.md) · [standalone HTML](tasks/T02.html) | EP01 | P1 / Fix / investigate | WAITING_FOR_DEPENDENCIES | T01 |
| [T03 — Stop old export completions hijacking reload](tasks/T03.md) · [standalone HTML](tasks/T03.html) | EP01 | P1 / Fix / investigate | READY | — |
| [T04 — Remove false export-required loading warning](tasks/T04.md) · [standalone HTML](tasks/T04.html) | EP01 | P1 / Fix | READY | — |
| [T05 — Repair both game-invitation entry points](tasks/T05.md) · [standalone HTML](tasks/T05.html) | EP01 | P1 / Fix | READY | — |
| [T06 — Correct rating and clip-creation helper immediately](tasks/T06.md) · [standalone HTML](tasks/T06.html) | EP02 | P1 / Fix | READY | — |
| [T07 — Offer Create highlight and Save play only as explicit outcomes](tasks/T07.md) · [standalone HTML](tasks/T07.html) | EP02 | P1 / UX implementation | WAITING_FOR_DEPENDENCIES | T06 |
| [T08 — Make capture ranges and source clocks consistent](tasks/T08.md) · [standalone HTML](tasks/T08.html) | EP02 | P1 / Fix | READY | — |
| [T09 — Replace stale onboarding with route-aware next actions](tasks/T09.md) · [standalone HTML](tasks/T09.html) | EP02 | P1 / UX implementation | WAITING_FOR_DEPENDENCIES | T07 |
| [T10 — Apply one vocabulary and stable highlight identity](tasks/T10.md) · [standalone HTML](tasks/T10.html) | EP03 | P2 / UX implementation | READY | — |
| [T11 — Autosave edits and retain finished private results](tasks/T11.md) · [standalone HTML](tasks/T11.html) | EP03 | P2 / UX / persistence implementation | WAITING_FOR_DEPENDENCIES | T01, T02, T03 |
| [T12 — Separate private replay, publication and link sharing](tasks/T12.md) · [standalone HTML](tasks/T12.html) | EP03 | P2 / UX implementation | WAITING_FOR_DEPENDENCIES | T02, T10, T11 |
| [T13 — Make all result entry points recover and replay consistently](tasks/T13.md) · [standalone HTML](tasks/T13.html) | EP03 | P2 / Integration implementation | WAITING_FOR_DEPENDENCIES | T02, T10, T11 |
| [T14 — Make progress and saving status readable and persistent](tasks/T14.md) · [standalone HTML](tasks/T14.html) | EP04 | P2 / UX implementation | WAITING_FOR_DEPENDENCIES | T04 |
| [T15 — Verify credit and storage rules; reconcile action copy](tasks/T15.md) · [standalone HTML](tasks/T15.html) | EP04 | P2 / Investigate then implement verified copy | READY | — |
| [T16 — Repair narrow and fullscreen editor layouts](tasks/T16.md) · [standalone HTML](tasks/T16.html) | EP04 | P1 / Fix / responsive UX | READY | — |
| [T17 — Simplify upload and remove fresh-home distractions](tasks/T17.md) · [standalone HTML](tasks/T17.html) | EP04 | P2 / UX implementation | READY | — |
| [T18 — Replace unsupported speed and tracking expectations](tasks/T18.md) · [standalone HTML](tasks/T18.html) | EP04 | P2 / Copy / capability verification | READY | — |
| [T19 — Simplify manual framing and preview actual output before export](tasks/T19.md) · [standalone HTML](tasks/T19.html) | EP05 | P2 / UX implementation | WAITING_FOR_DEPENDENCIES | T18 |
| [T20 — Make single-athlete Spotlight a clear optional step](tasks/T20.md) · [standalone HTML](tasks/T20.html) | EP05 | P2 / UX implementation | WAITING_FOR_DEPENDENCIES | T01, T02 |
| [T21 — Establish highlight quality benchmark and calibrated fallback](tasks/T21.md) · [standalone HTML](tasks/T21.html) | EP05 | P2 / Investigation / quality gate | READY | — |
| [T22 — Investigate automatic athlete tracking before committing to build](tasks/T22.md) · [standalone HTML](tasks/T22.html) | EP05 | P3 / Gated discovery | GATED_DISCOVERY | T21 |
| [T23 — Investigate a combined framing and Spotlight export](tasks/T23.md) · [standalone HTML](tasks/T23.html) | EP05 | P3 / Gated discovery | GATED_DISCOVERY | T01, T02, T21 |
| [T24 — Verify download capability and prepare a bounded delivery decision](tasks/T24.md) · [standalone HTML](tasks/T24.html) | EP05 | P3 / Gated discovery | GATED_DISCOVERY | T02 |
| [T25 — Define activation metrics and instrument the missing funnel](tasks/T25.md) · [standalone HTML](tasks/T25.html) | EP06 | P2 / Analytics implementation | READY | — |
| [T26 — Run the cross-feature first-highlight release gate](tasks/T26.md) · [standalone HTML](tasks/T26.html) | EP06 | P1 / Verification gate | WAITING_FOR_DEPENDENCIES | T01, T02, T03, T04, T05, T06, T08, T16 |
| [T27 — Validate parent success and stage measurable rollout decisions](tasks/T27.md) · [standalone HTML](tasks/T27.html) | EP06 | P2 / Human research / rollout planning | WAITING_FOR_RESEARCH_INPUTS | T25, T26 |

## Shared implementation contracts and change ownership

Each task repeats the parts it needs. These names describe responsibilities, not invented repository modules.

| Surface / contract | Owner tasks | Coordination rule |
| --- | --- | --- |
| Persisted editor revision and stable subject/settings references | T01; consumed by T02/T11/T20 | Agree stored shape before shared edits. Existing records must remain compatible. |
| Job → edit revision → eligible finished artifact | T02; recovery T03; progress T14 | One authoritative version/status model; late jobs cannot supersede newer saved results. |
| Marking form and source-time mapping | T06 → T07; T08 | Small helper repair may ship first; capture policy does not change merely to match a mockup. |
| Guide and source-position return | T09; result links T13 | Keep marking remains explicit and preserves work. |
| Parent-facing strings/navigation | T10; capability promise T18 | Coordinate final vocabulary across all tasks. No duplicate Highlights and Clips destinations. |
| Save/result UI and publication | T11; T12 | Private edits/export retention do not publish or silently alter a shared artifact. |
| Game invitations | T05; fresh-home Invite placement T17 | Inspect global Invite’s actual purpose; do not equate it with game collaboration or publication. |
| Editor layout | T16; form/framing tasks | Shared responsive patterns; avoid separate fixes that restore overflowing desktop panels. |
| Cost/retention claims | T15; consumed by T14/T17/T19/T20 | Unknown pricing/refund/expiry is a policy blocker, not permission to invent rules. |
| Framing preview, effects and quality | T19/T20; benchmark T21 | Equivalent preview/output; actual media checks, not screenshots alone. |
| Measurement / gate / parent study | T25/T26/T27 | Count people once; actual observed quality, replay and annotation matter alongside exports. |

## Complete source-to-task coverage

B01–B08 are original bug IDs. R1–R7 are original friction recommendations. N01–N12 are assigned labels for the naming report’s unnumbered rows, in original order. Minor Invite and “minutes away” findings now have explicit tasks.

| Source reference | Tasks | Coverage |
| --- | --- | --- |
| B01 | [T01](tasks/T01.md), [T02](tasks/T02.md), [T20](tasks/T20.md) | Selection persistence and bounded effects/preview mismatch |
| B02 | [T05](tasks/T05.md) | Direct game invitation nonresponse |
| B03 | [T06](tasks/T06.md), [T07](tasks/T07.md) | Rating/creation contradiction |
| B04 | [T08](tasks/T08.md) | Range and previous-12-seconds mismatch |
| B05 | [T09](tasks/T09.md) | Unavailable tutorial instruction |
| B06 | [T03](tasks/T03.md) | Earlier completion after reload, observed once |
| B07 | [T04](tasks/T04.md) | Transient false export-required warning |
| B08 | [T16](tasks/T16.md) | Narrow overflow |
| R1 | [T01](tasks/T01.md), [T02](tasks/T02.md), [T03](tasks/T03.md), [T11](tasks/T11.md), [T13](tasks/T13.md) | Result persistence/retrieval |
| R2 | [T06](tasks/T06.md), [T07](tasks/T07.md) | Creation separate from rating |
| R3 | [T18](tasks/T18.md), [T19](tasks/T19.md), [T21](tasks/T21.md), [T22](tasks/T22.md) | Promise, framing and output quality |
| R4 | [T09](tasks/T09.md) | Guidance / continued annotation |
| R5 | [T05](tasks/T05.md), [T10](tasks/T10.md), [T11](tasks/T11.md), [T12](tasks/T12.md), [T13](tasks/T13.md), [T24](tasks/T24.md) | Scope, names, replay and optional download investigation |
| R6 | [T04](tasks/T04.md), [T14](tasks/T14.md), [T15](tasks/T15.md) | Loading/progress/cost/entitlement |
| R7 | [T16](tasks/T16.md) | Responsive workflow |
| N01 | [T08](tasks/T08.md), [T10](tasks/T10.md) | Add Play / Mark play / Annotate |
| N02 | [T07](tasks/T07.md), [T10](tasks/T10.md) | Play / clip / annotation |
| N03 | [T06](tasks/T06.md), [T07](tasks/T07.md) | Creation toggle / star text |
| N04 | [T10](tasks/T10.md), [T18](tasks/T18.md), [T19](tasks/T19.md) | AI Focus / Generate / Frame labels |
| N05 | [T19](tasks/T19.md) | Focus point / keyframe / segment |
| N06 | [T10](tasks/T10.md) | REEL / Clips / Reels / Highlight Reels |
| N07 | [T10](tasks/T10.md), [T13](tasks/T13.md) | Source versus finished previews |
| N08 | [T05](tasks/T05.md), [T12](tasks/T12.md) | Invitation versus publication/share |
| N09 | [T10](tasks/T10.md), [T13](tasks/T13.md) | Stable highlight name and clock meaning |
| N10 | [T04](tasks/T04.md), [T14](tasks/T14.md) | Contradictory loading/saved/export-required |
| N11 | [T02](tasks/T02.md), [T10](tasks/T10.md), [T11](tasks/T11.md) | Saved location/effects/ready status |
| N12 | [T20](tasks/T20.md) | Remaining players instruction |
| Unnumbered: Invite + disabled home destinations | [T17](tasks/T17.md) | Explicitly added after coverage audit |
| Unnumbered: minutes-away expectation | [T18](tasks/T18.md) | Explicitly added after coverage audit |
| Unnumbered: optional upload metadata / unnamed opponent | [T17](tasks/T17.md) | Keep disclosure, defer details |
| Unnumbered: second effects render | [T20](tasks/T20.md), [T23](tasks/T23.md) | Reliable optional flow + gated consolidation |
| Unnumbered: soft portrait / identity unconfirmed | [T19](tasks/T19.md), [T21](tasks/T21.md) | Quality benchmark and wider framing |
| Measurement and practical limits | [T25](tasks/T25.md), [T26](tasks/T26.md), [T27](tasks/T27.md) | Person-level measurement, regression and real parent research |

## What is deliberately not a new bug or production task

- The local-preview warning, upload processing, temporary disabled Frame action and brief black replay frame recovered; improve truthful status without asserting permanent failure.
- Accessibility labels that initially appeared unavailable later resolved. No permanent accessibility defect was established; normal keyboard/label QA remains required.
- The problem-report form opened and enabled submit after text; actual delivery/attachments were untested. Preserve it; do not send real reports as proof.
- Authentication did not fail in this evaluation; no signup redesign or pre-email trial objection is inferred.
- Public recipient playback, purchases, expiry, other sports and download behavior were not verified. Tasks specify investigations rather than claiming capability or failure.
- No unverified automatic tracking, aggressive upscaling, compulsory music/titles, reels, social integrations or broad rebrand.

## Definition of done and handoff record

For a build/fix: repository-required checks plus task criteria pass; before/after evidence and actual changed paths are recorded; durable data is preserved; no unexplained capability/policy assumptions remain. A discovery ends with measured findings, go/no-go recommendation and unresolved risks, not a feature marked implemented. Research materials and executed sessions have separate status.

Record per task: status; actual root cause/capability; changed paths/commit; tests executed and results; screenshot or media evidence; dependency-contract changes; outstanding blockers; migration/rollback limits. Update downstream tasks if an agreed contract changes; a future AI must not need chat history to discover the change. Keep plan and duplicate task format in sync.

The source reports and recommendations HTML are provenance, not prerequisites to reading a task. Task briefs reproduce relevant observations, selected solutions, replacement copy, validations, screenshots and schematics. Source hashes and generated artifact hashes are in `manifest.json` for integrity checking. All assets are local; standalone task HTML needs no network.
