# SEO Content & Landing Value Props

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Priority:** 1.8
**Created:** 2026-08-16
**Sequencing:** After the T5140 tutorial reshoot (user-ordered 2026-08-16) — member of the
"queued directly after the reshoot" group in PLAN.md, alongside the JIT Migration and
Collection Download epics (T7020 remains first in that group; relative order among the
epics not specified).

## Goal

Make the marketing site sell everything the product actually does, and give the thin spots
in content coverage the pages Google and AI engines need to cite. Derived from the
homepage audit against [feature-inventory.md](../../../marketing/feature-inventory.md)
(2026-08-16): the share→claim loop, the kids'-privacy stance, the season-builds-itself
story, and half the broadcast-package stack are absent or undersold today, and the
highest-intent comparison queries (Hudl/Veo/Trace/iMovie) have no pages.

## Tasks

Strict order — T7120 depends on T7110 (TrustStrip component, FACTS entries, homepage link
targets):

| ID | Task | Status |
|----|------|--------|
| T7110 | [Landing homepage — sell all four value stories (copy overhaul)](T7110-landing-value-props.md) | TODO |
| T7120 | [SEO content expansion — comparisons, use-case & privacy pages, guide bodies](T7120-seo-content-expansion.md) | TODO |

## Boundaries

- **T6370** (GSC indexing cleanup + app-subdomain soft-404/robots) stays a standalone
  sibling in the same PLAN.md milestone — this epic feeds its Part C (page value /
  boilerplate reduction) from the content side but must not duplicate its scope.
- Owner-gated actions live in
  [seo-owner-checklist.md](../../../marketing/seo-owner-checklist.md): guide-outline
  approval (gates T7120 Phase D), homepage copy approval (gates T7110 merge), Search
  Console, social profiles, YouTube channel.
- All implementation is confined to `src/landing/` — no editor/backend code.

## Completion Criteria

- [ ] T7110 merged after user copy approval; verify-seo green
- [ ] T7120 Phases A–C live (comparisons, share/privacy pages, cross-links); Phase D for
      every outline approved at the time; Phase E optional
- [ ] No claim on any new page lacks a `site.ts` FACTS / feature-inventory source
- [ ] Indexed-page movement checked in GSC ~4 weeks after deploy (coordinate with T6370's
      success metric rather than duplicating it)
