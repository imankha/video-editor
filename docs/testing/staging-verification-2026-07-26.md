# Staging Verification Prompt — 2026-07-26 release

**Paste everything below to a fresh AI session with Playwright access.** It is self-contained.

---

You are verifying a batch of changes on the **staging** environment of a browser-based soccer video
editor. Six tasks shipped tonight. Your job is to drive the real app in a real browser and report
what you actually observe — not what the code says should happen.

## Environment

- **Frontend (staging):** the Cloudflare Pages staging site for this project
- **API (staging):** `https://reel-ballers-api-staging.fly.dev`
- Staging Stripe is in **TEST mode** — use test cards (`4242 4242 4242 4242`, any future expiry, any
  CVC). No real money moves. Buying credits here is expected and safe.
- Confirm you are on the right build before testing anything:
  `curl -sI https://reel-ballers-api-staging.fly.dev/api/version | grep -i x-app-version`
  It must be `35b35b16` or later. If it is older, STOP and report — the deploy has not landed.

## Authentication

Use the real-account path so you see real data (a blank test profile will make most of this
unverifiable):

```js
import { loginAsRealUser } from './helpers/realAuth';
await loginAsRealUser(context, 'imankh@gmail.com');
await page.goto('/');
```

`dev-login` runs the same init path a real login runs (R2 download + profile selection) and mints a
real session cookie. The `X-User-ID`/`test-login` bypass does NOT load real data — do not use it here.
See `.claude/skills/drive-app-as-user/SKILL.md`.

## Ground rules

1. **Assert on what the user SEES** — rendered text, visible controls, actual state — not on API
   responses. Several of tonight's bugs were cases where the API was fine and the UI lied.
2. **A passing test you did not watch is not evidence.** Capture screenshots at each checkpoint.
3. **Report failures precisely:** what you did, what you expected, what appeared, plus a screenshot
   and any console/network errors.
4. **Do not fix anything.** Report only.
5. If something is unreachable in this environment, **say so explicitly** rather than marking it
   passed. An untested item must be reported as untested.

---

# What to verify

## 1. Update gate — must appear ONCE, not twice (T5930)

**The bug:** the "New version" screen appeared before login AND again after logging in. Root cause:
the version-mismatch path did a plain `window.location.reload()`, which does not `skipWaiting`, so
the old service worker re-served the old bundle and the newly-installed one stayed waiting — then
raised a second gate.

**Test:**
- Load staging fresh (clear service workers first: DevTools → Application → Service Workers →
  Unregister, then hard reload). Log in.
- **Expect: at most ONE "New version" gate.** Seeing one gate as it updates onto the new bundle is
  CORRECT. Seeing a second one after login is the bug.
- If a gate appears, click "Update now" and confirm the app lands on the new build and does **not**
  gate again.
- Repeat once more from a cold load to be sure it does not re-fire on a build already accepted.

## 2. Credits — now served from Postgres (T5840)

Credits moved out of per-user SQLite into a Postgres ledger tonight, and the data was migrated live.
This is the highest-risk item in the release.

**Test:**
- **Balance displays correctly** on load, and **survives a hard refresh** (it should — it now reads
  from Postgres).
- **Buy a credit pack** with the test card. Verify: balance increases by exactly the pack amount,
  once. Refresh — the new balance persists.
- **Buy a second pack.** Confirm it adds again correctly (idempotency must not block a *distinct*
  purchase).
- **Spend credits** — run a framing/export operation and confirm the balance decrements by the
  expected amount and does not go negative.
- **Transaction history**, if surfaced in the UI: confirm past purchases appear with sensible dates.
  Historical purchases were migrated and should have kept their ORIGINAL dates (May/June), not
  today's.
- **Watch for any `503` on a credit action.** There is a migration gate that 503s all credit
  mutations when closed; it was opened tonight and should stay open. A 503 here is a real finding.

## 3. Sync status — pending must not read as failure (T5870)

**The bug:** "your edits aren't saving" fired during ordinary editing. A 0.5s upload-lock *defer*
(71% of syncs under burst editing) was reported as a *failure*, and the banner had no working Retry —
only a page refresh cleared it.

**Test:**
- **Burst-edit rapidly** — make many quick changes in Annotate/Framing (add clips, drag keyframes,
  rename things) as fast as the UI allows, for 30+ seconds.
- **Expect: NO alarming "not saving" banner during normal editing.** A quiet "Cloud backup pending"
  is acceptable and expected under load. A red/alarm "Could not save to the cloud" during ordinary
  editing is the bug returning.
- If an alarm banner DOES appear: confirm a **Retry** button is present, click it, and confirm the
  banner clears **without a page refresh**. Needing a refresh is the original bug.
- **Verify edits actually persisted**: hard refresh and confirm your changes are still there. This
  matters — the fix makes "pending" quieter, so it must not be quieter *and* lossy.
- Note anything that flashes an alarm briefly and then disappears — that would be a regression the
  fix specifically targeted.

## 4. Tournament / month grouping (T5880)

New derived grouping in Collections. Nothing to file — it groups automatically from existing game
metadata.

**Test:**
- Open **Collections** and find the **By game / By tournament / By month** toggle.
- **By tournament:** games with a tournament name group under it; each group is expandable and shows
  its games beneath (two-level: tournament → game).
- **By month:** groups by game date with a readable label (e.g. "July 2026").
- **Games with no tournament name must render flat, NOT in an "Unknown" bucket.** A fabricated
  "Unknown tournament" group is a bug.
- Toggling between axes and back must not lose or duplicate games.
- **Check both viewports: 390px and 1280px.** Nothing may overflow horizontally.
- The toggle is view-only state — it should NOT persist across reloads (a remembered filter that
  makes the app look broken on return is an anti-pattern here).

## 5. Game posters (T5890, shipped earlier — regression check)

Poster images on game cards. Previously broken on staging because URLs were relative and resolved to
the frontend host instead of the API.

**Test:** open the games list and confirm posters **render as images** (not the branded fallback
placeholder). Check the network tab: poster requests must go to the **API host** and return
`image/jpeg`, not `text/html`.

## 6. Reel tiles + player (T5860, T5900, T5910 — regression checks)

- **Play a reel**: the video renders **inside** its panel, correctly sized, with no large black dead
  area and no video painted outside the panel edge.
- **After closing**, no leftover artifact burned into the originating tile.
- **Overlay is modal**: while a reel is playing, clicking the backdrop must NOT interact with tiles
  underneath — and must NOT close the player (backdrop clicks should be swallowed, by project
  convention).
- **Resize the window narrow (~478px) while using a MOUSE**, then hover a reel tile: the action
  buttons (preview, rename, Framing, Overlay, delete) **must appear on hover**. This specifically
  regressed before at narrow desktop widths.

---

# Explicitly OUT of scope

**Do not attempt to test cross-machine sync conflicts.** Production runs a single backend machine, so
a CAS conflict cannot be produced. It is tracked as T5950 and blocked until we scale out. If you see
a "conflict" banner, that is unexpected — report it.

---

# Report format

For each of the 6 areas:

```
AREA: <name>
STATUS: PASS | FAIL | PARTIAL | UNTESTABLE
STEPS: <what you actually did>
OBSERVED: <what you saw — quote rendered text>
EVIDENCE: <screenshot filenames>
```

Then finish with:
- **Regressions found** (anything that worked before and does not now) — highest priority
- **Anything you could not test, and why** — do not silently omit
- **Console errors / failed network requests** seen at any point

Be blunt about failures. A false PASS here is worse than no test at all — this release moved money
storage and rewrote the sync-status state machine.
