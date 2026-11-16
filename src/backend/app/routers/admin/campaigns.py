"""Admin campaign endpoints (T13980): list, create and edit the campaigns behind ?ref= links.

Split out of routers/admin.py by T5940; every URL is unchanged. _campaign_name_join stays in
the package __init__: the analytics views label origins with it too."""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...services.pg import get_pg
from ...user_context import get_current_user_id
from . import _test_exclusion, require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# ---------------------------------------------------------------------------
# T13980: admin-created campaigns. The id is the short code in the link and the
# stored origin; the name is the only thing the UI displays. No delete endpoint
# (removing a row would turn attributed users back into an opaque code).
# ---------------------------------------------------------------------------

CAMPAIGN_NAME_MAX_LEN = 80
# T15200: the ad channel an admin picks when entering spend. Distinct from `origin` (the
# registry id); maps to a spend_readiness_constants.CHANNELS platform via
# CAMPAIGN_CHANNEL_PLATFORM. Mirrored in migrations/postgres/v044_campaign_spend.py's CHECK.
CampaignChannel = Literal["coach_credits", "coach_gift", "reddit", "meta", "club"]
_SPEND_FIELDS = ("channel", "spend_cents", "landing_views", "platform_conversions")


class CampaignNameRequest(BaseModel):
    name: str


class CampaignUpdateRequest(BaseModel):
    """PATCH body for a campaign row: the name (existing rename gesture) and/or the T15200
    spend fields (a separate Save gesture in CampaignsModal). Both are optional so each
    gesture can send only the field group it touched -- never reactive, never the whole row
    unless the admin pressed that row's button."""
    name: str | None = None
    channel: CampaignChannel | None = None
    spend_cents: int | None = Field(None, ge=0)
    landing_views: int | None = Field(None, ge=0)
    platform_conversions: int | None = Field(None, ge=0)


def _campaign_spend_columns_present(cur) -> bool:
    """Migration-window guard (T15200, v044): until the migration runs, the spend columns
    do not exist. Mirrors `_campaign_name_join`'s table-missing guard."""
    cur.execute(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'campaigns' AND column_name = 'spend_cents'"
    )
    return cur.fetchone() is not None


def _campaign_name(raw: str) -> str:
    name = raw.strip()
    if not name or len(name) > CAMPAIGN_NAME_MAX_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Campaign name must be 1 to {CAMPAIGN_NAME_MAX_LEN} characters",
        )
    return name


def _campaign_url(campaign_id: str) -> str:
    from ...frontend_url import CAMPAIGN_LINK_BASE
    return f"{CAMPAIGN_LINK_BASE}/?ref={campaign_id}"


def _campaign_row(row, signups: int, spend_columns: bool) -> dict:
    out = {
        "id": row["id"],
        "name": row["name"],
        "url": _campaign_url(row["id"]),
        "created_at": row["created_at"].isoformat(),
        "signups": signups,
    }
    for field in (*_SPEND_FIELDS, "spend_updated_at"):
        if not spend_columns:
            out[field] = None
        elif field == "spend_updated_at" and row[field] is not None:
            out[field] = row[field].isoformat()
        else:
            out[field] = row[field]
    return out


@router.get("/campaigns")
def list_campaigns(exclude_test: bool = True):
    """Every campaign, newest first, with its signup count (honoring the same
    test-account exclusion as the channels view). The T15200 spend fields read NULL
    (logged) before v044 runs, same guard as `_campaign_name_join`."""
    excl = _test_exclusion(exclude_test)
    excl_join = " LEFT JOIN users u ON u.user_id = s.user_id" if excl else ""
    excl_where = f" WHERE {excl}" if excl else ""
    with get_pg() as conn:
        cur = conn.cursor()
        spend_columns = _campaign_spend_columns_present(cur)
        if not spend_columns:
            logger.error("[Admin] campaigns spend columns missing (v044 not applied; "
                        "run POST /api/admin/migrate-postgres)")
        spend_select = ", c." + ", c.".join((*_SPEND_FIELDS, "spend_updated_at")) if spend_columns else ""
        cur.execute(f"""
            SELECT c.id, c.name, c.created_at{spend_select}, COALESCE(sig.signups, 0) AS signups
            FROM campaigns c
            LEFT JOIN (
                SELECT s.origin, COUNT(*) AS signups
                FROM user_segments s{excl_join}{excl_where}
                GROUP BY s.origin
            ) sig ON sig.origin = c.id
            ORDER BY c.created_at DESC, c.id
        """)
        rows = cur.fetchall()
    return {"campaigns": [_campaign_row(r, r["signups"], spend_columns) for r in rows]}


@router.post("/campaigns")
def create_campaign(body: CampaignNameRequest):
    import psycopg2

    from ...analytics import generate_campaign_id

    name = _campaign_name(body.name)
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM campaigns WHERE lower(name) = lower(%s)", (name,))
        if cur.fetchone():
            raise HTTPException(status_code=409, detail=f'A campaign named "{name}" already exists')
        # Retry only on an id collision (~1 in 28M per existing campaign).
        for _ in range(5):
            cur.execute("SAVEPOINT campaign_insert")
            try:
                cur.execute(
                    """INSERT INTO campaigns (id, name, created_by) VALUES (%s, %s, %s)
                       RETURNING id, name, created_at""",
                    (generate_campaign_id(), name, get_current_user_id()),
                )
            except psycopg2.errors.UniqueViolation as e:
                cur.execute("ROLLBACK TO SAVEPOINT campaign_insert")
                if e.diag.constraint_name == "idx_campaigns_name_lower":
                    raise HTTPException(
                        status_code=409, detail=f'A campaign named "{name}" already exists'
                    ) from e
                continue
            row = cur.fetchone()
            break
        else:
            raise HTTPException(status_code=500, detail="Could not allocate a unique campaign id")
    logger.info("[Admin] Campaign created: id=%s name=%r", row["id"], row["name"])
    return _campaign_row(row, 0, spend_columns=False)


@router.patch("/campaigns/{campaign_id}")
def update_campaign(campaign_id: str, body: CampaignUpdateRequest):
    """Partial update: `name` (the original rename gesture; the id stays the stored origin
    key, so no user row changes) and/or the T15200 spend fields (channel/spend_cents/
    landing_views/platform_conversions -- CampaignsModal's separate Save gesture for that
    row). Each group updates only when its gesture sent it; never reactive. The spend group
    requires v044 -- before it runs this 503s loudly rather than silently drop the input."""
    import psycopg2

    spend_touched = any(getattr(body, f) is not None for f in _SPEND_FIELDS)
    sets: list[str] = []
    params: list = []
    if body.name is not None:
        sets.append("name = %s")
        params.append(_campaign_name(body.name))
    with get_pg() as conn:
        cur = conn.cursor()
        if spend_touched:
            if not _campaign_spend_columns_present(cur):
                logger.error("[Admin] campaign spend update refused: v044 not applied (campaign_id=%s)",
                            campaign_id)
                raise HTTPException(status_code=503,
                                    detail="Spend tracking is not available yet (run the pending migration)")
            for field in _SPEND_FIELDS:
                value = getattr(body, field)
                if value is not None:
                    sets.append(f"{field} = %s")
                    params.append(value)
            sets.append("spend_updated_at = now()")
        if not sets:
            raise HTTPException(status_code=400, detail="No fields to update")
        params.append(campaign_id)
        returning = "id, name"
        if spend_touched:
            returning += ", " + ", ".join(_SPEND_FIELDS) + ", spend_updated_at"
        try:
            cur.execute(
                f"UPDATE campaigns SET {', '.join(sets)} WHERE id = %s RETURNING {returning}",
                params,
            )
        except psycopg2.errors.UniqueViolation as e:
            raise HTTPException(status_code=409, detail=f'A campaign named "{body.name}" already exists') from e
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Campaign not found")
    logger.info("[Admin] Campaign updated: id=%s name=%r spend_touched=%s",
               campaign_id, row["name"], spend_touched)
    out = {"id": row["id"], "name": row["name"]}
    if spend_touched:
        for field in _SPEND_FIELDS:
            out[field] = row[field]
        out["spend_updated_at"] = row["spend_updated_at"].isoformat() if row["spend_updated_at"] else None
    return out
