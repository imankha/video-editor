# T3100: Bug Storage Backend

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-05-24
**Updated:** 2026-05-25

## Problem

Bug reports go to email. The data (editor context, action breadcrumbs, console logs, screenshot) is trapped in email attachments with no structured access. AI can't load a bug by ID. Admin can't see all bugs in one place. Screenshots are base64-encoded in email, bloating messages and making them inaccessible to tools.

## Solution

Store bug reports in Postgres with screenshots in R2. The report-problem endpoint writes to DB instead of (only) sending email. New API endpoints for listing, reading, and updating bugs. Email becomes a lightweight notification with a link.

**Environment is implicit:** prod Postgres stores prod bugs, staging Postgres stores staging bugs. No `environment` column needed.

## Context

### Relevant Files
- `src/backend/app/routers/auth.py` - Current report-problem endpoint (lines 682-741)
- `src/backend/app/services/email.py` - Current email sending (send_problem_report_email)
- `src/backend/app/services/pg.py` - Postgres schema DDL (_SCHEMA_DDL)
- `src/backend/app/migrations/postgres/` - Postgres migrations
- `src/backend/app/services/r2_storage.py` - R2 upload helpers
- `src/frontend/src/components/ReportProblemButton.jsx` - Frontend report sender

### Related Tasks
- Blocks: T3110 (Bug Triage Skill), T3120 (Task Board Bug View), T3130 (Bug Resolution & Dedup Lifecycle)
- Extends: T1650 (Report a Problem Button) - current email-based system

### Technical Notes

**Postgres schema:**
```sql
CREATE TABLE IF NOT EXISTS bug_reports (
  id SERIAL PRIMARY KEY,
  reporter_email TEXT,
  description TEXT,
  page_url TEXT,
  user_agent TEXT,
  build TEXT,
  editor_context JSONB,
  actions JSONB,
  console_logs JSONB,
  screenshot_r2_key TEXT,       -- R2 key for screenshot, null if none
  status TEXT NOT NULL DEFAULT 'new',  -- new, investigating, confirmed, not_a_bug, duplicate, resolved
  duplicate_of INTEGER REFERENCES bug_reports(id),
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_duplicate ON bug_reports(duplicate_of);
```

**Key schema changes from original design:**
- Removed `task_id` column -- bugs are not promoted to task files (see EPIC.md)
- Removed `promoted` from status enum -- no promotion flow
- Added index on `duplicate_of` for auto-resolve queries

**R2 screenshot key:** `bugs/{id}/screenshot.jpg`
- Upload after DB insert (need the ID for the key)
- Two-step: insert row -> upload screenshot -> update row with R2 key
- Or: use a UUID key, set it before insert

**API endpoints (admin-only):**
- `GET /api/admin/bugs` - List bugs, filterable by status, paginated
- `GET /api/admin/bugs/{id}` - Full bug detail including presigned screenshot URL
- `PATCH /api/admin/bugs/{id}` - Update status, notes, duplicate_of
- `GET /api/admin/bugs/{id}/screenshot` - Redirect to presigned R2 URL

**Email changes:**
- After DB insert, send a lightweight notification email:
  - Subject: `Bug #{id}: {description_preview}`
  - Body: reporter, mode, description preview, link to bug in task board
  - No attachments (logs, screenshot, context all in DB)

**Frontend changes (minimal):**
- ReportProblemButton.jsx payload stays the same - backend handles storage differently
- No frontend changes needed for this task

## Implementation

### Steps
1. [ ] Add `bug_reports` table to `_SCHEMA_DDL` in pg.py (for fresh installs)
2. [ ] Create versioned migration `v{NNN}_bug_reports_table.py`
3. [ ] Modify `report_problem` endpoint: insert to DB, upload screenshot to R2, then send notification email
4. [ ] Create admin bug list endpoint (`GET /api/admin/bugs`)
5. [ ] Create admin bug detail endpoint (`GET /api/admin/bugs/{id}`)
6. [ ] Create admin bug update endpoint (`PATCH /api/admin/bugs/{id}`)
7. [ ] Refactor `send_problem_report_email` to send notification-only email (no attachments)
9. [ ] Tests: verify DB insert, R2 upload, email notification, admin endpoints

## Acceptance Criteria

- [ ] Bug reports stored in Postgres with full context (editor_context, actions, logs as JSONB)
- [ ] Screenshots uploaded to R2, not embedded in email
- [ ] Admin can list and read bugs via API
- [ ] Admin can update bug status via API
- [ ] Email sent as notification only (subject + description + link, no attachments)
- [ ] Existing frontend ReportProblemButton works unchanged
- [ ] Migration file created for existing Postgres instances
