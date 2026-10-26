# T13450: Finished viewer guide says "Tap Get share link" but the button reads "Create share link"

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Tier:** S/M (frontend copy + guide rule)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, at 390x844 (report bug 8). Opened a finished highlight from Annotate's "View Highlight".

## Problem

The coach says: "Done! Tap Get share link to send it, or Download to save it." The only share control in that viewer reads **Create share link**. A parent looks for a button that does not exist.

In code, `GUIDE.finished.viewer` (`src/frontend/src/config/displayNames.js:776`) is built from `RESULT_PUBLISH.PUBLISH_GET_LINK` ('Get share link'), while the viewer renders the `LinkReadyCard` / `REVIEW_CONFIRM` ('Create share link') trigger. `guideRules.namedControls.test.js` pins the sentence to the `Get share link` pulse target, so the test passes while the screen shows a different label.

Also seen: while the card is up at 390 it covers the viewer header (title, Download, Close) until "Got it" is tapped. The header overlap itself is T13190 (STAGING); check whether that fix covers this entry point (opened from Annotate, not the Finished tile).

## Solution

Make the sentence and the visible button use the same label constant, and pulse that button. Decide on one label for the viewer's share trigger.

## Context

### Relevant Files
- `src/frontend/src/config/displayNames.js` (`RESULT_PUBLISH`, `GUIDE.finished.viewer`)
- `src/frontend/src/components/LinkReadyCard.jsx`, `PublishLinkFlow.jsx`
- `src/frontend/src/components/instructions/guideRules.namedControls.test.js`
- `.claude/knowledge/guidance.md`

### Related Tasks
- T13190 (viewer header overlap at 390)

## Acceptance Criteria

- [ ] The viewer guide names the label actually shown on the share button, and pulses it
- [ ] The named-controls test checks the rendered label, not only the constant
