# T13340: Horizontal logo lockup in the landing header

**Status:** STAGING
**Impact:** 6
**Complexity:** 1
**Tier:** S (landing only, 2 files, display-only)
**Created:** 2026-10-24
**Updated:** 2026-10-24
**Milestone:** Landing Hero Redesign, see [EPIC.md](EPIC.md)

## Problem

`LogoWithText` (`src/landing/src/components/Logo.tsx:50-58`) renders the wordmark as a stacked
column: "Reel" (text-xl) above a 64px emblem above "Ballers" (text-xl), inside `w-[80px]`. With the
header's `py-4` that makes the landing header about 153px tall on every page. The app style guide
names this exact lockup as banned (`.claude/references/ui-style-guide.md:176`: stacked "Reel" /
icon / "Ballers" lines, "a wrap accident"). On a 1592x785 desktop it spends about 80px of the fold
before any content, and it reads as a layout bug.

## Solution

Horizontal lockup: `Logo size={40}` beside a single-line, non-wrapping wordmark "ReelBallers"
(`text-xl font-bold text-white whitespace-nowrap`), `flex items-center gap-2.5`. Header lands at
about 73px including its border. Only `Header.astro:15` uses `LogoWithText`; keep the export name
so the call site does not change, and delete the stacked markup rather than hiding it.

Mobile: same lockup; the wrapping mobile nav row under the header is unchanged.

## Context

### Relevant Files (REQUIRED)
- `src/landing/src/components/Logo.tsx` - `LogoWithText` (lines 50-58), the stacked column to replace
- `src/landing/src/components/Header.astro` - the single call site (line 15); `py-4` stays

### Related Tasks
- Blocks: T13350 (its fold arithmetic assumes the 73px header)
- Reference: `.claude/references/ui-style-guide.md` logo section (banned lockup)

### Technical Notes
- Display-only; no copy, no SEO surface changes (the `aria-label="ReelBallers home"` link wraps it already).
- The OG card is generated separately (`src/landing/scripts/generate-og-card.mjs`); not touched.

## Implementation

### Steps
1. [ ] Replace the stacked markup in `LogoWithText` with the horizontal lockup
2. [ ] `cd src/landing && npm run check` (astro check) and a CI-identical build per the `deploy-landing` skill pre-flight
3. [ ] Screenshot the header at 1592px and 390px wide; record the measured header height (target ~73px) in the Progress Log

### Progress Log

**2026-10-24**: Filed from the hero review (decision artifact https://claude.ai/artifact/WFcFDoGNHHnUMmXmTziwrp).

## Acceptance Criteria

- [ ] Header is one row: 40px emblem, one-line "ReelBallers", nav, button; no wrapping of the wordmark at any width from 360px up
- [ ] Measured header height about 73px (was ~153px) on index, pricing and a guide page
- [ ] `astro check` and the CI-identical build pass
