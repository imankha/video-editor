"""
T5120 / prod bug 32p — Add Spotlight export KeyError 'strokeOpacity'.

Keyframes that went through the framing->overlay transform/restore
(highlight_transform.py) carry only a single `opacity` field and DROP
`strokeOpacity`/`fillOpacity`. The Modal spline `_spline_interpolate_highlight`
reads those keys with bare bracket access (`sp('strokeOpacity')`), so an
opacity-only keyframe KeyErrors mid-render -> "Overlay processing failed:
'strokeOpacity'" red toast, no video.

T4900 added `_normalize_region_keys` at the DB-read boundary to canonicalize
region-level time keys, but it never normalized keyframe-level opacity keys.
This test pins the fix: `_normalize_region_keys` must derive
`strokeOpacity`/`fillOpacity` from the legacy `opacity` fallback (mirroring the
sanctioned legacy branch overlay.py:998-999) so the Modal spline never KeyErrors.

Red before the fix (KeyError), green after.
"""

from app.routers.export.overlay import _normalize_region_keys
from app.modal_functions.video_processing import _spline_interpolate_highlight


def _opacity_only_region():
    """A region whose keyframes carry ONLY `opacity` (transform-restored shape)."""
    return {
        'id': 'r1',
        'start_time': 0.0,
        'end_time': 1.0,
        'keyframes': [
            {'time': 0.0, 'x': 100, 'y': 100, 'radiusX': 40, 'radiusY': 40,
             'opacity': 0.6, 'color': '#FFFFFF'},
            {'time': 1.0, 'x': 120, 'y': 110, 'radiusX': 42, 'radiusY': 42,
             'opacity': 0.6, 'color': '#FFFFFF'},
        ],
    }


def test_normalize_derives_stroke_and_fill_from_opacity():
    """After normalization every keyframe carries strokeOpacity/fillOpacity."""
    region = _normalize_region_keys(_opacity_only_region())
    for kf in region['keyframes']:
        assert 'strokeOpacity' in kf, "strokeOpacity must be derived at the boundary"
        assert 'fillOpacity' in kf, "fillOpacity must be derived at the boundary"
        # Mirror the sanctioned legacy fallback (overlay.py:998-999):
        # stroke derives from opacity, falling back to 0.85; fill from opacity, 0.05.
        assert kf['strokeOpacity'] == 0.6
        assert kf['fillOpacity'] == 0.6


def test_modal_spline_no_keyerror_on_opacity_only_keyframes():
    """The Modal spline must interpolate a normalized opacity-only region without KeyError."""
    region = _normalize_region_keys(_opacity_only_region())
    sorted_kf = sorted(region['keyframes'], key=lambda k: k['time'])
    # Interpolate at a mid-point between the two keyframes — this is where the
    # spline actually reads sp('strokeOpacity')/sp('fillOpacity').
    result = _spline_interpolate_highlight(sorted_kf, 0.5)
    assert result is not None
    assert 0.0 <= result['strokeOpacity'] <= 1.0
    assert 0.0 <= result['fillOpacity'] <= 1.0


def test_normalize_preserves_explicit_stroke_fill():
    """Keyframes that already carry strokeOpacity/fillOpacity are left untouched."""
    region = {
        'id': 'r2',
        'start_time': 0.0,
        'end_time': 1.0,
        'keyframes': [
            {'time': 0.0, 'x': 10, 'y': 10, 'radiusX': 5, 'radiusY': 5,
             'strokeOpacity': 0.9, 'fillOpacity': 0.1, 'opacity': 0.3, 'color': '#FFF'},
        ],
    }
    _normalize_region_keys(region)
    kf = region['keyframes'][0]
    assert kf['strokeOpacity'] == 0.9  # not clobbered by opacity fallback
    assert kf['fillOpacity'] == 0.1
