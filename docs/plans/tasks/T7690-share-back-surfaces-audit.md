# T7690: Share-back attribution: audit surfaces beyond the reel tail card

**Status:** DECIDED 2026-09-03 — audit delivered, all 5 proposals approved, split into child
tasks below. This task itself is closed (research + decision only).
**Impact:** 5
**Complexity:** 3
**Created:** 2026-08-24

## Decision (2026-09-03)

Audit delivered as a decision artifact (surface inventory table + 5 ranked proposals):
https://claude.ai/code/artifact/3e8c3067-2381-4d61-85c9-990ef69bce4e

Core finding: the "make your own reel" viral CTA (`BrandedEndCard`, with UTM tracking)
already exists and fires on the reel and collection share pages — but is missing from the
teammate-tag share page, which is exactly the same-team-parent audience this task's growth
thesis names. That page was a bare "Sign in to watch" gate with zero brand story.

User approved all 5 ranked proposals for implementation. **Implementation split into 5 child
tasks** in the new [Share-Back Attribution epic](share-back-attribution/EPIC.md), in ranked
order (impact vs. effort):
- [T8410](share-back-attribution/T8410-teammate-tag-share-cta.md) — teammate-tag share page CTA (highest impact, lowest effort)
- [T8420](share-back-attribution/T8420-game-link-share-cta.md) — game-link share page CTA
- [T8430](share-back-attribution/T8430-share-page-wordmark-link.md) — link the dead wordmark header
- [T8440](share-back-attribution/T8440-branded-download-filename.md) — brand the download filename
- [T8450](share-back-attribution/T8450-unfurl-description-cta.md) — unfurl description CTA (ranked last — genuine truncation risk)

No code from this task itself — see the epic and its 5 children.

## Problem / Opportunity

CapCut's acquisition unit is the share-back loop: every finished video carries a "Try
this template" path back into the product. Our published reels ALREADY have a "Made with
ReelBallers" tail card (user confirmation 2026-08-24), but that is the only attribution
surface. The user notes there may be opportunities on OTHER surfaces - our natural viral
unit is other parents on the same team seeing a kid's reel.

## Scope

Audit-first, then propose (no implementation without user sign-off on the proposals):
1. Inventory every surface a non-user encounters: share pages (link previews/unfurls,
   the share landing page itself), downloaded video files, teammate-share claim flows,
   collection/ranking share views.
2. For each: what attribution/CTA exists today, what could exist ("Make one for your
   player" on the share page footer; unfurl copy; teammate-tag notifications), and the
   CapCut watermark lesson - default attribution with goodwill (their outro clip is
   deletable; ours should never hold shared content hostage).
3. Propose a ranked shortlist with effort estimates; user picks.

## Context

- Brand voice: focus-on-your-athlete positioning binds any CTA copy (marcom memory).
- Related: share UA-sniff fix T7350 (same share surfaces), staging cold-start unfurl
  caveat when testing link previews.

## Acceptance Criteria

- [ ] Surface inventory table (surface -> current attribution -> proposal)
- [ ] Ranked proposals put to the user; nothing implemented in this task
