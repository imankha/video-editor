# T9680: Confirm credits, retention and required upload fields

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **E1-02 (UX-01, UX-03, UX-06)**.

## Why this exists

**No code.** The walkthrough flagged that the public homepage and the signed-in account state
**different free-credit wording**, and that a 6.027-second clip was charged **seven** credits with
no on-screen rule explaining it. The handoff explicitly declines to file a billing bug without
verifying production behavior first. Three tasks are blocked on these answers.

## Questions to answer

1. **Free credits.** What does a new account actually receive, under what conditions, on production?
   Reconcile the homepage wording with the signed-in balance. (Context: T8120 moved to granting the
   full quest-chain total upfront.)
2. **Charging and rounding.** What is charged for an upload, for a framing render, and for a final
   export? What is the rounding rule? Is 6.027 seconds billed as 7 - and if so, is that rule stated
   anywhere a parent can find it?
3. **Retry charging.** A failed upload or a failed render that is retried: charged once, twice, or
   refunded? T9420 needs this to judge its own idempotency criterion.
4. **Source expiry.** 30 days on the source - what exactly is deleted, and what stays editable?
5. **Draft and published retention.** Do finished outputs survive source expiry? The report warns
   against implying they do until confirmed. (Related live evidence: bug 50p, T8310/T8320.)
6. **Required metadata.** Which upload fields does the backend genuinely require? "Optional" labels
   may only be used where the backend really accepts a missing value.

## Output

A decision record with the confirmed rules plus approved example wording for product copy.

## Related Tasks

- **Blocks:** T9480 (billing precision copy), T9650 (pricing and retention copy), T9640 (optional
  field labels)
- T8310, T8320, T8330 - the expiry-visibility work whose copy must agree with these answers

## Acceptance Criteria

- [ ] Free-credit conditions confirmed against production and reconciled with the homepage
- [ ] Charging and rounding rules recorded, including whether 6.027s bills as 7 credits
- [ ] Retry-charging behavior recorded for both uploads and renders
- [ ] Source expiry and draft/published retention recorded separately
- [ ] The genuinely required upload fields are listed from the backend, not inferred
