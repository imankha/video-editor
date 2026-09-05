# T8935: Upload error messages never render "[object Object]"; validation errors are logged server-side

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-05

## Problem

Live-testing feedback on T8810's universal dropzone: an upload failure toast showed
`[object Object]` with no actionable information, and the browser console showed
`[UploadStore] Upload failed: Error: [object Object]`. Root cause: `uploadManager.js` has
~10 call sites of the shape `throw new Error(error.detail || fallback)`. FastAPI returns
`detail` as a plain string for most `HTTPException` raises, but as an ARRAY of Pydantic
validation-error objects (`[{loc, msg, type}, ...]`) for a 422 — passing a non-string value
to `new Error()` silently stringifies it via `toString()`, producing exactly
`"[object Object]"`.

Compounding the problem: FastAPI/Starlette's default `RequestValidationError` handling
returns the 422 body but never LOGS anything server-side, so a request that fails Pydantic
validation was completely invisible in staging/prod logs — the original failure could not
be root-caused after the fact once the log buffer rolled past it (confirmed: `fly logs`'s
buffer only holds a couple of minutes on a low-traffic staging machine, and the machine had
just redeployed for an unrelated task around the same time).

## Solution

Two independent, complementary fixes:

1. **Frontend**: `extractErrorMessage(errorBody, fallback)` helper in `uploadManager.js`
   handles all three `detail` shapes — string (pass through), array (join Pydantic
   `loc: msg` pairs), object (prefer `.message`, else `JSON.stringify`) — applied at every
   `throw new Error(error.detail || ...)` site in the file (create game, add videos,
   activate game, prepare-upload, clip batch upload, cancel/dedupe/list endpoints).
2. **Backend**: a new `@app.exception_handler(RequestValidationError)` in `main.py` logs a
   WARNING (method, path, `exc.errors()`) before returning the SAME response FastAPI's own
   default handler would have given (`{"detail": jsonable_encoder(exc.errors())}`, 422) —
   pure observability addition, zero behavior change.

Together: the frontend now always shows a readable message on the FIRST occurrence of any
future validation failure, AND the backend now logs enough to root-cause it from staging/
prod logs even without a live repro.

## Relevant Files

- `src/frontend/src/services/uploadManager.js` — `extractErrorMessage` helper + all throw
  sites
- `src/frontend/src/services/uploadManager.test.js` — `describe('error message extraction
  (T8935)')`
- `src/backend/app/main.py` — `validation_exception_handler`
- `src/backend/tests/test_t8935_validation_error_logging.py`

## Acceptance Criteria

- [ ] A Pydantic validation-error array never renders as `[object Object]` in a toast or
      console log — it renders the joined `loc: msg` pairs
- [ ] An object `detail` with a `.message` field (the activateGame 402 shape) still shows
      that message, unchanged from before
- [ ] Every 422 (or any other) validation failure is logged server-side at WARNING with
      path + method + errors, even though the frontend never sees a behavior change in the
      response body
- [ ] Curated test set green (frontend + backend)

## Follow-up

The ACTUAL upload failure the user hit is still not root-caused — this task only ensures
the NEXT occurrence (of this or any future validation failure) is immediately diagnosable
from either the toast text or the server log, without needing a live repro race against a
redeploy. Ask the user to retry the failed upload now that this is deployed.
