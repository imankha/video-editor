# ReelBallers usability audit — tablet (768 × 1024)

## Audit status

The tablet audit could not proceed past sign-in. The staging site was tested at an explicit 768 × 1024 viewport in a dedicated in-app browser session because Chrome browser control was not available to this sub-agent. The Google account chooser showed an existing authorized account, but selecting **Continue as Iman** did not navigate, open a sign-in window, or show an error. Per the testing instructions, the audit stopped when authentication required user intervention.

## Finding T-01 — Google sign-in produces no visible result

- **Screen/state:** Initial sign-in screen, after selecting **Continue as Iman**
- **Viewport:** Tablet only tested (768 × 1024); cross-screen scope cannot be determined until the other viewport audits report back
- **Severity:** Blocker
- **Evidence:** [01-tablet-login-auth-blocker.png](tablet/01-tablet-login-auth-blocker.png)
- **What happened:** The Google account button received focus, but the page stayed exactly where it was. There was no loading message, error, alternate action, or explanation.
- **Why this is confusing for a soccer parent:** A parent who wants to turn a game recording into a highlight cannot tell whether the click worked, whether the site is loading, or whether they should try again. The entire highlight-making goal is blocked before the video can be uploaded.
- **Goal-oriented recommendation:** After the account is selected, immediately show a plain-language status such as **“Signing you in…”**. If the sign-in window cannot open or the sign-in attempt fails, replace the silent failure with a direct recovery message: **“We couldn’t open Google sign-in. Allow pop-ups, then try again — or enter your email to get a sign-in code.”** Keep the next action visible and specific.

## Additional observations from the blocked screen

- The headline **“Share Your Player’s Brilliance”** is warm but does not tell a first-time parent what they can accomplish. A more goal-focused line such as **“Turn a game video into your child’s highlight reel”** would set expectations before sign-in.
- The email field uses placeholder-only text (**“your@email.com”**) with no persistent label. Once text is entered, the field no longer explains what it is. Label it **“Email address”** and change the action to **“Email me a sign-in code”** so a nontechnical parent understands what will happen.
- The sign-in card is centered and readable at 768 × 1024 with no clipping or overlap visible. These observations are tablet-specific until the desktop and phone results are compared.

## Shared-account follow-up after the desktop upload

The tablet view was later reopened in the shared signed-in account at the same explicit 768 × 1024 viewport. No second upload or project was created. The tablet was refreshed after the desktop tester uploaded the game, created Play 1, and generated the highlight.

## Finding T-02 — Framing shows a crop box but no clear way to “set” the required point

- **Screen/state:** Play 1 → Frame Highlight
- **Scope:** All screen sizes; confirmed on desktop, tablet, and iPhone
- **Severity:** Critical
- **Evidence:** [04-tablet-focus-screen.png](tablet/04-tablet-focus-screen.png)
- **What happened:** A crop box is already visible over the video, but the footer says “Set at least one focus point to generate.” No button says Set, Save position, or Confirm player. The interaction that worked on desktop was dragging the box, which silently created the point.
- **Why this is confusing for a soccer parent:** The visible box looks like the player framing is already set, yet the final button stays disabled. The parent must guess a hidden gesture before the highlight can be made.
- **Goal-oriented recommendation:** Say “Drag the box over your child. Releasing it saves their position,” then confirm “Player position saved.” Better yet, create the first position automatically and let the parent adjust it.

## Finding T-03 — The tablet home page uses only about half the available width

- **Screen/state:** Games home after upload
- **Scope:** Tablet responsiveness issue; the iPhone correctly uses a single narrow column and desktop has enough room for a wider composition
- **Severity:** Medium
- **Evidence:** [03-tablet-home-narrow-layout-and-dead-resume-card.png](tablet/03-tablet-home-narrow-layout-and-dead-resume-card.png)
- **What happened:** Game cards remain phone-width and stack down the left side, leaving a large unused area on the right.
- **Why this is confusing for a soccer parent:** The page feels unfinished and makes the game library harder to scan than it should be on a tablet.
- **Goal-oriented recommendation:** Use the tablet width for two balanced columns or make each game card wider so the opponent, date, and progress are easier to compare.

## Finding T-04 — Post-generation status contradicts the action the parent chose

- **Screen/state:** Clips after the desktop tester generated Play 1 and chose Done for now
- **Scope:** All screen sizes; this is shared state and wording, not responsive layout
- **Severity:** Critical
- **Evidence:** [06-tablet-post-generation-jargon.png](tablet/06-tablet-post-generation-jargon.png)
- **What happened:** The parent skipped Add spotlight, but the clip is grouped under “Draft, in Spotlight” and carries an “In Spotlight” badge. On the same screen, the phase filter calls this “In Overlay.”
- **Why this is confusing for a soccer parent:** It suggests the app changed the video despite the parent declining the option, and it uses two names for the same state.
- **Goal-oriented recommendation:** If no spotlight was added, show only “Draft — ready to review.” Use a single plain-language status everywhere.

## Finding T-05 — Blocking loader says “Ready” while still covering the page

- **Screen/state:** Home after refresh
- **Scope:** Confirmed on desktop and tablet; likely shared loading behavior
- **Severity:** Low to Medium
- **Evidence:** [02-tablet-home-after-upload.png](tablet/02-tablet-home-after-upload.png)
- **What happened:** Page content was already visible, but a full-page dimming overlay and spinner still covered it while the text said “Ready.”
- **Why this is confusing for a soccer parent:** “Ready” says the app can be used, while the overlay says to wait.
- **Goal-oriented recommendation:** Remove the blocking overlay as soon as the page is usable. If background work remains, name it in a small, non-blocking message.

## Tablet coverage note

The shared-account refresh allowed inspection of Games, Clips, the framing screen, and generation status. Editing actions remained desktop-only as requested, so tablet evidence reflects the same project rather than a duplicate workflow.
