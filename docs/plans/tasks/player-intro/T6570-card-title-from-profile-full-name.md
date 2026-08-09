# T6570: The card title comes from the profile, not a text box

**Status:** TODO
**Impact:** 7 | **Complexity:** 3
**Follows:** [T5190](T5190-card-image-upload-consent.md) (profile facts), [T5205](T5205-card-editor-ui.md)

## Problem

User, 2026-08-05:

> On the intro card, we shouldn't let the user type text. We should be grabbing it from the profile.
> Add "Full Name" to the profile settings and just add that into title.

Today the card's title is a free-text box (`title_text`), so a user types their kid's name onto every
card and retypes it on every new one. The name is a **property of the athlete**, not of a card — the
same reasoning that moved position/class/team onto the profile in epic decision 3.

## Scope

- **Add `full_name` to the profile facts.** Follow the EXISTING precedent exactly: position, class
  and team are stored in the per-profile `user_settings` key/value table, **not** as columns on
  `profiles`. So this needs **NO migration** — it is another setting alongside them. Do not add a
  column, and do not reuse `profiles.name` (that is the profile's short label, e.g. "Stafford",
  which users pick for the profile switcher — a different thing from a full name).
- **Surface it in profile settings** next to position / class / team, same gesture-based save.
- **The card title reads `full_name`.** Remove the title text box from the card editor.
- **An unfilled `full_name` behaves like any other unfilled fact:** the card editor shows the same
  inline "Add it" prompt that position/class/team already use, and the renderer omits-and-logs rather
  than drawing a blank line. Do not invent a placeholder string.

## Added 2026-08-05 — a free-text SUBTITLE

User: *"I also see the need for users to want to include the tournament name or some free sub-heading
text. Please work that in where the user can turn on subtitle and type it."*

This is not in tension with removing the title box — it clarifies the split. **A name is a property of
the athlete** (profile). **A tournament name is a property of THIS card** (free text). Title stops
being typed; the subtitle becomes the one place free text lives.

**The contract used to have a subtitle slot and it was deliberately removed** — `intro_card_geometry.py`
still says *"There is deliberately NO subtitle slot: the shipped schema has only title_text."* That was
correct when nothing fed it. It no longer is. **The approved geometry values are in commit `c806e2a5`,
before their removal** — recover them rather than inventing new numbers, since they went through the
design gate.

What it needs:
- A nullable **`subtitle_text`** column on `intro_cards` via a profile_db migration (**include the
  Migration agent** — this changes the classification). Do NOT repurpose `title_text`; a column named
  title_text holding a subtitle misleads every later reader.
- Next version is likely **v035**, but VERIFY against unmerged sibling branches first — the runner
  applies only versions greater than the DB's current `user_version`, so a duplicate is silently
  skipped and the column is never created.
- Mirror the DDL in `database.py::ensure_database()` so fresh profiles get it (v034's pattern).
- Column-guard hot reads for the deploy→migrate window (T6030 pattern) **and the write** — an
  unguarded write is already an open bug ([T6550](T6550-poster-marker-write-unguarded.md)); do not add
  a second instance.
- Restore the subtitle slot in the shared contract: geometry for 4 compositions × both aspects, the JS
  mirror, the parity test, and `STAGGER_ORDER`.
- **Composition derivation is UNCHANGED** — the subtitle is orthogonal, like treatment. It must not
  count toward the fact count or change which composition is derived.

## Added 2026-08-05 — stop naming the layout

User: *"we don't need to tell the user the name of the layout."*

Partially reverts [T6540](T6540-card-editor-information-design.md), which had deliberately promoted the
composition badge into prominent feedback. Remove the layout NAME wherever it surfaces. Keep the causal
signal if it can be expressed without naming a layout ("The layout adapts to the facts you show" is
fine; "…currently Recruiting" is not) — the fact→layout relationship is still the only thing that makes
the facts checkboxes make sense. Note the current caption ends with "(named on the card)", which refers
to the badge being removed and will dangle.

## Decisions to make and state

- **`title_text` already exists on `intro_cards`** and holds typed titles for cards created before
  this change. Decide: keep reading it as an override when present (grandfathered, like T6510's
  uploads), or migrate those values into the profile. Grandfathering is likely simpler and safer —
  whichever you choose, say so, and make sure a card created after this change never depends on it.
- The task file for T5205 described `title_text` as "free-text title (title-only cards, or an
  override)". If the override concept survives, keep that wording true; if it does not, update the
  schema comment so the next reader is not misled.

## Relevant files
- `src/backend/app/services/user_db.py` — `user_settings`, and the existing position/class/team
  read/write pair (~line 667 carries the decision-3 comment explaining the pattern)
- profile settings UI (wherever T5190 put position/class/team)
- `src/frontend/src/components/introcards/IntroCardRail.jsx` — the title text box to remove
- `src/frontend/src/components/introcards/introCardPreviewElements.js` + `player_intro.py` —
  wherever the title's text is resolved; BOTH sides must agree (preview must match export)
- `src/backend/app/migrations/profile_db/v034_intro_card_library.py` — the `title_text` comment

## Classification hint
M-tier. Frontend + Backend. **No migration** (user_settings is key/value). Reviewer required.
The preview/export parity test must cover the new title source.

## Acceptance criteria
- [ ] "Full Name" is editable in profile settings, saved on a named gesture, stored in `user_settings`
      alongside position/class/team — no new column, no migration.
- [ ] The card editor no longer has a title text box.
- [ ] The card title renders from the profile's full name in BOTH the browser preview and the export.
- [ ] An unfilled full name prompts inline in the editor and is omitted-and-logged by the renderer.
- [ ] The decision on legacy `title_text` is implemented and documented; a newly created card does not
      depend on it.
- [ ] Changing the full name on the profile updates every card that shows it, with no per-card edit.
