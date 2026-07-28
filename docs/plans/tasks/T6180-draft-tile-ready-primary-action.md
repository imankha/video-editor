# T6180: A ready Draft Reel has no primary action — "Ready" is a status pretending to be a button

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-28
**Reported by:** the user, after not being able to find how to publish a finished reel

## What is wrong

`DraftTile.jsx:364-376` renders the publish affordance as a **corner badge**:

```jsx
{isReadyToPublish && (
  <button ... aria-label={`Move to ${SECTION_NAMES.LIBRARY}`}
    className="absolute top-1.5 left-1.5 z-30 ... px-2 py-1 rounded-full text-[10px] font-semibold bg-cyan-500/90 ...">
    {isPublishing ? <Loader2 size={12}/> : <Image size={12}/>}
    Ready
  </button>
)}
```

Its own docstring calls it a *"ready-to-publish corner badge"*. Three compounding problems:

1. **The label is a status, not a verb.** It says "Ready". The verb ("Move to My Reels") is only in
   `aria-label`/`title`, so a sighted mouse user never sees it. Nobody clicks a status.
2. **It is 10px in a corner**, competing with the status chip in the opposite corner
   (`:379`) and the action rail at `top-9 right-1.5` (`:434`).
3. **The tile itself goes inert exactly when it matters**: `onClick={isReadyToPublish ? undefined :
   handleCardClick}` (`:307`) plus the early return at `:236`. So on the one card the user most wants
   to act on, the whole surface stops responding and only that 10px pill works.

Net effect: the primary action on a finished reel is the hardest thing on the card to hit. The user
could not find it at all.

## The user's direction (this is the brief — follow it)

> *"I feel like Ready is a status, as such should be a badge. We need a main button, play, and the
> rest of the buttons in a kebab once ready."*

So, for a **ready** draft (`has_final_video && !is_published`):

| Element | Treatment |
|---|---|
| **"Ready"** | a **non-interactive status badge** — it stops being a button |
| **Move to My Reels** | the **primary, emphasized** action — unmistakably the main thing |
| **Play / Preview** | a clear secondary action, visible not hidden |
| Rename, Framing, Overlay, Hide, Delete | collapse into a **kebab** menu |

## Current action inventory (all must stay reachable)

From the rail at `:434-450` — every one of these must survive the reorganization:

| Action | Icon | Condition |
|---|---|---|
| Preview video | `Play` | `isComplete && project.final_video_id` |
| Rename reel | `Pencil` | always |
| Open in Framing | `Crop` | `isComplete` |
| Open in Overlay | `Layers` | `isComplete` |
| Hide from Drafts | `EyeOff` | `isComplete && !isReadyToPublish` |
| Delete reel | `Trash2` | always (two-click confirm) |

Do NOT drop any of them, and do NOT change what they do. This is a **presentation** change.

## Watch out for

- **Only restructure the ready state** unless you can argue otherwise. Non-ready tiles (still
  exporting, or already published) have their own layouts and their own specs — a blanket rewrite
  risks regressing surfaces this task was not asked to touch. If you do change the shared layout,
  say so explicitly and show those states still work.
- **Fix the inert-tile problem** (`:307`, `:236`). Decide deliberately what a tile click does in the
  ready state — publish, preview, or nothing — and state the choice. "Nothing" is what it does today
  and it is the reason the user was stuck.
- The two-click delete confirm (`showDeleteConfirm`) must keep working inside a kebab. Verify it,
  because a menu that closes on click will silently break the second click.
- The **publish-failure retry UI** at `:452+` (`publishRetry`, T4050) must stay reachable and must not
  be hidden behind the kebab — a durable sync failure is exactly when the user needs it visible.
- `DraftTile.test.jsx:154` asserts *"renders the ready-to-publish badge (Move to My Reels) only when
  complete and unpublished"*. That test pins the current shape; update it to the new contract and
  give it an explicit disposition rather than deleting it.
- Mobile: the rail is a hover/long-press sheet with `coarse-pointer:min-h-[44px]` sizing. Whatever
  you build must keep >=44px touch targets and work without hover. `isCoarsePointer` long-press
  handlers are at `:240-311`.
- Quest instrumentation: publishing records `moved_to_my_reels` (`:107`). Keep it firing exactly once
  per publish.

## UI Designer gate

This is a visual/interaction change with real layout latitude, so **produce the specific treatment
for approval before implementing** (layout, hierarchy, Tailwind classes, states, mobile behaviour) —
see `.claude/agents/ui-designer.md` and `.claude/references/ui-style-guide.md`. The user's brief above
fixes the *structure*; the designer fixes the *specifics*. Do not free-style a new visual language.

## Acceptance criteria

1. "Ready" is a non-interactive badge; the primary action reads as an action and names the verb.
2. Play is a visible secondary action; the remaining five actions live in a kebab and all still work.
3. A stated decision on what a tile click does in the ready state, and the inert-tile behaviour is
   gone.
4. Two-click delete, the publish-retry UI, and the `moved_to_my_reels` quest record all verified intact.
5. Real-browser verification at 375px and desktop, with evidence per criterion; non-ready and
   published tile states shown unregressed.
6. Frontend unit suite green. **Baseline 2026-07-28: 139 files / 1420 tests.**
