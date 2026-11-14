# T13730: Landing page checks in CI

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-10-27
**Follow-up of:** T13710
**Updated:** 2026-11-13

## In plain words

CI builds the marketing site and runs its tests, but it does not run the site's type check or its search-listing check, so a broken page title or an untyped mistake can ship. Turn both on and fix what they report. Any change to page wording needs the owner's sign-off. Worked when a branch that breaks either check fails CI.

## Current facts (checked 2026-11-13)

Checked against the code on 2026-11-13. Where the older text further down disagrees, this section is right.

- The `landing` job in `.github/workflows/branch-ci.yml` runs `npm ci`, `npm test` and `npm run build` only; no workflow mentions `astro check` or `verify-seo`.
- The untyped parameter the task names is still in `src/landing/src/pages/index.astro` (`CREDIT_PACKS.map((pack) =>`). Current failure counts of both commands were not re-measured.

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
