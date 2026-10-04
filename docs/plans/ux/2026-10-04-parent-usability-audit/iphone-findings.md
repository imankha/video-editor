# ReelBallers iPhone usability audit

Viewport tested: 390 × 844 (representative iPhone portrait). Site: `https://reel-ballers-staging.pages.dev`. Persona: a soccer parent trying to turn raw game footage into a highlight. The shared account was used in observation-only mode after another tester uploaded `staging-verification-fixture-5min.mp4`; I did not create, edit, mark, publish, or delete anything.

## Summary

The home screens are usable in portrait, but the game editor is not reliably responsive at iPhone width. It creates horizontal page scrolling, clips the current game name and later-step controls, and places important actions in very low-contrast text. The product also repeatedly uses workflow jargon—“annotations,” “Frame Highlight,” “Clipped,” “Spotlight,” “AI player boxes,” and “300%”—where a parent needs a simple explanation of what to do next.

## Findings

### 1. Game editor is wider than the iPhone viewport

- Severity: **High**
- Screen/state: Existing game and newly uploaded game, `/annotate`, portrait iPhone.
- Evidence: [04-annotate-horizontal-overflow-loading.png](iphone/04-annotate-horizontal-overflow-loading.png), [05-annotate-overflow-jargon-status.png](iphone/05-annotate-overflow-jargon-status.png), [07-new-game-editor-overflow-and-hidden-title.png](iphone/07-new-game-editor-overflow-and-hidden-title.png)
- What happens: A horizontal scrollbar appears across the entire page. The game name and “Frame Highlight” control extend beyond the visible area, so part of the workflow is off-screen. The parent must discover sideways scrolling before they can even understand the page.
- Why this hurts the goal: Marking plays while watching a game should be the core mobile task. Instead, the first decision is how to navigate a layout that does not fit the phone.
- Recommendation: Make the editor fit one portrait column with no page-level horizontal scrolling. Keep Back, the game name, and the current/next step visible. If the timeline itself must scroll sideways, contain that behavior inside the timeline and label it clearly.
- Cross-screen classification: **iPhone responsiveness issue**. This is caused by content exceeding the 390 px viewport; compare with tablet/desktop results to confirm they do not overflow.

### 2. Current game name disappears or is clipped in the editor header

- Severity: **High**
- Screen/state: Newly uploaded game in `/annotate` and existing game editor.
- Evidence: [07-new-game-editor-overflow-and-hidden-title.png](iphone/07-new-game-editor-overflow-and-hidden-title.png), [05-annotate-overflow-jargon-status.png](iphone/05-annotate-overflow-jargon-status.png)
- What happens: The title exists in the page structure (“Game uploaded Oct 4”), but it is not visible between Back and the workflow buttons at the iPhone width. On the existing game, the long name is also pushed out of view.
- Why this hurts the goal: A parent cannot confidently tell which game they are clipping, especially when several games are in the library.
- Recommendation: Put the game name on its own line, allow two-line wrapping, and keep it visible while the parent marks plays.
- Cross-screen classification: **iPhone responsiveness issue**.

### 3. Important bottom actions look disabled even when some are available

- Severity: **High**
- Screen/state: Newly uploaded game editor, below “Mark play.”
- Evidence: [07-new-game-editor-overflow-and-hidden-title.png](iphone/07-new-game-editor-overflow-and-hidden-title.png), [04-annotate-horizontal-overflow-loading.png](iphone/04-annotate-horizontal-overflow-loading.png)
- What happens: “Review plays,” “Share,” and “Add footage” use extremely faint text/icons against the purple background. Share and Add footage are available in the page structure, while Review plays is disabled, but visually they all look equally unavailable.
- Why this hurts the goal: The parent cannot tell what they can do now, what unlocks later, or where to go after marking a moment.
- Recommendation: Use clear enabled/disabled styling, and explain locked steps in plain language—for example, “Mark your first play to review it.” Do not show enabled actions with disabled-looking contrast.
- Cross-screen classification: **Likely all-screen clarity issue, amplified on iPhone**; verify contrast and states on larger screens.

### 4. Game cards truncate the information needed to choose the right game

- Severity: **Medium**
- Screen/state: Games library at `/home/games`.
- Evidence: [02-games-title-clipped-and-jargon.png](iphone/02-games-title-clipped-and-jargon.png), [06-new-game-card-clipped-and-annotations-jargon.png](iphone/06-new-game-card-clipped-and-annotations-jargon.png)
- What happens: Long game names are shortened to “at Oceanside Breake...” and even the generic newly uploaded title is shortened. Cards have room below, but the identifying title is forced to one line.
- Why this hurts the goal: Soccer parents often have many similar matches. Opponent/date are the fastest way to pick the correct raw video, and truncating the opponent increases the chance of editing the wrong game.
- Recommendation: Allow two title lines and keep the date/opponent readable. Consider a clearer generated name such as “Game — Oct 4” plus an obvious “Add opponent” prompt.
- Cross-screen classification: **iPhone responsiveness issue**, though the generic naming may affect all sizes.

### 5. “Annotations” is internal terminology, not a parent’s goal

- Severity: **Medium**
- Screen/state: Game cards, before opening a game.
- Evidence: [02-games-title-clipped-and-jargon.png](iphone/02-games-title-clipped-and-jargon.png), [06-new-game-card-clipped-and-annotations-jargon.png](iphone/06-new-game-card-clipped-and-annotations-jargon.png)
- What happens: Cards say “0 annotations” or “6 annotations • 2 published,” while the editor asks the user to “Mark play.”
- Why this hurts the goal: A parent has to guess whether an annotation is a marked play, a comment, or a finished highlight. The product uses two words for the same step.
- Recommendation: Use the user-facing language consistently: “0 plays marked,” “6 plays marked,” and “2 highlights shared/published.”
- Cross-screen classification: **All-screen content issue**.

### 6. Upload explanation leads with technical machinery instead of the outcome

- Severity: **Medium**
- Screen/state: Upload game modal.
- Evidence: [03-upload-modal-credit-wrap-and-jargon.png](iphone/03-upload-modal-credit-wrap-and-jargon.png)
- What happens: The modal describes “AI's player boxes,” “connects the dots,” “smooth motion,” and “upscales your video.” None of that tells a parent what they must do next in simple terms.
- Why this hurts the goal: Before spending credits and uploading a child’s game video, the parent needs a predictable path: upload the match, mark good moments, choose the player, review, and share.
- Recommendation: Replace the paragraph with a short outcome-led sequence: “Upload the game. Mark the moments you want. Choose your player. We’ll keep them centered and build a highlight you can review and share.” Explain technical details only in optional help.
- Cross-screen classification: **All-screen content issue**.

### 7. Credit/retention message breaks into a confusing sentence on iPhone

- Severity: **Medium**
- Screen/state: Upload game modal, before and after choosing a file.
- Evidence: [03-upload-modal-credit-wrap-and-jargon.png](iphone/03-upload-modal-credit-wrap-and-jargon.png)
- What happens: The row wraps into visually scrambled text: “2 credits - keeps your video for 30 Balance: days 54.” “Balance: 54” interrupts the retention sentence.
- Why this hurts the goal: This is the moment a parent decides whether uploading is safe and affordable. The layout makes both the price and the 30-day storage limit harder to understand.
- Recommendation: Stack the facts on separate lines: “Cost: 2 credits,” “Your balance: 54 credits,” and “Game video kept for 30 days.”
- Cross-screen classification: **iPhone responsiveness issue**.

### 8. Workflow labels do not form a clear, consistent path

- Severity: **Medium**
- Screen/state: Existing game editor and highlight rows.
- Evidence: [05-annotate-overflow-jargon-status.png](iphone/05-annotate-overflow-jargon-status.png)
- What happens: The same area uses “Annotate,” “Mark play,” “Frame Highlight,” “Make Highlight,” “Clipped,” “Published,” “Add Spotlight,” and “Make Another Highlight.” The step indicator says Annotate, while the main button says Mark play. “Vertical Video 2 Clipped” reads like a technical state or an error.
- Why this hurts the goal: A parent must learn the product’s vocabulary before knowing the next step. It is unclear whether “frame,” “make,” and “clip” are separate tasks or names for the same thing.
- Recommendation: Present a numbered, goal-based flow: “1. Mark the best moment → 2. Keep your player centered → 3. Review and trim → 4. Share.” Rename statuses to plain results such as “Ready to center,” “Ready to review,” and “Shared.”
- Cross-screen classification: **All-screen content/information-architecture issue**.

### 9. Timeline controls expose unexplained editing concepts

- Severity: **Medium**
- Screen/state: Game editor, both existing and new game.
- Evidence: [05-annotate-overflow-jargon-status.png](iphone/05-annotate-overflow-jargon-status.png), [07-new-game-editor-overflow-and-hidden-title.png](iphone/07-new-game-editor-overflow-and-hidden-title.png)
- What happens: The timeline opens at “300%,” includes an unlabeled draggable bar, and shows icons without explaining why a parent needs them to mark a play.
- Why this hurts the goal: The first-time parent is trying to find a goal or save, not operate a professional video editor. The controls add uncertainty before the core action.
- Recommendation: Default to a simple timeline with a clearly labeled current time. Put zoom and frame-by-frame controls behind “Fine tune” or explain them only after a play is marked.
- Cross-screen classification: **All-screen clarity issue**, with denser presentation on iPhone.

### 10. Loading state temporarily shows the wrong progress and unavailable workflow

- Severity: **Low to Medium**
- Screen/state: Existing game immediately after opening.
- Evidence: [04-annotate-horizontal-overflow-loading.png](iphone/04-annotate-horizontal-overflow-loading.png)
- What happens: While the video says “Loading video...” and “Connecting to server...,” the header shows 0 plays and disables Frame Highlight, even though the loaded game later has 6 plays and highlight options.
- Why this hurts the goal: The parent may think prior work is lost or that they opened the wrong game.
- Recommendation: During loading, show neutral placeholders (“Loading your plays…”) rather than temporary zero counts and disabled-looking completed steps.
- Cross-screen classification: **All-screen state-management issue**; the clipped loading layout is additionally an iPhone responsiveness problem.

### 11. Framing screen asks for a “focus point” without showing how to set one

- Severity: **Critical**
- Screen/state: Newly created Play 1 at `/focus`, before generating the highlight.
- Evidence: [08-focus-overflow-hidden-controls-and-unclear-focus-point.png](iphone/08-focus-overflow-hidden-controls-and-unclear-focus-point.png)
- What happens: A crop box is already drawn over the video and the instructions say to move it over the athlete. Yet the bottom action remains blocked with “Set at least one focus point to generate.” No visible button says “Set focus point,” “Save this position,” or similar.
- Why this hurts the goal: The parent can follow the visible instruction, see a box placed on the field, and still have no idea how to unlock the final highlight. This is a complete stop in the main journey.
- Recommendation: Make the action explicit beside the video: “1. Move the box over your player. 2. Tap **Set player position**.” Confirm success with “Player position set” and enable Generate. Avoid introducing “focus point” until after explaining it in parent language.
- Cross-screen classification: **All-screen workflow issue**; the iPhone layout makes the missing action especially hard to discover.

### 12. Sticky Generate panel hides the lower framing controls on iPhone

- Severity: **High**
- Screen/state: `/focus`, portrait iPhone.
- Evidence: [08-focus-overflow-hidden-controls-and-unclear-focus-point.png](iphone/08-focus-overflow-hidden-controls-and-unclear-focus-point.png)
- What happens: The large fixed “Generate Highlight” panel occupies the bottom of the screen while disabled. It covers the controls below the video, including the timeline, trim/slow-motion, preview, and settings area. At the same time a page-level horizontal scrollbar remains visible.
- Why this hurts the goal: The blocked final action takes space away from the controls needed to complete the prerequisite. A parent sees the problem message but cannot see the likely tools for resolving it.
- Recommendation: Do not pin the Generate panel until prerequisites are satisfied, or make it a compact status row. Reserve enough bottom padding so no content can sit behind it. Remove page-level horizontal scrolling.
- Cross-screen classification: **iPhone responsiveness issue**.

### 13. “Turn sideways” hint promises that nothing scrolls while the portrait page already scrolls sideways

- Severity: **Medium**
- Screen/state: `/focus`, framing instructions.
- Evidence: [08-focus-overflow-hidden-controls-and-unclear-focus-point.png](iphone/08-focus-overflow-hidden-controls-and-unclear-focus-point.png)
- What happens: The screen says “Turn sideways for a bigger frame — Twice the crop area, and nothing scrolls,” but the portrait page visibly has horizontal overflow and clipped header controls.
- Why this hurts the goal: It sounds like landscape mode is required to fix a broken layout rather than an optional aid. Parents may rotate the phone just to make the page usable.
- Recommendation: Make portrait mode fully usable first. Reword the optional hint to “Optional: rotate your phone for a larger video preview.”
- Cross-screen classification: **iPhone responsiveness issue**.

## Highest-priority fixes for the parent journey

1. Remove page-level horizontal overflow from `/annotate` at 390 px.
2. Keep the game name and next step visible.
3. Replace workflow jargon with one consistent parent-friendly sequence.
4. Make enabled, disabled, and locked actions visually distinct and explain how to unlock them.
5. Reflow upload cost, balance, and retention into separate mobile-friendly lines.
6. Add an explicit, visible “Set player position” action and keep prerequisite controls above any sticky Generate bar.
