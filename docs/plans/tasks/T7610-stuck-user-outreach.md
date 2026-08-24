# T7610: Stuck-user outreach: hint emails + bookable help sessions

**Status:** WAITING ON USER (email copy + calendar booking link approval)
**Priority:** P1 (only lever that can recover the existing 14 users)
**Impact:** 8
**Complexity:** 2
**Created:** 2026-08-24
**Updated:** 2026-08-24

## Problem

The 2026-08-24 funnel analysis found 14 real users, nearly all stuck at identifiable
walls, several visibly frustrated (bug reports, rage retries, four-visit struggles). Code
fixes (upload-integrity epic, T7540/T7580/T7590) recover FUTURE users; the existing ones
need direct outreach, and future stuck users need a standing "get unstuck" path.

## Solution

### 1. Segmented hint email (send mechanism exists: fly ssh + send_admin_update_email,
used for the 2026-08 win-back). Segments and the hint each gets:

| Segment | Users | Hint |
|---|---|---|
| Mobile users who never uploaded | phildebarra, hiro.mt629, avi468870, jsquared22 (+anaselidrysy, platform unknown) | Use a desktop/laptop for the first upload (mobile upload improvements are in progress); direct link to /home/games |
| Uploaded but no clips | cschwartz78, jordark91330, eticatch | One concrete tip: open your game, press Add Clip at a highlight, give it a rating, hit Save (mention the tag field commits with Enter); their game is still there waiting |
| Made clips, no reel | lisagee1443 | "You already did the hard part: your 13 clips become a reel with two more taps" + exact steps Framing -> Create Reel; acknowledge her feedback directly |
| Paid and lost work | bigajosue | Personal apology, what happened (upload failures on our side), credits intact + goodwill top-up (user decision), personal offer to do it together |
| Share recipients | 4lgdesigns, chris.kunst23 | Their shared game/clips are still available; here is what they can do with them |

Framing rule (memory): lead with "tell us where you got stuck", support framing, not a
tutorial-link dump. ALL segments get the booking link. Email copy drafted for user
approval BEFORE any send; sends are logged (who/when/segment) in this file.

### 2. Bookable help sessions (Google Calendar)
Standing "book time with Iman" link, Mon-Fri 09:00-14:00 (user's stated window):
- Mechanism: a Google Calendar APPOINTMENT SCHEDULE (native booking page) on the user's
  calendar with those recurring windows; the share link goes in every email + potentially
  the in-app help surface.
- AI cannot create this without the claude.ai Google Calendar connector being authorized
  (currently unauthorized in this environment). Two paths: (a) user authorizes the
  connector in claude.ai settings and AI sets it up + verifies; (b) user creates the
  appointment schedule in Google Calendar UI (Settings -> Appointment schedules, ~2 min)
  and pastes the booking link here for the emails. Either way the LINK lands in this
  file before emails go out.
- Follow-up (separate decision): surface the same booking link in-app on the bug-report/
  help surface, so future stuck users find it without an email.

### 3. Send + track
After approval: send per segment via the established mechanism, record sends here,
and (once T7510 lands) watch whether recipients return past their wall.

## Context

### Relevant Files
- Send mechanism: fly ssh + send_admin_update_email (see memory: win-back campaign
  2026-08; no admin session needed)
- Segment source: the 2026-08-24 drop-off report artifact + per-user table

### Related Tasks
- Upload-integrity epic: bigajosue's segment should ideally send AFTER T7480's fix is
  live (inviting him back to a still-broken upload burns the one apology)
- T7460 scorecard: outreach outcomes feed activation metrics

### Dedup risk against the 2026-08 win-back campaign (checked 2026-08-24)
Five of this task's recipients were ALREADY emailed 2026-08-18/19 in the prior win-back
campaign (memory: `project_winback_campaign_2026_08`), 5-6 days before this task was filed:
**cschwartz78** (ghost-signup segment), **eticatch** and **4lgdesigns** (ghost signups),
**lisagee1443** (13 clips, stuck at Framing — same framing as her hint here), and
**chris.kunst23** (annotated, no finished clip). Copy for these 5 must read as a
FOLLOW-UP, not a first contact (reference or at least not contradict the prior email's
framing), and sends should be spaced out from that campaign rather than landing as a
second cold email in under 2 weeks. The other 9 recipients are net-new to outreach.

## Acceptance Criteria

- [ ] Email copy per segment approved by user
- [ ] Booking link created (either path) and verified working
- [ ] Sends executed + logged per user/segment
- [ ] bigajosue send explicitly sequenced against the upload fix status
