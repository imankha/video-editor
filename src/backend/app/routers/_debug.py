"""
Debug endpoints — profile inspection (T1530/T1531) and log access (T2020).

Gated by DEBUG_ENDPOINTS_ENABLED=true. Do NOT enable in prod without a plan
for access control; the endpoints expose server-side file listings.
"""

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse

from ..profiling import (
    debug_endpoints_enabled,
    list_profiles,
    read_profile_text,
)

LOG_DIR = Path("/tmp/logs")

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
    return PlainTextResponse(text)


@router.get("/logs")
async def debug_list_logs():
    _require_enabled()
    logs = []
    if LOG_DIR.exists():
        for f in sorted(LOG_DIR.iterdir()):
            if f.is_file():
                stat = f.stat()
                logs.append({
                    "name": f.name,
                    "size": stat.st_size,
                    "last_modified": stat.st_mtime,
                })
    return {"logs": logs}


@router.get("/logs/{filename}")
async def debug_read_log(
    filename: str,
    tail: int = Query(200, ge=1),
    grep: Optional[str] = Query(None),
):
    _require_enabled()
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    log_path = (LOG_DIR / filename).resolve()
    if not str(log_path).startswith(str(LOG_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not log_path.is_file():
        raise HTTPException(status_code=404, detail="Log file not found")
    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    lines = lines[-tail:]
    if grep:
        lines = [l for l in lines if grep in l]
    return PlainTextResponse("\n".join(lines))
