# Handoff: clear everything before the Tutorial Redesign epic (T7620/T7630/T7640)

You're picking up where a previous session left off. Goal: resolve every remaining task that
sits ahead of the Tutorial Redesign epic in `docs/plans/PLAN.md`, so T7630 (guided-tour
implementation) can start with nothing outstanding behind it. Read `CLAUDE.md` and
`docs/plans/PLAN.md` in full before doing anything — this doc summarizes what a careful audit
already found, but PLAN.md epic-header status lines go stale (children finish, headers don't
get updated), so **verify every claim below against the actual task files / PLAN-archive.md
before acting on it, don't just trust this doc**.

## Do this first: a live P0 regression, unrelated to everything else here

**Staging is currently broken for opening any draft into Focus mode.** Confirmed 2026-09-15:
clicking a draft card crashes the app to a blank white screen with a real React error
(`Maximum update depth exceeded` / minified error #185 — an infinite render loop), captured via
console logging on a real Playwright run against `reel-ballers-staging.pages.dev`, not a fluke.

- Confirmed NOT caused by T10150 (reproduces on a page load before that merge's frontend
  changes were even live).
- Strongly suspected but **NOT confirmed**: T9950 (merged as PR #451, ~STAGING), which rewrote
  exactly this area — `FocusContainer.jsx` (+187 lines), `FocusModeView.jsx` (+115),
  `FocusSettingsPanel.jsx`, and a new `useFramingHistory` hook. Timing lines up (crash first
  observed shortly after that merge) but the actual infinite-loop mechanism hasn't been traced.
- Flagged in PLAN.md's T9950 row (search `P0 FLAG 2026-09-15`).
- **Fix this before anything else** — it blocks live-browser verification of several other
  things below (T10150's own QA is still incomplete because of it), and it's a core flow
  currently down on staging.

Repro recipe (reuse, don't rebuild): `loginAsRealUser` as `imankh@gmail.com` / profile
`9fa7378c` against staging, open Clips, click any draft card, watch the console for the React
error. `src/frontend/e2e/derisk-staging-export.qa.spec.js` also reproduces it (fails waiting for
the Framing export button after opening a draft).

## Confirmed: T7630 is actually already unblocked

The chain PLAN.md documents as gating T7630 — `R3,R4 -> T8360 -> T8370 -> T8380 -> T7630 ->
T7640` — is **fully cleared**. Verified in `PLAN-archive.md`: T8360, T8370, T8380, T8390, T8400
are all DONE (deployed to prod 2026-09-13). T7620's design is APPROVED. There is nothing left
blocking T7630 from starting except everything else in this document.

## Confirmed complete (PLAN.md header says TODO/blank, but every child is DONE or STAGING) — sweep these headers, no engineering needed

- **Admin Auth Hardening** epic — both children (T8300, T8290) DONE.
- **First-Clip Funnel** epic (under Milestone TOP) — all three children (T8120, T8130, T8140)
  DONE.
- **JIT Migration** epic — T5081, T5087, T5086, T5089 DONE; T5083, T5085 STAGING (awaiting the
  user's Resolve/deploy-promotion gesture, not engineering work).
- **Fast App Update** epic — T9340, T9360, T9370 DONE; T9380 (the 4th leg) is `ICE` (explicitly
  parked by the user, not something to resolve).
- **Cross-Profile Game Attribution (bug 37p)** epic — sole child T5830 DONE.
- **First Reel Funnel** epic (distinct from First-*Clip*-Funnel above) — all 15 children (see
  `tasks/first-reel-funnel/`) archived DONE.
- **Clip Upload & Reel Completion** epic — never had its own child task files; its two stated
  gaps are fully satisfied by the already-DONE T8390/T8400 (publish exit) and T8370/T8380
  (pre-cut upload). Nothing to build.

None of these need implementation. They need someone to update their PLAN.md epic-header status
and, per the project convention, move fully-DONE epics' rows to `PLAN-archive.md`.

## Confirmed real, unstarted work — this is the actual remaining engineering

**Export Write-Path Unification epic** (`tasks/export-write-path/EPIC.md`) — Impact 9, **STRICT
order**, all four children still `TODO`, none design-approved yet:
1. `T4370` — Export Golden-Output Test Harness (the parity oracle everything else needs first)
2. `T4380` — `ExportJobRepository` (single owner for every status transition)
3. `T4390` — `finalize_export`/`publish_final_video` single writers
4. `T4400` — Backend-Authoritative Export (client can no longer clobber newer server state)

This is the substance of the "TOP PRIORITY: Durability Hardening Campaign" named at the very top
of PLAN.md's Current Focus — but that Current Focus text is dated **2026-07-17, over two months
stale** relative to everything else in this file. Re-verify its framing (sequencing, whether
`T4320` — mentioned in prose but with no task row anywhere — was completed/renamed/folded into
something else) before trusting it; don't carry old assumptions forward uncritically.

Also TODO, same durability lane: `T2260` (Data Loss Detection & Recovery,
`tasks/session-scaling/T2260-data-loss-detection-recovery.md`).

**Release-gate + sign-off for the whole Sept 9-10 walkthrough remediation** (Shared Vocabulary
epic, under "Parent Walkthrough Remediation"):
- `T9720` — End-to-end and failure-path release check (E8-01). Needs the `wcfc-carlsbad-trimmed.mp4`
  fixture (confirm access or substitute an authorized equivalent). Consider whether it should
  become a permanent `@staging-gate` lane (see `STAGING-GATE.md`) — the runbook needs the
  staging machine scaled to `shared-cpu-4x/4096` first, revert after.
- `T9730` — Product review and traceability sign-off (E8-02). Depends on T9720, T9650 (done),
  T9570 (done). Worth publishing as an artifact rather than a buried task file, per its own note.

**Preview Video Improvements epic** (`tasks/preview-video-improvements/EPIC.md`) — genuinely not
started:
- `T7170` — Remove the artificial ~450ms preview reveal delay (S/M-tier)
- `T7160` — Mobile tap-to-select-plays-preview (L-tier, Architect gate, **4 open design
  questions already listed in the task file** — a good first candidate for the decision-artifact
  treatment below)
- `T6440` — Autoplay-previews setting + data-saver toggle, depends on T7160

## Items stuck on the user — not resolvable by engineering alone

- **`T8836`** — a measured decision table (client-side pre-upload probes) is ready; the user
  needs to pick which rows become tasks. Table is in the task file, already filled in.
- **`T8840`** — the standalone browser shrink tool is built and reviewed; it needs the **user's
  own physical hardware test** (a real 50GB DJI folder on a second machine, recipe in
  `scripts/shrink-tool/README.md`). No amount of engineering substitutes for this.
- **`T9120`/`T9130`** — root cause of the Publish page-load stall is fully confirmed (9
  un-offloaded handlers serializing on one event loop, live-reproduced on staging with
  measurements, not inference — full detail in the task file's Progress Log). The fix spec
  (`T9130`) is drafted inside T9120's task file but needs the user's approval to file and start
  it as its own task.

## Also open, lower priority, filed but not started (from tonight's session, same evaluation batch as T9650)

- `T10170` (**P1** — a live public-facing accuracy bug: the landing site claims the AI
  autonomously "frames and tracks the player," which is false and already corrected once in
  T9650's copy; the same overclaim is still live across the homepage, SEO meta description, and
  every generated sport/camera page — see `feedback_ai_capability_copy_accuracy.md` memory for
  the accurate mechanism to write instead).
- `T10180` (T9880's GATED_DISCOVERY follow-up — result-surface publish/visibility-review/link-
  ready UI, L-tier, Architect gate).
- `T10190` (T9890's follow-up — result-title consistency + back-to-game backlink + copy
  centralization, coordinate with T9860's conventions).

## Process notes

- **Load memory first** (`MEMORY.md` in the auto-memory directory) — it has durable context on
  how this user likes to work (test scope policy, merge-when-provably-verified, no em dashes,
  container discipline via `/dotask`, etc.) that CLAUDE.md doesn't repeat.
- **For anything that needs the user's input or a decision** — T8836's row-picking, T9120/T9130's
  approval, T7160's 4 open design questions, or anything else you hit a real fork on — **don't
  ask piecemeal in chat. Batch them into one consolidated decision artifact** (a published HTML
  page: options with a recommendation, before/after where there's a concrete diff to show, clear
  per-item asks) the way `https://claude.ai/artifact/QpK7ZpPkEDNADbeqQ3wWQk` did tonight for the
  GAN-upscale design gate + a copy review together. Load the `artifact-design` skill before
  writing it. If multiple decisions land around the same time, put them in the same artifact
  rather than publishing several small ones back to back.
- **Suggested order**: (1) root-cause and fix the P0 Focus-mode crash — it's live-broken right
  now and blocks verifying other work; (2) do your own fresh top-to-bottom pass of PLAN.md from
  the top down through (not including) the Tutorial Redesign section, confirming or correcting
  everything summarized above — PLAN.md is the source of truth, this document is a starting
  point, not a substitute for checking; (3) work the real remaining engineering
  (export-write-path epic first, per its strict order, then T2260, T9720/T9730, Preview Video
  Improvements) via `/dotask`, respecting the project's WIP-4 container discipline; (4) publish
  the consolidated decision artifact for the user-input items once you've reached them; (5) once
  Next Up + the durability campaign are genuinely clear, confirm T7630 is ready and hand back to
  the user for the go-ahead before starting Tutorial Redesign implementation — it's a fresh
  L-tier epic that deserves its own kickoff conversation, not something to fall into silently.
- Use `T{id}:` commit-subject prefixes and the AI-owned status transitions (`WIP`/`WAITING ON
  USER`/`STAGING`) per CLAUDE.md's Task Status Rule — never set `DONE` yourself.
