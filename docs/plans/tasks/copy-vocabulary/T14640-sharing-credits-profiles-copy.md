# T14640: Sharing, credits, profiles and guidance copy

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

- **Sharing:** "Revoke link" / "Revoke access", four dead-link messages, "Add people" vs
  "recipients" vs "teammates", five email-input hints including "Press Enter" (no Enter on
  phone keyboards), "share" as a noun ("This share was revoked"), "shared version", "claim these
  highlights", "URL", a bare URL shown as a success toast, "Copy Link" vs "Copy link", "Link
  copied to clipboard", restricted-page copy with two nouns.
- **Credits and storage:** "Usage history" vs "credit activity", "Welcome credits" vs "Signup
  bonus", "Admin grant", "Balance adjustment", "Video generation", "Insufficient Credits",
  "Buy Credits", "Extend Storage" vs "Extend storage", "Extend by:", "This upload requires N
  credit(s) for 30 days of storage", storage expiry copy with "source video", "annotations",
  "generated everything".
- **Profiles and intro cards:** athlete vs player vs profile; "Athlete Intro Card" vs card vs
  intro; "attest ... likeness" consent; "Add it" bare button; "Manage Profile" vs "Manage Profiles".
- **Guidance:** "Guidance" vs "Helpful instructions" vs "Quests: 3/7".
- **Ranking:** matchup, re-rank, "ranking game", "Rematch", "Confidence", "head-to-head".
- **Account and auth:** Title Case ("Account Settings", "Sign Out", "Send Code"), "Use different email", "Signed in with email code".

Task 5 of 8 in the [Copy Vocabulary epic](EPIC.md). Read EPIC.md for the glossary, verbs and
style rules. Prior tasks T14600 to T14630 covered Home, Mark plays, Frame and Spotlight.

## Solution

- Sharing: Share, link, people. "Turn off link" / "Stop sharing". One dead-link message ("This link no longer works."). Email hint: "Add emails, separated by commas". "Copy link" / "Link copied". "Only people it was shared with can watch. Sign in with the email the link was sent to."
- Credits: title "Credit history"; row labels "Highlight", "Highlight refund", "Game upload", "Video added to a game", "Bonus credits"; "Not enough credits"; "Buy credits"; "Extend storage"; "Adding this game costs N credits and keeps it for 30 days." Storage expiry: game video / marked plays wording (merge the two near-identical expiry messages in GameTile and StorageExpiryBanner).
- Profiles: "athlete" for the parent's kid everywhere (D4 decision); "intro card"; consent as two short sentences without "attest" / "likeness"; "Manage profiles".
- Guidance: "Guidance" only; "Getting started: 3 of 7" instead of "Quests".
- Ranking: "Pick the better highlight", "Undo last pick", "Your #3 favorite highlight this season"; drop matchup / rematch / confidence wording from visible copy.
- Account: sentence case; "Send code", "Send a new code", "Use a different email", "Signed in with email".
- Style rules throughout.

## Context

### Relevant Files
- Sharing: `src/frontend/src/components/ShareModal.jsx`, `ShareGameModal.jsx`, `SharePlaybackDialog.jsx`, `ShareWithTeammatesModal.jsx`, `CollectionShareModal.jsx`, `SharedCollectionView.jsx`, `SharedVideoOverlay.jsx`, `SharedAnnotationView.jsx`, `SharedGameView.jsx`, `DraftReelPreview.jsx`, `UserPicker.jsx`, `PublishedReelsPanel.jsx`, `hooks/useWebShare.js`, `utils/inviteEmail.js`, `constants/shareClipScope.js`
- Credits/storage: `BuyCreditsModal.jsx`, `CreditHistoryModal.jsx`, `CreditBalance.jsx`, `InsufficientCreditsModal.jsx`, `PaymentResultModal.jsx`, `StorageExtensionModal.jsx`, `StorageExpiryBanner.jsx`, `SourceExpiredPanel.jsx`, `ExpirationBadge.jsx`, `screens/ProjectsScreen.jsx`
- Profiles/intro: `ManageProfilesModal.jsx`, `MoveToProfileModal.jsx`, `ProfileIntroSection.jsx`, `components/introcards/**`, `ReferenceGameCard.jsx`, `ProfileSportButton.jsx`, `NoSportTagWarning.jsx`
- Guidance: `GuidanceToggle.jsx`, `AccountSettings.jsx`, `QuestIcon.jsx`, `components/instructions/**`
- Ranking: `components/ranking/**`
- Auth: `components/auth/OtpAuthForm.jsx`, `AuthGateModal.jsx`, `SignInButton.jsx`, `ProfileDropdown.jsx`, `SignInScreen.jsx`
- `src/frontend/src/config/displayNames.js` (SHARING, CREDITS, RETENTION, STORAGE, GUIDE.collectionShare)

Findings with lines: [audit/B-components-AL.md](audit/B-components-AL.md) 8-13, 28-40, 65-92, 119-122; [audit/C-components-MZ.md](audit/C-components-MZ.md) 9, 17-21, 56-85; [audit/A-catalog.md](audit/A-catalog.md) G47-G56, I61; [audit/F-gapfill.md](audit/F-gapfill.md) F9, F17-F22.

### Technical Notes
- This is the widest task; if the diff passes ~200 meaningful lines, split sharing from credits/profiles into two commits or two PRs (CLAUDE.md refactoring rule 4).
- Legal pages (`PrivacyPolicy.jsx`, `TermsOfService.jsx`) are out of scope except vocabulary words; do not change legal meaning.

## Implementation

1. [ ] Failing tests per area: share dead-link message, credit history labels, intro card naming, guidance label
2. [ ] Change strings; move inline strings to displayNames
3. [ ] Update unit + e2e selectors
4. [ ] Relevant tests + explicit lint; phone screenshots of share modal, Buy credits, credit history

## Acceptance Criteria

- [ ] No "revoke", "recipient", "share" as a noun, "Press Enter", "clipboard", "Usage history", "Admin grant", "Quests", "player" (for the parent's kid) in these surfaces
- [ ] Sentence case on every button and title in scope
- [ ] Tests pass
