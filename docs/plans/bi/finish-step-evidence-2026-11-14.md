# Evidence: highlights that were sharpened but never finished (2026-11-14)

Read-only pull on 2026-11-14 of every production per-user database and action log (413 real
accounts, test accounts excluded), plus one real export driven on a phone-sized browser in dev.
A highlight is a finished short clip. Frame is the step where the parent crops around their athlete
and pays to sharpen the result. Spotlight is the step that draws a circle around their athlete.
Finished means the highlight is in the Highlights tab, where it can be downloaded and shared.

## Where the exported highlights sit

| State | Highlights | Users | Mostly on |
|---|---|---|---|
| Finished | 30 | 17 | |
| Sharpened, never went further | 31 | 30 | phone (22 of 31) |
| Spotlight rendered, Finish never pressed | 11 | 9 | desktop (9 of 11) |

33 users paid to sharpen a highlight and have nothing in Highlights; 17 finished at least one. One
heavy account with 97 finished highlights and no project rows is left out of the table.

## What the stuck users did

Sharpened, never went further (31 highlights):

- 12 had no activity after the render finished. The render took a median of 3.5 minutes (1 to 13).
  The on-screen guide says "You can wait here or go mark more plays."
- At least 12 saw the "Your highlight is ready" panel. 4 left within two minutes without choosing,
  6 tapped "Done for now", 6 opened Spotlight and never rendered it (some did both). None tapped
  "Finish without spotlight". The panel event is recorded once a session, so 12 is a floor.
- 8 came back in a later session. Each return was a few seconds on Home and none finished.

Spotlight rendered, Finish never pressed (11 highlights): all saw the second ready panel. Two
started their next highlight straight away. 6 came back later and none finished.

## How many redo from this step

- Sharpened again, paying again: 9 of 68 highlights with job records (13%, 7 users). Seven of the
  nine did it within 25 minutes of the first render, straight from the ready panel.
- Rendered the spotlight again: 11 of 37 spotlighted highlights (9 users).
- Time between the last render and Finish, for highlights that were finished: about 45 seconds at
  the median, nearly all under 4 minutes. One user finished a batch the next day.
- Edited again after finishing: 2 highlights. That path already exists.

Redo is real but immediate. Nobody parks a highlight to reconsider it later.

## What the browser walk-through showed (phone viewport, dev, real export)

- The ready panel reads as finished: the headline is "Your highlight is ready", the exit is "Done
  for now", there is no Download or Share, and nothing says the highlight is not in Highlights yet.
- On Home a paid, sharpened highlight sits under Plays with the same "In progress" badge as a play
  that has not been cropped, and its tile has no Finish button.
- Tapping that tile opens the Spotlight editor, whose only main button is "Add spotlight to
  highlight". Finish is not on that screen.
- The only way back to the ready panel is a one-time "Your highlight is ready" notice on Home. It
  is gone for good once the parent taps "Done for now".
- On a phone the ready panel's close button sits under the Guidance switch.

## Measurement gap

No event is recorded when a parent taps Finish. The admin Journey counts its "Finished highlight"
stage from the spotlight render, so the 11 rendered-but-unfinished highlights are counted as
finished and the 31 sharpened-only ones are not visible as a loss at all.

## Method

Per-user profile databases and action logs were downloaded from production storage to a temporary
folder and opened read-only. "Finished" is a final video with a publish time. "Sharpened, never
went further" is a working video with no final video. "Left during the wait" is no logged activity
after the working video's creation time. Redo counts come from completed export jobs per highlight.
