# Athlete Profile

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Personalize the experience per athlete. Profiles store the athlete's name, team
name, and sport. Sport selection drives which annotation tags are available.

Six sports ship with pre-canned positional groups and tags: Soccer, Flag
Football, American Football, Basketball, Lacrosse, and Rugby. Users can also
type any custom sport -- they just start with no tags. Tags are fully editable:
users can modify pre-canned tags or create their own for any sport.

## Key Decisions

- **Sport field is open-ended text**, not an enum. A dropdown lists the six
  supported sports, but users can type any sport name and save it.
- **Default sport is Soccer** for new and existing profiles.
- **Tags are user-editable.** Pre-canned tags are seed data written to the
  database on first sport selection. Users can add, edit, or remove tags and
  positional groups for any sport.
- **Custom/unsupported sports have no tags.** The annotation UI works fine
  without tags -- users just clip without tagging. They can add tags later via
  the tag editing UI.
- **Positional groups are optional.** Tags are organized by position (Attacker,
  Midfielder, etc.), but positions are not required. Custom sports can have
  tags with no positional grouping.

## Reference

- [Sport Tags Reference](sport-tags-reference.md) -- all pre-canned sports,
  positions, and tag definitions

## Tasks

| ID | Task | Status |
|----|------|--------|
| T1610 | [Profile Fields](T1610-profile-fields.md) | TODO |
| T1620 | [Sport-Specific Tag Definitions](T1620-sport-specific-tag-definitions.md) | TODO |
| T1625 | [Custom Tag Editing](T1625-custom-tag-editing.md) | TODO |
| T1630 | [Sport-Driven Tag Selection](T1630-sport-driven-tag-selection.md) | TODO |

## Completion Criteria

- [ ] Profile stores athlete name, team name, and sport
- [ ] Sport selector: dropdown with 6 supported sports + free-text custom entry
- [ ] Changing sport changes the tags available during annotation
- [ ] Pre-canned tag definitions exist for all six sports
- [ ] Users can edit tags and positions for any sport (supported or custom)
- [ ] Custom sports work with no tags (annotation still functional)
- [ ] Existing profiles default to Soccer (backward compatible)
