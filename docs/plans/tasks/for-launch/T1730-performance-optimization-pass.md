# T1730: Performance Optimization Pass

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-04-24
**Updated:** 2026-04-24

## Problem

Before official launch, audit and optimize any slow operations across the stack. This is a placeholder reminder to do a comprehensive performance sweep.

## Solution

Systematic audit of:
- Slow API endpoints (use profiling from T1530)
- UI jank / slow renders (React profiler, User Timing API)
- Large frontend bundle sizes (Vite bundle analyzer)
- Slow SQLite queries (EXPLAIN QUERY PLAN on hot paths)
- Unnecessary R2 round-trips
- Unoptimized asset loading

## Context

### Relevant Files
TBD — this is a whole-stack audit.

### Related Tasks
- Depends on: T1530 (Comprehensive Profiling Strategy — already DONE, provides instrumentation)
- Related: Performance milestone tasks (T1531, T1533, T1535, T1539)

### Technical Notes
The profiling infrastructure from T1530 (backend cProfile-on-breach, R2 call timing, frontend User Timing API) is already in place. This task is about using that instrumentation to find and fix remaining bottlenecks before launch.

## Implementation

### Steps
1. [ ] Run backend profiling under realistic load, identify endpoints > 500ms
2. [ ] Analyze frontend bundle size, code-split if needed
3. [ ] Profile key UI flows (annotate, framing, overlay) for jank
4. [ ] Review SQLite query plans on hot paths
5. [ ] Audit R2 call patterns for unnecessary round-trips
6. [ ] Fix identified bottlenecks

## Acceptance Criteria

- [ ] No API endpoint takes > 1s under normal load (excluding exports)
- [ ] Frontend bundle < reasonable threshold (TBD based on audit)
- [ ] No visible UI jank in core workflows
- [ ] Profiling results documented
