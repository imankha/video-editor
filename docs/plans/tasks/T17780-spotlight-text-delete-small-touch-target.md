# T17780: Spotlight text deletion is tiny

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

A parent removes text from a highlight on a phone. The timeline delete control is only 20 by 20 pixels, making a destructive action unnecessarily hard to target.

## Reproduction

Open the QA-created play 14 in Spotlight as e2e@test.local, with its text region present. Use a real touch context at 390 x 844, then scroll the text region into view. Measure the Delete text button (text-delete-region-0). It is 20 x 20 on all three fresh page loads. The layout scan also found this same control below 44 x 44 at phone 360 x 640 and 844 x 390 and tablet 768 x 1024 and 1024 x 768.

Returning parent flow, staging build 91f0e6792 (#8105), 2026-11-18. Expected: a minimum 44 x 44 touch target on coarse pointer devices. Actual: dimensions above. Three fresh loads reproduced the measured fault. This reports one grouped issue per screen, not each button as a separate task.

## Evidence and logs

Local folder: qa/qa-pass-2026-11-18/bugs/. B11-spotlight-small-delete-1.png through B11-spotlight-small-delete-3.png; measured rectangles B11-small-delete.json. No failing API request or JavaScript exception established as the cause; this is a measured layout failure. Server logs are not relevant to the CSS hit target. Other request errors in this pass are tracked separately.

## Solution

Give the affected touch controls at least a 44 x 44 hit area without covering neighboring controls.

## Relevant Files

src/frontend/src/modes/overlay, text region timeline delete button.

## Acceptance Criteria

- [ ] C1: A browser check at the stated real-touch sizes confirms every listed control is at least 44 x 44 pixels.
- [ ] C2: The expanded hit areas do not overlap other controls or hide labels.
