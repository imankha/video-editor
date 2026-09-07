# T8824: Intake - overlap is a signal, not a disqualifier (layered order editor)

**Status:** TODO (design approved 2026-09-07; implementation queued behind T8892 - shared
files, see progress log)
**Impact:** 8
**Complexity:** 7
**Created:** 2026-09-06
**Updated:** 2026-09-06

## Problem

EPIC decision 1 says: sort by embedded recording time, sanity-check the chain, and if
the chain OVERLAPS, treat the timestamps as export times and discard them wholesale.
That rule was written for one real fixture (the Legends/Trace export, whose
`creation_time` is the export time and whose halves therefore "overlap by 32 min").

Decision 7 (angles) needs the opposite: a phone clip filmed DURING the main camera's
recording is genuine overlap and is the epic's headline scenario. Today the intake is
blind to it: upload a real main camera + a real overlapping sideline clip and the
picker says "We couldn't tell what order these go in - please check" (yellow), shows no
overlap badge (T8822's badge only fires at confidence `time`), and - after the T8872
hotfix - sends no `recorded_at`, so no angle is created either. Before T8872 the
timestamps leaked through despite being "discarded", which is how a real angle was
seeded on 2026-09-06 at all (see T8892's recipe). The two decisions want opposite things
from the same signal, and the picker currently loses both ways.

**User direction (2026-09-06):** the intake should not disqualify overlap. There may be
more than one level of overlap (a main camera plus several phone clips, some overlapping
each other), and the picker should handle it with another layer - i.e. show overlap as
stacked lanes, draggable, so the user sees the same layered picture they will later get
in Annotate. This supersedes T8822's deliberately light-touch "overlap badge"
(chosen 2026-09-06 over a full lane preview; the user has since seen the real thing and
wants the lanes).

## Solution

Replace the wholesale-discard rule with a **placement model** that keeps trustworthy
timestamps, recognises genuine overlap as angles, and only treats overlap as an
export-time artifact when the evidence says so. Render that model in the picker as lanes
(lane 0 = main camera sequence, lanes 1+ = angles, violet, multiple levels), reusing
T8880's greedy lane-assignment so the picker's lanes are exactly Annotate's lanes. Send
`recorded_at` only for items the model trusts (keeps T8872's invariant).

**This amends an approved EPIC decision - it is design-gated.** Produce the design doc
(`docs/plans/tasks/T8824-design.md`), get the user's approval on the disambiguation
rule and the picker layout, then implement.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/footageIntake.js` - `inferOrder` (~L169-205) becomes
  `inferPlacement` (or returns a richer shape); the filename heuristics (`_orderByHalfWords`,
  `_orderByCounter`, `_orderByDate`) stay and become DISAMBIGUATION signals
- `src/frontend/src/hooks/useFootageIntake.js` - exposes the placement model (`order`,
  `confidence`, `gaps` stay for compatibility; add `lanes`/per-item `offsetSeconds`/`trusted`)
- `src/frontend/src/components/FootageList.jsx` (T8822) - becomes the layered editor;
  its overlap badge is superseded
- `src/frontend/src/components/GameFootagePicker.jsx` - payload gains per-item trusted
  `creationTime` (replaces T8872's blunt `confidence === 'time'` gate with the model's
  per-item verdict) and the `onFootageChange` contract stays `files:[{file, sequence,
  creationTime, originalFilename}]`
- `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js` - `buildGameTimeline`'s
  lane assignment (greedy lowest-free-lane, `OVERLAP_EPSILON_S = 1.0`, provably minimal).
  Extract the pure `assignLanes(intervals)` helper into a shared util so the picker and
  Annotate run the SAME code (this is its 2nd real use -> extract, per the
  abstract-on-3rd rule read leniently because divergence here would be a correctness bug,
  not a style issue; keep it a plain named function, no registry)
- `src/frontend/src/utils/footageDisplay.js` - `overlapGroups`/`shortLabel` (T8822)
  either feed the new lanes or are deleted
- Tests: `footageIntake.test.js`, `FootageList.test.jsx`, `GameFootagePicker.test.jsx`,
  `useVirtualTimeline.test.js` (the extracted helper must keep T8880's tests green
  unmodified), `T8820-confirm-strip-reorder.qa.spec.js` (+ a new overlap e2e)
- Backend: no change expected - `compute_video_offsets` (T8870) already places from
  `recorded_at`; verify end-to-end only

### Related Tasks
- Depends on: T8872 (hotfix, merge first - this task replaces its gate but must keep its
  invariant), T8822 (STAGING - superseded here), T8880 (lane algorithm to share)
- Strongly prefer after: T8892 (real angle names - the lane rows should show `sideline`,
  not a hash)
- Amends: EPIC.md decision 1 (rewrite it in the same commit) and decision 3's "confirm
  strip" wording; note the T8822 badge is retired
- Read FIRST: `.claude/knowledge/annotate.md` (intake + T8880/T8890 sections), EPIC.md
  in full (evidence table + decisions 1, 3, 7, 9)

### The disambiguation problem (the design gate's core question)
The three real fixtures the epic was built on (EPIC.md evidence table):

| Fixture | Timestamps | Truth |
|---|---|---|
| DJI Action folder (4 segments) | sequential chain, 9-min halftime gap | sequential, one camera |
| Legends/Trace export (`...1st-half...`, `...2nd-half...`) | overlap by 32 min (export times) | sequential, one camera - timestamps are garbage |
| Phone clip during the DJI game | inside the main camera's span | genuine angle |

Candidate signals, roughly in order of trust (the design doc must pick, combine, and
show its work against all three fixtures plus the multi-level case):
1. **A decisive filename order** (half-words, shared-prefix counters, embedded dates)
   among the overlapping files => they are segments of ONE recording => sequential;
   their timestamps are export artifacts => untrusted (send `null`). This alone resolves
   Legends.
2. **Same camera family** (shared filename prefix, same resolution/fps/codec) + overlap
   => a single camera cannot record two overlapping files => artifact => sequential.
3. **Different camera family** (e.g. 7680x4320 HEVC `DJI_*` + 1080x1920 H.264 `VID_*`/
   `IMG_*`) + overlap => genuine angle => trusted.
4. **Overlap geometry**: a short file wholly inside a long one reads as an angle; two
   long files overlapping by a fixed delta reads as an artifact. Weak on its own.
5. **Ask, never block** (decision 1's rule stands): when 1-4 do not agree, one plain
   question with a safe default ("Are these two cameras filming at the same time, or two
   parts of one recording?"). Submit is never gated.
The model must also handle: a chain with a genuine gap AND an angle; two angles that
overlap each other (=> lane 2); an angle that runs past the main camera's end (=>
T8880's coverage extension); no main camera at all (two phones) - all already specified
for Annotate in T8880's tests, so the picker's lanes have a ground truth to match.

### Technical Notes
- Item metadata already available client-side per file: `name`, `size`, `duration`,
  `creationTime`, and (from the probe) width/height - check `extractVideoMetadata` for
  codec/fps and extend if needed for signal 2/3.
- Picker layout (propose in the design doc, artifact-with-mockups per project
  convention): lane 0 = the existing draggable list (T8822) = main camera order; each
  angle rendered in its own violet lane row positioned by offset, labelled with its name
  and "overlaps {main file} from mm:ss to mm:ss"; overlapping angles stack into lane 2+;
  drag stays lane-0-only in v1 (moving an angle in time is T8900's Fix-timing job in
  Annotate). Mobile: keep it usable at 360-428 px.
- Trust-line copy for the new states (approved-microcopy tone, "angle" never "lane"):
  e.g. "Put in order by the time each was recorded - 1 angle found", "These look like
  two parts of one recording - put in order by their names".
- Persistence: none new. `recorded_at` on create/attach is the only write, gesture is
  still the Add Game submit.

## Implementation

### Steps
1. [ ] Architect design doc: disambiguation rule (show it resolving all fixtures + the
   multi-level case), placement-model shape, picker lane layout with mockups, copy.
   **User approval required** (this rewrites EPIC decision 1).
2. [ ] Extract `assignLanes` from `buildGameTimeline`; T8880's suite green unmodified.
3. [ ] `inferPlacement` + unit tests: DJI chain (sequential/time), Legends (artifact =>
   sequential, `null` timestamps), phone-in-main (angle, trusted), main + 2 phones
   overlapping each other (3 lanes), same-camera overlap (artifact), ambiguous (ask
   state), no-main two phones, angle past main's end.
4. [ ] Layered `FootageList`; component tests; responsive sweep 360/390/428.
5. [ ] Payload: per-item trusted `creationTime`; assert `recorded_at` end-to-end via
   `GET /api/games/{id}` for the angle case (non-null, overlapping offsets) and the
   Legends case (`null`, prefix-sum).
6. [ ] E2E: real ffmpeg-generated main + sideline (T8892's recipe) through the real
   upload -> picker shows 2 lanes -> Annotate shows the angle named `sideline`; and the
   Legends-shaped pair -> 1 lane, sequential.
7. [ ] EPIC.md decision 1 rewritten; `annotate.md` updated; T8822's badge retired.

### Progress Log

**2026-09-06**: Filed from the live local-stack test of T8890 and the user's direction
that overlap must be handled with layers, not disqualified.

**2026-09-06/07**: Architect design pass complete (`docs/plans/tasks/T8824-design.md` +
`T8824-picker-mockup.html`, 7-screen sweep). Presented as a decision artifact
(https://claude.ai/code/artifact/525bdf7a-f59f-4a8b-a098-da3bc2a18cba); user approved as
recommended on all 7 open questions 2026-09-07. **Implementation queued, not yet spawned**:
the supervisor found `GameFootagePicker.jsx` (the payload-emitting effect) and
`useVirtualTimeline.js` (`buildGameTimeline`) are shared primary files with T8892, which
is already mid-flight in its own container - per the project's file-ownership rule this
sequences behind T8892 rather than running concurrently, to avoid wasted rework/merge
conflicts. Also matches this task file's own "Strongly prefer after: T8892" note. Will
spawn the implementation container the moment T8892 is pushed and merged, branching from
the resulting master so the naming/chip work is already present.

## Acceptance Criteria

- [ ] All three real fixtures place correctly (DJI sequential, Legends sequential with
      `null` timestamps, phone-in-main as an angle), plus main + 2 mutually overlapping
      phones => exactly 3 lanes in the picker AND in Annotate (same helper)
- [ ] No untrusted timestamp ever reaches `recorded_at` (T8872's invariant, now per item)
- [ ] Picker lanes match Annotate lanes for the same files (shared `assignLanes`)
- [ ] Submit is never blocked; ambiguous cases ask with a safe default
- [ ] Angle-free uploads render the picker exactly as T8822 left it (one list, no lanes)
- [ ] Design doc approved by the user before implementation; curated tests + both e2e
      flows green; Reviewer pass
