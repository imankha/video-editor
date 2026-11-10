# Funnel evidence behind the 2026-11-09 roadmap re-rank

Read-only pull from prod Postgres on 2026-11-09 (`fly proxy 15433:5432 --app reel-ballers-db-prod`,
`DATABASE_URL` from `.env.prod`, psycopg2). Real users only (`is_test_account` false), 402 sign-ups
from May to 2026-11-09. Per-user game and clip data lives in per-user SQLite, so every stage below is
read from `user_actions` (milestones) and `credit_transactions` (the ledger); "paid highlight" means a
`framing_usage` ledger row, which is the only complete record of a Frame export before T14710.

## The ladder, all time

| Stage | Users | Note |
|---|---|---|
| Signed up | 402 | Sep 148, Oct 169, Nov 37 to the 9th. Every sign-up is `origin=organic`, no utm. |
| Opened Add game or Add clip | 301 | |
| Picked a file | 202 | |
| Got footage in | 193 | 149 via a game upload, 52 via clips. |
| Marked a play | 109 | Game uploaders reach a paid highlight at 19%; clip-only users at 45%. |
| Opened Frame | 101 | |
| Paid for a highlight | 56 | 47 of 52 on their sign-up day. |
| Took it away (download or share) | 11 | October cohort: 30 paid, 3 took it away. Frame export completion was only instrumented 2026-11-04 (T14710), so some of this gap is measurement. |
| Made 2 or more highlights | 18 | 19 of 21 second highlights came the same day, median 15 minutes after the first. |
| Returned after day 7 | 17 | 278 of 330 users with any usage have exactly one usage day. |
| Ever shared a link | 6 | 117 share views, 74 from one user. |
| Paid money | 6 | 7 purchases, about $77 lifetime. |

## Day-one behaviour against later return (sign-ups 2026-08-01 to 2026-10-25)

| Day-one group | Users | Back after 7 d | Paid highlight later | Bought credits |
|---|---|---|---|---|
| Paid highlight and Spotlight export | 13 | 2 | 3 | 3 |
| Paid highlight, no Spotlight | 26 | 0 | 1 | 0 |
| Opened Frame, never paid | 30 | 1 | 2 | 0 |
| Marked a play, never opened Frame | 50 | 3 | 1 | 0 |
| Footage only | 48 | 1 | 0 | 0 |
| No footage | 159 | 5 | 1 | 0 |

All time: 22 users who ever exported Spotlight gave 5 returners, 9 repeat highlights and all 5 payers
in that set; 30 paid-but-no-Spotlight users gave 2 returners, 2 repeats, 0 payers. Among the 26
no-Spotlight day-one payers only 12 were offered Spotlight, 3 opened it, 16 were mobile-only. Spotlight
users also made more on day one (2.1 highlights against 1.2), so part of the effect is self-selection.

## Credits are not what stops the second highlight

Users with exactly one paid highlight hold a median 73 credits (34 users). Users with two or more spent
111 on average. Only 2 exporters ever fell below the median export cost of 13. The free-pass milestone's
premise (cost blocks the second highlight) is contradicted; the second highlight, when it happens, is
same-session.

## Uploads

| Step | Users |
|---|---|
| Opened Add game | 301 |
| Picked a file | 202 |
| Game upload succeeded | 154 |
| Picked a file, never got footage in, no failure row | 40 |
| Terminal failure on a file over 3 GB | 12 (5 refused at the 10 GB cap, none paid; 7 at 3 to 10 GB, 3 later succeeded, 1 paid) |
| Terminal failure on a file under 3 GB | 11 |

Of 246 successful game uploads (cost = ceil(GB) + 1 credits), 202 were under 1 GB and 2 were over
6 GB. Network and timeout failures cluster on 2 to 10 GB desktop files dying after 200 to 400 s.
Capability probes put about 23 users on sources above 4K out of 199 probed.

## Platform

Session users: mobile 212, desktop 185. Game uploads succeeded: desktop 92, mobile 62. Frame opened:
mobile 60, desktop 47. October paid users: 20 mobile, 18 desktop.

## Instrumentation gaps

Frame export completion recorded only since 2026-11-04 (T14710); the Veo import writes no Postgres
milestone; `result_viewed` has fired for 2 users since September; visits only since 2026-11-08; every
sign-up is "organic".
