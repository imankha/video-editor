# T3520: Fix Migration Count Assertions in test_migrations.py

## Context

`test_migrations.py` asserts expected migration counts per track. The review found a potential off-by-one: the postgres track has 13 registered migrations (v001-v013) but the test asserts `len(MIGRATIONS) == 12` and `latest_version == 12`.

Similarly, the profile_db track changed from 3 to 6 but needs verification against the actual migration registry.

## Problem

In `src/backend/tests/test_migrations.py`:
```python
def test_postgres_track(self):
    assert len(MIGRATIONS) == 12    # Should this be 13?
    assert RUNNER.latest_version == 12  # v013 is the latest

def test_profile_db_track(self):
    assert len(MIGRATIONS) == 6     # Needs verification
    assert RUNNER.latest_version == 6

def test_user_db_track(self):
    assert len(MIGRATIONS) == 4     # Needs verification
    assert RUNNER.latest_version == 4
```

## Requirements

1. Count the actual registered migrations in each track's `__init__.py`:
   - `src/backend/app/migrations/postgres/__init__.py`
   - `src/backend/app/migrations/user_db/__init__.py`
   - `src/backend/app/migrations/profile_db/__init__.py`
2. Fix test assertions to match actual counts
3. Verify `RUNNER.latest_version` matches the highest version number
4. Run `test_migrations.py` to confirm all pass

## Files to Change
- `src/backend/tests/test_migrations.py`

## Done When
- All migration count assertions match actual registered migrations
- `pytest tests/test_migrations.py -v` passes
