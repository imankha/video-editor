# T5642 — Overlay working-video: load via presigned URL (fix cross-origin 401 "format error")

**Tier:** M · Frontend (OverlayScreen + VideoPlayer) + Backend (presigned working-video URL)
**Model:** Opus. **Priority:** HIGHEST (blocks overlay playback on staging/prod).

## Symptom
On staging (and prod), opening a reel in **Overlay** intermittently shows
"Video format not supported" and the reel never loads. Happens on mobile AND desktop.

## Root cause (already diagnosed via the T5641 [CLIENT_VIDEO_ERROR] beacon + backend log)
- The overlay `<video>` loads the working-video from the **cross-origin authenticated proxy**
  `GET /api/projects/{id}/working_video/stream` (`OverlayScreen.jsx:352`
  `resolveApiUrl(project.working_video_url)`; the URL resolves to the fly.dev API host).
- `components/VideoPlayer.jsx:214` `<video>` has **NO `crossOrigin` attribute**, so its
  cross-origin request carries **no session cookie**. The auth middleware
  (`db_sync.py`) rejects it: backend log shows `GET .../working_video/stream ... REJECTED
  — no session cookie or X-User-ID` → **401**. Chrome surfaces a 401 on a media element as
  `MEDIA_ELEMENT_ERROR: Format error` (code 4), `readyState=0`, `networkState=3`.
- The file itself is FINE: proj 31's `working_31_f874d743.mp4` is valid h264 810x1440,
  decodes 100% clean. The beacon's Range probe (which sends credentials) returns 206
  video/mp4 — only the credential-less `<video>` request 401s.

## Fix (match how Framing already works)
Framing does NOT hit this because it loads clips via a **direct presigned R2 URL** fetched from
an authenticated endpoint (`FramingScreen.jsx` `getClipVideoConfig` -> `GET /api/clips/projects/
{pid}/clips/{cid}/playback-url` returns `{ url: <presigned> }`; the `<video src>` is then the
presigned R2 URL — no cookie needed). **Do the same for the overlay working-video.**

Preferred approach (confirm during implementation):
1. Backend: add/verify an authenticated endpoint that returns a **presigned R2 URL** for a
   project's current working-video (the `/working_video/stream` endpoint already generates one
   internally before its 302 — surface it as JSON instead, or add
   `GET /api/projects/{id}/working_video/playback-url` returning `{ url }`). Reuse the existing
   presign helper (`app.storage.generate_presigned_url`, key
   `working_videos/{filename}` under the profile). Keep the old stream endpoint for back-compat.
2. Frontend `OverlayScreen.jsx`: replace `resolveApiUrl(project.working_video_url)` with an
   **authenticated fetch** (`apiFetch`) of the presigned URL, then set the `<video src>` to that
   presigned R2 URL. Keep the existing retry/attempt loop (`MAX_WORKING_VIDEO_ATTEMPTS`) and the
   `extractVideoMetadataFromUrl` call (which already works because it's a credentialed fetch).
3. Do NOT edit files owned by sibling tasks: leave `VideoPlayer.jsx` structural changes minimal
   (if you add `crossOrigin` as a belt-and-suspenders, coordinate — but the presigned-URL fix
   should make crossOrigin unnecessary). T5643 owns OverlayModeView/OverrideHint; T5644 owns the
   timeline. Keep your edits to OverlayScreen video-load + the backend.

## Acceptance criteria
- Overlay working-video loads with NO 401 and NO "format not supported" (real browser, both a
  fresh session and after an idle period).
- The `<video src>` is a presigned R2 URL (no per-request auth), OR the proxy is made
  credential-safe — verify via the network tab (200/206, no 401).
- Framing still works (regression). Recap still works (regression).
- Backend: presigned endpoint requires auth (401 without session), returns a working URL with auth.

## QA (mandatory)
Live-drive overlay in a real browser as a real user (`e2e/helpers/realAuth.js`,
`loginAsRealUser(ctx,'imankh@gmail.com','9fa7378c')`, staging or local). Load a reel with a
working-video, confirm it plays, confirm the network tab shows no 401 on the video request.
Add a unit/integration test for the new backend endpoint (auth required, returns url). Map
evidence to every acceptance criterion. Update `.claude/knowledge/export-pipeline.md` /
`keyframes-framing.md` with the overlay-video load path change.

## Landmine
`resolveApiUrl` + `API_BASE`: on staging the frontend is cross-origin to the API (pages.dev ->
fly.dev). The presigned R2 URL is a DIFFERENT origin (R2) and needs no auth — that's the point.
Do NOT set `crossOrigin="use-credentials"` on a presigned-R2 `<video>` (R2 doesn't send
Access-Control-Allow-Credentials for a specific origin; it would break CORS). Presigned = anonymous.
