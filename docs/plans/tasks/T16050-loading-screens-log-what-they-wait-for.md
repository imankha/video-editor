# T16050: Loading screens log what they wait for

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-11

## In plain words

**Today.** When the app shows a loading spinner (Frame, Spotlight, Annotate, Home, the finished highlight player, a shared reel link), the browser console says nothing about what the spinner is waiting for. The production build strips ordinary log lines, so even the few messages the loaders do write are gone on staging and production.

**The problem and how we got here.** On 2026-11-11 Frame sat on "Loading..." forever (T16040), and the console had two unrelated warnings and nothing else. It took an hour of reading code to learn that Frame was not waiting on anything at all: its list of plays was empty, so it never asked for a video. The same blind spot cost time on three earlier hangs (T15220, T15410, T15490). A tester or the owner should be able to open the console and see the answer in one line.

**What we will do.** Every loading screen writes a console line when it starts, naming what it needs: for Frame, the highlight record, its plays and the video link. It writes another line as each of those arrives, fails or comes back empty, with how long it took. Once a screen has waited past a set time (10 seconds), it writes one warning listing what is still outstanding. A screen that has stopped waiting but still has nothing to show also says so. These lines survive the production build. Every line carries a common prefix so a filter finds all of them.

**Why this and not something else.** Logging inside each request already exists for slow requests ("SLOW FETCH"), but a slow or empty answer is only half the story. The screen knows which answers it still needs and which ones it never asked for, and the empty-plays hang above was a request that was never made. A debugger or a support tool does not help a parent's report or a staging tester; a console line does.

**How we will know it worked.** On staging, open each screen listed above, cold and from inside the app. Filtering the console by the prefix shows what each spinner waited for, when each item arrived, and a warning naming the missing item for any spinner that lasted over 10 seconds. Re-running the T16040 hang shows a line saying Frame has no plays to load.

## Implementer details

- Production keeps `console.info`, `console.warn` and `console.error` and strips `console.log` (`vite.config.js` `pure: ['console.log']`). Use `info` for progress, `warn` for the stuck report, and `error` for "stopped waiting with nothing to show".
- Shape: one small helper (for example `utils/loadTrace.js`) with `start(screen, ids, needs[])`, `arrived(need, detail)`, `failed(need, err)`, `empty(need)` and `settled()`, plus a timer that warns with the outstanding needs after 10 s. Prefix `[LOAD]`. Keep it greppable: string-literal screen and need names at the call site (Refactoring Rules 6). This is the third place this pattern would be wanted (`[SLOW FETCH]` in `clientLogger.js`, `sessionInit.js`), so a shared helper is justified.
- Tag each line with the request's `req_id` where one exists, so it lines up with the backend logs and the `[SLOW FETCH]` line.
- Screens to cover first: Frame (`FocusScreen` and `useProjectLoader` stages, clips prefetch and invalidate in `App.handleModeChange`, playback-url), Spotlight (`OverlayScreen` working video and overlay data), Annotate game load (`/games/{id}/load`, game video), Home bootstrap, the finished highlight player, and the shared reel page.
- Must not log on every render. Log on transitions only; tests assert one `start` per screen open.
- Do not add console output from tests; the existing Vitest console guard applies.

### Acceptance criteria
- [ ] C1: Each listed screen logs one `[LOAD] <screen> waiting for ...` line on open, one line per need as it arrives, fails or comes back empty (with milliseconds), and one line when it settles.
- [ ] C2: A screen still waiting after 10 s logs one `console.warn` naming each outstanding need.
- [ ] C3: A screen that settled with nothing to show (for example Frame with zero plays) logs a `console.error` saying which input was empty.
- [ ] C4: The lines appear in the staging (production-mode) build.

### Related tasks
T16040 (the hang that showed the gap), T16060 (tag cold-backend failures), T15410, T15490, T15220.
