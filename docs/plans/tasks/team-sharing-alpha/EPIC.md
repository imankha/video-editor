# Team Sharing Alpha

**Status:** TODO
**Created:** 2026-05-12

## Goal

Let users tag teammates during annotation and share relevant clips with them via email. Recipients get the game and annotations added to their account. The advocate user annotates footage, tags teammates by name, maps names to emails, and shares -- each recipient only sees clips where their kid appears.

## Flow

1. **Annotate**: User creates clip regions. Optionally tags teammate names (free-text, autocomplete from history). Toggles "My Athlete" per clip (default true).
2. **Share**: "Share with Tagged Players" button shows all unique tags from the game. User fills in email addresses per tag (stored for future autocomplete). Multiple emails per tag supported.
3. **Deliver**: Email sent via Resend. Recipient clicks link, picks a profile (if they have >1), game + filtered annotations materialize in their account.
4. **Merge**: If multiple sharers send overlapping annotations to the same recipient, merge them: first start frame, last end frame, first title, combined notes. Non-overlapping annotations stay separate.
5. **Non-users**: See a playback view with annotations (name, stars, notes) + "Sign up / Sign In to annotate and make your own Reel" CTA. On signup, content materializes.

## Design Decisions

### Free-text tags with autocomplete
No roster management. User types any name ("Jake", "Player 7"). Previously used names autocomplete from profile history. The tag vocabulary emerges organically.

### Tag name to email mapping
Stored per-profile in SQLite (`teammate_emails` table). Multiple emails per tag name (e.g., "Jake" -> mom@email.com, dad@email.com). Mappings persist across games for autocomplete.

### Per-player annotation filtering
Each recipient only receives annotations where their tag name appears. If "Jake" is tagged on 3 of 8 clips, Jake's parents only get those 3 clips shared.

### No inbox / no claim flow
Content goes directly into the recipient's account (no pending inbox). Profile picker shown if they have multiple profiles. Simpler than the original claim design.

### My Athlete toggle is for reel filtering
The per-clip "My Athlete" toggle (default true) does not affect sharing. It's used in the New Reel flow so users can filter for clips featuring their own athlete when building highlight reels.

### Game sharing standalone
Games can be shared independently from the annotation flow, via a share button on game cards. Uses the existing UserPicker component.

## Dependencies

- **Phase 1 & 2 Core Sharing** (T1750, T1760, T1770, T1780, T1800) -- all DONE. Infrastructure reused: UserPicker, email delivery, share model.
- **T1610 (Profile Fields)** -- DONE. Athlete names and sport are meaningful.

## Supersedes

These tasks from the original Teammate Sharing epic (Post Launch) are replaced:
- **T1810** (Teammate Annotation Model) -> T2800 (reworked: named tags instead of boolean)
- **T1820** (Teammate Toggle UI) -> T2810 (reworked: free-text tags + my_athlete toggle)
- **T1830** (Shared Content Inbox & Claim) -> T2830 (scrapped inbox; direct materialization)
- **T1850** (Share Game) -> T2850 (kept, minor adjustments)
- **T1840** (Tag Teammate at Framing) -> SCRAPPED
- **T1860** (Reel Teammate Filter) -> T2860 (simplified to my_athlete boolean filter)

## Tasks

Ordered by dependency.

| ID | Task | Status | Description |
|----|------|--------|-------------|
| T2800 | [Teammate Tag Data Model](T2800-teammate-tag-data-model.md) | TESTING | `tagged_teammates` JSON array + `my_athlete` boolean on raw_clips. `teammate_emails` table in profile SQLite. Autocomplete APIs. |
| T2810 | [Annotation UI: Tags + My Athlete](T2810-annotation-tags-my-athlete-ui.md) | TESTING | Free-text tag input with autocomplete + "My Athlete" toggle in annotation dialog |
| T2820 | [Share with Tagged Players](T2820-share-with-tagged-players.md) | TODO | Button in annotation mode showing all game tags with per-tag email input. Stores mappings. |
| T2825 | [Shares Table Refactor](T2825-shares-table-refactor.md) | TESTING | Normalize `shared_videos` into base `shares` + `share_videos` + `share_games` extension tables. Migration script for existing data. |
| T2830 | [Game + Annotation Materialization](T2830-game-annotation-materialization.md) | TODO | Backend creates game ref + filtered annotations in recipient's profile. Overlap merging. Email delivery. |
| T2840 | [Shared Annotation View](T2840-shared-annotation-view.md) | TODO | Non-user playback with annotations + signup CTA. Materialization on signup. |
| T2845 | [Scalability Audit](T2845-scalability-audit.md) | TODO | Audit epic PRs for scale: joins vs big tables, ever-growing shares, retention policy, materialization copies. |
| T2850 | [Share Game](T2850-share-game.md) | TODO | Share button on game cards via UserPicker. Profile picker for recipient. |
| T2860 | [My Athlete Filter in New Reel](T2860-my-athlete-reel-filter.md) | TODO | Filter clips by "My Athlete" in reel creation clip selector |

## Completion Criteria

- [ ] Teammate names taggable during annotation with autocomplete
- [ ] "My Athlete" toggle per clip, defaults true
- [ ] Tag name to email mappings stored per-profile, multiple emails per tag
- [ ] "Share with Tagged Players" sends filtered annotations per recipient
- [ ] Overlapping annotations from multiple sharers merged correctly
- [ ] Recipients see game + annotations in their account after profile selection
- [ ] Non-users see annotation playback + signup CTA
- [ ] Games independently shareable from game cards
- [ ] "My Athlete" filter works in New Reel clip selector
- [ ] No credit cost to recipients
