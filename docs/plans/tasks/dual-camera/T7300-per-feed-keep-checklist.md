# T7300: Per-Feed Keep Checklist (Rent UX)

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-08-19
**Updated:** 2026-08-19

## Problem

A pool game holds up to 50 members' cameras and clips. After the uploader's initial
30-day window (which covers the whole pool — EPIC decision 5), continued access is
**per-member per-feed** with the member's own credits. `StorageExtensionModal` extends a
whole game blindly, and `extend_game_storage` (`games.py` ~L1417) re-refs **ALL**
`game_videos` hashes for the game (~L1460-1469 loop) — with N feeds that would silently
charge a member for every camera in the pool.

## Solution

Implement [UX-SPEC.md §9](UX-SPEC.md) (normative): a per-camera keep checklist that
replaces `StorageExtensionModal` **for pool games only** (plain games keep the existing
modal untouched).

1. **Per-feed rows** — owner initial badge + `{owner} — {kind}` + `{size} · {n} credits /
   30 days`, in the ShareGameModal list wrapper. Row states per §9: renewable / covered by
   `{firstName}` until `{date}` (disabled+checked, excluded from total) / expired-for-member
   (`renew access`) / source reclaimed (single unavailable treatment, disabled).
2. **Pre-check rule (conservative — never pre-spend on inference):** pre-checked ONLY for
   (a) the member's own feed, (b) feeds carrying at least one of the member's **explicit
   clip stamps** (§8 `feed_id` picks). Main-resolved-only cameras start UNCHECKED with the
   `used by {n} of your clips` note + inline `Keep` affordance. Unchecking a stamped row
   arms the inline warning ("{n} clips export from this camera — they'll fall back to Main").
3. **"Keep nothing for now"** — at zero selection the primary is an enabled ghost that
   closes writing nothing; declining is a real choice. The **consequence line** ("Cameras
   you don't keep stop playing on {date}. Your clips, notes and finished reels stay.")
   is persistent, directly above both dismiss actions.
4. **Hash-selective extend.** The renewal write extends refs for ONLY the selected feeds'
   blake3 hashes — a pool-aware sibling of `extend_game_storage`, not a blanket re-ref of
   every `game_videos` row. One write for the whole checklist:
   `POST /api/pools/{id}/renewals {feed_ids: [...]}` (debits credits, extends the member's
   per-feed `game_storage` refs).
5. **Per-feed `storage_status` derivation.** A pool game's playability is per feed, not
   per game: derive each feed's status from the member's own refs on that feed's hashes
   (today's `storage_status` semantics, per-feed). Feeds the member hasn't kept show the
   single "camera unavailable" treatment in §6/§8; the game itself is not "expired" while
   any feed is live.
6. **Clip-feed pricing:** a clip feed renews at **1 credit** flat, with **no auto-export
   surcharge** (clips in a pool are feeds, not annotation clips — the expiry-sweep
   auto-export path must not touch them).
7. **Routing:** tile tap on an expired pool game opens THIS checklist (§4 states table) —
   never `StorageExtensionModal`; likewise every `Renew` affordance in §6 lanes and the
   §8 picker deep-links here with that feed pre-checked.

## Context

### Relevant Files (REQUIRED)
- NEW `src/frontend/src/components/KeepCamerasModal.jsx` — reuses `StorageExtensionModal.jsx` header/formatters/balance row/`BuyCreditsModal` gate
- `src/frontend/src/components/StorageExtensionModal.jsx` — untouched for plain games; source of reused idioms
- `src/frontend/src/components/GameTile.jsx` — expired-pool tile-tap routing + expiry chip reflecting the member's own rent state
- `src/backend/app/routers/games.py` — `extend_game_storage` (~L1417): pool games routed to the hash-selective path
- Backend pools router (T5500's) — `POST /api/pools/{id}/renewals`
- `src/backend/app/services/storage_credits.py` — per-feed cost calc (clip-feed flat pricing)
- `src/backend/app/services/sweep_scheduler.py` — per-feed status derivation must agree with the sweep's recount (T5520 owns the cross-account audit)

### Related Tasks
- Depends on: T5500 (pool tables), T5520 (per-feed refs + rent enforcement at presign — this task is the UX + renewal write over that foundation), T5550 (clip stamps drive the pre-check rule)
- References: [EPIC.md](EPIC.md) decision 5 (rent model), UX-SPEC §9 (all copy/states verbatim), §4 (routing), § Conventions (unavailable treatment)

### Technical Notes
- Knowledge docs: [persistence-sync.md](../../../../.claude/knowledge/persistence-sync.md), [backend-services.md](../../../../.claude/knowledge/backend-services.md)
- Gesture-based persistence: checkbox toggles and inline `Keep` clicks write NOTHING;
  the Confirm button is the single write gesture; `Keep nothing for now` / `Not now`
  write nothing; `BuyCreditsModal` success resumes the same renewal POST
- Never re-ref hashes the member did not select — the current all-hashes loop is exactly
  the bug class this task exists to prevent (memory: game-video ref_count drift)
- Migrations never auto-run; if renewal needs schema (it shouldn't — refs are existing
  `game_storage` rows), Migration agent + admin endpoint
- Partial failure surfaces per §9 ("Kept {k} of {n} — retry the rest"), never silent

## Implementation

### Steps
1. [ ] Backend: renewals endpoint (hash-selective, per-feed, clip-feed flat pricing) + per-feed status derivation
2. [ ] KeepCamerasModal: rows, pre-check rule, running total, consequence line, zero-selection ghost
3. [ ] Routing: expired pool tile tap, kebab Extend storage, §6/§8 Renew deep-links (pre-checked feed)
4. [ ] Tests: pre-check matrix (own/stamped/Main-resolved/covered/reclaimed), hash-selective extend leaves unselected feeds' refs untouched, clip-feed pricing, partial failure, plain games still get StorageExtensionModal

## Acceptance Criteria

- [ ] Pool-game renewal charges and extends ONLY the selected feeds' hashes (test proves unselected refs untouched)
- [ ] Pre-check follows §9's rule exactly; covered rows name the payer and date and cost nothing
- [ ] Zero-selection shows the enabled "Keep nothing for now" ghost; no path closes the modal without the consequence line visible
- [ ] Clip feeds renew at 1 credit with no auto-export surcharge
- [ ] Expired pool tile tap opens the checklist; plain games keep the existing modal byte-identically
- [ ] Backend + frontend tests pass
