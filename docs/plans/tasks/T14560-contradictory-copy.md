# T14560: Contradictory copy

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

Copy that tells the parent something false:

1. "For longer footage, use Add Game instead." / button "Add Game instead" / "Tap Add Game instead" point to a button that is labeled **Upload game** (`src/frontend/src/config/displayNames.js` ~457-479, ~819; also `src/backend/app/routers/games_upload.py` ~248).
2. "Looks good? Tap Finish to get your link." (`displayNames.js` ~798), but Finish only moves the highlight to the finished tab; it creates no link.
3. "Share plays" (`displayNames.js` ~241) shares the whole game video plus every marked play (its own disclosure at ~256 says so). The guide line "Tap Share plays to send them to your athlete" (~733) is also wrong about who receives it.
4. Landing home page says "Three steps" (`src/landing/src/pages/index.astro:49,207`); How it works says "Four steps" (`how-it-works.astro:87`); `llms.txt.ts` says "the three-step process".
5. Tagline "...in minutes..." (`src/landing/src/site.ts:27`, duplicated in `ProjectManager.jsx` ~1627 and `SignInScreen.jsx` ~66) vs the FAQ "roughly the length of the game" for marking.
6. "1 credits added to your balance!" (no singular) in `App.jsx` ~352 and `ExportButtonContainer.jsx` ~1108; "Your credit has been refunded" always singular (~957).
7. "Finish removing" / "Finished removing" (`hooks/useMoveReels.js`) reuses the Finish verb for removing from a profile.

## Solution

1. "Use Upload game instead." everywhere (frontend and backend detail).
2. "Looks good? Tap Finish, then Share to get a link." (match the actual Share control label).
3. Button "Share game"; guide line "Tap Share game to send the game and your plays to family or coaches."
4. One step count on every landing page: four steps (Upload game, Mark plays, Frame and spotlight, Share). T14650 rewrites the step names; this task fixes the count only.
5. Tagline: "...a highlight in minutes once you've marked your plays" or drop "in minutes". The tagline is also a marketing decision (memory: tagline set 2026-10-19), so **propose the wording to the user before changing it**.
6. One plural helper for credits; use it for added, refunded and cost lines.
7. "Remove from this profile" / "Removed".

## Context

### Relevant Files
Listed above. Glossary: [copy-vocabulary/EPIC.md](copy-vocabulary/EPIC.md).

## Implementation

1. [ ] Failing tests for 1, 2, 3, 6 (app strings)
2. [ ] Fix app and backend strings
3. [ ] Fix landing step counts; propose tagline wording to the user (WAITING ON USER for that line only)
4. [ ] Relevant tests + lint + landing build

## Acceptance Criteria

- [ ] Every instruction names a control that exists with that label
- [ ] "Share" labels say what is actually shared
- [ ] One step count across the landing site
- [ ] "1 credit" / "N credits" everywhere
- [ ] Tests pass
