# T5695: Add Fastpitch Softball as a supported sport

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-07-23
**Updated:** 2026-07-23

## Problem

The editor supports 10 sports (soccer, football x2, basketball, lacrosse, rugby,
volleyball, hockey, tennis, baseball) but **not softball**. Fastpitch softball is a large,
highly-engaged travel/club youth market that mirrors our soccer-parent core audience: girls'
travel-ball families film every game and want per-player highlight reels for recruiting and
sharing. Baseball is already supported; softball is the obvious adjacent sport and is a
frequent parent ask.

Softball is **not** just baseball with a different label. The competitive game is
**fastpitch** (distinct from recreational **slowpitch**), with its own vocabulary — the
windmill/riseball pitching arsenal and the left-handed **slap** are signature plays that a
softball parent expects to see reflected. Getting the wording right signals the app was built
for their sport, not bolted on.

## Solution

Register `softball` as an 11th sport following the exact pattern the other 10 use. This is a
data/registration task — no new architecture. A sport = (1) a tag set file, (2) four
registry edits, (3) a backend curated-combo entry, (4) two test edits, and (optionally) a
marketing-page line.

Positions reuse the baseball grouping (Pitcher / Batter / Infielder / Outfielder) since the
diamond is identical. Tags are **fastpitch-specific** where it matters (Rise Ball, Slap Hit)
so the vocabulary reads as native to the sport rather than copy-pasted baseball.

### Naming decision (please confirm)

- **id:** `softball` (stored value — stable, never shown)
- **Display name:** recommend **"Softball"** for the header chip (short; the competitive youth
  game is understood to be fastpitch). Alternative: **"Fastpitch"** / **"Fastpitch Softball"**
  if we want the precise market term visible. Tag set is fastpitch either way.
- **Emoji:** `🥎` (U+1F94E, the softball glyph — parallels `⚾` for baseball).

## Context

### Market wording (research 2026-07-23)

Sourced terminology so the tags read native to fastpitch:
- **Fastpitch vs slowpitch:** "fastpitch" is the competitive girls'/women's game; slowpitch is
  rec/coed. Our audience is fastpitch.
- **Signature pitches:** *rise ball* (backspin pitch that appears to climb — the pitch that
  most distinguishes softball hitting from baseball), drop ball, windmill delivery, "pitcher's
  circle." A dominant riseball K is a highlight moment.
- **Slap / slapper:** a left-handed batter contacting while moving toward first — unique to
  fastpitch, instantly recognizable to these families.
- Sources: [Bruce Bolt — Softball Terms](https://brucebolt.us/blogs/news/softball-terms),
  [RGen Sports — Fastpitch pitch types](https://rgensports.com/blogs/news/fastpitch-softball-pitch-types-explained-rise-ball-drop-ball-curveball-changeup),
  [Wikipedia — Comparison of baseball and softball](https://en.wikipedia.org/wiki/Comparison_of_baseball_and_softball),
  [Wikipedia — Riseball](https://en.wikipedia.org/wiki/Riseball).

### Proposed tag set (`softballTags.js`)

Mirror `baseballTags.js` structure. Each tag needs a `name` + one-sentence `description`.

```js
export const softballTags = {
  pitcher: [
    { name: "Strikeout",  description: "Retiring a batter on a third strike." },
    { name: "Rise Ball",  description: "A climbing riseball that gets a swing-and-miss." },
    { name: "Pickoff",    description: "Throw that catches a baserunner off the bag for an out." },
  ],
  batter: [
    { name: "Home Run",   description: "Hit that clears the fence for a run." },
    { name: "Hit",        description: "Base hit that puts the batter safely on base." },
    { name: "Slap Hit",   description: "Slapper contact on the move that beats out a hit." },
    { name: "RBI",        description: "At-bat that drives in a run." },
  ],
  infielder: [
    { name: "Fielding",   description: "Clean glove work on a ground ball for an out." },
    { name: "Double Play",description: "Turning two outs on a single batted ball." },
    { name: "Throw Out",  description: "Strong throw across the diamond to retire a runner." },
  ],
  outfielder: [
    { name: "Catch",         description: "Tracking down a fly ball for an out." },
    { name: "Diving Catch",  description: "Full-extension grab to take away a hit." },
    { name: "Outfield Assist", description: "Throw from the outfield that retires a runner." },
  ],
};

export const positions = [
  { id: 'pitcher',    name: 'Pitcher' },
  { id: 'batter',     name: 'Batter' },
  { id: 'infielder',  name: 'Infielder' },
  { id: 'outfielder', name: 'Outfielder' },
];
```

### Proposed curated combos (backend `collections.py`)

Tag names must match the registry EXACTLY (case-sensitive). Mirror baseball:

```python
"softball": [
    _combo("softball_hits_homers", "Top Hits & Homers", {"Home Run", "Hit"}),
    _combo("softball_defense", "Top Defensive Plays", {"Strikeout", "Double Play"}),
],
```

### Relevant Files (REQUIRED)

**Create:**
- `src/frontend/src/modes/annotate/constants/softballTags.js` — new tag set + positions (mirror `baseballTags.js`).

**Edit (frontend registry — 4 edits in one file):**
- `src/frontend/src/modes/annotate/constants/tagRegistry.js`
  - import `softballTags` + `positions as softballPositions`
  - add `softball:` entry to `TAG_SETS`
  - add `{ id: 'softball', name: 'Softball' }` to `SUPPORTED_SPORTS`
  - add `softball: '🥎'` to `SPORT_EMOJI`

**Edit (backend):**
- `src/backend/app/routers/collections.py` — add `"softball"` entry to `CURATED_COMBOS` (line ~119).

**Edit (tests):**
- `src/frontend/src/modes/annotate/constants/__tests__/tagRegistry.test.js` — add `softball` to the
  `CURATED_COMBO_TAGS` map. The cross-language guard asserts
  `Object.keys(CURATED_COMBO_TAGS) === SUPPORTED_SPORTS ids`, and the tag-set/positions/glyph
  guards iterate `SUPPORTED_SPORTS`, so softball must appear here or the suite fails.
- `src/backend/tests/test_collections_summary.py` — **no edit needed**; `test_each_sport_curated_and_per_tag`
  is `@parametrize("sport", list(CURATED_COMBOS.keys()))`, so it auto-covers softball once the
  backend combo is added. (Verify it passes.)

**Optional (marketing):**
- `src/landing/src/App.tsx` — the `SPORTS` array (line ~58) mirrors the registry but currently
  advertises only 4 sports. Decision: add `{ name: 'Softball', emoji: '🥎' }` if we want it on
  the landing page, or leave the landing list as its curated marketing subset.

### Technical Notes

- Pure registration — no schema change, no migration, no persistence-path change. `sport` is a
  stored string on the profile/games; adding a new supported value needs no DB work.
- The registry test guard requires **every** `SUPPORTED_SPORTS` id to have a tag set with
  positions, every position to have >=1 tag, every tag a name+description, unique names within a
  sport, and a glyph. The proposed set satisfies all of these.
- Both the frontend `CURATED_COMBO_TAGS` test map and the backend `CURATED_COMBOS` must stay in
  lockstep — the cross-language guard fails loudly if they diverge.

### Related Tasks

- Pattern reference: baseball was the most recent sport added; copy its files.

## Implementation

### Steps
1. [ ] Confirm naming decision (display "Softball" vs "Fastpitch"; landing-page inclusion).
2. [ ] Create `softballTags.js` (mirror `baseballTags.js`, fastpitch tags above).
3. [ ] Wire the 4 `tagRegistry.js` edits (import, TAG_SETS, SUPPORTED_SPORTS, SPORT_EMOJI).
4. [ ] Add `softball` to backend `CURATED_COMBOS`.
5. [ ] Add `softball` to `CURATED_COMBO_TAGS` in `tagRegistry.test.js`.
6. [ ] (Optional) add Softball to landing `SPORTS`.
7. [ ] Run frontend `tagRegistry.test.js` + backend `test_collections_summary.py`.
8. [ ] Sanity-check in the app: select Softball, confirm positions/tags render and the 🥎 chip shows.

### Progress Log

**2026-07-23**: Ticket authored. Codebase surface mapped (11th sport = 1 new file + 4 registry
edits + 1 backend combo + 1 frontend test map; backend test auto-covers via parametrize).
Fastpitch terminology researched. Awaiting naming confirmation before implementation.

## Acceptance Criteria

- [ ] Softball selectable in the sport picker with the 🥎 glyph.
- [ ] Annotate shows the four positions and their fastpitch tags; tagging a clip persists `softball`.
- [ ] Collections surfaces the softball curated combos ("Top Hits & Homers", "Top Defensive Plays")
      and per-tag cards for softball reels.
- [ ] `tagRegistry.test.js` passes (all per-sport guards + cross-language combo guard include softball).
- [ ] `test_collections_summary.py::test_each_sport_curated_and_per_tag[softball]` passes.
- [ ] No schema change / no migration introduced.
