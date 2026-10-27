# T13730: Make the landing job run astro check and the SEO verifier

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-10-27
**Follow-up of:** T13710

## Problem

T13710 added a `landing` job to Branch and Master CI that runs `npm run build`. Two other landing
checks already exist but fail on master, so they could not be gated:

- `npx astro check`: 1 error, `src/landing/src/pages/index.astro:383` `ts(7006): Parameter 'pack'
  implicitly has an 'any' type.`
- `node scripts/verify-seo.mjs` (from `src/landing`, after a build): meta descriptions over the
  length limit on several pages, e.g. /recruiting-videos 172 chars, /rugby 162, /soccer 174,
  /softball 171, /tennis 180.

## Solution

1. Type the `pack` parameter in `index.astro`.
2. Shorten the over-long meta descriptions in the landing data files. This is shipped copy:
   follow the marketing positioning and copy rules (no em dashes, no autonomous-AI overclaims),
   and show the user the before/after list for sign-off.
3. Add `npx astro check` and `node scripts/verify-seo.mjs` as steps in the `landing` job of both
   `.github/workflows/branch-ci.yml` and `master-ci.yml` (keep them identical;
   `scripts/test_ci_policy.py` pins the job blocks).

## Acceptance

- Both commands exit 0 locally on a fresh `npm ci` in `src/landing`.
- Branch CI `landing` job runs all three steps and is green.
