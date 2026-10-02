# T11630: Frontend: pass celebration sheet, "Free" export price, Home banner

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-10-02
**Updated:** 2026-10-02

## Epic Context

This is task 3 of 5 in the Free Second Highlight epic. Read [EPIC.md](EPIC.md).

Depends on T11620's API:
- the publish response field `free_pass: {expires_at, max_credits} | null`
- `GET /api/credits` field `free_pass`
- the export start response field `free_pass_credits_covered`

Mockups: [canvas](https://claude.ai/artifact/6DVHn3V3Y16rzEGJBPKg9x), artboard
"C: Next one free". For the Home banner, reuse the layout of "B: Home banner" with C's copy.

Classification hint: M-tier, frontend only.

## Solution

### 1. Celebration sheet after publish

- `usePublishProject.publish` (`hooks/usePublishProject.js:67`) receives the publish response. When
  `free_pass` is non-null, show a `FreePassSheet` over the post-publish preview.
- All three publish callers go through this hook, so one change covers them:
  - `handleOverlayExportCompletion.js:116`
  - `OverlayScreen.jsx` `handlePublishNow`
  - `DraftReelPreview.jsx:199`
- The trigger is the publish gesture's response, held in memory only. Never use a `useEffect`
  watching credit state, and never persist "sheet seen". The server already returns the pass only
  once.

Copy (no em dashes; never "first highlight", because existing users get a pass too):
- Title: "Your highlight is live!"
- Subtitle: the highlight name
- Card label: "Free pass · 24 hours"
- Card heading: "Your next highlight is on us"
- Card body: "Make another highlight in the next 24 hours and it costs 0 credits (up to 40
  seconds)."
- Expiry: "Expires {local time, e.g. 6:12 PM tomorrow}"
- Primary button: "Make my free highlight". It opens the next tagged clip from the same game
  without a highlight; if none, it opens Annotate for that game.
- Secondary button: "Share this one first". It closes the sheet back to the existing preview and
  share flow, so the share step is never blocked.
- The sheet has no backdrop close (house rule). It closes only through its buttons.

### 2. Export price shows the pass

- The export button's cost disclosure (`ExportButtonView` `estimatedCredits`) shows "Free" when
  `estimatedCredits <= 40`, else "{cost - 40} credits (40 free)".
- The client-side insufficient-credits check must use the net cost. Otherwise a user with a low
  balance is blocked from a free export.
- The pass comes from the `GET /api/credits` payload already held by the credits store. Don't add a
  second fetch or a second copy of the data.
- After an export starts with `free_pass_credits_covered > 0`, refresh credits as the export flow
  already does. The pass then disappears because the server returns null.

### 3. Home banner + credits chip

- While `free_pass` is non-null, Home shows a banner:
  - "Your next highlight is free"
  - a countdown ("4h 52m left"), computed from `expires_at` with a 1-minute tick
  - a Continue button with the same destination as the sheet's primary button
- The credits chip shows a small "1 free highlight" tag.
- Both disappear when `free_pass` is null or the countdown reaches 0. Locally that is display only;
  the server is authoritative.

### 4. Credit history label

- `CreditHistoryModal.jsx:31` label map: add `free_pass: 'Free highlight pass'`. The prefix comes
  from T11620's `KEY_PREFIX`.

## Tests

- Unit:
  - The publish response with `free_pass` renders the sheet, and with `null` does not.
  - Export price "Free" vs "N credits (40 free)".
  - The insufficient-credits check uses the net cost.
  - The banner hides at expiry.
- E2E: one spec drives publish, then the sheet, then "Make my free highlight", and shows the
  "Free" export price. Route mocks by URL, not by call order (see the beacons landmine).

## Acceptance

- [ ] The sheet shows once per pass, on publish, from the response only
- [ ] Export price and the insufficient-credits check reflect the pass
- [ ] Home banner + chip tag, hidden when no active pass
- [ ] Works at 390 px wide; touch targets of 44 px or more
