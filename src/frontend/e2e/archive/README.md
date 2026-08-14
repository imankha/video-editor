# e2e/archive — parked specs (not collected)

Playwright does **not** collect this directory (`testIgnore: '**/archive/**'` in
`playwright.config.js`). Files land here when they are **superseded QA/evidence
artifacts or one-off debug specs** — never regression guards — so their history stays
greppable without adding permanent noise (5-minute timeouts, stale assertions) to every
full-suite sweep.

Parked by **T6760** (e2e suite hygiene, 2026-08-14). Each was in the 2026-08-11
full-sweep failure list; none was a product regression. Restore a file (git mv back)
only if you find a live-coverage gap it uniquely closed.

## What's here and where the LIVE coverage is

### T5215 intro-attachment — round-N evidence chain
`T5215-round4/5/6.qa.spec.js` were per-round QA artifacts (`Run: bash scripts/dev-verify.sh …`),
each asserting the *intermediate* UI a later round then intentionally changed
(round 4's 32×32 circular photo → round 5 made it rectangular; round 5's title-row
badge → round 6 moved it to a corner; round 6 held the header thumbnail → round 7
removed it). They are pinned to superseded states.
- **Live coverage:** `T5215-intro-attachment.qa.spec.js` (the maintained regression
  spec) and `T5215-round7.qa.spec.js` (the current end state, 2026-08-07) — both still
  collected.

### T6630 text add/remove/drag — round-N evidence chain
`T6630-T6590-round2-evidence`, `T6630-round3/5/6-evidence.qa.spec.js` were one-off
QA-evidence rounds (their own headers say "one-off QA artifact by established
convention"), pinned to intermediate overlay-text UI states.
- **Live coverage:** `T6630-text-add-remove-drag.qa.spec.js` (the maintained regression
  spec) plus the still-collected later rounds `T6630-round4/round7-evidence.qa.spec.js`
  and the T67xx text specs (e.g. `T6720-text-spatial-drag.qa.spec.js`).

### One-off debug spec
`sidebar-scrub-debug.spec.js` was a diagnostic scratch spec (auth-bypass + in-page
`/src` store import) authored to investigate a scrub issue — never intended as a
regression guard, drives no product acceptance criterion.
