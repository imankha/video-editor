# Athlete Profile

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Personalize the experience per athlete. Profiles store the athlete's name, team
name, and sport. Sport selection drives which annotation tags are available.

Six sports ship with pre-canned positional groups and tags: Soccer, Flag
Football, American Football, Basketball, Lacrosse, and Rugby. Users can also
type any custom sport -- they just start with no tags.

## Key Decisions

- **Sport field is open-ended text**, not an enum. A dropdown lists the six
  supported sports, but users can type any sport name and save it.
- **Default sport is Soccer** for new and existing profiles.
- **Tags are static frontend constants** per sport. No DB storage for tags --
  keeps things simple. Custom tag editing deferred to a future epic.
- **Custom/unsupported sports have no tags.** The annotation UI works fine
  without tags -- users just clip without tagging.
- **Positional groups are optional.** Tags are organized by position (Attacker,
  Midfielder, etc.), but positions are not required.

## Reference

- [Sport Tags Reference](sport-tags-reference.md) -- all pre-canned sports,
  positions, and tag definitions

## Tasks

| ID | Task | Status |
|----|------|--------|
| T1610 | [Profile Fields](T1610-profile-fields.md) | TODO |
| T1620 | [Sport-Specific Tag Definitions](T1620-sport-specific-tag-definitions.md) | TODO |
| T1630 | [Sport-Driven Tag Selection](T1630-sport-driven-tag-selection.md) | TODO |

## Deferred

- **Custom Tag Editing** -- users editing/creating tags for any sport. Deferred
  to avoid DB schema for tag storage. Can revisit once tag usage patterns are
  clearer.

## Completion Criteria

- [ ] Profile stores athlete name, team name, and sport
- [ ] Sport selector: dropdown with 6 supported sports + free-text custom entry
- [ ] Changing sport changes the tags available during annotation
- [ ] Pre-canned tag definitions exist for all six sports
- [ ] Custom sports work with no tags (annotation still functional)
- [ ] Existing profiles default to Soccer (backward compatible)
