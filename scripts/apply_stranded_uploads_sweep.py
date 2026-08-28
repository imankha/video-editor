#!/usr/bin/env python3
"""
T7880 apply step: run the reap manifest (from scan_stranded_uploads_sweep.py) against
the LIVE machine.

Pipe the manifest JSON on stdin, run via:
    fly ssh console -a reel-ballers-api -C "python3 -" < this_script_with_manifest_embedded

This does NOT edit a downloaded profile.sqlite copy and push it back -- that risks
clobbering newer state and bypasses CAS. Instead, for each manifest entry it sets the
request-equivalent ContextVars (user_id, profile_id) and performs EXACTLY the T7490
honest-reap transition through the app's own code:
  1. r2_abort_multipart_upload for every UploadId the manifest names (best-effort,
     already swallows NoSuchUpload -- a double-abort of an already-dead id is a no-op)
  2. UPDATE games SET status='upload_failed' WHERE blake3_hash=? AND status='pending'
  3. DELETE FROM pending_uploads WHERE id=? (if the manifest entry had one)
  4. sync_db_to_r2_explicit(user_id, profile_id) -- CAS-protected durable write

Dry-run by default (APPLY=False below) -- prints exactly what it would do per entry
without writing anything. Flip APPLY=True to actually run the reap.

The manifest itself must be embedded into MANIFEST_JSON below before piping (fly ssh
-C strips quotes, so this can't take a separate stdin file arg the normal way -- the
manifest becomes part of the script text, same pattern as the T7870 heal script).
"""

APPLY = False  # <<<<<< FLIP TO True TO ACTUALLY WRITE

MANIFEST_JSON = r'''
__MANIFEST_PLACEHOLDER__
'''

import sys
sys.path.insert(0, "/app")

import asyncio
import json
import time
import traceback


def p(*a):
    print(*a, flush=True)


def hr(title):
    p("")
    p("=" * 72)
    p(title)
    p("=" * 72)


class Abort(Exception):
    pass


def main():
    from app.database import SyncResult, ensure_database, get_db_connection, sync_db_to_r2_explicit
    from app.profile_context import set_current_profile_id
    from app.storage import APP_ENV, R2_ENABLED, r2_abort_multipart_upload
    from app.user_context import set_current_user_id

    hr("T7880 APPLY -- mode=%s" % ("APPLY (WILL WRITE)" if APPLY else "DRY RUN"))
    p("APP_ENV=%s R2_ENABLED=%s" % (APP_ENV, R2_ENABLED))
    if APP_ENV != "production":
        raise Abort("APP_ENV is %r, expected production -- wrong machine." % APP_ENV)

    manifest = json.loads(MANIFEST_JSON)
    p("Manifest entries: %d" % len(manifest))

    results = []
    for i, entry in enumerate(manifest, 1):
        hr("[%d/%d] user=%s profile=%s game_id=%s (%s)"
           % (i, len(manifest), entry["user_id"], entry["profile_id"],
              entry["game_id"], entry["classification"]))
        p("game_name=%r hash=%s" % (entry["game_name"], entry["blake3_hash"]))
        p("upload_ids_to_abort=%s" % entry["upload_ids_to_abort"])
        p("has_pending_uploads_row=%s pending_uploads_id=%s"
          % (entry["has_pending_uploads_row"], entry["pending_uploads_id"]))

        if not APPLY:
            p("[dry-run] would abort %d multipart(s), flip game %s -> upload_failed, "
              "delete pending_uploads row %s, sync."
              % (len(entry["upload_ids_to_abort"]), entry["game_id"],
                 entry["pending_uploads_id"]))
            continue

        r2_key = "games/%s.mp4" % entry["blake3_hash"]
        for uid in entry["upload_ids_to_abort"]:
            ok = r2_abort_multipart_upload(r2_key, uid)
            p("  abort %s -> %s" % (uid, "OK" if ok else "already gone / failed (logged)"))

        set_current_user_id(entry["user_id"])
        set_current_profile_id(entry["profile_id"])
        ensure_database()

        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE games SET status = 'upload_failed' "
                "WHERE id = ? AND blake3_hash = ? AND status = 'pending'",
                (entry["game_id"], entry["blake3_hash"]),
            )
            game_flipped = cur.rowcount
            pu_deleted = 0
            if entry["pending_uploads_id"] is not None:
                cur.execute(
                    "DELETE FROM pending_uploads WHERE id = ?",
                    (entry["pending_uploads_id"],),
                )
                pu_deleted = cur.rowcount
            conn.commit()
        p("  games flipped=%d pending_uploads deleted=%d" % (game_flipped, pu_deleted))

        sync = None
        for attempt in (1, 2, 3):
            sync = sync_db_to_r2_explicit(entry["user_id"], entry["profile_id"])
            p("  sync attempt %d -> %s" % (attempt, sync))
            if sync in (SyncResult.OK, SyncResult.CONFLICT):
                break
            time.sleep(3)

        results.append({
            "user_id": entry["user_id"], "game_id": entry["game_id"],
            "game_flipped": game_flipped, "pending_uploads_deleted": pu_deleted,
            "sync": str(sync),
        })

        if sync == SyncResult.CONFLICT:
            p("  !!! CAS CONFLICT -- local edit discarded, R2 unchanged for this "
              "profile. Re-run the whole apply step to pick up the newer copy.")
        elif sync != SyncResult.OK:
            p("  !!! SYNC FAILED after 3 attempts -- this profile's reap is NOT "
              "durable yet. Re-run.")

    hr("DONE" if APPLY else "DRY RUN COMPLETE -- NOTHING WAS WRITTEN")
    if APPLY:
        for r in results:
            p(r)


if __name__ == "__main__":
    try:
        main()
        sys.exit(0)
    except Abort as e:
        p("")
        p("ABORTED: %s" % e)
        sys.exit(2)
    except Exception:
        p("")
        p("UNEXPECTED ERROR:")
        traceback.print_exc(file=sys.stdout)
        sys.exit(3)
