# T7000: `_js_path()` loud-failure guard no longer raises at Fly deploy depth

**Status:** WAITING ON USER
**Impact:** 4
**Complexity:** 2
**Created:** 2026-08-13
**Updated:** 2026-08-13

## Problem

T6920 added a loud-failure guard so `intro_card_geometry.py::_js_path()` raises a clear
`RuntimeError` (instead of a bare `IndexError: 4`) when the deployed Fly image's directory
depth doesn't match the expected repo-checkout layout — a no-silent-fallbacks safety net.

Discovered 2026-08-13 while triaging T6990's Branch CI: `test_t6920_intro_geometry_import_depth.py
::test_js_path_raises_clear_error_at_fly_image_depth` fails with `DID NOT RAISE <class
'RuntimeError'>`. Confirmed failing on **Master CI itself** (run 31745204680) and independently
on T6990's unrelated branch (run 31747448745, same failure line) — so this predates and is
unrelated to T6990 (whose diff never touches intro-card code). No commit has touched
`intro_card_geometry.py` since T6920 landed (`61c97add`), so the regression's trigger is unclear —
possibly an environment/import-caching difference on the CI runner rather than a code change,
but the guard existing and not firing is a real (if latent) violation of the project's
no-silent-fallbacks rule until root-caused.

## Solution

Root-cause why `_js_path()` no longer raises when `g.__file__` is patched to the mocked
`_FLY_IMAGE_DEPTH_FILE` depth in the test. Likely candidates: the depth-detection logic reads
something other than `__file__` now (module caching, `Path.resolve()` behavior differing from
the mock), or the guard's condition no longer matches the mocked path shape. Fix so the test
passes for the reason it was written to test (a real loud failure at that depth), not by
weakening the assertion.

## Context

### Relevant Files
- `src/backend/app/services/intro_card_geometry.py` — `_js_path()`, the guard
- `src/backend/tests/test_t6920_intro_geometry_import_depth.py` — the failing test + its
  companion `test_js_path_resolves_correctly_at_repo_depth` (currently passing — real-depth
  behavior unaffected)

### Related Tasks
- Follows: T6920 (added the guard this task's test is pinning)

### Technical Notes
- Currently listed in `docs/testing/known-failures.md` so Branch/Master CI stays a meaningful
  signal while this is open — remove that row when fixed.

## Acceptance Criteria
- [ ] `test_js_path_raises_clear_error_at_fly_image_depth` passes for the correct reason (guard
      actually raises `RuntimeError` at the mocked Fly depth)
- [ ] `test_js_path_resolves_correctly_at_repo_depth` still passes (no regression to real-depth
      resolution)
- [ ] `docs/testing/known-failures.md` row removed
- [ ] Tests pass
