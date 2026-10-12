# T11900: Re-run the parent journey on staging (milestone close)

**Status:** OBSOLETE (folded into [T12590](../T12590-guide-coverage-and-responsive-sweep.md) on 2026-10-11)
**Updated:** 2026-10-11
**Impact:** 7
**Complexity:** 2
**Tier:** S (verification only, no code)
**Created:** 2026-10-04

## Why this is obsolete

By 2026-10-11 this task had become a findings table written from another pass's screenshots: T12310
had already ruled out re-driving the journey, so nothing was left here but the write-up. T12590 walks
every screen at 1440x900, 1024x768, 768x1024 and 390x844 (a superset of this audit's three viewports
and all eight of its journey screens), so the Parent Usability Audit close is now a step and an
acceptance criterion of T12590, written into that task's RESULTS.md.

Nothing in the scope was dropped. What moved:

- The 12 audit findings, each mapped to fixed / partly fixed / not fixed with the screenshot that
  shows it, plus a filed follow-up for anything not fixed.
- The acceptance bar: every CRITICAL and HIGH finding proven by screenshot or a filed task, and the
  full journey completing at 1440 with no step that needs a hidden gesture.
- The known gap: T11890 (silent Google sign-in failure) was closed 2026-10-09 by user decision
  WITHOUT the Google console origin check or the real-device repro, so nothing covers it. T12590
  records it as "not verified (T11890 closed unchecked)"; `[auth-diag]` log lines are the only signal.
- Human judgment of clarity stays the user's call: T12590 sets `WAITING ON USER` with its RESULTS link.

## Context (kept for reference)

Closing task of the [Parent Usability Audit](README.md) milestone. The original audit
([reelballers-ux-audit.md](../../ux/2026-10-04-parent-usability-audit/reelballers-ux-audit.md)) ran
on staging at 1440x900, 768x1024 and 390x844, with per-viewport detail in `desktop-findings.md`,
`tablet-findings.md` and `iphone-findings.md`.
