# T1620: Sport-Specific Tag Definitions

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-20
**Updated:** 2026-05-08

## Problem

Annotation tags are hardcoded for soccer only (`soccerTags.js`). With sport
selection on the profile (T1610), we need tag definitions for all six supported
sports.

## Solution

Create one static tag definition file per sport in
`src/frontend/src/modes/annotate/constants/`, following the same shape as
`soccerTags.js`. Register each in `tagRegistry.js`.

### Sports to define

Sourced from the [Sport Tags Reference](sport-tags-reference.md):

1. **Flag Football** -- 5 positions, 14 tags
2. **American Football** -- 8 positions, 21 tags
3. **Basketball** -- 3 positions, 6 tags
4. **Lacrosse** -- 4 positions, 10 tags
5. **Rugby** -- 3 positions, 9 tags

(Soccer already exists in `soccerTags.js`.)

### Deliverable

One tag definition file per sport, each exporting the same shape:

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

Then register in `tagRegistry.js`:

```javascript
import { flagFootballTags, positions as flagFootballPositions } from './flagFootballTags';
// ...
const TAG_SETS = {
  soccer: { positions: soccerPositions, tags: soccerTags },
  flag_football: { positions: flagFootballPositions, tags: flagFootballTags },
  // ...
};
```

## Relevant Files

- `src/frontend/src/modes/annotate/constants/soccerTags.js` -- reference structure
- `src/frontend/src/modes/annotate/constants/tagRegistry.js` -- sport registry
- New files: `flagFootballTags.js`, `footballTags.js`, `basketballTags.js`,
  `lacrosseTags.js`, `rugbyTags.js`

## Depends On

- T1610 (profile sport field)

## Acceptance Criteria

- [ ] Tag definitions for all five new sports
- [ ] Each sport has position categories with 2-4 tags per position
- [ ] Tags are meaningful highlight plays for that sport/position
- [ ] Same export shape as soccerTags.js
- [ ] All sports registered in tagRegistry.js TAG_SETS
