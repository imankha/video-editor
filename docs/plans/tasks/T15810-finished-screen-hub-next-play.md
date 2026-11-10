# T15810: Finished screen is the hub: Download, Share, Add to reel, Make the next play

## In plain words

Today, when a parent finishes a highlight, the screen is empty, the clip is hard to find, Download sits under a help card, and nothing suggests what to do next. Second highlights, when they happen, come about fifteen minutes after the first, and parents who stop at one still hold most of their free credits, so the moment to offer the next play is here, not a day later. We will make the Finished screen a hub: Download, Share, Add to reel once reels exist, and Make the next play, a list of this game's other marked plays that open the cropping step directly. Done when the Finished screen shows those actions on phone and desktop and the download-or-share rate out of paid highlights rises.


**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Roadmap 2, Spotlight first (see PLAN.md)

## How we got here

Prod evidence 2026-11-09: 56 users paid for a highlight, 11 took it away; the October cohort was 30
paid, 3 took away. 19 of 21 second highlights were made the same day, median 15 minutes after the first,
and users with exactly one highlight still hold a median 73 credits. So the second highlight is won or
lost in the same sitting, by what the Finished screen offers, not by a 24-hour free pass and not by credits.

## The problem

Finish lands on an empty screen and the Highlights tab shows only locked reels (T15480); Download is
dead under the last Guidance card (T14840); Download takes 16 s with no feedback (T15520); the Share
button stays disabled after the link is created (T15500); the finished player keeps the URL at /home
(T15760). Those are bugs and run first. Even with them fixed there is no next step: nothing says
"you marked 4 other plays, make the next one".

## What we will do

One Finished screen for a highlight, desktop and phone, with four actions in this order:

1. **Download** and **Share** (file on phones, link on desktop, per T11510's split).
2. **Add to reel**: present once T11300 ships; before that, a disabled chip with "Reels are coming"
   is not acceptable, so the chip is simply absent until T11300 lands (feature flag off).
3. **Make the next play**: the list of this game's other marked plays that have no highlight yet,
   best-rated first, each opening Frame directly. When none are left, the row says so and offers
   "Mark more plays" into Annotate at the game's last playhead.

T14770's "list of highlights made" count chips and rows live on the same screen. No modal; the screen
has a canonical URL (T15760) so resume and impersonation land on it.

## How we will know it worked

- [ ] After Finish, the screen shows Download, Share and Make the next play with the game's remaining marked plays, on phone 390x844 and desktop 1280x800 (Playwright).
- [ ] Tapping a remaining play opens Frame on that play; the second highlight's `framing_usage` row follows without visiting Home.
- [ ] Download and Share stay tappable with any Guidance card open (T14840's test covers this screen).
- [ ] Gate for the section: took-away out of paid highlights, read on the admin Journey, with the 2026-11-03 baseline beside it.

## For the implementer

### Related Tasks
T15480, T14840, T15520, T15500, T15760 (bugs, first), T11510 (share split), T14770, T11300 (reel),
T15800 (Spotlight step before this screen).

### Relevant Files (REQUIRED)
- `src/frontend/src/components/PublishedReelsPanel.jsx`
- `src/frontend/src/components/DraftReelPreview.jsx`
- `src/frontend/src/components/collections/ReelTile.jsx`
- `src/frontend/src/hooks/useWebShare.js`
- `src/frontend/src/utils/reelDownload.js`
- `src/frontend/src/components/ProjectManager.jsx` (tab paths)
- `src/frontend/src/constants/displayNames.js`
