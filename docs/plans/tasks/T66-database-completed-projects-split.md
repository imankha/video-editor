# T66: Database Completed Projects Split Analysis

**Status:** TODO
**Impact:** MEDIUM
**Complexity:** MEDIUM
**Created:** 2026-02-11

## Problem

The SQLite database file size grows with all projects (active and completed). Loading the full database on startup may be slower than necessary since completed projects are rarely accessed.

## Solution

Analyze the potential file size savings of separating completed projects into a separate database that loads lazily (after the primary database).

## Analysis Tasks

1. **Measure current state**
   - Current database file size
   - Number of active vs completed projects
   - Data distribution (how much space do completed projects take?)

2. **Estimate savings**
   - Primary DB size with only active projects
   - Secondary DB size with completed projects
   - Startup time improvement estimate

3. **Design considerations**
   - When to load secondary DB (on-demand vs background)
   - How to handle project status changes (move between DBs)
   - R2 sync implications (two files vs one)
   - Query complexity for cross-DB operations

4. **Recommendation**
   - Is the complexity worth the savings?
   - What's the threshold (file size/project count) where this becomes worthwhile?

## Relevant Files

- `src/backend/app/database.py` - Database setup
- `src/backend/app/models/` - SQLAlchemy models
- R2 sync logic for database files

## Acceptance Criteria

- [ ] Current database size measured
- [ ] Active vs completed project data distribution analyzed
- [ ] File size savings estimated
- [ ] Recommendation documented (do it / don't do it / do it when X)
