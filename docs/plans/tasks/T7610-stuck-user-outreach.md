# T7610: Stuck-user re-activation: segmented hint emails + bookable help sessions

**Status:** WAITING ON USER (email copy + booking link + goodwill credit decision)
**Priority:** P1 (only lever that can recover the existing 14 users)
**Impact:** 8
**Complexity:** 2
**Created:** 2026-08-24
**Updated:** 2026-08-24 (full spec: send gate, per-user segment map, complete copy)

## Problem

The 2026-08-24 funnel analysis found 14 real users, nearly all stuck at identifiable
walls, several visibly frustrated (bug reports, rage retries, four-visit struggles). Code
fixes recover FUTURE users; the existing ones need direct outreach that (a) names their
specific wall, (b) accounts for their platform, (c) gives a concrete hint past it, and
(d) offers a personal help session. Re-engaging before the walls are fixed would burn
the one chance: **no email goes out until the blocking bugs are cleared** (user
directive 2026-08-24).

## SEND GATE (hard, user directive: clear all blocking bugs first)

No send to ANY segment until ALL of these are DEPLOYED TO PROD and verified live
(deploy is the user's /deploy gesture; "merged to master/staging" does not clear the
gate):

| Gate task | Why it blocks re-engagement |
|---|---|
| T7480 upload slow-uplink fix (5MB parts + progress-aware timeout + beacon) | Every hint funnels users back to uploading; below-0.8Mbps uplinks still hard-fail today |
| T7470 no cascade-delete on upload failure | A failed retry must never again destroy the work we invited them to redo |
| T7540 annotate save tag trap | The no-clips segment is told to Save a clip; Save must not dead-end |
| T7490 pending uploads visible + retry | rooom1h's segment is told "try again"; his stuck-pending game must be visible/resolvable when he returns |
| T7590 mobile Add Game entry point | ADDED 2026-08-24 with the mobile-affirming hint revision: the mobile segment is now invited to upload FROM the phone, so the entry point must work there |

Nice-before but NOT blocking (hints route around them): T7590 (mobile Add Game; the
mobile hint says use desktop), T7580 (Create Reel language; lisagee's email gives exact
steps regardless).

Gate check before sending: verify each fix's behavior on PROD (not staging), record the
verification evidence here.

## Segment map (every one of the 14, none skipped)

Platform: D desktop, M mobile, ? unrecorded (viewport heuristic + bug-report UAs).

| User | Platform | Fall-off point | Segment |
|---|---|---|---|
| phildebarra@gmail.com | M | opened app, 8s bounce | 1 mobile-wall |
| hiro.mt629@gmail.com | M | tutorial done, never uploaded | 1 mobile-wall |
| avi468870@gmail.com | M (iPhone) | tutorial done, filed empty bug report at upload step | 1 mobile-wall |
| jsquared22@jeffreyjones.com | M | opened app, 7s bounce | 1 mobile-wall |
| anaselidrysy09@gmail.com | ? | tutorial 19s after signup, nothing after | 1 mobile-wall (platform unknown, same hint is safe) |
| steven.zigterman20@gmail.com | D | opened app, 112s, no tutorial, no upload | 2 desktop-never-started |
| cschwartz78@gmail.com | D | uploaded 3.9GB, watched 28min, 4 return visits, 0 clips | 3 uploaded-no-clips |
| jordark91330@gmail.com | D | uploaded 1.23GB, opened Add Clip, 0 clips, never pressed play | 3 uploaded-no-clips |
| eticatch@gmail.com | ? | uploaded 3.2GB, never watched, gone in 16min | 3 uploaded-no-clips |
| lisagee1443@gmail.com | D | 13 clips, 15 projects, never found reel creation, rage bug report | 4 clips-no-reel |
| roooooooooom1h@gmail.com | D | upload failed (slow-uplink bug), game invisible | 5 upload-failed |
| bigajosue@gmail.com | M→D | PAID $3.99, 4 uploads failed, work destroyed | 6 paid-and-lost (own copy, extra care) |
| 4lgdesigns@gmail.com | D | share recipient; 2x "videos not loading" bug reports | 7 share-recipients |
| chris.kunst23@gmail.com | D | share recipient; 72s return then gone | 7 share-recipients |

## Email copy (drafts for user approval; ASCII, no em dashes)

Common frame (all segments): from Iman personally; lead with "tell me where you got
stuck" (support framing rule); every email carries the booking link; short.

**Base template:**
> Subject: Where did you get stuck? I'd like to help personally
>
> Hi, I'm Iman, the founder of ReelBallers. I noticed you signed up but didn't get all
> the way to a finished highlight reel, and I'd genuinely like to know where things got
> stuck. Reply to this email and tell me; even one sentence helps. Happy to reward your
> help with credits.
>
> Or better, grab 15 minutes with me and I'll walk you through it live: [BOOKING_LINK]
>
> [SEGMENT_HINT]
>
> Iman

**Segment hints:**
- **1 mobile-wall (REVISED + APPROVED 2026-08-24, mobile-affirming per research):**
  "Uploading your game right from your phone works now, even on slower connections -
  just keep the tab open and your screen unlocked while it uploads. A quick tip: it
  takes a few minutes for a full game, so start it when you have a moment."
  Rationale: the game video lives on the phone; the old "use a desktop" hint required a
  1-4GB phone-to-computer transfer harder than the upload itself (Descript precedent:
  route editing to desktop, never the upload). CONSEQUENCE: T7590 joins the send gate
  (below) - we must not invite mobile users into the entry-point bug.
- **2 desktop-never-started:** "It takes about 10 minutes to get from a game video to a
  shareable highlight reel: upload the game, tap the great plays, and the reel builds
  itself from your clips. If something didn't look worth those 10 minutes, that's exactly
  the feedback I need."
- **3 uploaded-no-clips:** "Your game is still in your account, ready to go. Open it,
  press Add Clip when you see a great play, give it a rating, and hit Save. (If you tag a
  teammate, press Enter after typing the name.) From there your clips become a reel in
  two more steps."
- **4 clips-no-reel (lisagee, personal):** "You already did the hard part: your 13 clips
  are sitting there ready. They become a finished reel from the Framing screen in about
  two more taps, and I'd love to show you personally. You were right that we didn't make
  this clear, and your feedback led to real changes."
- **5 upload-failed (rooom1h):** "Your upload didn't make it through, and that was a bug
  on our side, now fixed: slower internet connections were timing out. Your game is
  waiting in your account with a retry button, or upload fresh; either way it will work
  now."
- **6 paid-and-lost (bigajosue):** "First, I'm sorry. Your uploads failed because of a
  bug on our side, and that's a terrible first experience, especially right after paying.
  The bug is fixed, your credits are intact, and I've added 50 extra credits to your
  account for the trouble. I'd love to personally make sure your first reel gets made:
  [BOOKING_LINK]"
  **BLOCKED 2026-09-03: THIS ACCOUNT NO LONGER EXISTS.** Discovered while investigating a
  revenue-reconciliation drift (see [Revenue Record Integrity](revenue-integrity/EPIC.md)):
  user `fb40690a-edcf-4504-a51f-f9df6f84ac4f` has no `users`, `user_segments`, `credits`
  or `credit_transactions` row in prod and its R2 prefix is empty, so the account was
  deleted some time after 2026-08-24 05:05 UTC (self-serve CCPA delete or a manual
  `delete_user.py --env prod` run; the residue cannot distinguish them). Consequences for
  this segment, decide before any send: the copy above is now FALSE on two counts ("your
  credits are intact" and "I've added 50 extra credits to your account"), and the pre-send
  grant in step 4 has no account to grant against. Either rewrite this segment as a
  genuine start-over invitation (no credit claims, offer the goodwill credits on their
  next signup and grant them when it happens), or drop the segment. Their $3.99 was never
  refunded (user decision 2026-09-03: accept the chargeback risk), which makes an accurate,
  apologetic version of this email MORE worth sending, not less.
  **DECIDED 2026-08-24: 50 goodwill credits. GRANT THEM IMMEDIATELY BEFORE THE SEND**
  (admin grant-credits endpoint) so the email states a fact, not a promise - this is a
  pre-send checklist step, remind the user at send time.
- **7 share-recipients:** "The game and clips that were shared with you are still in your
  account. You can watch them, make your own clips from the game, and build your own reel
  from them. If that wasn't clear, that's on us; tell me what you were hoping to do."

**Dedup adjustment (see section below):** for the 5 recipients already emailed in the
2026-08 win-back campaign, open with continuity, e.g. "I wrote a little while back; since
then we've fixed several of the things that were in your way", instead of a cold intro.

## Booking (Google Calendar, Mon-Fri 09:00-14:00, user's stated window)

- Mechanism: a Google Calendar APPOINTMENT SCHEDULE (native booking page) on the user's
  calendar, recurring Mon-Fri 9:00-14:00; the share link is [BOOKING_LINK] in every email
  and, as a follow-up decision, on the in-app help/bug-report surface.
- AI cannot create it in this environment until the claude.ai Google Calendar connector
  is authorized. Two paths: (a) user authorizes the connector, AI creates + verifies the
  schedule; (b) user creates it in Google Calendar (Settings -> Appointment schedules,
  ~2 min) and pastes the link here. Either way the link lands in this file before sends.

## Send mechanism + tracking

- Send via the established fly ssh + send_admin_update_email path (2026-08 win-back
  precedent; no admin session needed). One send per user with their segment's hint.
- **Cadence (research-backed, 2026-08-24 best-practices review):** plain text from the
  founder's real address; ONE follow-up to non-responders 3-5 days after the first send
  (follow-ups get read: 45% read rates vs 24% first-open in win-back studies), then STOP
  at two touches. CTA order stays as approved: primary ask = "reply and tell me where you
  got stuck" (earns a reply), booking link second ("Or better...") - booking-first raises
  friction on a first touch. The credits-reward line stays a tail sentence, never the
  lead: these users never reached value, so incentives are not the lever.
- Log every send in this file: date, user, segment, template version.
- Success measure: recipients who RETURN and pass their previous wall (durable outcome,
  not milestones), readable per user from profile DBs now and from T7510's
  attempted-vs-succeeded views once landed. Review 7 and 21 days after send.

## Sequencing summary

1. NOW: user approves copy (goodwill credits DECIDED: 50); booking link deferred until
   send prep (user 2026-08-24).
2. Ship + DEPLOY the gate tasks (T7480, T7470, T7540, T7490).
3. Verify each gate fix live on prod; record evidence here.
4. PRE-SEND CHECKLIST: booking link in hand -> REMIND USER to grant bigajosue 50 credits
   (verify balance shows the grant) -> then send.
5. Send all segments (dedup-adjusted); log sends.
6. Review return/pass-the-wall outcomes at day 7 and day 21.

## Context

### Relevant Files
- Send mechanism: fly ssh + send_admin_update_email (memory: win-back campaign 2026-08)
- Segment source: 2026-08-24 drop-off report artifact + this file's segment map

### Related Tasks
- Gate tasks: T7480, T7470, T7540, T7490 (upload-integrity epic)
- T7460 scorecard: outreach outcomes feed activation metrics
- T7510: future sends get attempted-vs-succeeded tracking for free

### Dedup risk against the 2026-08 win-back campaign (checked 2026-08-24)
Five of this task's recipients were ALREADY emailed 2026-08-18/19 in the prior win-back
campaign (memory: `project_winback_campaign_2026_08`), 5-6 days before this task was filed:
**cschwartz78** (ghost-signup segment), **eticatch** and **4lgdesigns** (ghost signups),
**lisagee1443** (13 clips, stuck at Framing — same framing as her hint here), and
**chris.kunst23** (annotated, no finished clip). Copy for these 5 must read as a
FOLLOW-UP, not a first contact (reference or at least not contradict the prior email's
framing), and sends should be spaced out from that campaign rather than landing as a
second cold email in under 2 weeks. The other 9 recipients are net-new to outreach.

## Addendum 2026-08-27: gate status + new cohort (from the drop-off report refresh)

**Gate status: SATISFIABLE.** All 5 gate tasks (T7480/T7470/T7540/T7490/T7590) deployed to
prod 2026-08-26. Mobile upload additionally verified live by a REAL user, not just us:
mostafaali452010 uploaded 36 MB from an iPhone-class viewport on 2026-08-27 (first mobile
upload success in prod history). Remaining before send: log per-task verification evidence
here, booking link, and the pre-send checklist. NEW pre-send dependency: T7880 must
reconcile rooom1h's and finneganscudder's stranded uploads first (their emails say "try
again" — the Retry card must be what they see).

**2026-08-28: ojedalucas19's HOLD is lifted — T7870 resolved.** Verdict: a cascade-delete
bug (pre-existing, now fixed) deleted his game after a successful upload. Healed: his game
is restored and `ready` in his account (225s video, correctly playable), no re-upload needed.
Credits were NOT double-charged (verified) and no refund was issued (none was owed — the
heal restores the asset he already paid for). He does not know any of this happened; his
segment moves from "HOLD" to a normal uploaded-no-clips-style send (he never got past
watching the video, same shape as l.piress17). **Open call for whoever finalizes copy:**
whether to acknowledge the hiccup ("we found and fixed an issue with your upload") vs. a
plain re-engagement email as if nothing happened — not resolved here, flag at pre-send.

**New cohort (Aug 24-27 signups, 14 users).** The user base doubled since the segment map
was written. Segment assignments (existing approved templates reused where the segment
matches; flag for user OK at pre-send):

| User | Platform | Fall-off point | Segment |
|---|---|---|---|
| rikusbothainnz@gmail.com | Desktop | Uploaded 6.77 GB, 2 clips, 1 project, reached Framing, no export | lisagee-style: "your reel is two taps away" (strongest candidate in the whole list) |
| mostafaali452010@gmail.com | Mobile | Uploaded (mobile!), opened Add Clip, saved nothing | uploaded-no-clips (mobile variant) |
| t_tolovaeball@hotmail.com | Mobile->Desktop | Upload failed pre-fix; 1,895 s engaged (2nd-highest ever); empty account | upload-failed: "bug fixed, retry" |
| finneganscudder@gmail.com | Desktop | 663 MB upload stalled at 209 MB | upload-failed (AFTER T7880 reconciliation) |
| ojedalucas19@gmail.com | Desktop | Upload succeeded, game vanished (bug, now fixed + healed 2026-08-28 — see addendum above) | uploaded-no-clips (watched video, no clip saved); copy-tone call open |
| rogerio.klein.rsk@gmail.com | Desktop | 4 sessions / 31 min engaged, never created a game | desktop-never-started |
| l.piress17@gmail.com | Desktop | Uploaded 95 MB, never pressed play, gone in 3 min | uploaded-no-clips |
| mikhail.k.taylor@gmail.com | Desktop | Full account in 122 s incl. 1 clip; likely a tester | low priority; uploaded-no-clips if included |
| lisa.sakaio, j86283162, coxey2000gaming, trejosedwin22, thomascleverkappes69, 3522448 | mixed/? | Signed up, zero recorded actions | ghost-signup |

Also update cschwartz78's entry: he returned twice more (Aug 26: 3 s, Aug 27: 1 s) — six
visits total, still zero clips; his follow-up copy should acknowledge persistence.

## Acceptance Criteria

- [x] Email copy per segment approved by user (2026-08-24, with "Happy to reward your
      help with credits." added to the base template)
- [x] Goodwill credit decision for bigajosue recorded (50 credits, 2026-08-24; granted at
      pre-send checklist time, never earlier)
- [ ] bigajosue segment re-decided: the account was deleted (found 2026-09-03), so the
      approved copy and the pre-send grant are both invalid as written
- [ ] Booking link created (either path), verified working, recorded here
- [ ] ALL gate tasks verified live on PROD with evidence logged here BEFORE any send
- [ ] Sends executed + logged per user/segment
- [ ] Day-7 and day-21 return review recorded
