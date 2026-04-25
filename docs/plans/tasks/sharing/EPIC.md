# Sharing & Collaboration

**Status:** TODO
**Created:** 2026-04-25

## Goal

Let users share content with others — from finished highlight reels (view-only) to raw clips and full games (edit access). An enthusiastic user who annotates game footage can tag teammates, share games with the team, and create value for others who can then engage through the site.

## Two Sharing Models

### 1. Gallery Video Sharing (view-only)
Share a finished exported video with anyone. Recipient signs in, watches it in a gated player. Sharer sees who watched. Simple, lower complexity.

### 2. Player Tagging & Team Sharing (edit access)
Tag clips with athletes by email during annotation. Share full games with the team. Recipients claim shared content to a profile of their choice and get full pipeline access (annotate, frame, overlay, export). Higher complexity — requires cross-user data materialization.

Both models share infrastructure: User Picker component, email delivery via Resend, account lookup.

## Core Design Decisions

### Sharer only knows email
The sharer enters a recipient email — no profile selection on the sharer side. The **recipient** chooses which profile to associate shared content with when they claim it.

### Recipient claim flow (edit-access sharing only)
1. Recipient logs in → sees inbox notification
2. Opens inbox → list of pending shares (clips and/or games)
3. For each share: pick profile (defaults to last used with that sharer) or create new
4. Claim → content materialized in chosen profile's database
5. Navigate to the content

### Full editability for tagged clips
Recipients get a full `raw_clip` record in their database linked to the same game on R2 (via `blake3_hash`). They can take it through the full pipeline: framing → overlay → gallery. No video duplication — games are content-addressed on R2.

### Pending invites for non-users
Sharing with an email not in our system creates a pending share that resolves when they sign up. The yellow warning is feedback for typos, not a blocker.

### Autocomplete from prior shares
The User Picker suggests emails the user has previously shared with from the current profile (likely teammates/friends).

## Dependencies

- **T1610 (Profile Fields)** — Must ship first so player tags have meaningful athlete identities (athlete_name, sport)

## Tasks

Ordered by dependency. Phase 1 ships first, Phase 2 builds on its infrastructure.

### Phase 1: Shared Infrastructure + Gallery Video Sharing

| ID | Task | Status | Description |
|----|------|--------|-------------|
| T1800 | [User Picker Component](T1800-user-picker-component.md) | TODO | Shared UI: email input, autocomplete, account lookup (green/yellow) |
| T1750 | [Share Backend Model & API](T1750-share-backend-model.md) | TODO | shared_videos table, share/revoke/list endpoints |
| T1760 | [Share Email Delivery](T1760-share-email-delivery.md) | TODO | Resend integration for share notifications (reused by Phase 2) |
| T1770 | [Gallery Share UI](T1770-gallery-share-ui.md) | TODO | Share button on gallery cards, multi-email modal using UserPicker |
| T1780 | [Shared Video Player Page](T1780-shared-video-page.md) | TODO | /shared/:shareToken route, auth gate, gated video player |
| T1790 | [Watch Tracking & Share Status](T1790-watch-tracking-share-status.md) | TODO | Watched event on play, share status panel on gallery cards |

### Phase 2: Player Tagging & Team Sharing

| ID | Task | Status | Description |
|----|------|--------|-------------|
| T1810 | [Player Tag Data Model & API](T1810-player-tag-data-model.md) | TODO | clip_player_tags table, CRUD endpoints |
| T1820 | [Annotation Player Tagging UI](T1820-annotation-player-tagging-ui.md) | TODO | "Players" section in add clip dialog, auto-tag for 4+ star |
| T1830 | [Shared Content Inbox & Claim](T1830-shared-content-inbox.md) | TODO | pending_shares in auth.sqlite, inbox UI, profile picker with per-sharer default |
| T1840 | [Cross-User Clip Delivery](T1840-cross-user-clip-delivery.md) | TODO | Player tag → pending share → email → claim → materialize game+clip |
| T1850 | [Share Game with Team](T1850-share-game-with-team.md) | TODO | "Share with Team" on game cards, game materialization. Absorbs T1050. |
| T1860 | [Reel Creation Player Filter](T1860-reel-creation-player-filter.md) | TODO | Player filter in GameClipSelectorModal, user's athlete default |

## Completion Criteria

- [ ] All tasks complete
- [ ] Gallery videos shareable via email with gated player + watch tracking
- [ ] Clips taggable with athlete emails during annotation
- [ ] Full games shareable with team
- [ ] Recipients claim shared content to a profile of their choice
- [ ] Claimed clips fully editable (frame, export, download)
- [ ] Reel creation filters by player
- [ ] Non-users get pending invites that resolve on signup
