# T16680: On a phone the profile photo and the Guidance switch cover the logo on Home

**Status:** STAGING
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-16
**Updated:** 2026-11-16

## In plain words

On a phone (390x844) the small profile photo in the top bar sits over the right side of the "ReelBallers" title and its tagline, and the Guidance switch box covers the top of the logo. It stays there on every Home tab, after reloads. The desktop layout is fine.

## How we got here

Found on staging on 2026-11-16. The photo is positioned just below the top bar (absolute top-full right-0 in ProfileSportButton).

## Solution

Rearrange the phone top bar so the logo, the photo and the Guidance switch do not overlap, without changing the desktop layout.

## Why

Home is the first screen a parent sees on every visit, and the brand mark is covered.

## Relevant Files

- ProfileSportButton and the Home header under src/frontend/src/components/

## Acceptance Criteria

- [ ] C1: At 390x844 on every Home tab the logo, tagline, profile photo and Guidance switch do not overlap.
- [ ] C2: At 1280x800 the Home header looks the same as before.
