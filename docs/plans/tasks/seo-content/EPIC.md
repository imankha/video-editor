# SEO Content & Landing Value Props

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Priority:** 1.8
**Created:** 2026-08-16
**Sequencing:** After Milestone TOP (the Durable Sync campaign) completes in full —
NOT merely after the T5140 reshoot. Per PLAN.md's Priority Policy, growth work sits
behind open infrastructure bugs; this epic is deliberately excluded from the
"queued directly after the reshoot" group (T7140 [renumbered from T7020], JIT Migration,
Collection Download),
which is durability/infra-adjacent work that gets priority even though it also follows
the reshoot chronologically.

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

- **Do not start before Milestone TOP is closed out.** The epic and both task files are
  fully specced now so they're ready to pick up the moment the durability campaign clears
  — this is a "file now, work later" ticket, not a "start now" one.
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
