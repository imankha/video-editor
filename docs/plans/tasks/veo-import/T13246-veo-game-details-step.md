# T13246: Game details (opponent, date, Home/Away/Tournament) when making a game from a Veo zip

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-10-25
**Updated:** 2026-10-25 (code paths anchored)
**Decisions:** Q1-Q5 decided 2026-10-25 (all recommendations accepted). No design gate left; implement as specified.
**Epic:** [Veo Highlights Import](EPIC.md). Follows T13245 (a Veo zip with no game becomes one game).
**Tier:** M (frontend only, ~5 files, one extraction of a 3rd duplicate, no schema or endpoint change)

## Problem

"Make a game from these highlights" (T13245) creates the game straight from the pick list with only
a title taken from the zip name. Every other way to create a game (the Upload game dialog) offers the
game details: opponent, game date, Home / Away / Tournament (plus tournament name). A Veo game
therefore lands without a date or game type. It files under the upload month instead of the match
date, can't be told apart from another match against the same team, and the parent has to find
Edit game afterwards to fill it in. (User request 2026-10-25.)

## Solution

Give the Veo "make a game" flow the same **Game details (optional)** section the Upload game dialog
has, filled in from the zip where the zip honestly says something.

1. **Where:** in the pick list's game mode (`VeoZipPickList`, `gameMode`), between the moment list and
   the footer, a `<details>` **"Game details (optional)"** exactly like `GameDetailsModal`'s
   (`data-testid="game-details-disclosure"`). Same open rule as Upload game: collapsed, but opened when
   the name autofill filled something (`GameDetailsModal.jsx:133` `setDetailsOpen(true)`), so the parent
   sees the prefill. Either way the flow stays pick -> Create (no extra required gesture). The Create button stays visible (the dialog body scrolls,
   the footer does not; T13245 measured 85 moments fits at 844 px).
2. **Fields:** the SAME fields as the Upload game dialog: Opponent Team, Game Date, Game Type
   (Unknown / Home / Away / Tournament), Tournament Name with the existing-tournaments dropdown when
   Tournament is picked. Values pass through the T13245 payload (`opponentName`, `gameDate`, `gameType`,
   `tournamentName`) into the existing game intake (`onAnnotateWithFile` -> `uploadMultiVideoGame` ->
   `POST /api/games`, which already accepts all four). No new endpoint.
3. **Prefill (only what the zip honestly carries; see "Date evidence" below).** REUSE the existing
   filename autofill parser `parseGameFilename` (`src/frontend/src/utils/gameNameParser.js:100`, used by
   Upload game at `GameDetailsModal.jsx:126`) on the zip title (`veoGameTitle`), do not write a second
   parser. Measured on the real zip names 2026-10-25 it needs two extensions (add cases to
   `gameNameParser.formats.test.js`):
   - "(1st Half)" / "(2nd Half)" stays in the opponent today ("Legends FC San Diego (1st Half)"): strip it
     (same regex as `zipOpponent`, `utils/veoHighlights/routing.js:12`).
   - "{Team} vs. {Opponent}" returns `ourTeamName: null` (e.g. "WCFC B2012 vs. SD Surf"): capture our team.
   - "Scrimmage Game 10_4_25" returns null: correct per Q3 (10_4_25 is ambiguous M_D vs D_M), leave empty.
   - Opponent: the zip's opponent in original case (`Veo highlights {Team} vs. {Opponent} (1st Half).zip`
     -> "Legends FC San Diego"). The disclosure's hint line reads "Filled in from your zip's name. Check
     it's right." (same copy pattern as the filename autofill).
   - Date: empty, unless the zip name itself contains a date (e.g. "Scrimmage Game 10_4_25"); see Q3.
   - Type: Unknown. Tournament: empty.
   - Our team: the `{Team}` part feeds the same "confirm our team onto the profile when it has none"
     step the Upload game dialog runs after a successful submit (`parsedOurTeam` -> `setIntroFact`), Q4.
4. **One shared fields component (refactor rule: abstract on the 3rd duplication).** The opponent /
   date / type / tournament block exists twice today (`GameDetailsModal.jsx` ~382-470,
   `EditGameModal.jsx` ~125-200). Extract a presentational `GameDetailsFields` (props: values, setters,
   `existingTournaments`, `disabled`, `required` for EditGameModal's `*` labels) as a SEPARATE
   mechanical commit first (characterization: the existing GameDetailsModal / EditGameModal tests stay
   green unchanged), then use it in all three places. The tournaments fetch stays with each caller (or
   a tiny shared hook) as today.
5. **Title rule (important, decided by T13245):** `GET /api/games` rebuilds a game's display title as
   "Vs {opponent} {date}" (or "at ..."/"{Tournament}: Vs ...") WHENEVER an opponent is set; the stored
   name is only the fallback. So:
   - Opponent left empty -> the game keeps the zip title ("WCFC vs. Legends FC San Diego (1st Half)").
   - Opponent filled -> the title follows the app's normal naming like every other game ("at Legends
     FC San Diego Mar 28"). This is consistent, but it drops "(1st Half)", see Q2.
   The prefill must not silently change the title the user expects; the disclosure shows a one-line
   preview of the resulting title ("Game title: at Legends FC San Diego Mar 28") computed with the same
   rule (frontend mirror of `generate_game_display_name`, or read back from the create response).

## Date evidence (why the date is not prefilled from the zip)

Measured 2026-10-25 on the 6 Veo zips in Downloads: zip entry timestamps are the DOWNLOAD day
(2026-10-19 on every entry), and the MP4 `mvhd` creation time is zero in most clips and, where present,
inconsistent within one zip (Legends 1st Half: 2025-09-24 17:30, 09-24 17:33, 09-23 04:17), i.e. render
time, not match time. Neither is a match date. Only a date written in the zip NAME is evidence.

## Decisions (DECIDED 2026-10-25: user accepted every recommendation)

| # | Question | Decision (2026-10-25) |
|---|---|---|
| Q1 | Prefill Opponent from the zip name? | **Yes**, editable; it is the zip's own words. |
| Q2 | With an opponent set, the title loses "(1st Half)" and both halves get the same title. | **Accept for now** (halves become "... (2)" via unique naming) and show the title preview so it is never a surprise. A real fix (halves as one game with 2 videos, or a "Half" field) is a separate task. |
| Q3 | Parse a date from the zip name ("10_4_25", "10-4-25", "Oct 4")? | **Yes, only an unambiguous M_D_YY / M-D-YY / YYYY-MM-DD in the name**, else empty. Never from entry or mvhd times. |
| Q4 | Confirm "{Team}" onto the profile as our team when the profile has none? | **Yes**, same rule as the Upload game filename autofill (only after a successful create, never overwrite). |
| Q5 | Also offer details on Path A (import into an existing game)? | **No.** That game already has its details; Edit game covers changes. |

## Context

### Relevant Files (REQUIRED)
Anchors are origin/master @ 397f41193 (2026-10-25); re-grep before editing.

**The Veo "make a game" flow (where the details step goes)**
- `src/frontend/src/components/VeoZipRouter.jsx` - "Make a game from these highlights" (`veo-route-game`) opens the pick list in `gameMode`
- `src/frontend/src/components/VeoZipPickList.jsx:19` `VeoZipPickList({ gameMode, onCreateGame })`; `:66` `handleCreateGame` (the Create gesture); `:80` builds the payload `{ name: veoGameTitle(...), files, veoSuggestions }`, add `opponentName/gameDate/gameType/tournamentName` here; `:175` the Create button (`veo-add`)
- `src/frontend/src/utils/veoHighlights/clipImport.js:35` `veoGameTitle(zipName)` - the zip title the parser reads
- `src/frontend/src/utils/veoHighlights/routing.js:12` `zipOpponent` - half-suffix regex to reuse
- `src/frontend/src/components/ProjectManager.jsx:1313` `handleVeoCreateGame` -> `onAnnotateWithFile(gameDetails)` (passes the payload through unchanged; verify) ; `:2551` wiring

**How the details travel to the server (already supports all four fields; verify, don't rebuild)**
- `src/frontend/src/screens/ProjectsScreen.jsx:29` `getPendingGameDetails` whitelist (`opponentName/gameDate/gameType/tournamentName` already listed, `name` added by T13245)
- `src/frontend/src/containers/AnnotateContainer.jsx:1131` `handleGameVideoSelect`; `:1165-1172` local display name while uploading (`opponentName` -> "Vs/at X", then `gameDetails.name` overrides). With an opponent set this must show the SAME title the server will (see Solution 5); today `name` wins locally while the server list shows "Vs X"
- `src/frontend/src/stores/uploadStore.js:175-179` copies gameDetails into upload options
- `src/frontend/src/services/uploadManager.js:1007` `createGame` body (`opponent_name`, `game_date`, `game_type`, `tournament_name`, `name` at `:1016`)
- `src/backend/app/routers/games.py:366` `CreateGameRequest`; `:571` `create_game`; `:700` explicit `name`; `:289` `generate_game_display_name` (the title rule); `:1743` and `:2409` the list/load reads that REBUILD the title from opponent/date/type whenever an opponent is set (why the zip title is replaced). No backend change expected.

**The existing details UI to share (3rd copy -> extract `GameDetailsFields`)**
- `src/frontend/src/components/GameDetailsModal.jsx` - fields `:365` disclosure, `:383` Opponent, Game Date, Game Type buttons, `:440` Tournament name + dropdown; `:72` tournaments fetch (`GET /api/games/tournaments`); `:118-135` filename autofill + `setDetailsOpen(true)`; `:168` `submitGame`; `:213` `setIntroFact(..., 'team', parsedOurTeam)` (Q4 rule to reuse)
- `src/frontend/src/components/EditGameModal.jsx` - same fields with required `*` labels (`:125` Opponent, `:185` Tournament), `:34` tournaments fetch, `:71` submit shape
- `src/frontend/src/utils/gameNameParser.js:100` `parseGameFilename(filename, existingTeamName, now)` - extend, don't fork
- `src/frontend/src/utils/matchDate.js:12` `parseLocalCalendarDate`, `:56` `formatMatchDateWithYear` - the ONE local date parser (T7330); never `new Date("YYYY-MM-DD")`
- `src/frontend/src/config/displayNames.js` - copy (`VEO_ROUTING`, upload copy)

**Tests to extend / keep green**
- New/extended: `src/frontend/src/components/VeoZipPickList.test.jsx` (game-mode details + payload), `src/frontend/src/utils/gameNameParser.formats.test.js` (zip-title cases above), `src/frontend/src/components/ProjectManager.veoZipModal.test.jsx` (payload reaches `onAnnotateWithFile`), `src/frontend/src/containers/AnnotateContainer.uploadRestoreGameId.test.jsx` (local title with opponent)
- Characterization (must pass unchanged across the extraction): `GameDetailsModal.filenameAutofill.test.jsx`, `GameDetailsModal.sportPicker.test.jsx`, `GameDetailsModal.videoFirst.test.jsx`, `GameDetailsModal.t8700.test.jsx`, `GameDetailsModal.t12570.test.jsx`, `GameDetailsModal.guide.test.jsx`, `GameDetailsModal.invalidFile.test.jsx`, `GameDetailsModal.beacon.test.jsx`, plus any `EditGameModal` test (grep; add a characterization test first if none)
- Knowledge docs: `.claude/knowledge/annotate.md` (upload intake, T1540), `.claude/knowledge/backend-services.md` (games create)

### Related Tasks
- Depends on: T13245 (STAGING)
- Related: T13240 (router), T7330 (`matchDate.js` local-date parsing; reuse it, never `new Date("YYYY-MM-DD")`)

### Technical Notes
- No persistence change: the details ride the existing create gesture (one `POST /api/games`); nothing
  is written before Create.
- Keep the disclosure collapsed by default so submit stays gated only on picking moments (T8500 rule).
- `GameType` constants and the tournament dropdown behavior come from the existing modal; do not fork them.
- UI copy goes in `config/displayNames.js`; no em dashes in copy.

## Implementation

### Steps
1. [ ] Characterization: run the existing GameDetailsModal / EditGameModal tests; extract `GameDetailsFields` (mechanical commit, tests unchanged and green).
2. [ ] Failing tests: pick list game mode shows the collapsed "Game details (optional)"; prefilled opponent from the zip; filled fields reach `onCreateGame`'s payload; title preview follows the naming rule; zip-name date parse (Q3) cases.
3. [ ] Implement in `VeoZipPickList` + zip-name parse helpers.
4. [ ] Real-browser check (desktop + phone): Legends zip -> Make a game -> open details -> set Away + a date -> Create -> the game files under that date with title "at Legends FC San Diego {date}", game type Away; leaving details closed keeps the zip title.

### Progress Log

**2026-10-25**: Spec written from the T13245 landing session (user request). User accepted all Q1-Q5 recommendations the same day.

## Acceptance Criteria

- [ ] "Make a game from these highlights" shows a collapsed "Game details (optional)" with the same fields as Upload game; Create works without opening it.
- [ ] Opponent is prefilled from the zip name and editable; date is empty unless the zip name holds an unambiguous date.
- [ ] Filled details are saved on the created game (opponent, date, type, tournament) in the same single create request.
- [ ] The game title shown matches the preview; with no opponent the zip title is kept.
- [ ] GameDetailsModal and EditGameModal behave exactly as before (their existing tests pass unchanged).
- [ ] Works at phone width (390 px) with the Create button visible.
