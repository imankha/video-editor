# T16525: Tell the parent it finished itself, and remove the Finish tap

## In plain words

Today, after the parent pays to sharpen a highlight, a "Your highlight is ready" panel waits for them to tap Finish before it reaches the Highlights tab. T16520 makes the server finish the highlight on its own the moment sharpening ends. This task is the part the parent sees: the screens and messages that say "your highlight is in Highlights" (whether they waited or came back later), and removing the Finish tap, including the second Finish tap after a spotlight render. If the automatic finish failed, the panel keeps a working Finish button as it does today. Done when a parent who sharpens a highlight is told it is in Highlights without tapping anything, on phone and desktop.

**Status:** STAGING
**Impact:** 9
**Complexity:** 3
**Created:** 2026-11-16
**Updated:** 2026-11-16
**Milestone:** Automatic finish (see [EPIC.md](EPIC.md)). Frontend half of T16520 (owner split it 2026-11-16).
**Depends on:** T16520

## How we got here

T16520's design (T16520-design.md) was split by the owner into a backend task and this frontend one, so each can be verified and merged on its own.

## The problem

The server will finish highlights by itself after T16520, but the app still shows the old "tap Finish" panel and has no message saying the highlight is already in Highlights.

## What we will do

1. When the server reports the highlight is finished, show it as in Highlights with a clear message, both for a parent who stayed and one who returns later.
2. Remove the Finish tap, and the second tap after a spotlight render.
3. If the automatic finish failed, keep the existing Finish button working.
4. Sport-neutral strings; any sport wording goes in the per-sport strings.

## Acceptance Criteria

- [ ] After a highlight is sharpened, the parent sees that it is in Highlights without tapping Finish.
- [ ] A parent who returns later sees the same message and finds the highlight in Highlights.
- [ ] After a spotlight render there is no second Finish tap.
- [ ] When the automatic finish failed, the Finish button still works.
- [ ] Phone (390x844) and desktop layouts both show the message without overflow.
