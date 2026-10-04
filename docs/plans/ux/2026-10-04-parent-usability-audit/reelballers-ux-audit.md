# ReelBallers parent usability audit

## Outcome

The full desktop journey succeeded: sign in, upload a five-minute game, mark a play, turn it into a highlight, keep the player centered, generate, and save an 8-second portrait draft named **Play 1**. The same account state was then inspected at 768 × 1024 tablet and 390 × 844 iPhone sizes. Only desktop performed state-changing actions; tablet and iPhone refreshed the shared account.

The app can produce the desired highlight, but the parent has to learn hidden rules and product jargon. The most serious obstacle appears on every screen: a visible crop box does not count until it is dragged, yet the UI only says “Set at least one focus point.” The most serious responsive defects are on iPhone, where editor pages overflow sideways and the fixed Generate panel covers controls needed to satisfy its prerequisite.

## Priority findings by scope

| Priority | Finding | Scope | Evidence |
|---|---|---|---|
| Critical | A hidden crop-box drag is required to create a “focus point” and unlock Generate | **All screens** | [Desktop](desktop/05-frame-editor-focus-point-confusion.png), [Tablet](tablet/04-tablet-focus-screen.png), [iPhone](iphone/08-focus-overflow-hidden-controls-and-unclear-focus-point.png) |
| Critical | The clip says “In Spotlight” after Spotlight was skipped; the same state is also called “In Overlay” | **All screens / shared state** | [Desktop](desktop/08-clips-status-inconsistent-spotlight.png), [Tablet](tablet/06-tablet-post-generation-jargon.png) |
| High | `/annotate` and `/focus` overflow horizontally; title and next-step controls are clipped | **iPhone-only responsiveness** | [Annotate](iphone/07-new-game-editor-overflow-and-hidden-title.png), [Focus](iphone/08-focus-overflow-hidden-controls-and-unclear-focus-point.png) |
| High | Fixed Generate panel covers timeline, trim, preview, and settings while Generate is disabled | **iPhone-only responsiveness** | [iPhone](iphone/08-focus-overflow-hidden-controls-and-unclear-focus-point.png) |
| High | Upload shows conflicting progress values and unclear save state | **All screens / workflow state**; directly captured on desktop | [Desktop](desktop/03-upload-processing-conflicting-status.png) |
| High | Making a highlight is silently gated by a five-star “Brilliant” rating | **All screens / workflow** | [Desktop](desktop/04-marked-play-rating-required.png) |
| High | After “Done for now,” the app returns to an empty-looking editor rather than the saved highlight | **All screens / navigation** | [Desktop](desktop/07-done-returns-to-empty-annotate.png) |
| Medium | Upload cost, balance, and 30-day storage wrap into a scrambled sentence | **iPhone-only responsiveness** | [iPhone](iphone/03-upload-modal-credit-wrap-and-jargon.png) |
| Medium | Game titles truncate, making similar matches hard to distinguish | **iPhone responsiveness** | [iPhone](iphone/02-games-title-clipped-and-jargon.png) |
| Medium | Tablet game cards occupy only half the screen | **Tablet-only responsiveness** | [Tablet](tablet/03-tablet-home-narrow-layout-and-dead-resume-card.png) |
| Medium | “Annotations,” “Frame,” “Clipped,” “Spotlight,” “Overlay,” and “300%” force parents to learn editor vocabulary | **All screens / content** | [Desktop](desktop/03-upload-processing-conflicting-status.png), [iPhone](iphone/05-annotate-overflow-jargon-status.png) |
| Low–Medium | A blocking loader says “Ready” while still dimming the usable page | **Desktop and tablet** | [Desktop](desktop/01-home-loaded.png), [Tablet](tablet/02-tablet-home-after-upload.png) |

## Recommended parent-friendly flow

1. **Upload the game** — show cost, current balance, and storage time on separate lines.
2. **Save the best moment** — “Play the game. When the moment ends, press Save this moment.”
3. **Make this a highlight** — do not require a rating; keep stars optional for organizing plays.
4. **Keep your child centered** — “Drag the box over your child. Releasing it saves their position.” Confirm when it is saved.
5. **Review the highlight** — use Save privately, Point out my child, and Share; avoid Spotlight, Overlay, and Publish unless they are explained.

## Fix order

1. Add an explicit, visible way to save the player position and automatically enable Generate when it succeeds.
2. Remove iPhone page-level horizontal overflow and keep the game name and workflow steps visible.
3. Stop the disabled Generate panel from covering the controls required to unlock it.
4. Correct the Spotlight/Overlay state and use one status name everywhere.
5. Remove the five-star gate and replace “Annotate” with “Choose moments” or “Save this moment.”
6. Replace multi-signal upload progress with one percentage and one instruction: “Keep this page open.”
7. Send “Done for now” to the new clip and confirm it is saved privately.
8. Reflow tablet cards and mobile upload facts for their viewports.

## Test details

- Site: `https://reel-ballers-staging.pages.dev/home`
- Desktop: 1440 × 900
- Tablet: 768 × 1024
- iPhone: 390 × 844
- Source used: `staging-verification-fixture-5min.mp4` from the supplied `test.short` folder. The 10 KB `game2-test.mp4` was not a usable game source.
- Result: Play 1, 8-second portrait draft
- Credits: 54 → 44 (2 for upload, 8 for generation)
- Detailed reports: [Desktop](desktop-findings.md), [Tablet](tablet-findings.md), [iPhone](iphone-findings.md)
