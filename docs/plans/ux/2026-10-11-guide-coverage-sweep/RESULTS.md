# T12590 guide coverage sweep: results (static pass, 2026-10-13)

**Status: PARTIAL. The live staging walk has NOT been run.** The worker container has no staging
credentials, no fixture accounts and no four-viewport Playwright rig, so nothing below was observed
in a browser. Section 1 is derived from the code (`GUIDE_RULES` / `GUIDE_STATES` in
`resolveGuide.js`, mount points of `<Guide>`). Sections 2 to 4 list what still needs a human or a
staging-driven run. Layout, dialog-placement and audit-finding verdicts are all **unverified** and
must not be read as passes.

## 1. Coverage by screen, from the code

Guide mounts: Annotate, Focus, Overlay (floating), Home tabs, upload modal, finished viewer, share
modal. Rule ids are the ones that fire (every one has a `GUIDE_STATES` fixture and a test).

| Screen / state | Guide? | Rule id | Content note |
|---|---|---|---|
| Sign-in / auth gate, expired session | NO | none | Needs a decision: probably none (no editor facts). Unverified in the app |
| Home Games: empty / uploading / no plays / plays / finished exists | yes | `home.games.*` | Not judged against shortest path |
| Home Clips: empty / unfinished / all done | yes | `home.clips.*` | |
| Home Finished: empty / first | yes | `home.finished.*` | |
| Upload: choose / submit / failed | yes | `upload.choose`, `upload.submit`, `upload.failed` | |
| Upload in flight | yes | `home.games.uploading` | |
| Game details modal, add footage | NO | none | Candidate gap |
| Annotate: nothing marked, playing, one, several, editor, choice card, review, expired | yes | `annotate.progress.watch`, `.watch.playing`, `.has-plays.*`, `.editor`, `.choice`, `.review`, `.expired` | |
| Annotate: selected play, generating, 5 star states, published | yes | `annotate.selected.*`, `annotate.progress.*` | |
| Focus: drag, play, trim split / adjust, keep, preview, watch preview, generate | yes | `focus.progress.*` | |
| Focus: export processing, finishing, failed, credits, ready | yes | `focus.progress.export`, `focus.finishing`, `focus.failed`, `focus.credits`, `focus.ready` | |
| Focus: framing already rendered | silent by design | `focus.rendered` (documented null, T12470) | |
| Focus: settings panel (aspect ratio, straighten, background dim) | NO | none | Advanced controls have no guide |
| Overlay: spotlight pick walk (first, next, at-marker, away, not outlined, none, done) | yes | `overlay.pick.*` | |
| Overlay: text lane / sheet | yes | `overlay.text` | |
| Overlay: generating, failed, ready | yes | `overlay.progress`, `overlay.failed`, `overlay.ready` | |
| Overlay: no pick walk and no text open (plain editing, job none) | NO | none (resolves null) | Candidate gap |
| Finished viewer (not shared) / shared | yes / silent by design | `finished.viewer` | |
| Share modal | yes | `share.modal` | |
| Share and claim pages a recipient sees | NO | none | Recipient pages have no facts; probably intentional |
| Account settings, buy credits, credit history | NO | none | Candidate gap or "needs none" |
| Error and edge (too large, clip upload limits, report a problem) | NO | none | |

## 2. Content rule (shortest path / advanced settings after two exports)

Static finding: **no guide fact carries a finished-highlight count** for the editor screens (Home
has `progress.finished`, Annotate / Focus / Overlay do not). The rule "two or more finished
highlights: invite the user into aspect ratio, trim, straighten, background dim, text, spotlight"
cannot be expressed today, and no rule advertises advanced controls. This is the "likely child" the
task names. **Filing needed:** a task to add a finished-count fact to the editor catalogs and a
second copy tier for those states. Shortest-path judgement per state and the second-account check
need the live walk.

## 3. Layout, overflow and dialog placement

Not run. Still required: 4 viewports (1440x900, 1024x768, 768x1024, 390x844), the
`assertNoHorizontalOverflow` sweep at 320/360/375/390/768 on /annotate, /focus, /overlay, /home,
and a placement verdict (anchor item, side, near-and-central, on-screen) per guided screen.
Pointers for the walker: T12580 shading is new, so re-check phone dock and off-screen anchors; the
placement criteria are in `components/instructions/placement.js`.

## 4. Parent Usability Audit close (12 findings)

Verdicts need screenshots from the live walk, so every row is **not verified** here. The task
files that targeted each finding are noted where the repo history shows them.

| # | Finding (priority) | Verdict | Notes |
|---|---|---|---|
| 1 | Hidden crop-box drag unlocks Generate (Critical) | not verified | Guide steps `focus.progress.drag/play/keep` now name it; confirm in app |
| 2 | "In Spotlight" after skipped / "In Overlay" (Critical) | not verified | T11940 unified status words (Not started / In progress / Finished) |
| 3 | /annotate and /focus overflow on iPhone (High) | not verified | Run the overflow sweep |
| 4 | Fixed Generate panel covers controls on iPhone (High) | not verified | See 2026-10-11 re-run N3 (still open then) |
| 5 | Upload conflicting progress (High) | not verified | |
| 6 | Highlight silently gated by 5-star rating (High) | not verified | See re-run N13 |
| 7 | Done returns to empty-looking editor (High) | not verified | `annotate.choice` / `annotate.review` rules exist |
| 8 | Upload cost/balance wrap on iPhone (Medium) | not verified | |
| 9 | Game titles truncate on iPhone (Medium) | not verified | |
| 10 | Tablet game cards half-width (Medium) | not verified | T12570 touched Games alignment |
| 11 | Editor vocabulary (Medium) | not verified | T11940 vocabulary decision |
| 12 | Blocking loader says "Ready" (Low-Medium) | not verified | |
| T11890 | Silent Google sign-in failure | **not verified** | T11890 was closed 2026-10-09 by user decision without the Google console origin check or a real-device repro; `[auth-diag]` log lines are the only signal |

## 5. Tasks to file (none filed yet; PLAN.md edits left to the user)

1. Finished-highlight-count fact + advanced-settings copy tier for Annotate / Focus / Overlay.
2. Guides (or recorded "needs none") for: Focus settings panel, Overlay plain editing, game
   details modal / add footage, account / billing screens, error and edge states.
3. Whatever the live walk finds in sections 3 and 4.
