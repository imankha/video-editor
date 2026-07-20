# T5651: Proxy/master asset pairing data model + credit accounting

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-07-20
**Epic:** [Multi-File Ingest & Prep](EPIC.md) (task 1/7)

## Epic Context
See [EPIC.md](EPIC.md) and the study
[research/T5650-dji-8k-ingest-reduction-study.md](../../research/T5650-dji-8k-ingest-reduction-study.md)
(section 0 = locked decisions). Foundational task: everything downstream needs a game video to
carry BOTH a proxy (LRF) and a master (MP4) with a link between them.

## Problem
Today a game video is a single asset. The dual-asset pipeline needs each game video to reference a
**proxy** (used by Annotate + Framing preview) and a **master** (used by Framing conform +
upscale), plus storage-credit accounting that counts both.

## Solution
- Extend the game-video data model so each video row carries a proxy ref + master ref (R2 keys),
  each with resolution/codec/bitrate/duration and a `proxy_source` flag (`shipped_lrf` |
  `generated`). Frame-accuracy checked at ingest (frame count proxy == master).
- Storage-credit cost = bytes(proxy) + bytes(master). Retention policy: keep master while the game
  is active (re-framing needs it); do NOT evict on export.

## Context
### Relevant Files
- `src/backend/app/routers/games_upload.py`, `games.py` (video rows, add-half precedent L460).
- Schema: game-video table (profile_db or the games schema in `database.py` / `pg.py`) + versioned
  migration. Follow [backend-services.md](../../../.claude/knowledge/backend-services.md) migration rules.
- `src/frontend/src/utils/storageCost.js` (`calculateUploadCost`) + `GameDetailsModal.jsx` cost display.
- `src/frontend/src/constants/gameConstants.js` (`VideoMode`), backend `app/constants.py`.

### Related Tasks
- Blocks T5653 (upload writes both refs), T5654 (Annotate reads proxy ref), T5655 (Framing reads master ref).

### Technical Notes
- Single canonical location per asset (no derivable/duplicate state). Frame-accuracy check is the
  gate for "is this a valid proxy for conform" (offset mapping must be exact).

## Acceptance Criteria
- [ ] Game video carries proxy + master refs with a verified frame-accurate link.
- [ ] Upload cost counts both assets; migration + fresh-DDL updated.
- [ ] Retention documented (keep master while active).
