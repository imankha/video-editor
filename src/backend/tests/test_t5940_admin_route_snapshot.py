"""T5940: splitting routers/admin.py into routers/admin/*.py is pure code motion.

Characterization pin written BEFORE the motion: every /api/admin (method, path)
pair, and the handler a request to that path actually reaches (route ORDER
matters: /bugs/purge must still win over /bugs/{bug_id}, /users/bulk/... over
/users/{user_id}/..., /impersonate/stop over /impersonate/{target_user_id}),
must be byte-identical after the split. The module test pins where each handler
lives once the split is done.
"""

import re

from fastapi.routing import APIRoute
from starlette.routing import Match

# (method, path, handler that a request to the path reaches), captured from the
# unsplit admin.py at bb5fa7f56.
ADMIN_ROUTES = [
    ('DELETE', '/api/admin/bugs/purge', 'purge_old_bugs'),
    ('DELETE', '/api/admin/bugs/{bug_id}', 'delete_bug'),
    ('GET', '/api/admin/analytics/activation', 'analytics_activation'),
    ('GET', '/api/admin/analytics/builds', 'analytics_builds'),
    ('GET', '/api/admin/analytics/by-sport', 'analytics_by_sport'),
    ('GET', '/api/admin/analytics/channels', 'analytics_channels'),
    ('GET', '/api/admin/analytics/cohorts', 'analytics_cohorts'),
    ('GET', '/api/admin/analytics/countries', 'analytics_countries'),
    ('GET', '/api/admin/analytics/funnel', 'analytics_funnel'),
    ('GET', '/api/admin/analytics/game-formats', 'analytics_game_formats'),
    ('GET', '/api/admin/analytics/journey', 'analytics_journey_map'),
    ('GET', '/api/admin/analytics/journey/step/{stage}', 'analytics_journey_step'),
    ('GET', '/api/admin/analytics/journey/{user_id}', 'analytics_journey'),
    ('GET', '/api/admin/analytics/pack-mix', 'analytics_pack_mix'),
    ('GET', '/api/admin/analytics/platforms', 'analytics_platforms'),
    ('GET', '/api/admin/analytics/pulse', 'analytics_pulse'),
    ('GET', '/api/admin/analytics/retention-chart', 'analytics_retention_chart'),
    ('GET', '/api/admin/analytics/rollup', 'analytics_action_rollup_status'),
    ('GET', '/api/admin/analytics/share-funnel', 'analytics_share_funnel'),
    ('GET', '/api/admin/analytics/spend-readiness', 'analytics_spend_readiness'),
    ('GET', '/api/admin/analytics/spend-readiness/gate/{key}', 'analytics_spend_readiness_gate'),
    ('GET', '/api/admin/analytics/user/{user_id}/actions', 'analytics_user_actions'),
    ('GET', '/api/admin/analytics/user/{user_id}/clip-phases', 'analytics_user_clip_phases'),
    ('GET', '/api/admin/backfill-hiq-recaps', 'backfill_hiq_recaps_status'),
    ('GET', '/api/admin/backfill-share-posters', 'backfill_share_posters_status'),
    ('GET', '/api/admin/bugs', 'list_bugs'),
    ('GET', '/api/admin/bugs/{bug_id}', 'get_bug'),
    ('GET', '/api/admin/bugs/{bug_id}/correlated', 'get_correlated_bugs'),
    ('GET', '/api/admin/bugs/{bug_id}/screenshot', 'get_bug_screenshot'),
    ('GET', '/api/admin/campaigns', 'list_campaigns'),
    ('GET', '/api/admin/credits/backfill-report', 'credits_backfill_report'),
    ('GET', '/api/admin/dashboard', 'get_admin_dashboard'),
    ('GET', '/api/admin/me', 'admin_me'),
    ('GET', '/api/admin/migration-status', 'migration_status'),
    ('GET', '/api/admin/r2-usage', 'r2_usage'),
    ('GET', '/api/admin/referrals/by-channel', 'referrals_by_channel'),
    ('GET', '/api/admin/referrals/leaderboard', 'referral_leaderboard'),
    ('GET', '/api/admin/referrals/tree/{user_id}', 'referral_tree'),
    ('GET', '/api/admin/referrals/user/{user_id}', 'referrals_for_user'),
    ('GET', '/api/admin/revenue-reconciliation', 'revenue_reconciliation'),
    ('GET', '/api/admin/upload-failures', 'list_upload_failures'),
    ('GET', '/api/admin/users', 'list_users'),
    ('GET', '/api/admin/users/{user_id}/stuck-uploads', 'stuck_uploads'),
    ('PATCH', '/api/admin/bugs/{bug_id}', 'update_bug'),
    ('PATCH', '/api/admin/campaigns/{campaign_id}', 'update_campaign'),
    ('POST', '/api/admin/analytics/journey/rollup', 'analytics_journey_rollup'),
    ('POST', '/api/admin/analytics/rollup', 'analytics_action_rollup'),
    ('POST', '/api/admin/backfill-hiq-recaps', 'backfill_hiq_recaps'),
    ('POST', '/api/admin/backfill-share-posters', 'backfill_share_posters'),
    ('POST', '/api/admin/campaigns', 'create_campaign'),
    ('POST', '/api/admin/cleanup-shares', 'cleanup_shares'),
    ('POST', '/api/admin/credits/backfill', 'credits_backfill_apply'),
    ('POST', '/api/admin/credits/open-gate', 'credits_open_gate'),
    ('POST', '/api/admin/impersonate/stop', 'stop_impersonation'),
    ('POST', '/api/admin/impersonate/{target_user_id}', 'impersonate'),
    ('POST', '/api/admin/migrate-postgres', 'run_postgres_migration'),
    ('POST', '/api/admin/revenue-reconciliation/heal', 'heal_revenue_reconciliation'),
    ('POST', '/api/admin/users/bulk/email', 'admin_bulk_email'),
    ('POST', '/api/admin/users/bulk/grant-credits', 'admin_bulk_grant_credits'),
    ('POST', '/api/admin/users/{user_id}/grant-credits', 'admin_grant_credits'),
    ('POST', '/api/admin/users/{user_id}/reset-data', 'admin_reset_test_account_data'),
    ('POST', '/api/admin/users/{user_id}/set-credits', 'admin_set_credits'),
    ('POST', '/api/admin/users/{user_id}/test-account', 'admin_mark_test_account'),
]

# Handlers by sub-module; every admin handler not listed here lives in
# app.routers.admin.analytics.
HANDLER_MODULES = {
    "session": {'admin_me', 'stop_impersonation', 'impersonate'},
    "users": {'list_users', 'admin_mark_test_account', 'admin_reset_test_account_data', 'stuck_uploads', 'admin_bulk_email'},
    "credits": {'admin_bulk_grant_credits', 'admin_grant_credits', 'admin_set_credits', 'credits_backfill_report', 'credits_backfill_apply', 'credits_open_gate'},
    "revenue": {'revenue_reconciliation', 'heal_revenue_reconciliation'},
    "ops": {'r2_usage', 'list_upload_failures', 'cleanup_shares', 'run_postgres_migration', 'migration_status', 'backfill_hiq_recaps', 'backfill_hiq_recaps_status', 'backfill_share_posters', 'backfill_share_posters_status'},
    "campaigns": {'list_campaigns', 'create_campaign', 'update_campaign'},
    "referrals": {'referral_leaderboard', 'referrals_by_channel', 'referrals_for_user', 'referral_tree'},
    "bugs": {'list_bugs', 'get_bug', 'get_correlated_bugs', 'update_bug', 'purge_old_bugs', 'delete_bug', 'get_bug_screenshot'},
}


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "x1", path)


def _live_admin_routes():
    from app.main import app
    rows = []
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path.startswith("/api/admin/"):
            for method in sorted(route.methods):
                scope = {"type": "http", "path": _concrete(route.path), "method": method, "root_path": ""}
                winner = next(c for c in app.routes if c.matches(scope)[0] == Match.FULL)
                rows.append((method, route.path, winner.endpoint.__name__, route.endpoint))
    return rows


def test_admin_url_table_is_byte_identical():
    live = sorted((m, p, w) for m, p, w, _ in _live_admin_routes())
    assert live == sorted(ADMIN_ROUTES)


def test_each_admin_handler_lives_in_its_subject_module():
    expected = {h: m for m, hs in HANDLER_MODULES.items() for h in hs}
    wrong = {}
    for _, _, _, endpoint in _live_admin_routes():
        want = "app.routers.admin." + expected.get(endpoint.__name__, "analytics")
        if endpoint.__module__ != want:
            wrong[endpoint.__name__] = endpoint.__module__
    assert wrong == {}
