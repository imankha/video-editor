# T5740 — Share modal UX redesign (Phase A: UI design proposal)

**Status:** DESIGN GATE — awaiting user approval. No application code written yet.
**Scope:** Restructure the ONE existing share surface (`ShareGameModal.jsx`) into a Google-Docs-style
sharing dialog with per-recipient clip control. Phase B implements; Phase B also owns the backend
contract change. This document decides layout, states, copy, Tailwind, and interactions only.

---

## Open questions for the user (please relay — top item is blocking)

### Q1 (BLOCKING) — the per-person dropdown label wording

The dropdown chooses, per recipient, WHAT CLIPS that person receives. There are **three states to name**.
"All clips" (the phrase floated in the directive) is ambiguous and arguably wrong: My Athlete clips
**never** cross to a recipient (EPIC decision 1/2/3), so "all clips" could be misread as "including your
own athlete's clips." I am **not** silently picking — here is my recommendation and the candidates.

| State | What the recipient actually gets | **RECOMMENDED label** | Sub-label (dropdown row) |
|-------|----------------------------------|------------------------|--------------------------|
| Default | Every **Team-layer** clip (`my_athlete = 0`) for the game | **"All team clips"** | "Every team highlight from this game" |
| Tagged-only | Only Team clips this person is tagged in (`clip_teammates` via their `teammate_emails` mapping) | **"Only clips they're tagged in"** | "Just this player's team moments" |
| Game-only | The game/team recap and **zero** clips | **"Game only (no clips)"** | "Recap only — no highlight clips" |

Why these three:
- **"All team clips"** over "All clips": the word *team* makes the layer boundary explicit and kills the
  "does this include my athlete?" misread. It matches the EPIC's "Team layer" vocabulary the rest of the
  app already uses (amber "Team" chips).
- **"Only clips they're tagged in"** over "Only their clips" / "Clips they're tagged in": leads with
  *Only* so it reads as a narrower subset of "All team clips," and "tagged in" names the actual mechanism
  (player tags → `teammate_emails`), so the untagged=empty case (Q2) is self-explanatory.
- **"Game only (no clips)"** — the directive explicitly requires the zero-clips reality to be unmistakable
  **in the label itself**. "(no clips)" is in the label, not hidden in a tooltip. "Game only" alone was
  rejected because a reader could assume clips ride along with the game.

**Please confirm or edit these three labels before Phase B.** Everything downstream (row copy, empty
states, send-summary) uses this exact wording, so this is the one blocking decision.

### Q2 — Default selection confirmation
EPIC says the default per-recipient selection is **all team clips**. Confirmed in the design as the
pre-selected dropdown value for every freshly added recipient. Flagging only so it's on the record.

### Q3 — Should the clip preview also show for "All team clips"?
Recommendation: **yes** (a count + expandable list), for symmetry and so the sharer always sees the
zero-clips reality even on the default option (a game with no Team-layer clips shows "0 clips" here too,
which is a useful pre-send signal). See Decision 3.

### Q4 — Mixed-recipient send button copy
When recipients have different selections, the primary button reads **"Share with N"** (N = recipient
count) and a one-line summary sits above it. Confirm you're happy with a single Share action rather than
per-row send. (Matches today's single-submit model.)

---

## Product constraints honored (from the directive + EPIC — not re-litigated)

- `ShareGameModal.jsx` is the **single** share surface. **No new entry points, no native share sheet.**
- Per-recipient clip control, mirroring **Google Docs** ("Same UI"): **People with access** (rows w/
  per-person dropdown) + **General access** (the public link).
- Strictly one layer per clip; **My Athlete clips never cross** to a recipient (EPIC 1/2/3).
- Default per-recipient selection = **all team clips**.
- **No modal closes on backdrop click** (project rule) — applies to the revoke confirmation too.
- The untagged-recipient zero-clips state is **visible before send, never a post-hoc toast**.

---

## Layout overview (Google Docs mapping)

```
┌──────────────────────────────────────────────────────────┐
│  Share: {gameName}                                    [X] │  header (unchanged)
├──────────────────────────────────────────────────────────┤
│  Add people                                               │  ← UserPicker (unchanged internals)
│  ┌────────────────────────────────────────────────────┐  │
│  │ [chip] [chip]  type an email…                       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  People with access                                       │  ← NEW: recipient rows
│  ┌────────────────────────────────────────────────────┐  │
│  │ ● dana@…                     [All team clips  ▾]    │  │
│  │ ● sam@…                      [Only tagged     ▾] ▸  │  │
│  │     ⚠ No tag match — Sam gets 0 clips              │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  ── General access ─────────────────────────────────────  │  ← the public link (T5720)
│  🔗 Anyone with the link watches the team recap           │
│     [ Copy link ]   [ Revoke link ]                       │
│                                                           │
│                              [ Cancel ]   [ Share with 2 ]│
└──────────────────────────────────────────────────────────┘
```

Two labeled sections replace today's flat "public link above a picker": **People with access** (per-person
control) and **General access** (public link). The UserPicker stays as the *add* input at the top; once an
email is added it becomes a **row** below with its own dropdown.

---

## Decision 1 — Per-person dropdown (options, labels, control)

**Control:** a native-styled `<select>` (custom-rendered as a Docs-style dropdown button) on the RIGHT of
each recipient row. Options are the three states from Q1. Default = "All team clips".

**Why a dropdown, not a toggle:** three states, not two; Docs uses a dropdown ("Viewer/Commenter/Editor")
and the user asked for that exact idiom.

**Row anatomy (desktop):**

```
┌──────────────────────────────────────────────────────────┐
│ ●  dana@example.com                 [ All team clips  ▾ ] │
└──────────────────────────────────────────────────────────┘
   └ avatar dot   └ email (truncates)      └ per-person dropdown
```

**Tailwind — recipient row:**
```jsx
<div className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-700/40">
  <span className="w-2 h-2 rounded-full bg-cyan-500 shrink-0" aria-hidden />
  <span className="flex-1 min-w-0 truncate text-sm text-gray-200">{email}</span>

  {/* dropdown trigger */}
  <button
    type="button"
    onClick={() => setOpenFor(email)}
    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg
               bg-gray-700 hover:bg-gray-600 border border-gray-600
               text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-400"
  >
    {SELECTION_LABEL[selection]}
    <ChevronDown size={14} className="text-gray-400" />
  </button>

  {/* remove */}
  <button onClick={() => removeRecipient(email)}
          className="shrink-0 p-1 text-gray-500 hover:text-white rounded coarse-pointer:min-h-11 coarse-pointer:min-w-11">
    <X size={14} />
  </button>
</div>
```

**Dropdown menu (opened):** anchored popover, `bg-gray-700 border border-gray-600 rounded-lg shadow-xl`,
matching the UserPicker contacts dropdown exactly (same palette, same `hover:bg-gray-600`, cyan highlight):

```jsx
<div className="absolute right-0 z-50 mt-1 w-64 bg-gray-700 border border-gray-600 rounded-lg shadow-xl py-1">
  {OPTIONS.map((opt) => (
    <button key={opt.value}
      onClick={() => { setSelection(email, opt.value); setOpenFor(null); }}
      className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors
                  ${selection === opt.value ? 'bg-cyan-600 text-white' : 'text-gray-200 hover:bg-gray-600'}`}>
      <Check size={14} className={`mt-0.5 shrink-0 ${selection === opt.value ? 'opacity-100' : 'opacity-0'}`} />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{opt.label}</span>
        <span className="block text-xs text-gray-400">{opt.sublabel}</span>
      </span>
    </button>
  ))}
</div>
```

Icons per option (lucide-react, 14px, in the closed trigger optionally): `Users` (All team clips),
`UserCheck` (Only tagged), `Film` or `VideoOff` (Game only). Icons are decorative here; the label carries
the meaning.

**Selection constants (illustrative — final labels pending Q1):**
```js
const CLIP_SELECTION = { ALL_TEAM: 'all_team', TAGGED_ONLY: 'tagged_only', GAME_ONLY: 'game_only' };
const OPTIONS = [
  { value: CLIP_SELECTION.ALL_TEAM,    label: 'All team clips',           sublabel: 'Every team highlight from this game' },
  { value: CLIP_SELECTION.TAGGED_ONLY, label: 'Only clips they’re tagged in', sublabel: 'Just this player’s team moments' },
  { value: CLIP_SELECTION.GAME_ONLY,   label: 'Game only (no clips)',     sublabel: 'Recap only — no highlight clips' },
];
```

**ASCII — default state (all recipients "All team clips"):**
```
People with access
┌──────────────────────────────────────────────────────────┐
│ ●  dana@example.com               [ All team clips    ▾ ] │
│ ●  jordan@example.com             [ All team clips    ▾ ] │
└──────────────────────────────────────────────────────────┘
```

**ASCII — game-only selected:**
```
│ ●  coach@example.com              [ Game only (no clips) ▾ ]
│      (collapsed preview shows: "0 clips — recap only")     │
```

---

## Decision 2 — Untagged-recipient state (explicit, visible BEFORE send)

**Trigger:** recipient's selection is "Only clips they're tagged in" AND the backend reports no
`teammate_emails` tag mapping for that email (or a mapping that matches zero clips). Backend already
resolves email→tag_name (`clips.py:2408 get_teammate_emails`, `_filter_clips_for_tag`); Phase B surfaces a
per-recipient count so the modal can render this before send.

**Two layers of visibility (both required):**

**(a) Inline warning on the row** — appears the instant "Only tagged" is chosen and the count is 0:

```jsx
<div className="mt-1 ml-4 flex items-start gap-1.5 text-xs text-amber-400">
  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
  <span>No tag match for this email — <strong>{shortName}</strong> will get the game with{' '}
  <strong>0 clips</strong>. Switch to “All team clips” to include highlights.</span>
</div>
```

- Color: `text-amber-400` with `AlertTriangle` (14px). Amber = warning, not error (the send is still
  valid, just probably not intended). Matches the project's yellow/amber warning convention
  (`yellow-900/70 text-yellow-300` on GameTile; amber-400 chosen here for text-on-dark legibility).
- The row's dropdown trigger also gets an amber ring hint: `border-amber-500/60`.

**(b) Send-time summary line** — above the Share button, so it's unmissable even if the row scrolled:

```jsx
{untaggedCount > 0 && (
  <div className="mb-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-950/40 border border-amber-800/50">
    <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
    <p className="text-xs text-amber-200">
      {untaggedCount === 1 ? '1 person' : `${untaggedCount} people`} set to “Only clips they’re tagged in”
      {' '}will receive <strong>0 clips</strong> (no tag match). Send anyway?
    </p>
  </div>
)}
```

**ASCII — untagged + tagged-only:**
```
People with access
┌──────────────────────────────────────────────────────────┐
│ ●  sam@example.com          [ Only clips they’re tagged ▾ ]│
│    ⚠ No tag match — Sam will get the game with 0 clips.    │
│      Switch to “All team clips” to include highlights.     │
└──────────────────────────────────────────────────────────┘
        …
 ┌────────────────────────────────────────────────────────┐
 │ ⚠ 1 person set to “Only tagged” will receive 0 clips    │  ← send-time banner
 │   (no tag match). Send anyway?                          │
 └────────────────────────────────────────────────────────┘
                          [ Cancel ]   [ Share with 1 ]
```

The Share button is **not disabled** (sending game-only is legitimate) — the amber banner is a
speed-bump, not a block. This is the requirement most likely to be built weakly; both the inline row
warning and the send-time banner are mandatory.

---

## Decision 3 — Clip preview list

**Where it lives:** an **expandable panel under the recipient's row** (accordion), disclosed by a chevron
on the row. This keeps each recipient's (possibly different) clip set attached to that person, which a
single shared panel can't do when recipients differ.

**Disclosure control:** a `▸/▾` chevron button at the right end of the row (after the dropdown). Collapsed
by default; the row always shows a **count** so the sharer sees the number without expanding.

**Collapsed (count only) — always shown, for every option including "All team clips" (Q3):**
```
│ ●  dana@example.com     [ All team clips ▾ ]  12 clips  ▸ │
│ ●  sam@example.com      [ Only tagged    ▾ ]   3 clips  ▸ │
│ ●  coach@example.com    [ Game only      ▾ ]   0 clips    │  ← no chevron; nothing to expand
```

Count chip Tailwind:
```jsx
<span className="shrink-0 text-xs text-gray-400 tabular-nums">{count} clip{count === 1 ? '' : 's'}</span>
<button className="shrink-0 p-1 text-gray-500 hover:text-white rounded" aria-label="Show clips">
  {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
</button>
```
(For `game_only` the count is always 0 and the chevron is omitted — nothing to reveal.)

**Expanded panel** — the clip list. Each entry shows what the backend can actually return
(`serialize_clip_data`: `name`, `rating`, `start_time`/`end_time`, `tags`, `tagged_teammates`):

- **Clip name** (`name`, falls back to a generated "Clip @ mm:ss" if null).
- **Rating** as the existing labeled rating pill (`Star` + `RATING_ADJECTIVES[r]`, per the style-guide
  "Labeled metadata pill" pattern) — only if `rating` present.
- **Timestamp** — `start_time` formatted `mm:ss` (mono `tabular-nums`), the clip's position in the game.

```jsx
<div className="ml-4 mt-1 mb-2 border-l border-gray-700 pl-3 space-y-1 max-h-40 overflow-y-auto scrollbar-hide">
  {clips.map((c) => (
    <div key={c.id} className="flex items-center gap-2 py-1 text-sm">
      <span className="flex-1 min-w-0 truncate text-gray-300">{c.name || `Clip @ ${fmt(c.start_time)}`}</span>
      {c.rating != null && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] font-semibold"
              style={{ color: RATING_BADGE_COLORS[c.rating], backgroundColor: RATING_BACKGROUND_COLORS[c.rating],
                       borderColor: `${RATING_BADGE_COLORS[c.rating]}4D` }}
              title={RATING_ADJECTIVES[c.rating]}>
          <Star size={10} />{RATING_ADJECTIVES[c.rating]}
        </span>
      )}
      <span className="shrink-0 text-xs text-gray-500 tabular-nums">{fmt(c.start_time)}</span>
    </div>
  ))}
</div>
```

**Empty state (= Decision 2):** when the expanded list is empty, the panel shows the amber zero-clips
message instead of rows:
```jsx
<div className="ml-4 mt-1 mb-2 border-l border-amber-800/50 pl-3 py-2 flex items-start gap-1.5 text-xs text-amber-400">
  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
  <span>No clips match — this person will receive the game only.</span>
</div>
```

**Different sets per recipient:** because the panel is per-row, each recipient's expanded list is
independent — expanding Dana's 12-clip "all team" list and Sam's 3-clip "tagged" list at the same time is
fine; they stack. Only one row's dropdown popover is open at a time (`openFor` state), but multiple
preview accordions may be open.

**ASCII — tagged-only expanded with clips:**
```
People with access
┌──────────────────────────────────────────────────────────┐
│ ●  sam@example.com     [ Only tagged ▾ ]     3 clips   ▾  │
│    │ Fast break dunk              ★ Brilliant    04:12    │
│    │ Steal + assist               ★ Good         11:47    │
│    │ Buzzer three                 ★ Brilliant    23:05    │
└──────────────────────────────────────────────────────────┘
```

**Data note (Phase B, not designed here):** the modal needs per-recipient counts + clip lists. Cleanest
is a preview endpoint (`GET /api/games/{id}/share-preview?email=…&selection=…`) or a single call returning
`{ all_team: [...clips], per_email: { sam@…: {count, clips} } }`. Phase B decides; this design only assumes
the fields above are available.

---

## Decision 4 — General access (public link) section

Reuses today's link logic (`handleCopyLink` / `handleRevokeLink`, already in the file). Only the framing
changes: it becomes the "General access" section, styled as a distinct labeled block below the recipients.

```jsx
<div className="mt-4 pt-4 border-t border-gray-700">
  <label className="block text-sm text-gray-400 mb-1.5">General access</label>
  <div className="flex items-start gap-2">
    <Globe size={16} className="mt-0.5 text-gray-400 shrink-0" />
    <div className="min-w-0 flex-1">
      <p className="text-sm text-gray-200">Anyone with the link</p>
      <p className="text-xs text-gray-500">Watches the team recap — no account needed.</p>
    </div>
  </div>
  <div className="mt-2 flex gap-2">
    <Button variant="cyan" onClick={handleCopyLink} disabled={linkBusy} icon={copied ? Check : Link2}>
      {copied ? 'Copied' : 'Copy link'}
    </Button>
    {linkActive && (
      <Button variant="ghost" onClick={() => setConfirmRevoke(true)} disabled={linkBusy}>Revoke link</Button>
    )}
  </div>
</div>
```

`Globe` (lucide) is the Docs "anyone with the link" idiom.

### Revoke confirmation (no backdrop dismiss)

Revoke is destructive (breaks a link already pasted in a team chat), so it gets a confirmation step.
**Project rule: no modal closes on backdrop click.** The confirmation is dismissible only via Escape or
the explicit Cancel/Keep buttons — the backdrop is inert (`onClick` does nothing; the existing
ShareGameModal backdrop already has no onClose handler, so this matches). Escape closes the confirmation
only (not the whole share modal) while it's open.

**Copy:**
- Title: **"Revoke this game link?"**
- Body: **"Anyone you've already shared the link with will lose access. People you added above keep their
  access. You can create a new link later, but it will be a different URL."**
- Buttons: **"Keep link"** (`variant="ghost"`) / **"Revoke link"** (`variant="danger"`)

```jsx
{confirmRevoke && (
  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
    {/* backdrop is inert — no onClick handler (project no-backdrop-dismiss rule) */}
    <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-sm mx-4 p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="text-red-400 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-base font-semibold text-white">Revoke this game link?</h3>
          <p className="text-sm text-gray-400 mt-1">
            Anyone you’ve already shared the link with will lose access. People you added above keep
            their access. You can create a new link later, but it will be a different URL.
          </p>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setConfirmRevoke(false)}>Keep link</Button>
        <Button variant="danger" onClick={confirmRevokeAction} disabled={linkBusy}>Revoke link</Button>
      </div>
    </div>
  </div>
)}
```
Escape handling: while `confirmRevoke` is open, the modal's existing Escape listener must close the
confirmation FIRST (and only that), not the parent — a small guard in the keydown handler.

**ASCII — revoke confirmation:**
```
        ┌────────────────────────────────────────────┐
        │ ⚠  Revoke this game link?                  │
        │                                            │
        │ Anyone you’ve already shared the link with │
        │ will lose access. People you added above   │
        │ keep their access. You can create a new    │
        │ link later, but it will be a different URL.│
        │                                            │
        │                  [ Keep link ] [ Revoke ]  │
        └────────────────────────────────────────────┘
```

### Revoked state (visible)

After a successful revoke, the General access block reflects it (in addition to the existing toast):

```jsx
<div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
  <GlobeLock size={16} className="shrink-0" />
  <span>Link revoked — no one can watch via a link.</span>
  <Button variant="ghost" size="sm" onClick={handleCopyLink}>Create new link</Button>
</div>
```
`GlobeLock` (lucide) signals the link is closed. A "Create new link" affordance stays so the sharer can
re-open access (a new URL, per the confirmation copy). State comes from the link's active/revoked status
(Phase B: the modal reads current link state on open rather than assuming; today's code fires blind
POST/DELETE — Phase B should hydrate `linkActive` so the correct button/state shows).

**ASCII — revoked state:**
```
General access
🔒 Link revoked — no one can watch via a link.   [ Create new link ]
```

---

## Decision 5 — Responsive behavior (360–428px)

Modal stays `max-w-md` with `mx-4`. The recipient row is the pressure point: dot + email + dropdown +
count + chevron + remove don't fit on one 360px line. **Rule (responsiveness skill): stack into two lines
rather than overlap.**

**Mobile row = two lines** — email on line 1, controls on line 2:
```jsx
<div className="px-2 py-2 rounded-lg hover:bg-gray-700/40">
  {/* line 1: identity */}
  <div className="flex items-center gap-2">
    <span className="w-2 h-2 rounded-full bg-cyan-500 shrink-0" />
    <span className="flex-1 min-w-0 truncate text-sm text-gray-200">{email}</span>
    <button aria-label="Remove" className="p-1 text-gray-500 hover:text-white coarse-pointer:min-h-11 coarse-pointer:min-w-11">
      <X size={14} />
    </button>
  </div>
  {/* line 2: dropdown + count + expand — wraps below name on mobile, inline on sm+ */}
  <div className="mt-1.5 sm:mt-0 flex items-center gap-2 pl-4 sm:pl-0 sm:absolute sm:right-2 sm:top-2">
    <button className="... coarse-pointer:min-h-11">{label}<ChevronDown size={14} /></button>
    <span className="text-xs text-gray-400 tabular-nums">{count} clips</span>
    <button className="p-1 coarse-pointer:min-h-11 coarse-pointer:min-w-11" aria-label="Show clips">▾</button>
  </div>
</div>
```

Simpler, and the one I recommend: **always two lines on mobile, single line on `sm:`** via a plain
`flex-col sm:flex-row` on the row (no absolute positioning):
```jsx
<div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 px-2 py-2 rounded-lg hover:bg-gray-700/40">
  <div className="flex items-center gap-2 min-w-0 sm:flex-1"> …dot + email + (mobile remove)… </div>
  <div className="flex items-center gap-2 pl-4 sm:pl-0"> …dropdown + count + chevron… </div>
</div>
```

- **Dropdown popover** on mobile: `w-[calc(100vw-4rem)] max-w-xs` so it never exceeds the viewport; anchor
  left-aligned to the trigger. Option rows get `coarse-pointer:min-h-11`.
- **Touch targets:** every icon button (remove, chevron, dropdown trigger) carries
  `coarse-pointer:min-h-11 coarse-pointer:min-w-11` — the project floor (Button already bakes this for
  `iconOnly`). Desktop stays compact (fine pointer, no floor).
- **Recipient list scrolls, not the modal:** wrap the rows in
  `max-h-[40vh] sm:max-h-64 overflow-y-auto scrollbar-hide` so a 15-family team list scrolls internally
  while the header, Add-people input, General access, and Share button stay pinned. Clip-preview panels
  each cap at `max-h-40 overflow-y-auto` inside their row.
- **Revoke confirmation** on mobile: `max-w-sm mx-4`, buttons stack-friendly but fit side-by-side at
  ≥360px (two short buttons). Keep `justify-end gap-2`.

**ASCII — mobile (≈375px), two-line rows:**
```
┌────────────────────────────────┐
│ Share: Warriors vs Hawks    [X]│
├────────────────────────────────┤
│ Add people                     │
│ ┌────────────────────────────┐ │
│ │ type an email…             │ │
│ └────────────────────────────┘ │
│                                │
│ People with access            ⇅│  (list scrolls, max-h-40vh)
│ ┌────────────────────────────┐ │
│ │ ● sam@example.com       [X]│ │
│ │   [ Only tagged ▾ ] 3 clips▾│ │
│ │   ⚠ No tag match — 0 clips  │ │  (only if untagged)
│ │ ● dana@example.com      [X]│ │
│ │   [ All team ▾ ] 12 clips  ▾│ │
│ └────────────────────────────┘ │
│                                │
│ ── General access ──────────── │
│ 🌐 Anyone with the link        │
│   Watches the team recap.      │
│ [ Copy link ]  [ Revoke link ] │
│                                │
│ ⚠ 1 person → 0 clips. Send?    │
│      [ Cancel ] [ Share with 2]│
└────────────────────────────────┘
```

---

## All states — index of ASCII sketches above

| State | Section |
|-------|---------|
| Default (all-team selected) | Decision 1 + Layout overview |
| Tagged-only expanded with clips | Decision 3 |
| Untagged + tagged-only (0-clip warning) | Decision 2 |
| Game only (no clips) | Decision 1 |
| Revoke confirmation | Decision 4 |
| Revoked state | Decision 4 |
| Mobile (narrow) | Decision 5 |

---

## What I did NOT change (blast radius)

- **UserPicker internals:** untouched. It stays exactly as-is as the *add-people* input at the top of the
  modal (email validation, contacts dropdown, chip removal). The new recipient **rows** are a separate,
  new presentational block driven by the same `emails` array — I'm not modifying UserPicker's chips into
  rows, I'm rendering rows below it. (Open Phase-B choice: keep UserPicker chips visible too, or hide them
  once rows exist to avoid duplication — recommend hiding chips and letting the rows be the source of
  truth; flag for implementer.)
- **Backend contract:** unchanged in Phase A. The per-recipient `selection` field on
  `POST /api/games/{id}/share`, the preview counts/clips endpoint, and email→tag resolution surfacing are
  **Phase B**. This doc only assumes the already-existing fields (`name`, `rating`, `start_time`,
  `tagged_teammates`, email→tag_name mapping) can be read.
- **Public link endpoints:** `POST`/`DELETE /api/games/{id}/share-link` logic reused verbatim; only the
  surrounding layout and a revoke-confirmation gate are added. (Phase B should additionally hydrate
  current link active/revoked state on open — today's code fires blind.)
- **Email flow semantics:** the existing targeted per-player teammate email share (`share_with_teammates`,
  EPIC arch decision 6) is a **different** surface and is NOT touched. This modal's per-recipient control
  rides the game-share path.
- **No new entry points / no native share sheet** (explicit user rejection honored). This is a
  restructure of the one modal.
- **Recap/claim/edge pages** (T5710/T5720/T5730): untouched. This task polishes the *send* moment only.
- **Modal shell:** `bg-gray-800 rounded-xl border border-gray-700 max-w-md`, header, and Escape-to-close
  preserved; backdrop remains non-dismissing (already the case). Growth instrumentation (the other half of
  T5740) is not a UI concern and is out of scope for this proposal.

---

## Palette / icon summary (all reused from the existing modal + style guide)

| Element | Classes / icon |
|---------|----------------|
| Surfaces | `bg-gray-800` (modal), `bg-gray-700` (dropdown/inputs), `hover:bg-gray-700/40` (rows) |
| Borders | `border-gray-700` (sections), `border-gray-600` (controls) |
| Text | `text-gray-200`/`text-gray-300` (body), `text-gray-400` (labels), `text-gray-500` (meta) |
| Primary action | `<Button variant="cyan">` (Copy link, Share) |
| Neutral action | `<Button variant="ghost">` (Cancel, Keep link) |
| Destructive | `<Button variant="danger">` (Revoke link) |
| Warning (untagged/0-clips) | `text-amber-400`, `bg-amber-950/40 border-amber-800/50`, `AlertTriangle` |
| Selected option | `bg-cyan-600 text-white` + `Check` (matches UserPicker highlight) |
| Icons | `ChevronDown/Up`, `X`, `Check`, `Link2`, `Globe`, `GlobeLock`, `AlertTriangle`, `Users`, `UserCheck`, `Film`, `Star` (all lucide-react) |
| Rating pill | style-guide "Labeled metadata pill" (`RATING_ADJECTIVES` + `Star size={10}`) |
| Touch floors | `coarse-pointer:min-h-11 coarse-pointer:min-w-11` on icon buttons |
```
