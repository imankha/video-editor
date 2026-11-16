# T16660: A parent who opens the admin page sees the admin screen and a stuck loader

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-16
**Updated:** 2026-11-16

## In plain words

Anyone signed in can type /admin and see the whole Admin Panel page: its filters, the Journey and Spend readiness boxes, a line saying the roadmap has "9 steps, 54 tasks" and the build id. The data boxes fail with a 403 error and the Journey box says "Loading journey..." forever. The server does refuse the data, so no data leaks, but the page and the internal roadmap line are shown and three failing requests are made.

## How we got here

Found on staging on 2026-11-16 with a normal account. T4610 moved the admin check to the server's router; the screen in the browser was never told.

## Solution

When the signed-in account is not an admin, send it to Home (or show a short not-available screen) before any admin screen or request is made.

## Why

Parents should never see internal screens or the company's roadmap, and failing requests add noise to our own error counts.

## Relevant Files

- the admin route and its guard under src/frontend/src/
- how the app already knows whether the account is an admin

## Acceptance Criteria

- [ ] C1: A normal account that opens /admin on staging ends up on Home or on a not-available screen, with no admin filters, roadmap line or build id shown.
- [ ] C2: No request to /api/admin/* is made for a normal account.
- [ ] C3: An admin account still sees the Admin Panel as before.
