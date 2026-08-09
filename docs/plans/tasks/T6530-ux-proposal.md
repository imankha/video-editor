# T6530 UX Proposal: Intro Card Discoverability

**Status:** DRAFT — awaiting user approval. No application code has been touched for this task.
**Method:** Live-drove the app as a real user (Playwright + `dev-login`, account `imankh@gmail.com`)
against a temporary worktree at `origin/master` (commit `f4b0f140`, which includes T5215 —
attachment + resolution — merged; **T5220, the actual pre-roll playback, is still unmerged**
on `feature/T5220-intro-egress` as of this research). Walked two real profiles on that account:
"Test Soccer Mehdi profile" (2 cards, active) and "sdfg" (0 cards, inactive) — swapping which one
was active to see both the zero-card and non-active-profile cases from the inside. Screenshots
below are real captures, not mockups, saved under
`docs/plans/tasks/T6530-ux-screenshots/` (desktop 1440px + mobile 375px).

---

## TL;DR recommendations

| # | Question | Recommendation |
|---|---|---|
| 1 | Where does card *management* live? | Keep it in Profile settings (matches the original design mockup and the app's existing pattern for per-athlete assets), but add a second, shallow entry point so it isn't buried 3 levels deep — see mockup below. |
| 2 | Where does card *selection* live? | No change. T5215 already put it in the right place (reel kebab + collection share dialog, next to the decision). |
| 3 | First-run for a zero-card user | The on-ramp itself (New card → consent → editor) is already good. Fix the *trigger*, not the destination: surface it at first share/download, not only inside Settings. |
| 4 | Non-active-profile case | Replace the grey dead-end line with a real "Switch & manage" button that performs the switch and opens the library in one gesture. |
| 5 | Naming | "Intro cards" matches the original design mockup, so this is not a clear-cut rename — but fix a real inconsistency: the SAME screen currently calls it "Player intro card" (heading) and "Intro cards" (button) four lines apart. |
| 6 | Discoverable before T5220 ships? | No — stage the work. Ship the correctness fixes (Q4, Q5) now; hold new prominent entry points (Q1's second entry point, Q3's share-time prompt) until T5220 is merged and verified. |

---

## What I actually found, live

### 1. The entry point today: three levels deep, and it disappears on scroll

Home → profile switcher → **Manage Profiles** (list) → **Edit** a profile → scroll past Sport,
Color, Name, Save/Cancel, Photo, Full Name, Position/Class/Team, "minimum reel length" and the
consent checkbox → **Intro cards** button.

- Desktop: `03-edit-profile-active-introcards-button-desktop.png`
- Mobile (375px): `19-edit-profile-active-mobile.png` — the button is the very last thing in a
  panel that already needs a full scroll to reach.

This *is* where the original design mockup put it too (section 06.A: "Profile settings › Intro
cards") — so the placement isn't a mistake, it's a decision nobody revisited once the feature
had 8 more fields stacked in front of it by T5190's consent/photo/facts work.

### 2. The dead end on a non-active profile — confirmed, and it's not a trivial fix

Editing "sdfg" (not the active profile) renders:

> *Switch to this profile to manage its intro cards.*

as plain `text-gray-500`, no button, no link — screenshot `06-edit-profile-nonactive-greytext-desktop.png`
(desktop) and `21-edit-profile-nonactive-mobile-top.png` (mobile, where it's even easier to miss).

I traced *why* it's gated, because the fix has to match the real constraint:

- `intro_cards.py` resolves the profile scope entirely from `get_current_profile_id()`
  (`app/profile_context.py`), which reads the `X-Profile-ID` **request header**.
- That header is stamped by a single **global** module variable (`_currentProfileId` in
  `src/frontend/src/utils/sessionInit.js`), updated only by `reinstallProfileHeader()` on an
  actual profile switch — there is no per-request override today.

So "view another profile's library without switching" is a real plumbing gap, not a css/copy fix.
The consistent, low-risk fix is to make the existing gesture (`switchProfile`, already used by
clicking a profile row) do double duty: switch, then open the library — one click, not two
screens.

Worth noting: the sibling `ProfileIntroSection` (photo, full name, position/class/team,
consent) directly above this button has **no such gate** — it's editable on any profile,
active or not. So the inconsistency isn't just cosmetic; only the card *library* is
current-profile-scoped, while the rest of the per-profile intro data isn't.

### 3. The first-run flow, walked end to end (zero-card profile)

Switched active profile to "sdfg" (0 cards, no consent yet) and opened its library:

- `09-introcards-empty-grid-desktop.png` — "No intro cards yet. Create one to open a reel with
  your player." + a dashed "New card" tile. Good copy, good CTA, non-native comparison well made.
- Clicking **New card** without consent shows an inline **Consent required** gate
  (`10-new-card-editor-empty-desktop.png`) — not a separate dialog, not a dead end.
- Ticking consent drops straight into the editor with a card already created, auto-named
  "Intro Card 1", auto-marked **Default** (`11-new-card-editor-after-consent-desktop.png`).

This is a genuinely good on-ramp — one click from "empty" to "editing a usable, already-default
card." The acceptance criterion ("a user who has never made a card can find the feature and
finish with a usable card") is basically already met **once they're in Settings**. The gap is
entirely upstream: nothing outside Settings tells a first-time user this exists.

### 4. Card selection (T5215) — already well placed, mildly buried

- **Collection kebab → Intro** opens a picker titled `Intro for "Top Plays"` with real card
  thumbnails, a "Selected" tag, "Your default" marking, "No intro," and the public-exposure
  warning (`13-collection-kebab-menu-desktop.png`, `14-intro-picker-carousel-desktop.png`).
- **Per-reel kebab → Intro** — same `IntroCardCarousel` component, reached from the reel tile's
  "More actions" menu (`16-reel-kebab-menu-desktop.png`). It's item 5 of 9 (Download, Share, Copy
  Link, Rename, **Intro**, Before/After, Open as Draft, Move to profile, Delete).
- Reels/collections that already have a card attached show a passive **"An intro plays before
  this [reel/collection]"** badge inline, so the state is visible without opening the menu
  (visible in `15-my-reels-expanded-desktop.png` and `16-...png`'s tile).

This matches the task's own instinct ("probably next to the reel, not in profile settings") and
the original mockup's section 06.C. The only deviation from the mockup: the mockup showed the
picker rows inline inside the reel's popup menu; the shipped version opens a dedicated modal from
one menu row instead. That's a reasonable trade — this app's kebab menus are already long lists,
and the modal has room for the exposure warning and real thumbnails — not something I'd unwind.
**No change recommended here.**

### 5. Comparable per-profile assets — how the app already does this

`ProfileIntroSection` (photo, full name, position/class/team) lives in the exact same panel,
right above the Intro cards button, with no gating and no separate modal — it's just more form
fields in Edit Profile. The share flow's existing entry points (`ShareGameModal`,
`CollectionShareModal`) already embed pickers inline rather than sending the user elsewhere
(confirmed in `CollectionShareModal.jsx`: `<IntroCardCarousel ... onRequestConsent={...}>`,
which nudges to Settings only when consent is missing, via a toast, not a redirect).

The pattern this app already uses: **structured per-athlete facts stay in profile settings;
per-reel decisions stay next to the reel; the two are connected by a toast/link, not a shared
screen.** My placement recommendation for Q1 below follows this precedent rather than inventing
a new one.

---

## Recommendations, in detail

### Q1 — Where does card management belong?

**Keep the canonical home in Profile settings** (consistent with the mockup, with
`ProfileIntroSection`, and with how position/class/team/photo already live there). Do **not**
invent a new top-level nav item — that would be the second unrelated home for "profile stuff"
in the app.

**Add one shallow entry point**, not a redesign: a **"Manage cards"** link inside the
`IntroCardCarousel` picker itself (the same component T5215 already renders at reel/collection
decision time). A user who is picking a card and sees only "curl test card" and one photo card is
in exactly the right frame of mind to go make a better one — send them there directly instead of
making them back out, find the profile switcher, open Manage Profiles, click Edit, and scroll.

This is a one-line addition to an existing component (`IntroCardCarousel.jsx` already knows the
profile and already renders "No intro"/card rows — a footer link that opens `IntroCardsModal` is
in scope, in spirit, and costs nothing architecturally).

### Q2 — Where does card selection belong?

**No change.** T5215 already implements this correctly: a shared `IntroCardCarousel` component
used identically in the reel kebab and the collection share dialog, both next to the actual
decision, both showing the public-exposure warning, both showing "Your default." This satisfies
the acceptance criterion ("Card SELECTION sits where the user decides which reel gets an
intro") as shipped.

### Q3 — First-run for a zero-card user

Leave the empty-state screen exactly as built (`09-...png`, `10-...png`, `11-...png` — copy, CTA,
consent gate, and default-marking are all good). The fix is **where the trigger lives**, not the
destination:

- Recommend a **one-time prompt at first share or download of a reel** (the moment a parent is
  already thinking "I want this to look good") — e.g. a dismissible banner in the share dialog:
  "Add a player intro card? Takes 30 seconds." → deep-links straight into the create flow.
- This ties discovery to a real user *moment* instead of ambient hope that someone opens Settings.
- **Sequencing note:** this specific trigger should not ship until T5220 (playback) is live — see
  Q6. Shipping it earlier would invite a user to spend that 30 seconds on a card that then plays
  nowhere.

### Q4 — The non-active-profile case

Replace the grey text with a real control:

```
Before (today, both widths):
  ┌─────────────────────────────────────────┐
  │  ...consent checkbox...                  │
  │                                           │
  │  Switch to this profile to manage its    │   <- plain gray-500 text, no affordance
  │  intro cards.                             │
  └─────────────────────────────────────────┘

After (proposed):
  ┌─────────────────────────────────────────┐
  │  ...consent checkbox...                  │
  │                                           │
  │  ┌─────────────────────────────────────┐ │
  │  │  Switch to "sdfg" & manage cards  →  │ │   <- real button, bg-gray-700 like the
  │  └─────────────────────────────────────┘ │      existing "Intro cards" button
  └─────────────────────────────────────────┘
```

On click: call the existing `switchProfile(p.id)` (already used by the profile-row click in
`ManageProfilesModal.jsx`), then open `IntroCardsModal` once the switch resolves — chaining two
gestures the app already has, not adding a new capability. This meets the acceptance criterion
("gives an action... never a dead line of grey text") without touching the `X-Profile-ID`
plumbing, which is out of scope for this task (see the architecture note in section 2 above).

### Q5 — Naming

The original design mockup already committed to "Intro cards" / "Intro card" — so this is **not**
a clean case for inventing new user-facing language without more validation. What I'd fix now,
because it's an outright inconsistency rather than a judgment call: `ProfileIntroSection.jsx`
renders `<h3>Player intro card</h3>` as its section heading, and four form-fields later
`ManageProfilesModal.jsx` renders a button labeled `Intro cards` for the *same feature, same
screen, same scroll*. Standardize on one term across that one panel. I'd pick **"Player Intro"**
as the singular feature name (matches the epic's own title, matches the section heading that's
already live) and reserve "cards" only for the plural library view where the user is literally
managing multiple instances ("Player Intro" nav/section label, "New card" / grid still fine
inside the library itself, matching the shipped grid copy).

### Q6 — Discoverability before T5220 ships?

**No, not the new entry points.** T5220 (serve-time prepend + playback pre-roll — i.e. the part
that actually makes a card play before the footage) is unmerged as of this research
(`feature/T5220-intro-egress`). Today a user who builds a beautiful card and attaches it gets...
nothing visible anywhere, because nothing consumes `intro_card_id` yet at any egress. The task's
own risk flag is correct: promoting the feature harder right now would spend a user's attention
on something invisible.

**Recommended split:**

| Ship now (safe regardless of T5220 timing) | Hold until T5220 merges + is verified |
|---|---|
| Q4 fix — grey-text → real switch-and-open button | Q1's "Manage cards" link — low risk either way, but pair it with the share-time prompt for one coherent release |
| Q5 fix — standardize "Player Intro" copy in one panel | Q3's share/download-time discovery prompt — this is the one that actively pulls a user toward the feature, so it should not fire before the payoff exists |

Q4 and Q5 are bug fixes (dead end, inconsistent copy) that improve the feature's current, honest
footprint without amplifying it. Q1 and Q3 actively increase how many users notice the feature —
those should wait for a signal that T5220 landed.

---

## Screenshots (all under `docs/plans/tasks/T6530-ux-screenshots/`)

| File | What it shows |
|---|---|
| `01-home-desktop.png` | Home, logged in as the test account |
| `02-manage-profiles-list-desktop.png` | ManageProfilesModal, list mode |
| `03-edit-profile-active-introcards-button-desktop.png` | Active profile edit view, "Intro cards" button reachable |
| `04-introcards-library-grid-desktop.png` | Library grid, 2 existing cards |
| `05-introcard-editor-desktop.png` | Card editor for an existing card |
| `06-edit-profile-nonactive-greytext-desktop.png` | **The dead end** — non-active profile, grey text only |
| `07-home-after-switch-to-sdfg-desktop.png` | Home after switching active profile to the zero-card profile |
| `08-edit-profile-active-zerocard-desktop.png` | Edit view for the now-active zero-card profile, consent unchecked |
| `09-introcards-empty-grid-desktop.png` | Empty library state — "No intro cards yet..." |
| `10-new-card-editor-empty-desktop.png` | Inline consent gate on first "New card" click |
| `11-new-card-editor-after-consent-desktop.png` | Editor immediately after consent — card already created + default |
| `12-my-reels-drawer-desktop.png` | My Reels drawer, collections view |
| `13-collection-kebab-menu-desktop.png` | Collection kebab menu showing the "Intro" item |
| `14-intro-picker-carousel-desktop.png` | `IntroCardCarousel` picker — "Intro for 'Top Plays'" |
| `15-my-reels-expanded-desktop.png` | Expanded game group, reel tiles with "An intro plays..." badge |
| `16-reel-kebab-menu-desktop.png` | Per-reel kebab — full 9-item menu, "Intro" is item 5 |
| `17-home-mobile.png` | Home at 375px |
| `18-manage-profiles-mobile.png` | Profile list at 375px |
| `19-edit-profile-active-mobile.png` | Active profile edit at 375px — full scroll to reach "Intro cards" |
| `20-introcards-grid-mobile.png` | Library grid at 375px |
| `21-edit-profile-nonactive-mobile-top.png` | **The dead end at 375px** — even easier to miss |
| `22-my-reels-mobile.png` | My Reels drawer at 375px |

---

## Open questions for the user

1. **Q1's second entry point** — is a "Manage cards" link inside the `IntroCardCarousel` picker
   the right shallow entry, or would you rather it live somewhere more visible on Home (e.g. next
   to the profile switcher itself, always visible, not nested behind a reel action)? I avoided a
   new top-level nav item on the theory that this app deliberately keeps "profile stuff" in one
   place, but I could be wrong about how much weight this feature deserves relative to e.g. My
   Reels or Games.
2. **Q3's share-time prompt** — should it be dismissible permanently ("don't ask again") or just
   per-session? A parent sharing 10 clips in one sitting shouldn't see it 10 times, but a genuine
   "I don't want this feature" signal should probably not need to be re-suppressed on a new
   device/session either.
3. **Q5 naming** — I'm recommending "Player Intro" as the singular feature name based on the
   epic's own title and the existing `ProfileIntroSection` heading, but this wasn't tested with
   an actual parent. Worth a real naming check before it's load-bearing everywhere, or is
   "Intro cards" (as the original mockup already committed to) good enough to leave alone and
   just make internally consistent?
4. **Timing** — T5220 is in flight right now (not yet merged as of this research). Do you want
   me to treat "T5220 merged" as the gate for Q1/Q3 as written above, or is there a different
   signal you'd rather use (e.g. ship everything together once T5220 lands, rather than staging
   Q4/Q5 separately)?

Nothing has been implemented. Once you approve (or redirect) the recommendations above, the
implementation is a normal M-tier frontend task per the CLAUDE.md classification.
