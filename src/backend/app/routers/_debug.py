"""
Debug endpoints — profile inspection (T1530/T1531).

Gated by DEBUG_ENDPOINTS_ENABLED=true. Do NOT enable in prod without a plan
for access control; the endpoints expose server-side file listings.
"""

from fastapi import APIRouter, HTTPException

from ..profiling import (
    debug_endpoints_enabled,
    list_profiles,
    read_profile_text,
)

router = APIRouter(prefix="/_debug", tags=["_debug"])


def _require_enabled():
    if not debug_endpoints_enabled():
        raise HTTPException(status_code=404, detail="Debug endpoints disabled")


@router.get("/profiles")
async def debug_list_profiles():
    _require_enabled()
    return {"profiles": list_profiles()}


@router.get("/profiles/{name}")
async def debug_read_profile(name: str):
    _require_enabled()
    text = read_profile_text(name)
    if text is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    # Return plain text so it renders cleanly in curl / browsers.
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(text)
