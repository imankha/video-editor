# Tutorial Redesign: guided essential path

**Status:** TODO (SEQUENCED AFTER ALL P1 bug fixes from the 2026-08-24 investigation:
upload-integrity epic T7470/T7480/T7490/T7500 + T7540 + T7580 + T7590 + T7520)
**Started:** filed 2026-08-24
**Impact:** 9 | **Complexity:** 7 | **Priority:** 1.3

## Goal

Replace the current "watch a video" quest UI with an in-context guided tutorial that
walks a new user through the ESSENTIAL PATH of making a reel, using a modal shade +
bouncy arrow that anchors to the real UI element the user must touch next. User
directive 2026-08-24.

Why (evidence from the 2026-08-24 funnel analysis): the watch-a-video model demonstrably
does not transfer. Three mobile users COMPLETED the tutorial and stopped dead at the very
next step ("upload a game"); lisagee completed the quest chain and still never found reel
creation; cschwartz watched his game for 28 minutes across five visits and never saved a
clip. Users watch, then face the real UI alone and get lost. The redesign guides them ON
the real UI instead.

## Product requirements (user-specified 2026-08-24)

1. **Toggleable, default ON.** A user can turn the tutorial off and back on; new
   accounts start with it on. (A real preference, so persisting it is legitimate,
   gesture-based: the toggle click is the gesture.)
2. **Guides the essential path of making a reel**: upload a game -> open it -> create a
   clip (rate + save, including the tag field's Enter behavior, then **"Clip Out Play"** —
   renamed from "Create Reel" by T8760) -> **Focus** (crop/follow the athlete — renamed
   from "Framing" by T7700) -> Publish (T8390's preview-first one-tap Publish) -> see it
   in the **Published** tab (T8555's four-tab IA; NOT the old "My Reels") -> share. Each
   step completes by the USER performing the real action, not by watching.
3. **Modal shade + bouncy arrow**: dim everything except the one element that advances
   the path; an animated arrow points at it. The user is funneled to the right action
   (escape hatch: the off toggle + a "not now" affordance; never a hard lock).
4. **Tested on all screen sizes**: 320px iPhone SE class through desktop, keyboard
   open/closed on mobile, per the responsiveness skill. The shade/arrow must anchor
   correctly across breakpoints and after layout shifts.

## Evidence constraints (2026-08-24 research review; binding on T7620's design)

Validated: advance-on-real-action is exactly the pattern the evidence favors (contextual
just-in-time guidance shows ~2.9x feature adoption vs front-loaded tours; passive
tooltips are dismissed within ~3 seconds; CapCut's own onboarding is this same mechanic:
hotspot tooltips, dimmed background, user must perform each action). Three shape
constraints from the same evidence:

1. **3-5 steps per contextual segment, never one mega-tour.** Tour completion collapses
   from ~72-74% at 3-4 steps to ~16% at 7. The essential path must be SPLIT into
   contextual mini-tours that fire when the user reaches each surface (upload tour on
   the Games screen, clip tour on entering Annotate, reel tour when >=1 clip exists),
   not one long guided chain.
2. **Visibly skippable, even though default-on.** Skippable tours complete ~25% better;
   ~70% of users skip tours that feel imposed. "Not now" must be one obvious tap; the
   shade must never read as a lock.
3. **Contextual triggering over front-loading**: each mini-tour fires at the moment of
   first need, resumable independently. (This also degrades gracefully: skipping the
   upload tour does not forfeit the clip tour later.)

## 2026-08-31 user directive: the Help button (binding; supersedes conflicting lines below)

The quest panel surface is retired in favor of a single **Help button** (the mechanical
collapse ships early as [T8120](../first-clip-funnel/T8120-quest-overlay-help-collapse.md);
this epic builds what the button opens). Requirements:

1. **Context-aware**: help derives its guidance from the user's CURRENT screen plus what
   they have already done (existing FLOW_EVENTS milestone state + route). It never plays
   a generic sequence.
2. **Totally modal steps.** Each step is exactly ONE of:
   - the one control we want clicked is the only interactive element (shade everything
     else), bouncy arrow anchored to it, explainer dialog positioned to NEVER overlap
     the target or other essential UI;
   - the one input we want filled, same arrow + non-overlapping explainer;
   - a question dialog that asks the user about their intent and BRANCHES the guided
     path on the answer (e.g. full game video vs pre-cut clips).
3. **No more tutorial videos.** The guided branches must cover EVERYTHING the videos
   covered, plus the branch points. The videos are removed as a mechanism, not demoted
   (this supersedes the "T5140 videos stay for the help surface" line below; the
   assets contract retires with them).
4. **On/off**: user can toggle help off and back on (unchanged from requirement 1 below).
5. **Report a problem** from Help - wires into the existing T7515 frustration/impression
   channel and the bug_reports path.
6. **Breakthrough guarantee**: help must do its best to get the user past any blocker.
   Complement the pull surface with one push element: when a funnel screen shows dwell
   with no key action (~45s), PULSE the Help button with a contextual label - never
   auto-open, never occlude (that is the exact bug T8120 removes).
7. **Credits upfront**: the quest credit drip is replaced by a full upfront grant
   (ships in T8120); the guided path never gates on earning credits.
8. **V2 (out of scope, design for it)**: text-to-speech - the help speaks each step.
   Keep step copy as short plain spoken-style sentences per step so voice is a renderer
   swap, not a rewrite.

Naming alignment: step copy uses the approved vocabulary - "Add Play", "Clips",
"Create Highlight Reel" (see first-clip-funnel epic decisions).

## 2026-09-17 user directive: restated target + four deltas awaiting the user's ruling

The product owner restated the target while filing the Deploy Candidate milestone (the epic is IN
that milestone):

> "Redo tutorial so there is no quest UI, there is just a help button that toggles on and off,
> and defaults on for new users, and when on puts the app in guided mode, essentially forcing the
> user to click on one of their options, and spelling out the implications of each, and takes the
> user's historical activity into account along with the current screen to determine what they
> need to do at the time. The user might have more than one option, for example, initially we
> don't know if they want to upload a full game video or just a clip."

Mapped against the APPROVED T7620 design (`docs/plans/tasks/T7620-design.md`, 2026-09-02):

| Clause | Status |
|---|---|
| No quest UI | Covered: design §13.1 deletes `QuestPanel`, `questDefinitions.jsx`, claim/fanfare UI; only the invisible milestone ledger survives (credits grants, achievements, analytics). |
| Just a Help button that toggles | Covered: T8120 shipped the chip; T7630 replaces what it opens (`HelpChip` + `HelpPanel`, `guide_enabled` gesture-written). |
| Historical activity + current screen decide | Covered, it is the design's spine: `deriveFacts` = 24 server milestone booleans + screen + screen-local state + durable intent; `GUIDANCE_MAP` is a first-match lookup. "History" means the milestone ledger, not raw telemetry. |
| More than one option, e.g. game vs clip | Covered: fork F1 (durable `guide_intent_source`), the design's headline example; its pre-cut branch target `clips-add-video` is live since T8370/T8380. |
| **Default on for new users** | Partial: D1 = ON for accounts that have not yet published, OFF for accounts that have. If "default on" means unconditionally, D1 needs a one-line amendment. **Decision needed.** |
| **"Essentially forcing the user to click one of their options"** | **Conflict**: the design (§7.3, D2/D4) and this epic's binding evidence constraint #2 keep an always-present "Not now" and forbid the shade acting as a lock (skippable tours complete ~25% better; ~70% skip imposed ones). Forcing = removing "Not now" (or demoting it to Help-off only). **Decision needed**; never reintroduce backdrop-close semantics either way. |
| **"Spelling out the implications of each option"** | Small delta: fork dialogs are one sentence + bare answer labels (§8.2). Extend answers to `{value, label, caption}` using the shipped `FOCUS_PUBLISH` / `OVERLAY_PUBLISH` consequence-caption pattern; widen `steps.copy.test.js` word budgets and re-check `placement.test.js` at 320px / keyboard-open. Recommend yes. |
| **Re-film tutorial videos, accessible from tutorial and site** (separate ask) | **Conflict** with the 2026-08-31 directive above ("No more tutorial videos", videos removed as a mechanism) and design §12/§20 retiring `TutorialVideoModal.jsx` in T7630. Outcomes in [T10320](../T10320-reshoot-tutorial-videos-v3.md): (1) landing-only reshoot, or (2) videos return in-app via the Help panel and T7630 keeps the modal. **Decision needed before T7630 deletes the player.** |

**Rulings (user, 2026-09-17), binding on T7630 and superseding the conflicting lines above:**

1. **Fully guided when ON.** No per-step "Not now". The escape is closing Help, which must be one
   obvious tap, always visible, and re-openable at any time from the same place. This amends
   evidence constraint #2 and design D2/D4: the "skippable" property is satisfied by the toggle, not
   by a per-step dismiss. The shade still never acts as a backdrop-close.
2. **Not always one choice.** Forks with several options are expected (game video vs. clip at the
   start). The guide derives what to show from WHERE the user is and WHAT they have done, and should
   ANTICIPATE the likely next intents and explain each one, not only the single next click.
3. **Default ON until the first EXPORT** (not "published" as D1 said): on for anyone who has not
   exported a clip or reel yet, off for anyone who has; an explicit toggle pins forever.
4. **Consequence captions on fork options**: yes, `{value, label, caption}` using the shipped
   `FOCUS_PUBLISH` / `OVERLAY_PUBLISH` pattern.
5. **Tutorial videos return in-app as well as on the site** (amends the 2026-08-31 "no more videos"
   directive). Entry point: the Help panel ("Watch the walkthrough"), never the retired quest steps.
   T7630 therefore keeps `TutorialVideoModal.jsx` / `tutorialVideos.js` alive and re-mounts them from
   `HelpPanel`; the reshoot itself is [T10320](../T10320-reshoot-tutorial-videos-v3.md).
6. **Sequencing**: the essential-path core (T7630 re-scoped, T7640) is worked LAST in the Deploy
   Candidate, after every other task is implemented and the UI has been approved by the user,
   because guided mode must anchor to final screens. The videos shoot after guided mode ships.
   The advanced tier and cleanup (T10330) follow in the next iteration.

Also found: every one of the design's 69 rules carries `say` copy written in T8130-era vocabulary
("Add Play", "Highlight Reels", "Focus"); T9860 (2026-09-14) and the Deploy Candidate copy tasks
(T10280/T10290) changed most of those nouns. T7630 must re-derive all step copy and target
literals from `displayNames.js` at implementation time, not from the design text.

Sequencing inside the Deploy Candidate: T7630 starts only after EVERY other milestone task is
implemented and the UI approved (ruling 6 above); T10320 (videos) shoots after guided mode ships.

## Design constraints

- Motion is core product value (animation polish direction memory): the arrow bounce and
  shade transitions deserve real motion design, `prefers-reduced-motion` respected.
- The engine anchors to real DOM elements: it needs a robust target registry (stable
  data-tutorial-target attributes, NOT brittle selectors), a scroll-into-view step
  advance, and re-anchoring on resize/route change.
- Steps advance on the SAME gestures the app already persists; the tutorial itself
  writes nothing except its own on/off preference and current-step bookmark.
- Quest UI: the existing quest system remains for post-tutorial goals, but the
  tutorial's essential path replaces quest_1's watch-video steps; reconcile with the
  quest definitions rather than running two competing guides (design call in T7620).
  **T8690 (SHIPPED 2026-09-04) already hid the quest_1-4 "Watch tutorial video" steps
  behind `TUTORIAL_VIDEOS_ENABLED=false` (code kept) — so the watch-video steps are
  already gone from the UI; reconciliation is now about the remaining quest steps vs the
  guided tour, not re-retiring videos.**
- Tutorial assets contract (assets.reelballers.com) is largely obsolete for the tutorial:
  the 2026-08-31 directive retired the videos as the primary mechanism AND T8690 has now
  turned the in-app watch-video steps off. Any remaining video use is optional-reference
  only.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T7620 | [Architect design: guided-tour engine + step definitions](T7620-guided-tour-design.md) | TODO |
| T7630 | [Implement engine + essential-path steps](T7630-guided-tour-implementation.md) | TODO |
| T7640 | [Screen-size matrix verification + quest reconciliation + rollout](T7640-screen-size-matrix-rollout.md) | TODO |
| T10330 | [Next iteration: post-publish advanced tier, remaining forks, ledger cleanup](T10330-guided-mode-advanced-tier-and-cleanup.md) | TODO |

**Split 2026-09-17 (user order):** T7620 + T7630 (re-scoped to the essential-path core) + T7640 ship in the
Deploy Candidate milestone; T10330 holds everything the next deploy does not need and runs in the
following iteration. The epic completes when T10330 lands.

## Sequencing

After ALL P1 bug fixes, explicitly: the guided path walks users straight into upload and
clip-save, so shipping it while uploads fail (T7480), failed uploads destroy work
(T7470), Save can dead-end (T7540), and the mobile entry point is broken (T7590) would
guide users INTO the walls. T7580's "Create Reel" language should also land first so the
tutorial and the chrome say the same words.

## Completion Criteria

- [ ] New user with tutorial on is walked element-by-element to a published reel
- [ ] Toggle off/on works and persists; default on for new accounts
- [ ] Verified at 320/375/428/768/1280px, mobile keyboard open/closed, reduced motion
- [ ] Quest UI reconciled (no competing guidance)
