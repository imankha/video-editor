# T17840: Old multi-play highlights should say plainly they are not supported

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-19
**Updated:** 2026-11-19

## In plain words

Highlights made from several plays in the old editor can no longer be edited. That is intended and stays (owner, 2026-11-19: keep them frozen, no split migration). What is wrong is how we say it. On Home, under "Earlier highlights", such a highlight looks like an editable draft: it has an "In progress" badge and a pencil button. Clicking it pops a 30-word toast that disappears after 5 seconds and still calls the editor "Focus". The owner hit this testing staging and could not tell why the highlight could not be edited.

## Ruling

Owner, 2026-11-19: keep old multi-play highlights frozen. Make the communication clearer: say that highlights made from several plays are no longer supported. Less wordy in the toast, clearer on screen.

## Repro

1. On staging, sign in to an account that has a highlight made from several plays in the old editor (the card shows a stack badge with a count above 1, e.g. "5", in "Earlier highlights" on Home).
2. Note the "In progress" badge and the pencil button on the card.
3. Click the card or the pencil. A toast reads: "This highlight was made from multiple plays and can no longer be re-edited in Focus. You can still add a Spotlight, finish, and download it." It auto-dismisses after 5 seconds.

## Solution

- On screen: the "Earlier highlights" section and each card in it state plainly that highlights made from several plays are no longer supported for editing, at a glance and without clicking. The card must not look editable: no pencil edit affordance and no "In progress" badge that implies it can be finished in the editor. Keep what still works visible (watch, download, share, and adding a Spotlight if that path really still works; check it).
- Toast (for any route that still reaches the refusal, e.g. the header Frame tab): short, one sentence, along the lines of "Highlights made from several plays are no longer supported." No "Focus". Long enough on screen to read.
- Copy rules: say "plays" and "highlight", never "clip" or "multiclip"; no em dashes; never the retired name "Focus" (T9860).
- Copy lives in `src/frontend/src/config/displayNames.js` (HOME_TILE.EARLIER_GROUP / EARLIER_NOTICE) and `src/frontend/src/utils/reelReEditable.js` (LEGACY_MULTICLIP_REFRAME_MESSAGE). No backend change; the refusal rule itself (`canReEditReel`, `allowEnterFraming`, backend restore-project refusal) stays as is.

## Relevant Files

- `src/frontend/src/utils/reelReEditable.js`
- `src/frontend/src/config/displayNames.js`
- `src/frontend/src/components/ProjectManager.jsx` (the "Earlier highlights" section, `data-testid="legacy-reel-drafts"`)
- `src/frontend/src/components/DraftTile.jsx` (card badge and pencil)

## Acceptance Criteria

- [ ] C1: On Home, a highlight made from several plays shows, without any click, text saying highlights made from several plays are no longer supported for editing; its card shows no pencil edit button and no "In progress" badge.
- [ ] C2: Any remaining refusal toast is one short sentence (at most 12 words), never says "Focus" or "clip", and stays on screen at least 6 seconds.
- [ ] C3: Watching, downloading and sharing such a highlight still work from Home, and single-play drafts keep their "In progress" badge and pencil exactly as before.
