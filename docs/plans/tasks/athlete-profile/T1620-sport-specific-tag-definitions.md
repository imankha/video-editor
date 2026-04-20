# T1620: Sport-Specific Tag Definitions

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-20
**Updated:** 2026-04-20

## Problem

Annotation tags are hardcoded for soccer only (`soccerTags.js`). With sport
selection on the profile (T1610), we need position/role categories and tags
for American Football, Basketball, Lacrosse, and Rugby.

## Solution

Research and define tag sets for each sport, following the same structure as
soccer: position categories, each with 2-4 tags (name + description).

### Sports to define

1. **American Football** -- positions: QB, WR/TE, RB, OL, DL, LB, DB, K/P
2. **Basketball** -- positions: Guard, Forward, Center
3. **Lacrosse** -- positions: Attack, Midfield, Defense, Goalie
4. **Rugby** -- positions: Forward, Back, Halfback

Each position gets 2-4 tags describing highlight-worthy plays for that role.

### Deliverable

One tag definition file per sport in `src/frontend/src/modes/annotate/constants/`,
following the same shape as `soccerTags.js`:

```javascript
export const {sport}Tags = {
  positionId: [
    { name: "TagName", description: "What this tag captures." },
  ],
};
export const positions = [
  { id: 'positionId', name: 'Display Name' },
];
```

## Relevant Files

- `src/frontend/src/modes/annotate/constants/soccerTags.js` -- reference structure
- New files: `footballTags.js`, `basketballTags.js`, `lacrosseTags.js`, `rugbyTags.js`

## Acceptance Criteria

- [ ] Tag definitions for all four new sports
- [ ] Each sport has position categories with 2-4 tags per position
- [ ] Tags are meaningful highlight plays for that sport/position
- [ ] Same export shape as soccerTags.js (tags object, positions array, getTagsForPosition, getAllTags)
