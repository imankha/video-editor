# T8450: Unfurl descriptions: add a soft CTA line

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-09-03

## Problem

All four share-link unfurl variants (og:description / meta description / twitter:description)
currently just name-drop the brand with no call to action:

- Reel (`src/frontend/functions/shared/[token].js:192`): `` `${name} -- shared from ReelBallers.` ``
- Game (`src/frontend/functions/shared/game/[token].js:78`): `` `${attribution} -- watch the team recap on ReelBallers.` ``
- Collection (`src/frontend/functions/shared/collection/[token].js:17-20`): `` `${title} - ${context_line} - shared from ReelBallers.` `` (or without context_line if absent)
- Teammate (`src/frontend/functions/shared/teammate/[token].js:21`): `` `${clips} highlight clip(s) from ${game} - shared with you on ReelBallers.` ``

This is the one surface in the whole audit with a genuine way to make things worse: most
messaging apps (iMessage, WhatsApp, Slack) truncate link-preview descriptions on mobile,
often to roughly the first ~90-120 characters. Appending a CTA clause risks pushing off the
part that actually matters — who/what the clip is — in favor of marketing copy nobody asked
to read in a link preview.

## Solution

Add a short CTA clause to each description, but only after checking real-world rendered
length: for each of the 4 templates, compute the typical filled-in length (using realistic
sample data — a real game/reel name, not a placeholder) with a candidate CTA suffix appended
(something in the register of "Make your own free at reelballers.com" — keep it terse), and
verify the essential part (who/what) still survives common truncation points (~90 and ~120
chars are reasonable checkpoints; note there's no single universal limit across platforms).
If a template's essential info would get pushed past a realistic truncation point, either
shorten the CTA for that template or drop it for that template specifically — do not force
uniform copy across all 4 if one genuinely doesn't have the room. Document per-template
which choice was made and why in the PR description, since this is exactly the kind of
judgment call a future editor of this copy needs the reasoning for, not just the result.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/functions/shared/[token].js:192` (reel)
- `src/frontend/functions/shared/game/[token].js:78` (game)
- `src/frontend/functions/shared/collection/[token].js:17-20` (collection)
- `src/frontend/functions/shared/teammate/[token].js:21` (teammate)
- `scripts/verify_share_unfurl.py` — existing verifier; confirms og:title/video/image shape
  today but doesn't check copy content. Consider whether a length-sanity assertion belongs
  here, but this task's acceptance criteria don't require extending the script — a manual
  length check per template is sufficient to ship.

### Related Tasks
- See [EPIC.md](EPIC.md) for the full decision record and shared context. Ranked last in
  the epic on purpose — see EPIC.md's "Why this order" section for the truncation-risk
  reasoning.
- No file overlap with any other task in this epic.

### Technical Notes
- No backend changes; these are Cloudflare Pages edge functions (plain JS, not React).
- Each template's existing `escapeHtml()` call must still wrap the final string — don't
  bypass HTML escaping when appending the new clause.
- This is copy-content only; the og:title/og:image/og:video mechanics that
  `verify_share_unfurl.py` checks are unaffected and must keep passing.

## Implementation

### Steps
1. [ ] For each of the 4 templates, draft a candidate CTA suffix and measure realistic
   rendered length against sample real data
2. [ ] Decide per-template: include, shorten, or skip the CTA, with the reasoning recorded
3. [ ] Apply the chosen copy, keeping `escapeHtml()` wrapping intact
4. [ ] Run `scripts/verify_share_unfurl.py` to confirm the unfurl shape (title/image/video
   tags) is still intact

## Acceptance Criteria

- [ ] Each of the 4 unfurl templates has an explicit, documented decision (CTA added,
      shortened, or skipped) based on a real length check against realistic sample data
- [ ] The essential who/what information in each description is not pushed past a
      realistic truncation point by the change
- [ ] `scripts/verify_share_unfurl.py` still passes
