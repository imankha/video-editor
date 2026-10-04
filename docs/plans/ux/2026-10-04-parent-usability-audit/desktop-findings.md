# ReelBallers desktop usability audit

## Test context

- Viewport: 1440 × 900 (desktop)
- Persona: a soccer parent who wants to turn raw game video into a short highlight of their child
- Tested journey: sign in → upload a five-minute game → mark a play → choose it as a highlight → frame the athlete → generate → save as a draft → verify it in Clips
- Test video: `staging-verification-fixture-5min.mp4` (the originally suggested `game2-test.mp4` was only 10 KB / 0 minutes, so it was not uploaded)
- Result: one 8-second portrait highlight, **Play 1**, was generated and saved as a draft. The balance moved from 54 to 44 credits (2 for the game and 8 for the highlight).
- Browser note: the requested separate Chrome surface was unavailable in this subagent environment, so the desktop run used the isolated Codex in-app browser at an explicit desktop viewport.

## Findings

### D1 — Upload instructions lead with production jargon instead of the parent's goal

- Severity: High
- Scope: Likely all screen sizes; this is a content problem, not a desktop responsiveness problem.
- Screen/state: **Games → Upload game** modal, before choosing a file.
- Evidence: [02-upload-game-modal-jargon.png](desktop/02-upload-game-modal-jargon.png)
- What is confusing: The first explanation says the parent will “pick them from the AI's player boxes,” that ReelBallers “connects the dots,” and “upscales” the video. A parent has not yet been told the simple path: upload the game, mark the good moment, choose their child, and receive a highlight. “AI player boxes,” “connects the dots,” and “upscales” describe the machinery rather than the result.
- Why it hurts the goal: This is the commitment point where the user is about to spend two credits and upload a large family video. Technical wording makes the process feel harder and less predictable.
- Recommendation: Replace the paragraph with goal-based copy, for example: “Upload the game, mark the moment you want, and choose your child. We’ll keep your child centered and create a highlight you can preview and share.” Put the 2-credit cost and 30-day storage policy in a plain sentence directly below it.

### D2 — The upload progress presents two conflicting percentages

- Severity: High
- Scope: Likely all screen sizes; the desktop layout makes both values visible at once.
- Screen/state: Immediately after uploading the five-minute game on the annotation screen.
- Evidence: [03-upload-processing-conflicting-status.png](desktop/03-upload-processing-conflicting-status.png)
- What is confusing: The progress panel simultaneously showed “Computing hash... 20%” and “3%.” The page also warned “Local preview — not saved online yet” while displaying a playable-looking video and “Connecting to server.” A parent cannot tell whether the upload is 3% or 20%, whether it is safe to leave, or whether the game has actually been saved.
- Why it hurts the goal: A 165 MB upload can take time. Contradictory status can cause users to leave too early, restart the upload, or fear that the video has been lost.
- Recommendation: Show one overall progress bar with one percentage and one plain-language phase, such as “Uploading your game — 20%. Keep this page open.” When the file is safely stored, change it to “Upload complete. Preparing your video for marking plays.”

### D3 — The core “mark a play” screen exposes too many editing concepts at once

- Severity: Medium
- Scope: Likely all screen sizes; smaller screens may make the overload worse.
- Screen/state: First arrival on **Annotate** after upload.
- Evidence: [03-upload-processing-conflicting-status.png](desktop/03-upload-processing-conflicting-status.png)
- What is confusing: The screen uses “Annotate,” “PLAYS,” “My athlete,” “Team,” “Frame Highlight,” “Add Spotlight,” two separate zoom systems, frame-step controls, a timeline, and “Captures 6 seconds before and 2 after.” A parent mainly needs to know: play the game, pause just after the good moment, and press **Mark play**.
- Why it hurts the goal: The main action competes with professional-editor controls and unfamiliar workflow terms. “Annotate” especially sounds like note-taking, not choosing highlight moments.
- Recommendation: Make the first-use instruction prominent and concrete: “Play the game. When the moment ends, press **Save this moment**. We’ll include the six seconds before and two seconds after.” Hide frame stepping, timeline zoom, and layer filters behind “More controls” until they are needed. Rename the top step from “Annotate” to “Choose moments.”

### D4 — Creating a highlight is unexpectedly gated by a five-star rating

- Severity: High
- Scope: Likely all screen sizes; this is a workflow and wording issue.
- Screen/state: Immediately after pressing **Mark play**.
- Evidence: [04-marked-play-rating-required.png](desktop/04-marked-play-rating-required.png)
- What is confusing: After saving the moment, the app opens an editing panel with five unlabeled stars. The top navigation's help text says a play must be rated “Brilliant,” but that requirement is not explained in the main panel. Nothing tells the parent that five stars is the key that unlocks “Make Highlight Now.” The button-like “Rate this play” at the right also looks disabled.
- Why it hurts the goal: A parent can successfully find the moment and still get stuck before making the highlight because the application silently turns a subjective rating into a required workflow state.
- Recommendation: Remove rating as a prerequisite. After marking a moment, offer a primary button: **Make this a highlight**. Keep rating optional for organizing plays. If the distinction must remain, replace stars with explicit choices such as “Save for review” and “Make a highlight.”

### D5 — “Set a focus point” gives no visible instruction for the action that actually works

- Severity: Critical
- Scope: Likely all screen sizes; it is a core interaction problem. On touch screens, discoverability may be even worse.
- Screen/state: First arrival on **Frame Highlight**, before moving the crop box.
- Evidence: [05-frame-editor-focus-point-confusion.png](desktop/05-frame-editor-focus-point-confusion.png)
- What is confusing: The footer blocks generation with “Set at least one focus point to generate.” The page says “Each spot you set is a focus point,” but does not say what gesture creates one. Clicking the timeline area that describes itself as the framing timeline did not create a point. The action that worked was dragging the crop box. Only after the drag did a keyframe appear and **Generate Highlight** become available.
- Why it hurts the goal: This is the most serious stop in the flow. The athlete is already inside a visible crop box, so the parent reasonably believes the framing is set, yet the primary action remains disabled with no next-step control.
- Recommendation: On first load, show a short guided instruction over the video: “Drag this box so your child is inside it. Releasing the box saves your first focus point.” Add a visible **Set focus here** button, or automatically create the first focus point from the initial box and let the parent adjust it. Use “keep your child centered” instead of “focus point” and “keyframe.”

### D6 — Completion choices introduce “spotlight,” “publish,” and “share” as three unclear states

- Severity: Medium
- Scope: Likely all screen sizes; content issue.
- Screen/state: **Your Highlight is Ready**.
- Evidence: [06-highlight-ready-next-step-choices.png](desktop/06-highlight-ready-next-step-choices.png)
- What is confusing: “Add spotlight” is explained as pointing out the athlete, but “Publish without spotlight” says the item goes to Published while “Nobody else can see this until you share a link.” Parents may reasonably equate publish with making something visible to others. “Done for now” is visually smaller despite being the safest choice.
- Why it hurts the goal: The user has achieved the main goal and now faces product-state terminology rather than an obvious preview/save/share decision.
- Recommendation: Use three outcome labels: **Point out my child**, **Save privately**, and **Share this highlight**. If publishing is only an internal ready state, do not call it publish. State privacy directly: “Saved privately. Only people with a link can view it.”

### D7 — “Done for now” returns to an empty editing screen instead of the saved highlight

- Severity: High
- Scope: Likely all screen sizes; not a desktop responsiveness issue.
- Screen/state: After selecting **Done for now** from the ready screen.
- Evidence: [07-done-returns-to-empty-annotate.png](desktop/07-done-returns-to-empty-annotate.png)
- What is confusing: The app returned to an **Annotate** page containing an 8-second video, “No plays yet,” disabled **Frame Highlight** and **Add Spotlight** actions, and a toast saying the item was added to Clips. The breadcrumb no longer clearly named the game or highlight. This looks like the work disappeared or the user has been placed in the wrong editor.
- Why it hurts the goal: Immediately after a costly render, the parent needs strong confirmation and a clear place to find the result. An empty play list and disabled controls undermine confidence that the highlight was saved.
- Recommendation: After **Done for now**, go directly to the new clip's detail page or the Clips list, scroll the new card into view, and label it “Draft — ready to preview.” Keep a visible confirmation with the highlight name and a **View highlight** button.

### D8 — The new clip is labeled “In Spotlight” even though no spotlight was added

- Severity: Critical
- Scope: All screen sizes; this is a state/label inconsistency, not a responsive issue.
- Screen/state: **Clips** after generating the highlight and choosing **Done for now**.
- Evidence: [08-clips-status-inconsistent-spotlight.png](desktop/08-clips-status-inconsistent-spotlight.png)
- What is confusing: The completion screen offered **Add spotlight**, but the user chose **Done for now**. The new clip then appeared under “Draft, in Spotlight” with an “In Spotlight” badge and the phase filter “In Overlay (1).” Three different terms—Spotlight, Overlay, and the skipped action—now describe the same clip.
- Why it hurts the goal: The parent cannot tell whether the app automatically changed the video, whether a spotlight was added accidentally, or what work remains before sharing.
- Recommendation: Use one term consistently. If no spotlight was added, label the clip simply **Draft** and offer **Add a spotlight to point out your child**. If player detection is processing automatically, call that background step “Finding players” and keep it separate from the optional user-added spotlight.

### D9 — The home screen briefly remains covered by a “Ready” loading overlay

- Severity: Low
- Scope: Observed on desktop; verify separately on tablet and iPhone.
- Screen/state: First signed-in home screen after the connection finished.
- Evidence: [01-home-loaded.png](desktop/01-home-loaded.png)
- What is confusing: The page content was visible and interactive while a centered spinner/progress treatment still said “Ready.” It reads as both finished and still loading and visually covers the main call to action.
- Why it hurts the goal: It creates hesitation at the very start and makes the page feel unstable.
- Recommendation: Remove the overlay as soon as the page becomes interactive. If a final background task remains, show a small non-blocking status that names what is happening.

## Desktop journey summary

The app can produce a usable athlete-focused highlight, but a parent has to infer several hidden rules: “Annotate” means choose moments, five stars means eligible for a highlight, and dragging the crop box creates a “focus point.” The most important improvements are to make the workflow goal-based, eliminate the rating gate, explicitly teach the crop-box action, and make saved/draft/spotlight/published states consistent.
