from ..base import BaseMigration


class V029UploadFailures(BaseMigration):
    version = 29
    description = (
        "T10270: upload_failures table -- durable per-event record of every "
        "upload failure (design doc §3.2/§5), TTL-swept by cleanup._do_cleanup"
    )

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS upload_failures (
                id                BIGSERIAL PRIMARY KEY,
                occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
                -- WHO. No FK to users(user_id): X-User-ID/e2e users legitimately
                -- have no Postgres users row (same reasoning as the credits
                -- table). A NULL user_id is an anonymous beacon, recorded
                -- honestly rather than dropped.
                user_id           TEXT,
                profile_id        TEXT,
                -- WHAT, closed vocabularies validated by the writer
                kind              TEXT NOT NULL,          -- UploadKind: 'game' | 'clip'
                stage             TEXT NOT NULL,          -- UPLOAD_STAGES
                reason            TEXT NOT NULL,          -- UPLOAD_FAILURE_REASONS
                terminal          BOOLEAN NOT NULL,        -- did this END the attempt
                origin            TEXT NOT NULL,           -- 'server' | 'beacon'
                impersonated      BOOLEAN NOT NULL DEFAULT FALSE,
                -- DIAGNOSIS
                http_status       INTEGER,
                error_text        TEXT,                    -- writer-capped at 300 chars
                blake3_hash       TEXT,
                upload_session_id TEXT,
                r2_upload_id      TEXT,
                file_size         BIGINT,
                original_filename TEXT,                    -- writer-capped at 120 chars
                parts_total       INTEGER,
                parts_completed   INTEGER,
                attempt_no        INTEGER,
                elapsed_ms        INTEGER,
                platform          TEXT,                    -- get_current_platform()
                user_agent        TEXT,                    -- writer-capped at 200 chars
                -- WHICH BUILD (version.py). app_build is the ORDERABLE integer
                -- used for "since the last deploy"; commit_sha is for human
                -- correlation only.
                app_build         INTEGER NOT NULL DEFAULT 0,
                commit_sha        TEXT
            )
        """)
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_upload_failures_occurred "
            "ON upload_failures(occurred_at DESC)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_upload_failures_build "
            "ON upload_failures(app_build, occurred_at DESC)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_upload_failures_user "
            "ON upload_failures(user_id)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_upload_failures_kind "
            "ON upload_failures(kind, reason)"
        )
