"""T11330: a preflight over-budget rejection must cost the user zero credits.

T11330 Step 4 decision (a): credits are reserved + confirmed (deducted) synchronously in the
request handler BEFORE the background task runs, and the T11320 guard rejection fires inside
``_export_clips``'s background task. The acceptance criterion "no credits are charged for a
rejected export" is therefore satisfied by a DEDUCT-then-REFUND that nets to zero (matching Bug
58p's own precedent, where credits were auto-refunded on the timeout) -- NOT by "never deducted".

This test pins that net-zero behavior at the decisive seam: when ``_export_clips`` is entered
with ``credits_deducted > 0`` and the guard rejects the export, ``refund_credits`` is called for
the full deducted amount. If a future change moved the guard before deduction (Step 4 option b),
this test should be updated to assert deduction never happens; until then, net-zero is the
contract and this guards it.
"""

import pytest

from app.routers.export import multi_clip as mc
from app.services import credit_ledger
from app.services.export_cost_guard import ExportBudgetExceeded


class _FakeVid:
    async def read(self):
        return b"x"

    async def seek(self, *a):
        return None


def _clip_export(clip_index, duration, w, h):
    return mc.ClipExportData(
        clip_index=clip_index,
        crop_keyframes=[
            {"time": 0.0, "x": 0, "y": 0, "width": w, "height": h},
            {"time": duration, "x": 0, "y": 0, "width": w, "height": h},
        ],
        segments=None,
        duration=duration,
        video_file=_FakeVid(),
        clip_name=f"Clip {clip_index}",
    )


@pytest.mark.asyncio
async def test_over_budget_rejection_refunds_deducted_credits(monkeypatch):
    """Deduct-then-refund nets to zero: a rejected export refunds every deducted credit."""
    refunds = []

    def spy_refund(user_id, credits, export_id, video_seconds):
        refunds.append({"user_id": user_id, "credits": credits, "export_id": export_id})

    monkeypatch.setattr(mc, "modal_enabled", lambda: True)
    monkeypatch.setattr(credit_ledger, "refund_credits", spy_refund)
    # Guard must reject before the upload loop; keep upload a no-op just in case.
    monkeypatch.setattr(mc, "upload_bytes_to_r2", lambda user_id, key, content: True)

    deducted = 5
    # Bug-58p shape: 14 full-1080p clips totalling ~79s -> far over the 2880 GPU-s budget.
    clips = [_clip_export(i, duration=79.0 / 14, w=1920, h=1080) for i in range(14)]

    with pytest.raises(ExportBudgetExceeded):
        await mc._export_clips(
            export_id="exp-t11330-refund",
            clips=clips,
            aspect_ratio="16:9",
            transition={"type": "cut", "duration": 0.0},
            include_audio=False,
            target_fps=30,
            export_mode="quality",
            project_id=None,
            project_name="T11330 Refund Fixture",
            user_id="test-user-t11330",
            profile_id=0,
            credits_deducted=deducted,
            total_video_seconds=79.0,
            is_test_mode=False,
        )

    # The full deducted amount is refunded -> net zero cost to the user.
    assert len(refunds) == 1, "a rejected export must refund exactly once"
    assert refunds[0]["credits"] == deducted
    assert refunds[0]["user_id"] == "test-user-t11330"


@pytest.mark.asyncio
async def test_over_budget_rejection_with_zero_credits_refunds_nothing(monkeypatch):
    """No credits deducted -> no refund attempted (the refund is guarded on credits_deducted)."""
    refunds = []
    monkeypatch.setattr(mc, "modal_enabled", lambda: True)
    monkeypatch.setattr(credit_ledger, "refund_credits", lambda *a, **k: refunds.append(a))
    monkeypatch.setattr(mc, "upload_bytes_to_r2", lambda user_id, key, content: True)

    clips = [_clip_export(i, duration=79.0 / 14, w=1920, h=1080) for i in range(14)]

    with pytest.raises(ExportBudgetExceeded):
        await mc._export_clips(
            export_id="exp-t11330-refund-zero",
            clips=clips,
            aspect_ratio="16:9",
            transition={"type": "cut", "duration": 0.0},
            include_audio=False,
            target_fps=30,
            export_mode="quality",
            project_id=None,
            project_name="T11330 Refund Zero Fixture",
            user_id="test-user-t11330",
            profile_id=0,
            credits_deducted=0,
            total_video_seconds=79.0,
            is_test_mode=False,
        )

    assert refunds == []
