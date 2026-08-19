# T5510: Invite, Status Page, Join + No-Video Annotate UX

**Status:** TODO
**Impact:** 8
**Complexity:** 7
**Created:** 2026-07-19
**Updated:** 2026-08-19

## Problem

T5500's backend exists but there is no way to invite other cameras, see a pool's status
from a texted link, join it, or work with a game that has no video yet. The normative
screen-by-screen spec is [UX-SPEC.md](UX-SPEC.md) §§1-4b — this task implements those
surfaces exactly (copy, classes, states, and gesture→write tables are all specified there;
do not re-design).

## Solution

Frontend only (T5500's endpoints are the contract):

1. **Entry point: inside the Share game modal ONLY (§1.1).** No new kebab item, no
   post-upload toast. `ShareGameModal.jsx` gains one block ("Another parent filmed this
   game?" + "Invite their camera" cyan button) below General access. This is the single
   pool-related surface a basic user can ever encounter (progressive-disclosure ladder).
2. **Invite sheet (§1.2).** "Invite other cameras" modal: explainer, game summary,
   storage note, **"Who is this link for?" segmented control — `Anyone` (DEFAULT,
   one-tap copy) | `My team` | `The other team`**. Selecting The-other-team with no team
   fact reveals the required "What's your team called?" input — the Copy/Share click
   saves it to the sharer's profile fact AND the pool side in the same gesture. Pool +
   link are created by the FIRST Copy/Share click (T7150 rule: never on modal open).
   States: no pool / exists ({n} of 50 joined) / at cap 50 / create failed / no video yet.
3. **Share-first (§1.3).** The link can exist before any video: an `awaiting video` game
   (T5495) shares from the same §1.1 block or the §4b panel; the pool is created by the
   share gesture, never as a side effect of deferring an upload.
4. **Public pool status page `/pool/{token}` (§2).** SharedAnnotationView state-machine
   idiom: brand lockup, game card, camera status list showing **kinds and counts, never
   member names** (uploaded ✓ / uploading pulse / joined-no-camera summary / dashed
   "You" row), one CTA per auth state (Sign up to join / Join this game / Open in your
   library for existing members — no confirm re-run), revoked/full/no-cameras/error
   states, `SharePageInstallBanner` + `GoogleOneTap`. Page title/OG carry the game title
   only (privacy). NUF suppression sessionStorage flag (T5330b precedent).
5. **Join confirm (§3).** Card, not the Add Game modal: profile block FIRST
   (multi-profile chips, no default / single-profile display row / **new-account =
   profile creation inline**, sport prefilled from the pool snapshot), display-only date,
   **"Which team are you with?"** segmented control pre-answered by the link's side tag,
   opponent prefill per side, consequence block (visibility + who pays until when),
   derived-name preview updating live. One write: the Join click. Success → straight
   into Annotate on the new game.
6. **Pool tile states (§4).** `GameTile.jsx`: pool chip (count, cyan new-camera dot,
   uploading pulse — all derived from `created_at`/`last_opened_at`, no new persisted
   state), "Add camera" action chip (persistent, 44px, `data-pool-upload` guard), kebab
   rows for pool games only (Invite more cameras / Manage cameras / Shared game info —
   recompute the flip-aware menu height), **No-video tile state** (placeholder + Upload
   video chip + "invite link live — no video yet" scrim line).
7. **No-video Annotate setup panel (§4b).** Opening an `awaiting video` game lands in
   Annotate; the video area renders the setup panel (bug-27p `AnnotateModeView` panel
   precedent): "No video yet" + Upload video + Copy game link, status line refreshed by
   the live-sync poll, upload-progress state with Cancel. Swaps to the player in place
   when the first feed activates — no reload. (The panel itself ships with T5495; this
   task adds the pool-aware share action + joined-count status line.)

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ShareGameModal.jsx` — §1.1 block; link lifecycle + `RevokeConfirmDialog` patterns reused
- NEW `src/frontend/src/components/InviteCamerasModal.jsx` (§1.2 sheet) + `sharePoolInvite(url, text)` helper (extract the `navigator.share`-vs-clipboard branch — `useWebShare` is hardwired to `downloadId`, don't force-fit)
- NEW `src/frontend/src/screens/PoolStatusPage.jsx` (§2) + `PoolJoinConfirm.jsx` (§3); route `/pool/{token}` in `src/frontend/src/App.jsx`
- `src/frontend/src/components/GameTile.jsx` — §4 chips, kebab rows, no-video state
- `src/frontend/src/modes/AnnotateModeView.jsx` — §4b pool-aware panel additions
- `src/frontend/src/stores/gamesDataStore.js` — pool state selectors (fetched, never persisted view state)
- `src/frontend/e2e/` — NEW spec: share→copy→status→join (two users)

### Related Tasks
- Depends on: T5500 (all endpoints), T5495 (reworked Add Game modal + awaiting-video state + §4b panel)
- Blocks: T5520 (Add-camera chip routes into the §5 pool upload variant)
- References: [EPIC.md](EPIC.md) decisions 6, 8, 9 (derived names, progressive disclosure, vocabulary); UX-SPEC § Conventions (feed colors = member_index-keyed initial badges; modal shell; copy-link lifecycle)

### Technical Notes
- Knowledge docs: [annotate.md](../../../../.claude/knowledge/annotate.md), [backend-services.md](../../../../.claude/knowledge/backend-services.md)
- UX-SPEC is the design doc — no UI Designer pass needed; deviations require spec change,
  not improvisation. Vocabulary is absolute: camera/clips/shared game/line up; never
  feed/pool/sync in copy
- Auth round-trip: token in the URL path is the state carrier; after auth either the §3
  confirm renders or deferred resolution already joined — handle both (join is idempotent
  by T5500 contract)
- Gesture→write tables in §1.2/§2/§3/§4 are normative: modal opens, chips, and status
  pages write NOTHING; the only writes are first-Copy (pool create + optional team-name),
  later-Copy (idempotent link read), and Join
- E2E: real-auth helper (`e2e/helpers/realAuth.js`) + two test users (A shares, B joins
  signed-in, B' via signup); real-browser verification of navigator.share fallback and
  the mobile status page

## Implementation

### Steps
1. [ ] §1.1 block + §1.2 invite sheet (Anyone default, side tags, team-name capture, cap/error states)
2. [ ] §2 status page + route (all auth states, privacy rules, revoked/full states)
3. [ ] §3 join confirm (profile binding incl. new-account creation, side derivation preview)
4. [ ] §4 tile chips + kebab rows + no-video state; §4b pool-aware panel additions
5. [ ] E2E two-user flow + signup-claim flow + revoked link; real-browser mobile pass

## Acceptance Criteria

- [ ] A basic (non-pool) user sees zero new chrome anywhere except the §1.1 block inside a modal they opened — audited against the ladder, not asserted
- [ ] `Anyone` link copies in one tap; side-tagged links pre-answer §3's team question; missing team name is captured once and prefills cross-team joiners' Opponent
- [ ] Status page renders kinds/counts only (no names pre-join) and behaves per the §2 state table for all auth/cap/revoked states
- [ ] Join binds a profile (creating one for new accounts), previews the derived name live, and lands the joiner in Annotate
- [ ] Pool tiles show count/new/uploading/no-video states with no new persisted state; awaiting-video games share and upload from the §4b panel
- [ ] E2E specs pass; real-browser verification done
