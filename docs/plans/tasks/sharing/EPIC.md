# Sharing & Collaboration

**Status:** TODO
**Created:** 2026-04-25
**Updated:** 2026-05-02

## Goal

Let users share content with others — from finished highlight reels (view-only) to raw games and polished teammate clips (edit access). The 1-in-10 advocate user who uploads game footage and creates clips becomes the growth engine: they share their work with friends on the team, those dads see their kid in a polished highlight, and some of them become advocates themselves.

## Two Sharing Models

### 1. Gallery Video Sharing (view-only)
Share a finished exported video with anyone. UX modeled on Google Docs sharing:
- Sharer enters recipient email(s) and chooses **visibility**: public or private
- **Private** (default): recipient must log in with the matching email to view
- **Public**: anyone with the link can view — named recipients still get email notifications
- Sharer sees who watched. Simple, lower complexity.

### 2. Teammate Sharing (edit access)
Two paths for sharing editable content with friends:
- **Share Game**: Share raw game footage so friends can annotate their own clips
- **Tag at Framing**: After framing a teammate's clip, tag the parent with an email — they receive the game, annotation, AND finished My Reels entry

Both models share infrastructure: UserPicker component, email delivery via Resend, account lookup.

## Core Design Decisions

### Advocate-first design
The sharing flow is designed around the 1/10 power user who uploads games, annotates clips, and wants to show off their work. Every sharing action maps to a moment of motivation in their workflow:
- **Annotation**: quick teammate toggle (low friction, high scrubbing speed)
- **Framing export**: tag with email (idle time, clip just became "real work")
- **Game card**: share button (advocate thinks "my friends should have this footage")

### No "team" concept
Users share with individuals, not rosters. Parents form friend groups within teams — sharing is with 3-4 dads you know, not 15 families on a roster. The UserPicker autocompletes from prior shares, so the friend group emerges organically.

### Two-step teammate tagging
Old design had email tagging at annotation time — too much friction during scrubbing. New design separates intent from action:
1. **Annotation**: toggle "My Athlete" / "Teammate" (one tap, no email)
2. **Framing export**: tag with email and share (natural idle moment, clip is worth sharing)

### Sharer only knows email
The sharer enters a recipient email — no profile selection. The **recipient** chooses which profile to associate shared content with when they claim it.

### Recipient claim flow
1. Recipient logs in → sees inbox notification
2. Opens inbox → list of pending shares grouped by sharer
3. For each share: pick profile (defaults to last used with that sharer) or create new
4. Claim → content materialized in chosen profile's database
5. Navigate to the content

### No cost to recipient
All shared content is free for the recipient. Games reference the same R2 objects (no duplication). My Reels entries reference the same exported video. No storage credits consumed.

### Expiry follows the uploader
Game videos expire with the uploader's storage credits. When the R2 video is deleted, shared recipients lose access to raw footage. However, finalized clips and My Reels entries survive independently — those are prepaid at export and never expire.

### Full editability for shared content
Recipients get full pipeline access. A shared game can be annotated, framed, and exported. A tagged clip can be re-framed with a different crop or re-overlayed with different effects.

### Pending invites for non-users
Sharing with an email not in our system creates a pending share that resolves when they sign up.

## Dependencies

- **T1610 (Profile Fields)** — Must ship first so athlete identities are meaningful

## Tasks

Ordered by dependency. Gallery sharing ships first (For Alpha), teammate sharing builds on its infrastructure (Post Launch).

### Phase 1: Core Sharing (For Alpha)

End-to-end share loop: create share, send link, recipient watches.

| ID | Task | Status | Description |
|----|------|--------|-------------|
| T1750 | [Share Backend Model & API](T1750-share-backend-model.md) | TESTING | shared_videos table, share/revoke/list endpoints, public/private access control |
| T1770 | [Gallery Share UI](T1770-gallery-share-ui.md) | TESTING | Share modal: email input, visibility toggle, copy link |
| T1780 | [Shared Video Player Page](T1780-shared-video-page.md) | TESTING | /shared/:shareToken route — public plays immediately, private requires auth |

### Phase 2: Share Engagement (For Alpha)

Recipient discovery, email notifications — polish on core sharing.

| ID | Task | Status | Description |
|----|------|--------|-------------|
| T1800 | [User Picker Component](T1800-user-picker-component.md) | TESTING | Email autocomplete from prior shares, account lookup (green/yellow) |
| T1760 | [Share Email Delivery](T1760-share-email-delivery.md) | TESTING | Resend integration for share notifications (reused by teammate sharing) |

### Phase 3: Teammate Sharing (Post Launch)

Teammate annotations, game sharing with friends, tag-at-framing clip delivery.

| ID | Task | Status | Description |
|----|------|--------|-------------|
| T1810 | [Teammate Annotation Model](T1810-player-tag-data-model.md) | TODO | `is_teammate` boolean on raw_clips, API support |
| T1820 | [Teammate Toggle UI](T1820-annotation-player-tagging-ui.md) | TODO | "My Athlete" / "Teammate" toggle in annotation dialog |
| T1830 | [Shared Content Inbox & Claim](T1830-shared-content-inbox.md) | TODO | pending_shares in auth.sqlite, inbox UI, claim flow with materialization |
| T1850 | [Share Game](T1850-share-game-with-team.md) | TODO | Share game with friends via UserPicker, no cost to recipient |
| T1840 | [Tag Teammate at Framing](T1840-cross-user-clip-delivery.md) | TODO | During framing export wait, prompt to tag + share; delivers game + clip + My Reels |
| T1860 | [Reel Creation Teammate Filter](T1860-reel-creation-player-filter.md) | TODO | "My Athlete" / "Teammate" filter in GameClipSelectorModal |

## Completion Criteria

- [ ] All tasks complete
- [ ] Gallery videos shareable via email with public/private visibility toggle
- [ ] Public links viewable without login; private links require recipient email auth
- [ ] Watch tracking works for both public and private shares
- [ ] Clips markable as "My Athlete" or "Teammate" during annotation
- [ ] Teammate clips prompt sharing during framing export
- [ ] Games shareable with individual friends (no team roster)
- [ ] Recipients claim shared content to a profile of their choice
- [ ] Tagged clip recipients get game + annotation + My Reels entry
- [ ] Claimed content fully editable (annotate, frame, export)
- [ ] Reel creation filters by "My Athlete" / "Teammate"
- [ ] No credit cost to any recipient
- [ ] Non-users get pending invites that resolve on signup
