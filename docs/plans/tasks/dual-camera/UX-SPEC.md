# Game Pools (Multi-Feed Shared Games) — UX Specification

**Status:** DRAFT — revised after design review; awaiting user approval
**Scope:** UI only. Architecture (Postgres pool coordination object, per-member private game
rows, wall-clock offsets, rent-based storage) is settled — see [EPIC.md](EPIC.md).

> **Supersedes EPIC.md where they differ** (member cap, feed count, "name" field, rent
> model, entry points): this spec follows the revised design — up to 50 contributors,
> clips-as-feeds, derived game names, per-feed rent after the uploader's first 30 days.
> **Reconcile EPIC.md with this spec at approval time** (do not treat EPIC.md flows as
> current until then).

---

## Conventions Used (read first)

Every proposal below is grounded in an existing component or a rule from
[.claude/references/ui-style-guide.md](../../../../.claude/references/ui-style-guide.md).

### Vocabulary

| Spec term | UI copy term | Why |
|-----------|--------------|-----|
| **pool** | "shared game" | "Pool" is internal; parents understand "shared game". |
| **feed** | "camera" (full/half uploads) or "clips" (short phone videos); "angle" allowed in explanatory copy | "Feed" is jargon and never appears in UI copy. Camera/clips/angle are held **absolutely** — no synonyms. |
| **Main** | "Main" (the resolved default camera over time) | Named **Main** (`Star` glyph) until T5560 lands; planned rename to "Auto" with the `Wand2` glyph when auto-editing ships. |
| **reference feed** | (never shown) | Internal: slot-0 creator's feed, defines wall-clock 0. |
| **offset alignment** | "line up" (actions and states) | "Sync" appears in exactly ONE string: the auto-success banner ("Auto-synced by sound…"). Everywhere else: "line up", "lined up", "not lined up yet". |

### Surface idioms reused

| Idiom | Source of truth | Used by sections |
|-------|-----------------|------------------|
| Modal shell: `fixed inset-0 z-50`, **inert** `bg-black/70 backdrop-blur-sm` backdrop (never closes on click), `bg-gray-800 rounded-xl border border-gray-700 max-w-md mx-4`, **`max-h-[90dvh] flex flex-col` with the body region `overflow-y-auto`** (headers/footers never scroll away), header icon chip `p-2 bg-{color}-600/20 rounded-lg` + `text-lg font-semibold` title + X button | `GameDetailsModal.jsx`, `StorageExtensionModal.jsx` | 1, 3, 5, 7, 9, 10 |
| Segmented control: `flex gap-2`, buttons `flex-1 px-3 py-2 rounded-lg text-sm font-medium`, active `bg-green-600 text-white`, inactive `bg-gray-700 text-gray-300 hover:bg-gray-600` | `GameDetailsModal.jsx` (Game Type / Video Format) | 3, 5 |
| Form inputs: `bg-gray-900 border border-gray-600 rounded-lg`, `focus:border-green-500 focus:ring-1 focus:ring-green-500`, date inputs add `[color-scheme:dark]` | `GameDetailsModal.jsx` | 3, 5 |
| Dashed dropzone with drag/selected states | `GameDetailsModal.jsx:427-455` | 5 |
| Cost/balance row: `px-3 py-2 rounded-lg bg-gray-700/50 text-gray-300` + `Coins size={14} className="text-yellow-400"` + `Balance: {n}` right-aligned; `BuyCreditsModal` lazy fallback when short | `GameDetailsModal.jsx:509-517`, `StorageExtensionModal.jsx` | 5, 9 |
| Kebab menu: single `MoreVertical` button top-right, portal popover `w-44 bg-gray-700 border-gray-600 rounded-lg` flip-aware on desktop, bottom sheet `rounded-t-2xl` + grabber on mobile, items `px-4 py-3 text-sm gap-3`, destructive items red with **two-tap confirm that keeps the menu open** | `GameTile.jsx:276-317`, `ReelTile.jsx` | 4, 10 |
| Copy-link button lifecycle: create link **only on the explicit Copy/Share click** (T7150 lesson — never on modal open or toggle), `Link2` → spinner → `Check` "Copied" for 2s, toast on success | `ShareGameModal.jsx:264-292`, `CollectionShareModal.jsx:88-100` | 1, 10 |
| Native share: `navigator.share` gated to mobile capability, clipboard fallback | `useWebShare.js` (URL-share path) | 1 |
| Destructive confirm dialog: nested `z-[60]` dialog with `AlertTriangle text-red-400`, inert backdrop, Escape closes the confirm first | `ShareGameModal.jsx:151-179` (RevokeConfirmDialog) | 10 |
| Public landing view: state machine (`loading/ready/error`), `Logo` lockup, deferred claim after auth, `SharePageInstallBanner`, `GoogleOneTap` | `SharedAnnotationView.jsx`, `SharedCollectionView.jsx` | 2 |
| Timeline lanes: label column cells `flex items-center justify-center border-r`, selected-layer ring `bg-green-900/50 ring-1 ring-inset ring-green-500`, `EDGE_PADDING` positioning formula for ALL markers, Pointer-Events drag with `setPointerCapture` + 44px coarse hit boxes | `AnnotateTimeline.jsx`, `ClipRegionLayer.jsx`, `TimelineBase.jsx` | 6 |
| Chips: `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold`, expiry style `bg-yellow-900/70 text-yellow-300` | `GameTile.jsx:269-274` | 4, 6, 9 |
| Buttons | `shared/Button.jsx` — `success` (green) for game-creation actions, `cyan` for sharing actions, `ghost`/`secondary` for cancel, `danger` for destructive | all |
| Mobile detection | `useIsMobile()` (width < 1024 OR coarse pointer — NEVER the `sm` breakpoint; T4933 landscape-phone landmine) and `useIsCoarsePointer()` for touch-target floors | 6, 7, 8 |

### Feed color system (new — `src/frontend/src/modes/annotate/constants/feedColors.js`)

Cyan `#06b6d4` (My Athlete) and amber `#f59e0b` (Team) are **taken** by the clip lanes
(`ClipRegionLayer.jsx:73-76`) and must never identify a feed. Feed colors are assigned
**deterministically by the pool `member_index`** (join order — stable across all members'
devices, so "Sarah is violet" is true for everyone):

```js
// Deterministic per-feed accents. Index = pool member_index % 4.
// Never cyan/amber (clip lanes), never green (selection/success), never
// blue-500 (playhead layer), never red (errors), never yellow (expiry/credits),
// never lime (too close to selection green) or rose (too close to error red).
export const FEED_COLORS = [
  '#8b5cf6', // violet-500 — member 0 (creator / reference feed)
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
];
export const MAIN_COLOR = '#e5e7eb'; // gray-200 — the Main track is a composite, no hue
```

With up to 50 contributors colors repeat at index 4+. That is acceptable **because color is
never the sole signal** (T6400 rule): the feed "dot" is actually an **initial badge** —
`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white`
in the feed color, rendering the owner's first initial — so two violet feeds still read
"S" vs "M" at a glance. Every feed surface additionally pairs the badge with the owner's
name, and every feed element carries an `aria-label` naming the owner. A member's own feed
is additionally labeled "You".

### "Camera unavailable" — ONE treatment, everywhere

Whenever a camera cannot play for this member — expired for them, removed by its owner,
or source reclaimed — every surface uses the same treatment: content `grayscale
opacity-40`, `Lock size={12-14} className="text-yellow-400"` beside the label, and text
naming the reason (`expired for you` / `removed` / `no longer available`). Used by §6
lanes, §8 picker tiles, §9 checklist rows. The export-side warning is likewise ONE string
(§8): *"This clip's camera isn't available — it will export from Main."*

### Progressive-disclosure ladder (hard requirement)

| User | What they see |
|------|---------------|
| Basic user (no pool) | **Zero new chrome — literally.** No lanes, no picker, no chips, no new kebab items, no toasts. The only pool-related pixels a basic user can ever encounter are one block *inside* the Share game modal they already chose to open (§1.1). |
| Pool member, only 1 feed exists | Game tile shows the pool chip + "Waiting for cameras" state. Annotate is **completely unchanged** (one feed = nothing to pick). |
| Pool member, 2+ feeds | Camera lanes (desktop) / camera chip (mobile) + per-clip picker appear. |
| Advanced | Offset drag, ± nudge, replace link, remove camera — all behind the unaligned badge or the Manage cameras sheet. Never at rest in the main UI. |

---

## 1. Create / Invite Entry Points

### 1.1 The ONLY entry point: a block inside the Share game modal

There is **no new kebab item and no post-upload toast**. The invite lives where sharing
already lives: the existing Share game modal (`ShareGameModal.jsx`) gains a second block
below "General access", separated by `pt-4 border-t border-gray-700`:

1. Heading, `text-sm font-medium text-gray-200`: **"Another parent filmed this game?"**
2. One-liner, `text-xs text-gray-500`: *"Invite their camera and everyone gets every angle."*
3. `<Button variant="cyan" icon={Video} size="sm">Invite their camera</Button>` — opens
   the invite sheet (§1.2).

For a game already in a pool the button label becomes **"Invite more cameras"** and opens
the same sheet. The block inherits the Share game modal's own gates (it never opens for
expired games), so no new gating logic is needed. Nothing else on the tile, kebab, or
upload flow changes — the basic-user ladder cell above is literally true.

**Gestures → writes.** Opening the Share game modal and clicking "Invite their camera"
write **nothing** (they open UI). All writes live in §1.2.

### 1.2 Invite modal (share sheet)

**Layout.** Modal shell per conventions (max-w-md, `rounded-xl`). Header icon chip:
`bg-cyan-600/20` + `Video size={20} className="text-cyan-400"` (cyan = sharing family).
Title: **"Invite other cameras"**.

Body, top to bottom:
1. Explainer paragraph, `text-sm text-gray-300`:
   *"Anyone with the link — parents from both teams — can add their camera or phone clips
   to this game. Everyone who joins sees every camera."*
2. Game summary line, `text-xs text-gray-500`: `{game.name} · {date}` (read-only — nothing
   to type; the pool inherits this game's metadata and binds it as the reference feed).
3. Storage note, `text-xs text-gray-500` with `Coins size={12} className="text-yellow-400"`:
   *"Your storage credits cover everyone's access for the first 30 days."*
4. Link row — exact `ShareGameModal` "General access" pattern (`ShareGameModal.jsx:446-459`):
   - Mobile (`useWebShare().capability !== NONE`): primary `<Button variant="cyan" icon={Share2}>Share link</Button>`
     → `navigator.share({ title, text, url })` with prefilled text (see Copy). Secondary
     `<Button variant="ghost" icon={Link2}>Copy</Button>`.
   - Desktop: primary `<Button variant="cyan" icon={Link2}>Copy link</Button>` →
     clipboard + `Check`/"Copied" swap for 2s + toast.
5. Footer: `<Button variant="ghost">Done</Button>` right-aligned.

**Components reused.** Modal shell (`GameDetailsModal`), link lifecycle (`ShareGameModal.handleCopyLink`),
`useWebShare` URL-share capability gating (extract the `navigator.share`-vs-clipboard branch
into a `sharePoolInvite(url, text)` helper — `useWebShare` is currently hardwired to
`downloadId`, don't force-fit it), `toast`.

**States.**
| State | Appearance |
|-------|-----------|
| No pool yet | Buttons as above; the pool + link are created by the first Share/Copy click (spinner in-button: `Loader size={14} animate-spin` + "Creating link…"). |
| Pool exists | Same modal; the click returns the existing link (idempotent, like game share-link). Explainer line 1 appends: *"{n} of 50 cameras joined."* |
| **At cap (50 cameras)** | Copy/Share buttons **disabled**; inline `text-sm text-yellow-300` under the link row: *"This game has all 50 cameras. Remove one in Manage cameras to invite another."* |
| Create failed | `text-red-400 text-sm` inline error under the link row: *"Couldn't create the link. Check your connection and try again."* Button stays enabled for retry. |

**Copy (exact strings).**
- Title: `Invite other cameras`
- Prefilled share text: `Join my Reel Ballers game: {game.name}, {date} — add your camera and everyone gets every angle. {url}`
- Copy success toast: `Invite link copied — text it to the other team's camera parent`

**Gestures → writes.**
| Gesture | Write |
|---------|-------|
| Click "Copy link" / "Share link" (first time) | `POST /api/pools` `{game_id}` → creates pool + invite token, binds this game as the reference feed, **snapshots the creator's sport into the pool** (feeds §3's new-account profile creation). **The only write in this flow.** Opening the modal writes nothing (T7150 rule). |
| Click again later | `POST /api/pools/{id}/link` idempotent read-or-return; no new state. |

**Accessibility.** Buttons are real `<button>`s with visible text (no icon-only). Copied
state announced via the toast (toast component already renders `role="status"`). Modal
close is the X button + Escape only.

---

## 2. Public Pool Status Page (`/pool/{token}`)

This is a stranger's first impression — it reuses the public shared-view idiom
(`SharedAnnotationView.jsx` state machine + `SharedCollectionView` chrome) but is a
**status page, not a player**: there is nothing to watch without joining.

**Layout — desktop.** Full-viewport `bg-gray-900`, centered column `max-w-md w-full mx-4`:
1. Brand lockup at top (`LogoWithText` pattern, sign-in size: `Logo size={64}` +
   wordmark — style guide § Brand lockup).
2. Game card: `bg-gray-800 border border-gray-700 rounded-xl p-6`:
   - **Header:** `text-lg font-semibold text-white` — `{creatorTeam} vs {opponent}` when both
     team names are known; else `{game.name}`. Below: `text-sm text-gray-400` — `{weekday},
     {Month D, YYYY}` and creator's display name: *"Started by {firstName}"*.
   - **Camera status list** (`divide-y divide-gray-700/60 rounded-lg border border-gray-700`
     wrapper, rows `px-3 py-2` — the `ShareGameModal` "People with access" list idiom).
     **Pre-join, rows show kinds and counts — never member names** (this page is visible
     to anyone holding the link): 
     - Uploaded: neutral gray dot + `text-sm text-gray-200` kind + `Check size={14}
       className="text-green-400"` — `Full-game camera ✓`, `Phone clips (3) ✓`
     - **Uploading:** pulsing dot (`animate-pulse`) + `Camera uploading now`
     - Joined, no camera: one summary row — `{n} more parent{s} joined — no camera yet`
     - The viewer: last row, dashed-border style (`border border-dashed
       border-gray-600 rounded-lg`): `You — join to add your camera`
     Owner names (with feed color badges) appear only after joining, inside the app.
3. One CTA, full width: `<Button variant="success" size="lg" fullWidth>` (green = the
   game-creation family; this creates a game in their library).
4. Below CTA, `text-xs text-gray-500 text-center`: *"Free to join — you'll see every
   camera already uploaded. Adding your own is optional."*
5. `SharePageInstallBanner` (mobile) + `GoogleOneTap` (signed-out), exactly as
   `SharedAnnotationView` mounts them.

**Layout — mobile.** Same single column (it is already single-column ≤ max-w-md);
`p-4` page padding; CTA has the 44px floor from `size="lg"`.

**Components reused.** `Logo`, `Button`, `SharePageInstallBanner`, `GoogleOneTap`,
`apiFetch` state machine from `SharedAnnotationView.jsx:27-63`, status-row idiom from
`ShareGameModal`'s recipient list.

**States.**
| State | Appearance |
|-------|-----------|
| Loading | Centered `Loader className="animate-spin text-gray-400"` (SharedAnnotationView pattern). |
| Signed out | CTA label **"Sign up to join this game"**; directly beneath, `text-xs text-gray-500 text-center`: *"Already have an account?"* + **Sign in** text link (`text-gray-300 hover:text-white underline`). Both routes → auth flow → deferred claim → §3 confirm (the `pending_teammate_shares` / T2915 deferred-resolution rails; also set the `shared_annotation_flow`-equivalent sessionStorage flag so onboarding NUF stays suppressed on this route — T5330b precedent). |
| Signed in, not a member | CTA label **"Join this game"** → §3 confirm. |
| Already a member | **No confirm step.** CTA label **"Open in your library"** → `setPendingGame(gameId)` navigation + toast *"You're already in this game."* Status list marks their row "You ✓". |
| Link revoked/replaced | Error card (`AlertCircle text-red-400`): *"This invite link is no longer active. Ask the person who shared it for a new one."* |
| Pool full (50) | CTA disabled (`Button disabled`) + `text-sm text-yellow-300`: *"This game already has 50 cameras — the maximum."* |
| Fetch error | *"Could not load this game. Please try again."* + Retry ghost button. |

**Copy (exact strings).** As inlined above. Camera kinds: `Full-game camera`,
`Both halves`, `First half`, `Second half`, `Phone clips ({n})`.

**Gestures → writes.** None on this page (read-only status). The CTA navigates; the join
write happens in §3. Signed-out signup stores the token for deferred claim
(sessionStorage breadcrumb, the existing claim rails — not a DB write from this page).

**Accessibility.** Status glyphs pair with text (✓ is decorative, `aria-hidden`; the row's
accessible text carries "uploaded"/"uploading"/"no camera yet"). Page `<title>` and the OG
unfurl (stretch, per epic flow 2) carry the **game title only** — no date, no member
names or roster details leak into link previews.

---

## 3. Join Confirm Step

Shown after the CTA (and after auth for signed-out users). One small modal-sized card on
the same public-page background — not the full Add Game modal. Skipped entirely for
existing members (§2 "Already a member").

**Layout.** Card `bg-gray-800 border border-gray-700 rounded-xl max-w-md w-full p-4`.
Header: icon chip `bg-green-600/20` + `Gamepad2 text-green-400` (the Add Game family) +
title **"Add this game to your library"**.

Body, top to bottom:

**1. Profile block (first — the join MUST bind to a profile):**

| Account state | Profile block |
|---------------|---------------|
| Multiple profiles | Required chip row labeled **"Whose game is this?"** — one chip per profile (initial badge + name, segmented-control styling, wrap-friendly `flex flex-wrap gap-2`). **No default selection**; Join stays disabled until one is picked (helper `text-xs text-gray-500`: *"Pick the athlete this game belongs to."*). |
| Single profile | Display-only row (`text-sm text-gray-300` + `User size={14}` gray icon): **"Adding to {profileName}"**. Nothing to choose. |
| Brand-new account (just signed up from §2) | **The confirm step IS profile creation.** Two fields replace the chip row: "Athlete's name" text input (`autoFocus`) + the existing sport selector, **sport prefilled from the creator's sport** via the pool's sport snapshot (T2915 inherited-sport rails; the snapshot is written at pool creation — §1.2). Join creates the profile and joins in one gesture. |

**2. Mini-form** (labels/inputs byte-identical to `GameDetailsModal` styling):

| Field | Behavior |
|-------|----------|
| Game Date | Pool's date. **Display-only** — plain value row (`text-sm text-white` next to a `Calendar size={14}` gray label), NOT a disabled input. It's the same physical game. |
| **"Which team are you with?"** | Segmented control, two options: **`{creatorTeamName}`** (fallback label when the creator has no team fact: **`Same team as {firstName}`**) and **`The other team`**. **No default** — Join disabled until chosen. Same team → inherits the creator's game type AND opponent **verbatim**. Other team → **inverts** the game type (Home ↔ Away; Tournament stays Tournament) and prefills Opponent with the creator's team name. |
| Opponent Team | Text input, prefilled per the team-side choice above (editable; `autoFocus` when blank and a side is chosen). |

**3. Consequence block** — `bg-gray-900/50 rounded-lg p-3` with two `text-xs text-gray-400`
lines (icons `size={12}` gray, `aria-hidden`):
- `Video` — *"Any camera or clips you add are visible to everyone in this game."*
- `Coins` — *"Storage is covered by {firstName} until {date}. After that, each camera you
  keep costs credits."*

**4. Privacy note**, `text-xs text-gray-500`: *"This is your own copy — your clips and
reels stay private to you. You can edit these details anytime."*

**5. Preview line** above the confirm button (`bg-gray-900/50 rounded-lg p-3 text-sm`):
*"Will appear in your library as:"* + derived name `text-white font-medium`
(computed by the same derivation used everywhere: opponent/type/date — updates live as
the team side and opponent change).

Confirm: `<Button variant="success" size="lg" fullWidth>Join game</Button>`.
Secondary: `<Button variant="ghost">Cancel</Button>` (returns to the status page).

**Mobile.** Identical (already single-column, max-w-md).

**Components reused.** `GameDetailsModal`'s input/segmented-control classes, `Button`,
the existing sport selector, the derived-name helper (reuse, never re-derive locally
with different logic).

**States.**
| State | Appearance |
|-------|-----------|
| No profile picked (multi-profile) / no team side picked | Join disabled; helper text under the incomplete block. |
| Blank opponent | **Join still enabled** once profile + side are set (opponent is fixable later; the derived-name preview shows the date/type-only fallback the derivation already produces). |
| Submitting | Button `Joining…` + disabled form (GameDetailsModal `isSubmitting` idiom). |
| Join failed | Inline `text-red-400 text-sm` above the button: *"Couldn't join. Please try again."* |
| Success | Toast: *"Game added — {n} camera{s} ready to watch"*; if any feed is still uploading: *"Game added — {n} ready, {m} still uploading"*. Then `setPendingGame(gameId)` → straight into Annotate on the new game (the payoff moment). |

**Gestures → writes.**
| Gesture | Write |
|---------|-------|
| Click **"Join game"** | `POST /api/pools/{token}/join` `{profile_id \| new_profile: {name, sport}, team_side, opponent_name}` — the single write: creates the profile if needed, the member row, and the joiner's private `games` row (date from pool; game type derived from team side; derived name), registers existing feeds as references (`shared_by` provenance per epic decision 7). Chip taps, segmented-control taps and typing before Confirm are local state only. |
| Later edits | The existing Edit Game flow (pencil in the tile scrim) — already gesture-persisted; no new surface. |

**Accessibility.** The fixed date row has `aria-label="Game date: {date} (set by the shared
game)"`. Profile chips are a radiogroup (`role="radiogroup"` + `aria-checked`). Segmented
controls keep `type="button"`.

---

## 4. Game Card (Games Tab Tile) for a Pool Game

**Layout.** `GameTile.jsx` gains three additions, all gated on `game.pool_id` (a basic
user's tile renders byte-identical to today):

1. **Pool chip** — top-left, exactly the expiry chip's geometry
   (`GameTile.jsx:269-274`): `inline-flex items-center gap-1 px-2 py-0.5 rounded-full
   text-[10px] font-semibold bg-gray-900/70 text-gray-200 z-20` with `Video size={10}` +
   `{feedCount}`. When the expiry chip is also present, the pool chip stacks **below** it
   (`top-7 left-1.5` when `isExpired || isNearExpiry`, else `top-1.5`) — chips never overlap.
   - **New-camera signal:** when any feed's `created_at` > this member's `last_opened_at`
     for the game (both already stored — **no new persisted state**), the chip gains a
     cyan dot (`w-1.5 h-1.5 rounded-full bg-cyan-400`) and its `title`/`aria-label`
     becomes `Shared game — {n} cameras, {k} new`.
   - **Uploading signal:** while any feed is mid-upload, the chip's dot pulses
     (`animate-pulse`) and the `title` appends `, {m} uploading`.
   - Deliberate deviation from the brief's "pool indicator + feed count" as scrim content:
     the scrim is the minimal name/date/clip-count surface (T5681 decision, annotate.md
     § Games-tab surface) — a chip in the badge zone matches the established tile grammar.
2. **"Add camera" chip** — only when the member has NOT contributed a feed AND the pool
   has ≥1 other feed: a second badge-zone chip stacked directly below the pool chip, same
   chip geometry but action-styled: `bg-cyan-600/90 hover:bg-cyan-500 text-white` with
   `Upload size={10}` + **"Add camera"**. It is a real `<button>`; on coarse pointers it
   carries `min-h-11` via a transparent hit-area extension (`before:` pseudo or padding —
   the visible chip stays chip-sized). Persistent (never hover-gated — discoverability
   rule, T5910/T6300). Opens §5. Tapping it must not trigger the tile's primary open
   (`data-pool-upload` guard, same pattern as `data-game-edit`).
   `aria-label="Add your camera to this shared game"`.
3. **Kebab items** (in the `actions` array — pool games only; non-pool games get NO new
   kebab rows):
   - `Invite more cameras` (`Video` icon) — reopens the §1.2 sheet (re-share link).
   - Creator: `Manage cameras` (`Users` icon) — opens §10 sheet.
   - Non-creator members: `Shared game info` (`Users` icon) — opens §10 sheet (member
     variant; "Stop sharing this game" lives inside it, not at top level).
   - **Implementation note:** the kebab popover's flip-aware desktop positioning uses a
     measured/estimated menu height — it must be **recomputed with the added rows** or
     the flip math will clip near viewport edges.

**Mobile.** Identical (GameTile is already responsive; the kebab bottom sheet carries the
new rows automatically).

**Components reused.** `GameTile` chip/kebab/scrim structures verbatim; `Upload` icon.

**States.**
| State | Appearance |
|-------|-----------|
| Pool, only own feed | Chip shows `1`; no Add-camera chip; nothing else changes. |
| Pool, others uploaded, member hasn't | Pool chip + "Add camera" chip. |
| Pool, member uploaded | Pool chip only. |
| New camera since last open | Cyan dot + `{k} new` in title (derived, see above). |
| Feed uploading | Pulsing dot + `{m} uploading` in title. |
| Feed(s) expiring | Existing expiry chip logic, but days reflect the **member's own rent state**; tile tap on an expired pool game opens §9 (per-feed checklist) instead of `StorageExtensionModal`. |
| Waiting (no other feeds yet, member is creator) | Chip shows `1`, `title` "1 camera — waiting for others"; no other chrome. |

**Copy.** Chip `aria-label`: `Shared game — {n} camera{s}` (+ `, {k} new` / `, {m}
uploading` when applicable). Action chip: `Add camera`.

**Gestures → writes.** None on the tile itself (chips are display/navigation; the kebab
opens surfaces that own their writes). The new-camera dot clears as a side effect of the
existing open-game gesture updating `last_opened_at` — no new write path.

**Accessibility.** Both chips pair icon+count/label with `title` + `aria-label` (color
never sole signal — the pool chip is neutral gray; the action chip has a text label).

---

## 5. Upload Binding — "Add Your Camera"

**Layout.** A trimmed variant of `GameDetailsModal` (same file, new `poolGame` prop —
reuse, don't fork). **When `poolGame` is absent, `GameDetailsModal` renders byte-identical
to today — zero diff for basic users.** When `poolGame` is set: title **"Add your
camera"**, header chip unchanged (`Gamepad2` green), and:

- **Hidden entirely:** Opponent Team, Game Date, Game Type, Tournament Name — they are
  pool-fixed / already set on the member's own game row. In their place, one read-only
  summary line `text-sm text-gray-400`: `{game.name} · {date}`.
- **Kept:** the "Video Format" segmented control, **extended to three options**:
  `Full Game | Per Half | Clips`. First two reuse the existing dropzones verbatim
  (`GameDetailsModal.jsx:411-505`).
- **New "Clips" variant:** the full-game dropzone with `multiple` file input. Selected files
  render as a list of rows (`text-xs text-green-400 truncate` name + size, X to remove —
  the half-file selected-state idiom, stacked). Helper text under the dropzone,
  `text-xs text-gray-500`: *"Short phone clips are fine — we'll line them up on the game
  clock for you, and flag any we can't match so you can line them up yourself."*
  (Honest promise: auto-alignment can fail; §7's short-clip variant is the fix path.)
- **Kept:** upload cost row + `BuyCreditsModal` gate, submit `Button variant="success"
  size="lg" fullWidth` → label **"Add Camera"** (or **"Add Clips"** in Clips mode).

Positioning metadata: none asked of the user. Creation-time metadata positions the feed
initially; audio sync refines it (§7 only if that fails) — the modal says nothing
about alignment (progressive disclosure).

**T7280 interplay:** a single short clip uploaded through the normal (non-pool) flow goes
straight to Framing. In the **pool** flow it instead becomes a clip-kind feed on the game —
same picker UI downstream; do not route pool clip uploads to Framing.

**Mobile.** Unchanged from GameDetailsModal (max-w-md modal already mobile-sized; dropzones
are tap-to-pick).

**Components reused.** `GameDetailsModal` (dropzones, cost row, submit lifecycle,
`BuyCreditsModal`), `calculateUploadCost`.

**States.**
| State | Appearance |
|-------|-----------|
| No file | Submit disabled (existing `isValid` logic minus the metadata fields). |
| Uploading | Existing submitting state ("Adding Camera…"). |
| Insufficient credits | Existing `BuyCreditsModal` intercept. |
| Upload failed | Existing error handling/toast. |
| Duplicate feed (member already has a camera-kind feed) | Entry CTA labeled "Add more clips" and Video Format locked to `Clips` (one full-game camera per member; clips unlimited). |

**Copy.** As inlined. Cost row unchanged: `{n} credit{s} for 30 days of storage`.

**Gestures → writes.**
| Gesture | Write |
|---------|-------|
| Click **"Add Camera"/"Add Clips"** | The existing upload/finalize flow (`games_upload.py` rails) bound to `{pool_id, member_index}`; finalize registers the feed in the pool with creation-time metadata for initial positioning. The one gesture, the one write path. |

**Accessibility.** Dropzones keep their `role="button" tabIndex={0}` + Enter/Space handlers
(`GameDetailsModal.jsx:428-431`). File-remove X buttons get `aria-label="Remove {filename}"`.

---

## 6. Annotate — Camera Lanes

The heart of the feature. Extends the T5700 two-lane precedent in `AnnotateTimeline.jsx`.

### Desktop layout

Row order inside `TimelineBase`, top → bottom:
1. Video track (unchanged).
2. My Athlete clip lane (unchanged).
3. Team clip lane (unchanged).
4. **Camera lanes** — only when the game's pool has **≥2 feeds** (1 feed = zero new chrome):
   - **Main lane** (first): label cell `text-gray-200` with `Star size={16}` + "Main"
     (`title`/`aria-label`: `Main · {currentOwnerName}`). Track shows the **resolved feed
     choice over time** as contiguous segments, each filled with the winning feed's color
     at 35% opacity (`{color}59`) with a solid 2px top border in the feed color — a "who
     wins when" map. **Segments wider than ~48px render the owner's first name**
     (`text-[9px] text-white/80 truncate px-1`). Precedence (clip stamp → preferred-camera
     spans → reference feed) is computed, never editable here.
     - **Preference-span strip:** directly under the Main segments, a thin `h-[3px]` strip
       marks each preferred-camera span in the preferred feed's color, with a `Pin
       size={10}` glyph (feed-colored, on a `bg-gray-900` chip) at each span start —
       preferences are always visible, never invisible state.
     - The Main lane carries `aria-label` listing the switch schedule:
       `"Main — Sarah's camera 0:00–12:40, Mike's camera 12:40–31:05, …"`.
   - **One lane per feed**, ordered by `member_index`, own feed first. Label cell:
     the owner **initial badge** (§ Feed colors) + owner first name (own = "You"),
     `text-xs truncate max-w-[72px]`. Track: **coverage bars** — `h-3 rounded-sm` blocks
     positioned with the shared `EDGE_PADDING` formula (never bare `%` — style guide
     § Positioning math), filled `{feedColor}` at 45% opacity, full opacity when this feed
     is the active one at the playhead. Gaps = `bg-gray-800` (track base). Clip-kind feeds
     render as short bars (they are just short coverage).
   - **ONE height model:** lane rows are `1.625rem` tall (label cells match) and
     `totalLayerHeight = 9.75rem + 1.625rem × min(feedLanes + 1, 3)` (the `+1` is the
     Main lane; at most 3 lane rows contribute height). With more than 2 camera lanes,
     the lane region becomes a scroll area of that fixed height: the **Main lane and the
     active feed's lane are sticky**, remaining lanes scroll beneath them, and a
     `+{n} more` hint (`text-[10px] text-gray-500`, right-aligned at the region's bottom
     edge) signals overflow.
   - **Short-viewport fallback:** whenever `window.innerHeight < 800` — regardless of
     pointer type — the lane stack does not render at all; the mobile active-camera chip
     (below) is used instead. One rule, no per-surface exceptions.

**First-use education (one coach-mark).** On the first render where `feedCount >= 2`, a
one-time coach-mark anchors to the lane stack (desktop) or the camera chip (mobile):
`bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-3 text-sm text-gray-200 max-w-xs`
— *"{name} added a camera. Tap a row to watch their angle at this moment."* +
`<Button size="sm" variant="secondary">Got it</Button>`. **The Got-it click is the
persisting gesture** (writes the dismissed flag to user prefs); no reactive writes. The
first time the Main lane renders, its label cell shows a one-line helper beneath the
coach-mark text: *"Main is the camera your game plays and exports from unless you pick
another."*

**Active feed indicator:** the active lane's label cell gets the selected-layer treatment
recolored to the feed (`ring-1 ring-inset` + `bg-{feed}/20` via inline style, mirroring the
green `clips` ring at `AnnotateTimeline.jsx:57-61`) — plus a small `Eye size={12}` icon.
The video area shows a transient camera chip on switch (top-left over video,
`bg-black/60 backdrop-blur-sm rounded-full px-2 py-0.5 text-xs text-white` — text over
video always on a backdrop): `● Sarah's camera`, auto-fades after 1.5s.

**Interactions (at rest — basic member):**
- **Tap a lane's coverage bar** → switch the *viewing* camera at the playhead (video swaps
  via the wall-clock mapping, playhead preserved). Tapping a gap shows the same transient
  over-video chip idiom: `No coverage here` (1.5s fade — tooltips don't exist on touch).
- **Tap the Main lane** → return to Main.
- **`C` key** cycles: Main → camera 1 → camera 2 → … → Main (skipping cameras with no
  coverage at the playhead; register in `useKeyboardShortcuts.js`).
- **"Prefer this camera from here" pill** — the ONLY preference gesture, and it lives at
  the player, not in a menu: while the watched camera differs from Main's current
  resolution at the playhead, a quiet pill overlays the player bottom-left, above the
  controls: `bg-black/60 backdrop-blur-sm border border-gray-600 rounded-full px-3
  py-1.5 text-xs text-gray-200 hover:text-white inline-flex items-center gap-1.5` with
  `Pin size={12}` + **"Prefer this camera from here"**. Coarse pointers: `min-h-11`
  (visible pill stays quiet; hit area extends transparently). On click: the preference
  span is written, the pill disappears (watched == default now), the Main lane's strip +
  pin update, and a transient chip confirms: `Main uses {name}'s camera from here`.
  There is **no lane context menu** — right-click/long-press on lanes does nothing.

**Advanced (behind the unaligned badge — never at rest):**
- **Unaligned badge:** a feed whose offset is unconfirmed shows `AlertTriangle size={12}
  className="text-yellow-400"` in its label cell + `aria-label` suffix "— not lined up
  yet". `title`: **"Not lined up yet — tap to fix"**. Clicking the badge opens §7.
  (Yellow = warning family; distinct from feed colors.) §7 is otherwise reachable only
  from Manage cameras → per-camera row (§10) — there is no other entry.
- **Unavailable lane** (expired/removed/reclaimed): the single "camera unavailable"
  treatment (§ Conventions) — grayscale bars + `Lock`; tapping the lane opens a
  mini-popover: *"Sarah's camera expired for you."* + `<Button variant="warning"
  size="sm">Renew — {n} credits</Button>` → §9 with that feed pre-checked.
- **Drag-lane-to-adjust-offset:** NOT active at rest (a drag at rest must scrub/select, and
  an accidental offset change corrupts shared state). Only inside **line-up mode**
  (entered exclusively from §7's "Adjust on the timeline" link): the lane's bars get
  `cursor-grab`, a dashed outline (`outline-dashed outline-1 outline-yellow-400/60`), and
  horizontal drag moves the feed's offset live (Pointer Events pattern: `onPointerDown` +
  `setPointerCapture` + `touch-none`, T5450). A floating confirm bar appears over the
  timeline (`bg-gray-800 border border-gray-700 rounded-lg shadow-xl px-3 py-2 flex
  gap-2`): offset delta readout (`ui-monospace text-sm`, e.g. `+1.24s`) +
  `<Button variant="success" size="sm">They're lined up</Button>` +
  `<Button variant="ghost" size="sm">Cancel</Button>`.

### Mobile layout

No lane stack (T4933: no tall stacks; a landscape phone is height-starved). Gated on
`useIsMobile()` OR `window.innerHeight < 800` (the §6 desktop fallback shares this path):

- **Active-camera chip** in the player controls row: `inline-flex items-center gap-1.5
  px-2.5 py-1 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-200
  coarse-pointer:min-h-[44px]` — owner initial badge + name ("Main" with `Star` when on
  Main) + `ChevronDown size={12}`. Rendered **only when ≥2 feeds** (zero chrome otherwise).
- Tapping it opens a **bottom-sheet camera picker** — the exact GameTile mobile-sheet shell
  (`fixed inset-0 z-50`, `flex-1 bg-black/40` top spacer that closes the SHEET on tap — a
  sheet is not a modal; the no-backdrop-close rule applies to modals — `bg-gray-800
  rounded-t-2xl border-t border-gray-700`, grabber). Rows (`px-4 py-3`, 44px floor):
  Main first (`Star` + `Main · {ownerName}` sublabel), then each camera: initial badge +
  name + coverage note `text-xs text-gray-500` (`covers this moment` / `no coverage
  here` — grayed + disabled) + `Check` on the active row. Unavailable cameras use the
  single unavailable treatment + `Renew` inline text button → §9.
- The **"Prefer this camera from here" pill** overlays the player on mobile exactly as on
  desktop (it is the one preference gesture everywhere; the sheet carries no preference
  row). Line-up drag stays desktop-only (the drag needs pixel precision; mobile users get
  §7's ± nudge).

**Components reused.** `TimelineBase`/`EDGE_PADDING`, `AnnotateTimeline` lane-label
classes, GameTile bottom-sheet shell, `useIsMobile`, Pointer-Events drag pattern from
`RegionLayer.jsx:98-132`.

**States.**
| State | Appearance |
|-------|-----------|
| 1 feed | No lanes, no chip — Annotate byte-identical to today. |
| ≥2 feeds, all lined up | Lanes/chip as above, Main active by default per session. |
| Feed not lined up | Yellow `AlertTriangle` badge on the lane label / sheet row; that feed EXCLUDED from Main until confirmed (Main must never cut to a misaligned feed). |
| Camera unavailable for this member | Single unavailable treatment; excluded from Main; renew affordance. |
| Feed processing (upload/alignment running) | Lane bars pulse (`animate-pulse` on the bar fill); label suffix `aria-label` "— processing". |
| Coverage gap at playhead | Other lanes tappable only where bars exist; C-cycle skips them. |
| Someone re-lined-up the cameras | One-time on-load toast to every member EXCEPT the one whose write won (last-write-wins — the winner sees nothing): *"{name} adjusted how the cameras line up."* Derived from the offset's `updated_by ≠ me` and `updated_at > last_opened_at` — no new persisted state. |

**Copy.** Gap chip: `No coverage here`. Unaligned badge: `Not lined up yet — tap to fix`.
Unavailable popover: `Sarah's camera expired for you.` / button `Renew — {n} credits`.
Pill: `Prefer this camera from here`. Pill confirm chip: `Main uses {name}'s camera from
here`.

**Gestures → writes.**
| Gesture | Write |
|---------|-------|
| Tap lane / C key / sheet row (switch viewing camera) | **None.** Viewing camera is session state (no-persisted-view-state rule; epic decision 5 — viewing is a display mapping). |
| **"Prefer this camera from here" pill click** | `POST /api/pools/{id}/preferences` `{feed_id, from_shared_t}` — surgical, member-scoped. The only preference-creating gesture. |
| Coach-mark **"Got it"** | User-prefs dismissed flag — the click is the gesture. |
| **"They're lined up"** (after line-up-mode drag) | `POST /api/pools/{id}/feeds/{feed_id}/offset` `{wall_offset}` — the confirm gesture, per epic decision 6. Drag movement itself writes nothing. |
| "Cancel" in line-up mode | Nothing; local offset preview discarded. |
| (Clearing preferences) | Not here — `Clear all camera preferences` lives in Manage cameras (§10). |

**Accessibility.** Every lane label: `aria-label="{owner}'s camera — covers {ranges}
{', not lined up yet' | ', expired for you'}"`; the Main lane's `aria-label` carries the
switch schedule (above). Bars are within a `role="button"` lane with keyboard activation
(Enter switches at playhead). Color is never sole signal: initial badges + owner names in
labels, lock/warning icons for states. C-shortcut listed in the existing shortcut help.
**Coarse pointers:** each `1.625rem` lane row gets an explicit **transparent `min-h-11`
hit overlay** (absolutely positioned, spanning the row) so the visual density survives
while every touch target meets the 44px floor.

---

## 7. Line-Up View (Manual Alignment)

Reachable from exactly two places: the unaligned badge (§6) and Manage cameras → a
camera row's **"Line up this camera…"** action (§10). Never from the timeline at rest,
never from a context menu. Auto audio-sync runs first; this UI is confirm/fix.

**Layout — desktop.** Modal shell, wider: `max-w-3xl`. Header chip `bg-yellow-600/20` +
`SlidersHorizontal size={20} className="text-yellow-400"` (alignment = calibration family,
like StorageExtensionModal's yellow). Title **"Line up the cameras"**.

Body:
1. Instruction, `text-sm text-gray-300`: *"Find a moment you can hear on both — a whistle
   or a kick — and nudge until they match."*
2. **Side-by-side players**, `grid grid-cols-2 gap-3`: left = reference feed, right = the
   feed being lined up. Each: `aspect-video bg-black rounded-lg overflow-hidden` with the
   owner chip (initial badge + name, `bg-black/60` backdrop) top-left. Both paused at the
   same shared-clock moment; a shared scrub bar underneath (reuse `ProgressTrack` from
   `components/shared/` — store-free) moves both in lockstep.
3. **Nudge row**, centered `flex items-center justify-center gap-2`:
   `[-1s] [-0.1s] [±offset readout] [+0.1s] [+1s]` — ghost `Button size="sm"` pairs with
   `ChevronLeft`/`ChevronsLeft` icons + labels; readout `ui-monospace text-sm text-white
   w-20 text-center` showing the delta vs. the suggested offset (e.g. `+0.3s`). A
   `Play 1s` ghost button plays both players simultaneously for one second (the actual
   "does the whistle match" test — audio from the adjusted feed only, reference muted at
   50% volume; simultaneous audio is the point).
4. Footer: `<Button variant="ghost">Cancel</Button>` +
   `<Button variant="success">They're lined up</Button>`. A tertiary text link (desktop
   only) `text-xs text-gray-500 hover:text-gray-300`: *"Adjust on the timeline instead"*
   → closes and enters §6's line-up mode.

**Short-clip variant (clip-kind feeds).** When the feed being lined up is a short phone
clip, side-by-side lockstep scrubbing is useless (the clip covers seconds, the game covers
hours). Instead: the **reference player scrubs freely** across the whole game; the clip
side is a **fixed strip** — the clip plays/loops its own full duration with its own
mini-scrubber — and the nudge adjusts where that strip sits on the game clock, **clamped
to ± (clip length + a small margin)** around the current estimate so a stray nudge can't
fling a 12-second clip across the half. Everything else (nudge row, Play 1s, confirm) is
identical.

**Layout — mobile.** Portrait: the two players **stack is avoided** — instead one player
with an A/B camera toggle above it (two-segment control: reference name | aligning camera
name), so the user flips between the same moment on each; nudge row + confirm below
(44px floors). Landscape phone (`useIsLandscape`): side-by-side grid works (two 16:9 in a
short-wide viewport) with the nudge row overlaid at the bottom — never a vertical stack
(T4933).

**Components reused.** Modal shell, `Button`, `ProgressTrack`, owner-chip idiom from
§6, `useIsMobile`/`useIsLandscape`.

**States.**
| State | Appearance |
|-------|-----------|
| Auto-alignment succeeded (confirm mode) | Banner over the players `bg-green-900/30 border border-green-700 rounded-lg px-3 py-2 text-sm text-green-400`: *"Auto-synced by sound — check a loud moment and confirm."* (The one permitted "sync".) Nudge starts at 0.0s delta. |
| Auto-alignment failed / low confidence | Yellow banner (`bg-amber-950/40 border-amber-800/50 text-amber-200`): *"Couldn't line these up automatically. Line them up by ear."* Initial offset = creation-time metadata estimate. |
| Auto-alignment running | Players replaced by centered `Loader animate-spin` + *"Listening for a match…"*; nudge disabled. |
| Saving | Confirm button `Saving…` disabled. |
| Concurrent write (another member confirmed meanwhile — last-write-wins per epic) | The later write silently wins; **no toast for the winner** (their screen already shows their own result). Members whose view is now stale get the one-time on-load toast (§6 states). No conflict UI. |
| Video load error | Standard error text in the player box: *"Couldn't load this camera."* |

**Copy.** As above. Nudge buttons `aria-label`: `Nudge back 1 second`, `Nudge back 0.1
seconds`, etc.

**Gestures → writes.**
| Gesture | Write |
|---------|-------|
| ± nudge clicks, scrubbing, A/B toggling, Play 1s | **None** — all local preview state. |
| **"They're lined up"** click | `POST /api/pools/{id}/feeds/{feed_id}/offset` `{wall_offset}` — the single surgical write (epic decision 6), shared pool-wide, last write wins. |
| Cancel / X / Escape | Nothing persisted; suggestion remains unconfirmed (badge stays). |

**Accessibility.** Nudge buttons have text labels beside icons (not icon-only). The offset
readout is `aria-live="polite"`. Players carry `aria-label="{owner}'s camera preview"`.
Keyboard: left/right arrows = ±0.1s, shift+arrows = ±1s while the modal is open.

---

## 8. Per-Clip Camera Picker

Appears when a clip is selected in Annotate AND ≥2 feeds **fully** cover the clip's span
(otherwise: nothing — zero chrome).

**Layout — desktop.** A new block inside `ClipDetailsEditor.jsx` (the desktop sidebar clip
editor), placed after the rating/layer controls, labeled like sibling fields
(`block text-sm font-medium text-gray-300 mb-1.5`): **"Camera for this clip"**.

Directly under the label, an **always-visible helper line** `text-xs text-gray-500`:
*"This camera's video is used when the clip is exported."* — the stakes are stated before
any pick, not discovered after.

Content: a horizontal strip of poster tiles (`flex gap-2 overflow-x-auto pb-1`, the
`CardCarousel` scroll idiom without chevrons — the strip is short). Each tile:

```jsx
<button className="relative shrink-0 w-24 aspect-video rounded-md overflow-hidden
                   border-2 transition-colors bg-gray-900
                   {picked ? 'border-[feedColor]' : 'border-gray-700 hover:border-gray-500'}">
  <img src={feedPosterAtClipStart} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
  <span className="absolute bottom-0 inset-x-0 px-1 py-0.5 text-[10px] text-white truncate
                   bg-gradient-to-t from-black/85 to-transparent">{ownerName}</span>
  {picked && <Check size={12} className="absolute top-1 right-1 text-white bg-black/60 rounded-full p-0.5" />}
</button>
```

- First tile = **Main** (`Star` glyph badge over its poster, label "Main"); sublabel under
  the strip when Main is picked: `Main · {ownerName}` (`text-[10px] text-gray-400`) —
  Main always names the camera it currently resolves to. (Tile becomes "Auto"/`Wand2`
  when T5560 renames — see Vocabulary.)
- Only feeds **fully covering the clip's span** are pickable. Feeds with **partial
  coverage render as disabled tiles** (no hover border, `opacity-60`, not focusable as a
  pick) with sublabel `only covers part of this clip` — a camera that vanishes mid-clip
  is never a valid export source.
- Poster frames = each feed at the clip's start moment. Load chain: lazy `<img>` →
  skeleton pulse → **frame from the reference camera at the same moment** (the branded
  mark only if even that fails) — a real frame beats a logo for choosing between angles.
- **Tap = pick + preview** (one gesture): stamps the extraction source AND switches the
  player to that feed at the clip start so the choice is immediately visible.
- **When a stamp exists**, a line renders under the strip: `text-xs text-gray-300`
  **"Exports from {name}'s camera"** + a `Use Main instead` text button
  (`text-xs text-cyan-400 hover:text-cyan-300`) that clears the stamp — undo is one
  labeled click, not a hunt for the first tile.

**Layout — mobile.** The same strip (helper line included) inside
`AnnotateFullscreenOverlay` (the mobile clip add/edit surface), above the Save row; tiles
`w-28` with `coarse-pointer:min-h-[44px]` implicit via aspect (a 112px-wide 16:9 tile is
63px tall — over the floor). Horizontal snap-scroll (`snap-x snap-mandatory`, CardCarousel
touch idiom).

**Components reused.** `ClipDetailsEditor` field grammar, DraftTile poster
loading/fallback contract (with the reference-frame fallback above), CardCarousel scroll
classes, `LayerSegmentedControl` placement precedent (this is a sibling per-clip control).

**States.**
| State | Appearance |
|-------|-----------|
| Only 1 feed fully covers the clip | Block hidden entirely. |
| Default (no stamp) | Main tile picked (border `MAIN_COLOR`), resolved camera named in the sublabel. |
| Explicit pick | That tile bordered in its feed color + Check badge; "Exports from {name}'s camera" + `Use Main instead` line shown. |
| Poster loading | `bg-gray-700 animate-pulse` skeleton in the tile. |
| Feed not lined up | Tile shows `AlertTriangle text-yellow-400` corner badge; **pickable** (the user may know better) but sublabel `not lined up yet`. |
| Partial coverage | Disabled tile, sublabel `only covers part of this clip`. |
| Camera unavailable for member | The single unavailable treatment; not pickable; tap opens the §9 renew popover. An existing stamp on an unavailable camera shows the ONE generalized warning under the strip: *"This clip's camera isn't available — it will export from Main."* |
| Save failed | Existing clip-save failure toast/retry closure (`useRawClipSave` rails). |

**Copy.** Label: `Camera for this clip`. Helper: `This camera's video is used when the
clip is exported.` Main sublabel: `Main · {ownerName}`. Stamp line: `Exports from {name}'s
camera` / `Use Main instead`.

**Gestures → writes.**
| Gesture | Write |
|---------|-------|
| Tap a camera tile | `PUT /api/clips/raw/{id}` `{feed_id}` — the T5550 camera-stamp pattern: surgical, one field, times stay in primary-timeline terms, mapped at export. |
| Tap the Main tile OR click `Use Main instead` | `PUT /api/clips/raw/{id}` `{feed_id: null}`. |
| The preview switch that rides the tap | Session state only (no write — it's the same viewing-camera state as §6). |

**Accessibility.** Tiles: `aria-label="Export from {owner}'s camera"` /
`aria-label="Export from Main (currently {owner}'s camera)"`, `aria-pressed={picked}`;
disabled partial tiles carry `aria-disabled` + the sublabel text. Strip is
keyboard-navigable (tiles are buttons in DOM order). Picked state = border + Check icon,
never color alone.

---

## 9. Expiry / Keep Checklist (Per-Feed Renewal)

Replaces `StorageExtensionModal` **for pool games only** (plain games keep the existing
modal untouched). Opened from: expired/near-expiry pool tile tap, the tile kebab "Extend
storage", and every "Renew" affordance in §6/§8.

**Layout.** Modal shell `max-w-md rounded-xl max-h-[90dvh] flex flex-col` (list scrolls,
header/total/footer never do). Header: chip `bg-yellow-600/20` + `Calendar
text-yellow-400` (StorageExtensionModal's exact header), title **"Keep this game's
cameras"**. Subhead `text-sm text-gray-400`: *"{firstName} paid to keep this game live
until {date}. After that, each camera needs its own credits to stay playable."* (Honest:
the free period is a person's money, not a product grace — name them.)

**Per-camera checklist** (`ShareGameModal` recipient-list wrapper: `rounded-lg border
border-gray-700 divide-y divide-gray-700/60 overflow-y-auto`). Each row
`px-3 py-2.5 flex items-center gap-3`:

1. Checkbox (`w-4 h-4 accent-yellow-400`, native input — matches the range input's
   `accent-` approach in StorageExtensionModal).
2. Owner initial badge + label block: `text-sm text-gray-200` **{owner} — {kind}** ("You —
   full game", "Sarah — full game", "Dana — 3 clips"); second line `text-xs text-gray-500`:
   `{size} · {n} credits / 30 days` (sizes via StorageExtensionModal's `formatSize`).
3. Right-aligned per-row state (see States).

**Pre-check rule (conservative — never pre-spend on inference):** rows are pre-checked
ONLY when (a) it's the member's own camera, or (b) at least one of the member's clips
carries an **explicit stamp** (§8) on that camera. Cameras used only via Main's automatic
resolution are **unchecked**, with a `text-[10px] text-cyan-400` note under the label —
`used by {n} of your clips` — and an inline **`Keep`** text button (`text-xs text-cyan-400`)
that checks the row (an affordance, not a default). Unchecking an explicitly-stamped row
arms an inline warning (row turns `bg-amber-950/30`): *"{n} clips export from this camera
— they'll fall back to Main."*

**Running total** — the cost/balance row idiom pinned under the list:
`{total} credit{s} for 30 more days` + `Balance: {n}` (Coins icon, `bg-gray-700/50`).

**Consequence line (persistent, always visible, directly above the button row):**
`text-xs text-gray-400`: *"Cameras you don't keep stop playing on {date}. Your clips,
notes and finished reels stay."*

**Confirm row:**
- ≥1 selected: `<Button variant="success" size="lg" fullWidth>Keep {k} camera{s} —
  {total} credit{s}</Button>`.
- 0 selected: the primary becomes an **enabled ghost** `<Button variant="ghost" size="lg"
  fullWidth>Keep nothing for now</Button>` (closes, writes nothing) — declining is a real,
  honest choice, not a disabled dead-end.
- Secondary ghost `Not now` (always present) sits beside it; both dismiss actions share
  the consequence line directly above them — nobody closes this modal without seeing what
  lapses.
- Insufficient balance → `BuyCreditsModal` intercept (GameDetailsModal pattern).

**Mobile.** Identical modal (max-w-md, list scrolls); checkbox rows get
`coarse-pointer:min-h-[44px]` and the whole row toggles (label-wrapped input).

**Components reused.** `StorageExtensionModal` (header, formatters, balance row,
`BuyCreditsModal` gate), `ShareGameModal` list wrapper, `Button`.

**States.**
| Row state | Appearance |
|-----------|-----------|
| Renewable | Checkbox enabled, cost shown. |
| Already covered (someone else's rent keeps it live ≥30d — uploader's first-30-days case) | Checkbox disabled+checked, cost `—`, right note `text-xs text-green-400`: **`Covered by {firstName} until {date}`** (who is paying, until when — never a vague "covered"). Excluded from total. |
| Already expired for member | Row leads with `Lock size={14} text-yellow-400`; checking it = renewing access (label note `renew access`). |
| Source reclaimed (no live refs anywhere — gone from R2) | The single unavailable treatment: row `opacity-50`, checkbox disabled, note `no longer available`. |
| Submitting | Button `Keeping…`, list disabled. |
| Partial failure | Toast per ShareGameModal partial-failure idiom: `Kept {k} of {n} — retry the rest`. |

**Copy.** As inlined above.

**Gestures → writes.**
| Gesture | Write |
|---------|-------|
| Checkbox toggles / inline `Keep` clicks | **None** — local selection. |
| **Confirm button** | `POST /api/pools/{id}/renewals` `{feed_ids: [...]}` — one write for the whole checklist (debits credits, extends the member's per-feed refs). |
| `Keep nothing for now` / `Not now` | **None** — close only. |
| `BuyCreditsModal` success | Existing purchase flow, then the same renewal POST resumes (GameDetailsModal `handlePaymentSuccess` pattern). |

**Accessibility.** Each checkbox `aria-label="Keep {owner}'s camera — {n} credits for 30
days"`. Warnings are text + background tint (not color-only). Total row `aria-live="polite"`.

---

## 10. Manage Cameras (Creator) + Member Withdraw

**Entry.** Tile kebab → `Manage cameras` (creator) / `Shared game info` (non-creator) —
§4. Basic users never see either (no pool → no item).

**Layout.** Desktop: modal shell `max-w-md`. Mobile: the GameTile bottom-sheet shell
(this is a list surface; the sheet idiom fits). Header: chip `bg-cyan-600/20` +
`Users text-cyan-400`, title **"Manage cameras"** / **"Shared game info"**.

Body:
1. **Camera list**, section heading `text-xs font-semibold text-gray-500 uppercase
   tracking-wide`: **"Cameras on this game"** — ShareGameModal recipient-list wrapper.
   Each row: owner initial badge + name (+ `You` / `Started the game` sublabels) + camera
   summary `text-xs text-gray-500` (`full game · 2.1 GB` / `3 clips` / `no camera yet`)
   + per-row overflow menu:
   - **`Line up this camera…`** (any member, rows with a camera, not the reference feed) —
     opens §7 for that camera. This row + the §6 unaligned badge are the ONLY entries to
     the line-up view.
   - Creator, on others' cameras: **`Remove this camera`** — `text-red-400`, **two-tap
     confirm in place** (`Tap again to remove` — the GameTile delete idiom, menu stays
     open). Removes the camera from the pool (stops NEW references; members who already
     renewed keep their refs — the armed state's second line says so).
   - Any member, on their own camera row: **`Remove this camera`** — same red two-tap
     idiom, self-authorized.
2. **`Clear all camera preferences`** — a quiet row under the list (`text-sm
   text-gray-300`, `Pin` icon), shown only when this member has preference spans
   (§6 pill). Two-tap confirm in place (`Tap again to clear`); clears every span the
   member has set. Main falls back to clip stamps → reference feed.
3. **Invite link block** (creator only), `pt-4 border-t border-gray-700`:
   - `Copy invite link` — cyan Button, §1 lifecycle.
   - **`Replace invite link`** — ghost Button → `RevokeConfirmDialog`-pattern nested
     confirm (`z-[60]`, inert backdrop, `AlertTriangle text-red-400`): title *"Replace
     the invite link?"*, body *"The old link stops working. Members who already joined
     keep access. You'll get a new link to share."*, buttons `Keep link` (ghost) /
     `Replace` (danger).
4. **`Stop sharing this game`** (non-creator members), bottom, `text-red-400` row with
   two-tap confirm: *"Stop sharing this game"* → *"Tap again — your game stays, other
   cameras go away"*. Leaving **releases the member slot** (the count against 50 drops)
   and **the invite link re-admits them** later — leaving is reversible via the same
   link, and the copy in the armed state's second line reflects that: *"You can rejoin
   with the invite link."*

### Creator deletes their game

The creator deleting a pool game from their library (the existing delete flow) intercepts
with a `RevokeConfirmDialog`-pattern nested confirm (`z-[60]`, `AlertTriangle
text-red-400`): title *"Delete this game?"*, body *"Other parents keep the shared game and
every camera they've kept. Your camera stops being available to members who haven't kept
it. This can't be undone."*, buttons `Keep game` (ghost) / `Delete` (danger).

**Settled outcome (UI contract):** the pool, its members, and **all confirmed offsets
survive** the creator's departure. The shared wall-clock origin is a **stored constant on
the pool** — written when slot-0's feed is registered — NOT a live pointer at slot-0's
video, so alignment keeps working after the reference video is gone. *(Confirm this
storage shape with the architect at T5500 design.)* Members' games keep playing every
camera they have refs to; the creator's own camera follows the normal remove-camera
semantics above.

**Components reused.** Modal + sheet shells, member-list wrapper, `RevokeConfirmDialog`
pattern (`ShareGameModal.jsx:151-179`), two-tap destructive idiom (`GameTile.handleDelete`).

**States.**
| State | Appearance |
|-------|-----------|
| Loading members | Skeleton rows (`animate-pulse` bars). |
| Replace-link in flight | Confirm dialog button `Replacing…` disabled. |
| Remove/withdraw in flight | Row `opacity-50` with spinner. |
| Errors | Inline `text-red-400 text-sm` + toast; row restored. |

**Copy.** As inlined. Remove-camera consequence line (armed state's second line,
`text-xs text-red-300`): *"Their camera disappears for members who haven't paid to keep it."*

**Gestures → writes.**
| Gesture | Write |
|---------|-------|
| Second tap of `Remove this camera` (creator on another's) | `DELETE /api/pools/{id}/feeds/{feed_id}` (creator-authorized). |
| Second tap of `Remove this camera` (own row) | Same endpoint, self-authorized. |
| Second tap of `Clear all camera preferences` | `DELETE /api/pools/{id}/preferences` — clears all of THIS member's spans (member-scoped). |
| `Replace` in the confirm dialog | `POST /api/pools/{id}/rotate-link` → new token returned; old token 410s (§2 revoked state). |
| Second tap of `Stop sharing this game` | `POST /api/pools/{id}/leave` — removes membership AND releases the member slot; the member's private game row and own clips remain; the invite link re-admits them later. |
| `Delete` in the creator-delete confirm | The existing game-delete write + pool membership removal; the pool object, offsets and stored wall-clock origin are untouched. |
| Opening the modal, first tap of any two-tap | **None.** |

**Accessibility.** Destructive rows: `aria-label` includes the consequence
(`"Remove Sarah's camera from this shared game"`); armed state announced by the label text
change. Nested confirm traps focus; Escape closes the confirm first (ShareGameModal's
Escape ordering, `ShareGameModal.jsx:325-335`).

---

## Cross-Cutting Notes

- **No new chrome for basic users** is enforced structurally: every new surface gates on
  `game.pool_id` and, inside Annotate, additionally on `feedCount >= 2`. The single
  basic-user-visible addition is the block inside the Share game modal (§1.1).
- **Session vs. persisted, one table:**

  | State | Persistence |
  |-------|-------------|
  | Viewing camera (lane tap / C key / sheet) | Session only — never written |
  | Clip extraction stamp | `raw_clips` via `PUT /clips/raw/{id}` (tile tap / `Use Main instead`) |
  | Preferred-camera spans | Pool, member-scoped, via the player pill gesture only; cleared via Manage cameras |
  | Feed offsets | Pool, shared, via the "They're lined up" gesture only |
  | Renewals | Via checklist Confirm only |
  | Pool membership/link | Via join / replace-link / remove / leave gestures only |
  | Coach-mark dismissed | User prefs, via the Got-it click only |
  | New-camera dot / re-line-up toast | **Derived** (`created_at`/`updated_at` vs `last_opened_at`) — never persisted |

- **No modal closes on backdrop click** (mobile bottom SHEETS may close on the top-spacer
  tap — they are sheets, matching `GameTile`'s existing sheet; every desktop modal and the
  nested confirms have inert backdrops). All modals carry `max-h-[90dvh] flex flex-col`
  with a scrolling body.
- **Every icon-only or color-coded element carries `title` + `aria-label`**, and every
  state (not lined up, unavailable, picked, active) pairs its color with an icon or text
  (T6400 / WCAG 1.4.1).
- **Coarse-pointer floors:** 44px on all new tap targets via `coarse-pointer:` variants or
  explicit transparent hit overlays (§4 chip, §6 lane rows, §6 pill).
- **Vocabulary is absolute:** camera / clips / angle / shared game / Main / "line up".
  "Sync" survives in one auto-success banner string; "feed" and "pool" never reach copy.

---

## Changelog (review-driven revisions)

| Finding | Change |
|---------|--------|
| B1 | Global kebab item + post-upload toast entry points removed; invite is a second block inside the Share game modal; ladder cell rewritten to be literally true. |
| B2 | §3 join now binds to a profile: multi-profile required "Whose game is this?" chips (no default), single-profile display row, new-account confirm = profile creation with sport prefilled from the pool's creator-sport snapshot (T2915 rails). |
| B3 | §9 pre-checks only own camera + explicitly-stamped cameras; Main-resolved cameras start unchecked with "used by {n} of your clips" + inline `Keep`. |
| B4 | §3 consequence block (visibility + who pays until when, then per-camera credits); §2 sub-CTA now says joining is free and adding a camera is optional. |
| B5 | New §10 subsection "Creator deletes their game": RevokeConfirmDialog-pattern confirm; pool + offsets survive; wall-clock origin is a stored constant (architect confirmation flagged for T5500). |
| M1 | Line-up view reachable only from the unaligned badge + Manage cameras per-camera row; one-time on-load "{name} adjusted how the cameras line up" toast for superseded members; lane context menu deleted. |
| M2 (owner override — spans KEPT) | Preference spans stay per product requirement; remedies applied in full: visible pin strip under the Main lane, `Clear all camera preferences` in Manage cameras, owner names in wide segments + aria switch schedule; the gesture moved from a lane context menu to a single "Prefer this camera from here" pill at the player (shown only when watched ≠ default; 44px coarse). |
| M3 | "Auto" renamed **Main** (`Star` glyph, `Main · {owner}` sublabel, first-use helper) until T5560; planned rename back to "Auto"/`Wand2` noted. |
| M4 | New-camera arrival: cyan dot + "{k} new" title on the pool chip (derived from `created_at` vs `last_opened_at`); one-time coach-mark on first 2-feed render, dismissed by the persisting Got-it gesture. |
| M5 | Picker: always-visible stakes helper; "Exports from {name}'s camera" + `Use Main instead` when stamped; partial-coverage cameras disabled ("only covers part of this clip"). |
| M6 | Tile CTA strip replaced with an `Add camera` badge-zone chip (expiry-chip geometry, coarse min-h-11, aria-label). |
| M7 | Full string table adopted: Manage cameras / Shared game info / Cameras on this game / Stop sharing this game / Remove this camera / Replace invite link / Line up this camera… / "Not lined up yet — tap to fix"; camera/clips/angle held absolutely; "sync" confined to the auto-success banner. |
| M8 | §3 Game Type control replaced with "Which team are you with?" ({creatorTeam} / The other team, fallback "Same team as {firstName}"); same team inherits type+opponent verbatim, other team inverts type + prefills opponent; derived-name preview kept. |
| M9 | §9 honesty pass: named-payer subhead, `Covered by {firstName} until {date}` rows, persistent consequence line, enabled ghost `Keep nothing for now` at zero selection, title "Keep this game's cameras". |
| M10 | One height model (`9.75rem + 1.625rem × min(feedLanes+1, 3)`), scroll region with Main + active sticky + `+{n} more`, mobile-chip fallback whenever `innerHeight < 800` regardless of pointer. |
| M11 | Uploading state added: §2 rows ("uploading now"), §3 toast ("{n} ready, {m} still uploading"), §4 chip (pulsing dot + title). |
| M12 | §5 clip auto-alignment promise qualified; §7 short-clip variant added (free-scrubbing reference, fixed clip strip, nudge clamped to ±clip length + margin). |
| M13 | §1.2 at-cap state: Copy/Share disabled + "This game has all 50 cameras. Remove one in Manage cameras to invite another." |
| m1 | Page `<title>` / OG unfurl carry the game title only (interpreted with m7's privacy direction: no date/names in link previews). |
| m2 | FEED_COLORS reduced to four hues (violet/pink/teal/indigo — lime/rose dropped); dots became owner-initial badges. |
| m3 | Owner first names render in Main-lane segments wider than ~48px; Main lane aria-label lists the switch schedule (folded into the M2 remedy). |
| m4 | Gap tap shows the transient over-video "No coverage here" chip instead of a tooltip. |
| m5 | §4 note: kebab popover flip-aware positioning must recompute menu height with the added rows. |
| m6 | §2 signed-out state gains an "Already have an account? Sign in" path beside Sign up. |
| m7 | Pre-join status list shows camera kinds/counts, never member names. |
| m8 | LWW winner receives no toast (folded into the M1 toast rule). |
| m9 | Modal shell convention now includes `max-h-[90dvh] flex flex-col` + scrolling body. |
| m10 | One "camera unavailable" treatment defined in Conventions and reused (§6/§8/§9); one generalized export warning ("…will export from Main"). |
| m11 | Stop-sharing releases the member slot and the invite link re-admits; copy says rejoining is possible. |
| m12 | §5 states explicitly: non-pool GameDetailsModal renders byte-identical — zero diff for basic users. |
| m13 | §6 coarse pointers get an explicit transparent min-h-11 hit overlay per lane row. |
| m14 | Already-a-member link visit skips the confirm step; opens the library with a toast. |
| m15 | Creator's sport snapshotted into the pool at creation (folded into B2 / §1.2 write). |
| m16 | The §9 dismiss actions sit directly under the persistent consequence line — no silent close. |
| m17 | Picker poster fallback = frame from the reference camera (branded mark only as last resort). |
| m18 | Header now states this spec supersedes EPIC.md where they differ and that EPIC.md is reconciled at approval (EPIC.md itself untouched). |
