# T4940: Monetization pass: credit transparency + ~5c repricing

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-07-12
**Updated:** 2026-07-12

## Problem

User direction (2026-07-12): "What you get for your credits should be clear. Can we sell credits cheaper (5c vs 7c) and still be profitable on cloud costs (upload and Modal)? I want users to see they're getting value and how credits are consumed. I don't want to gouge customers — a reasonable return, especially during growth."

Two gaps, one pricing + one transparency:

**Pricing.** Packs currently sell at 10.0c / 8.2c / 7.2c per credit (`CREDIT_PACKS`, [payments.py:67-71](../../src/backend/app/routers/payments.py#L67)). The original pricing analysis (T520) was never completed — packs shipped without it. This task supersedes T520.

**Transparency.** Users can't tell what a credit buys or when they're spent:
- Pack cards say "~3 clips / ~6 clips / ~14 clips" ([BuyCreditsModal.jsx:45-76](../../src/frontend/src/components/BuyCreditsModal.jsx#L45)) — nowhere does the UI state the actual rule: **1 credit = 1 second of exported video**.
- The export flow computes the exact cost pre-flight ([ExportButtonContainer.jsx:535-558](../../src/frontend/src/containers/ExportButtonContainer.jsx#L535)) but only shows it when the user CAN'T afford it (insufficient-credits modal). A user who can afford it spends N credits with zero upfront notice.
- Upload cost (storage-based, +1 auto-export surcharge) is charged at game activation with no explanation of the formula or the 30-day storage window it buys.
- A `/credits/transactions` endpoint exists ([credits.py:53](../../src/backend/app/routers/credits.py#L53)) but there's no user-facing usage history.
- What's FREE (spotlight render, player detection, downloads, sharing, storage of exported reels) is never stated — users may assume everything costs credits.

## Investigation Findings (2026-07-12, this task's economic basis)

### Consumption model (code ground truth)
| Action | Credits | Where |
|---|---|---|
| Game upload (30d storage) | `ceil(GB x $0.015 x 1.1 / $0.072)` + 1 surcharge; typical 2-6GB game = 2-3 cr | [storage_credits.py](../../src/backend/app/services/storage_credits.py), games.py:724 |
| Framing export (single + multi-clip) | `ceil(video_seconds)` — 1 cr/sec | exports.py:594, multi_clip.py:1971 |
| Storage extension | size x days formula | games.py:1230 |
| Spotlight/overlay render (2nd Modal pass) | **FREE** (no deduction in overlay.py) | — |
| Player detection (YOLO, Modal T4) | **FREE** | — |
| Downloads / share views / playback | **FREE** (R2 egress is $0) | — |
| New account | +8 cr signup, +80 cr via quests (15+25+25+15) | storage_credits.py:25, quest_config.py |

### Marginal cloud cost per credit (= per exported second)
- **Framing+upscale, Modal T4** (the dominant cost): benchmarked 681 ms/frame -> 10s clip @30fps = ~204 GPU-s = **~$0.03 -> ~0.3c per credit-second** (modal-gpu.md, E6 benchmark).
- **Overlay render** (uncharged today): unmeasured; ffmpeg compositing, not GAN — expected well under 0.1c/s. **Measure in Step 0.**
- Detection: single T4 call per clip, sub-cent. R2 storage of working/final videos: ~50MB/reel = ~$0.001/mo. R2 egress: $0. Retry ceiling: 3 attempts on transient failures (rare).
- **All-in marginal estimate: ~0.4-0.5c per credit.**

### Verdict on 5c
**Yes — comfortably profitable.** At 5c/credit the estimated gross margin on marginal cloud cost is ~90% (vs ~93% at 7.2c). GPU cost is ~10x below even the reduced price; current prices are value-based, not cost-forced. Fixed infra (Fly VMs, Postgres) is volume-independent and fine to run lean during growth, per user intent. Free-user liability: a fully-quested free account (88 cr) costs us ~$0.40-0.45 marginal — cheap acquisition.

### Caveats the implementation must handle
1. `CREDIT_VALUE = 0.072` is hardcoded in [storage_credits.py:19](../../src/backend/app/services/storage_credits.py#L19) as "worst-case per-credit" — it converts $ storage cost into credits. Repricing to 5c means updating it to the new worst-case (0.05), which makes uploads cost slightly MORE credits (4GB: 2 -> 3 cr incl. surcharge) while costing users less in $. Keep formula cost-recovering.
2. Pack definitions are **duplicated** (backend `CREDIT_PACKS` + frontend `PACKS` display copy). Single-source them: extend the existing `/payments/config` endpoint to return packs; frontend renders from it (leverage existing systems, no new parallel config).
3. Existing balances are unaffected (consumption rules unchanged; a cheaper price for future purchases strictly benefits users). No migration.
4. In-flight Stripe sessions carry pack metadata; deploy is safe (grant reads metadata, not current constants) — verify.
5. Overlay render stays free (product decision), but measure its real cost first so "free" is a known number, not an assumption.

## Solution

### Workstream A — Repricing (~5c/credit)
Present pack options to user at kickoff (final numbers are a user gate):
- **Option A, flat 5c:** 80/$3.99 · 140/$6.99 · 260/$12.99
- **Option B, tiered to 5c best-value:** 70/$3.99 (5.7c) · 130/$6.99 (5.4c) · 260/$12.99 (5.0c) — preserves "Best Value" meaning
Update `CREDIT_PACKS`, `CREDIT_VALUE`, and the single-sourced frontend packs. Update analytics expectations if any dashboards assume pack sizes.

### Workstream B — "What you get" transparency
1. **State the rule everywhere credits appear:** "1 credit = 1 second of exported video" on pack cards (with honest per-pack conversion: "80 credits = 80 seconds ≈ 6 clips"), in the buy modal, and in a compact "How credits work" explainer (buy modal link + help surface): what costs credits (export seconds, upload storage/30 days), what's free (spotlight, detection, downloads, sharing), credits never expire.
2. **Pre-flight cost display:** Export/Add Spotlight primary button area shows the cost BEFORE click ("Export · 14 credits") using the already-computed `getRequiredCredits(totalVideoSeconds)` — surface it always, not only on insufficiency. Same for upload: show the storage cost + what it includes (30 days) before activation ([storageCost.js](../../src/frontend/src/utils/storageCost.js) exists for this).
3. **Usage history:** minimal transactions view (source, amount, date, running balance) fed by the existing `/credits/transactions` endpoint — likely in the profile/account surface next to the balance.
4. Copy tone per user intent: value-forward, not scarcity-forward ("your credits go further now").

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/payments.py` — `CREDIT_PACKS` (~67), `/payments/config` (extend with packs)
- `src/backend/app/services/storage_credits.py` — `CREDIT_VALUE`, upload/extension formulas
- `src/frontend/src/components/BuyCreditsModal.jsx` — `PACKS` duplicate -> render from config; explainer entry
- `src/frontend/src/components/InsufficientCreditsModal.jsx` — align copy with the stated rule
- `src/frontend/src/containers/ExportButtonContainer.jsx` + `components/ExportButtonView.jsx` — pre-flight cost display
- `src/frontend/src/stores/creditStore.js` — `getRequiredCredits` (already exists)
- `src/frontend/src/utils/storageCost.js` — upload cost preview
- `src/frontend/src/components/shared/UnifiedHeader.jsx` — balance display; entry point to usage history
- `src/frontend/src/components/TermsOfService.jsx` — check for pricing mentions
- Tests: `creditStore.test.js`, payments/export backend tests

### Related Tasks
- Supersedes: T520 (pricing exploration, never completed) — close it when this lands
- Related: T4870 (admin credit display) / T4860 (bulk grants) — admin-side credit views, unaffected by pack prices
- Storage Credits epic decisions (memory): no migration, new-signups-only patterns for credit changes

### Technical Notes
- Modal cost anchors: [modal-gpu.md](../../.claude/knowledge/modal-gpu.md) E6 benchmark (T4 ~681ms/frame; 10s clip ~$0.03). Step 0 measures overlay render the same way.
- No schema change (packs are constants; transactions table exists). No Migration agent.
- Stripe: prices are inline `price_data` per session, not Stripe Price objects — repricing is a pure code change.
- Deduction/refund paths (reserve -> confirm/release, refund on failure) are untouched; only pack contents and presentation change.

## Implementation

### Steps
1. [ ] Step 0 — measure overlay render GPU-s/video-s on a representative clip (it's free to users; know what we're absorbing); sanity-check framing cost anchor still ~0.3c/s
2. [ ] User gate: pick pack option (A flat 5c / B tiered) and confirm explainer copy stance
3. [ ] Backend: new `CREDIT_PACKS`, `CREDIT_VALUE`, packs in `/payments/config`
4. [ ] Frontend: packs from config (kill the duplicate), rule copy + explainer, pre-flight export/upload cost display, transactions view
5. [ ] Tests: pack math, config endpoint, pre-flight display, transactions rendering
6. [ ] Verify a live Stripe test purchase end-to-end on staging (amount, credits granted, analytics `total_spent`)

### Progress Log

**2026-07-12**: Task created after investigation. Economics: marginal cloud cost ~0.4-0.5c/credit vs 5c proposed price -> ~90% gross margin; 5c is safely profitable. Key mechanical dependency found: `CREDIT_VALUE` constant couples pack pricing to upload cost formula. Key UX gap: cost is computed pre-flight but only shown on insufficiency.

## Acceptance Criteria

- [ ] Overlay render cost measured and documented (this file + modal-gpu.md)
- [ ] New pack pricing live at ~5c/credit (exact packs user-approved), profitable per measured costs
- [ ] `CREDIT_VALUE` updated; upload formula still cost-recovering at new price
- [ ] Pack definitions single-sourced from backend config
- [ ] "1 credit = 1 second of exported video" stated on every credit purchase/spend surface; free actions explicitly listed
- [ ] Export and upload show credit cost BEFORE the user commits
- [ ] Usage history visible to users
- [ ] Existing balances and in-flight payments unaffected; live test purchase verified on staging
- [ ] Tests pass
