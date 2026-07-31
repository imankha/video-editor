# Post-T6190/T6200 Latency Findings (HAR 2026-07-31)

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Close out the remaining latency and wasted-request findings from the 2026-07-31 local HAR
(`Downloads/localhost.har`, 85 entries), captured while verifying T6190 + T6200 on the
integration branch. The headline fixes worked; this epic covers what the same capture exposed
next.

## Why

T6190 (redundant project-open fetches) and T6200 (event-loop serialization) were verified
**confirmed** by this capture:

| criterion | measured |
|---|---|
| `GET /api/games` on project-open | **0** |
| clips-list on project-open | **exactly 1** |
| `GET /api/health` on project-open | **0** |
| first R2 video byte after click | **~485ms** (prod baseline was 2.7s) |
| project-open request durations | 30 / 123 / 288 / 528ms — all different |

That last row is T6200 working: the original HAR had four requests at an identical ~1460ms all
finishing within 2ms. That signature is gone from the project-open path.

But the same capture shows the identical queueing signature at **app boot**, 15x worse, plus a
second duplicate-fetch cluster on a transition T6190 didn't cover, plus cache headers that
cannot do anything.

## The capture

`Downloads/localhost.har` — local dev (`localhost:5173` + `:8000`), integration branch
`integration/T6190-T6200-project-open-latency`, account `imankh@gmail.com` / profile `9fa7378c`.
Session: app boot -> Drafts -> open project 30 into Framing -> Overlay -> annotate game 6 ->
My Reels.

## Design decisions

### Read the numbers with these two caveats

1. **Dev, not prod.** Durations are local. **Request counts and orderings** are the signal;
   absolute ms are not prod-representative.
2. **React StrictMode double-invokes effects in dev.** Any exact **x2** may be **x1** in prod
   (this is why boot `/api/health` was 2 — T6190 confirmed prod is 1). An **odd** count cannot
   be explained by StrictMode alone and therefore proves multiple real owners. Every task below
   states which case it is. **Do not "fix" a x2 without first confirming it survives a
   production build** (`npm run build && npm run preview`, or a staging capture).

### One owner per fetch

Same rule T6190 established: two components fetching the same data is the defect. Do NOT paper
over duplicates with a blanket request cache or a longer-lived in-flight latch — that hides the
second owner instead of removing it.

### Measure, then fix

T6200's discipline carries: reproduce with `scripts/concurrency_probe.py` (committed) or a fresh
HAR before changing anything, and re-measure to prove the change. A refuted hypothesis written up
honestly closes a task successfully.

## Sequencing

**T6240 first, and re-measure before starting anything else.** It is the largest single cost
(~22s) and several smaller findings (notably the `/api/games` x8 burst) may simply be the same
event-loop contention — they could disappear when it is fixed. Confirm they still exist before
spending a task on them.

After T6240, the rest are independent and can be reordered freely.

## Tasks

| # | Task | What |
|---|------|------|
| 1 | T6240 | Cold-boot serialization — `user_session_init` blocking the event loop (~22s) |
| 2 | T6250 | Overlay-entry duplicate fetches (`overlay-data` x3, `outdated-clips` x2) |
| 3 | T6260 | Read endpoints send `no-cache` with no validator — add ETag/304 |
| 4 | T6270 | Every achievement POST is chased by a `quests/progress` GET |
| 5 | T6280 | Small double-fires (`rank/confidence` x2, `games/{id}/video` 302 x2) |
| 6 | T6290 | Poster first-load batch competes with boot |

## Completion criteria

- App boot no longer serializes: concurrent boot requests show varied durations and a
  meaningful finish-spread, proven by a fresh HAR.
- No endpoint is fetched more than once per user gesture on the Framing->Overlay transition.
- Repeat loads of unchanged read endpoints answer 304 rather than resending bodies.
- Each task's finding is either fixed with before/after evidence, or written up as refuted.

## Related

- **T6190** / **T6200** — the tasks this capture was verifying; both confirmed fixed above.
- **T6200's deferred item** — its Stage-7 note explicitly parked `user_session_init` as "rare on
  the hot path". T6240 exists because this capture shows it is not rare. See
  `.claude/knowledge/backend-services.md` § Request concurrency model.
- **T2540** — HTTP/2 verification at the Fly edge; relevant to the poster-batch concurrency
  question in T6290.
