# Epic E: Upload and sign-in confidence

**Status:** TODO (U1 ruled as recommended; U2 rejected all options 2026-10-04, T11890 is an investigation)
**Milestone:** [Parent Usability Audit](../README.md)
**Impact:** 7 | **Complexity:** 4
**Knowledge docs:** `.claude/knowledge/annotate.md` (upload section), `.claude/knowledge/backend-services.md` (auth)

## Goal

At the two commitment points, signing in and uploading a large family video for credits, the
parent sees one plain message at a time: what it costs, how far along it is, and what to do if
something does not open.

## Verified findings (2026-10-04)

- **Two percentages at once.** `services/uploadManager.js:677` writes `Computing hash... ${p}%` with
  the *phase* percent, while `stores/uploadStore.js:51-56` `progressToPercent` weights phases
  (hash 15%, upload 83%, finalize 2%) for the bar. `components/UploadProgressIndicator.jsx:69-70` shows
  both, so a 20% hash reads "20%" next to a "3%" bar. `UploadingGameTile.jsx:207-209` repeats it.
  "Local preview - not saved online yet" (`displayNames.js:385`, `UploadPreviewNotice.jsx:66-83`) and
  an unrelated "Connecting to server..." buffer overlay (`components/shared/VideoLoadingOverlay.jsx:43`)
  show at the same time. `UPLOAD_STATE.SAVED = 'Saved'` breaks the no-"Saved" rule.
- **Upload modal copy is mechanism-first.** `displayNames.js:290-291` `DIVISION_OF_WORK` ("pick them
  from the AI's player boxes... connects the dots... upscales"), used only by
  `components/GameDetailsModal.jsx:254`. Landing duplicates exist (`src/landing/...`, T10170 keeps app
  and landing aligned).
- **Sign-in fails silently in in-app browsers.** GIS popup mode (`utils/googleAuth.js:102-117`,
  `components/SignInScreen.jsx:32-45`). If the popup is blocked, GIS fires no callback, so nothing
  happens. The only fallback text shows if the GIS *script* fails to load. The app cannot see clicks
  inside Google's iframe button. The email field is placeholder-only (`components/auth/OtpAuthForm.jsx:211`)
  with a "Send Code" button. No tests exist for these files.

## Design decisions

Full proposal: [annotate-rating-upload-signin.md](../../../ux/2026-10-04-parent-usability-audit/design/annotate-rating-upload-signin.md) (D-H, D-I, D-J).

## Tasks (file-disjoint; can run in parallel)

| ID | Task | Status |
|----|------|--------|
| T11870 | [One upload progress number and one sentence](T11870-one-upload-progress-number.md) | STAGING |
| T11880 | [Honest upload modal copy](T11880-honest-upload-modal-copy.md) | TODO |
| T11890 | [Investigate the silent Google sign-in failure before handling it](T11890-sign-in-fallback.md) | TODO |

T11880 depends on T11770 (shared cost row).

## Completion criteria

- [ ] An upload shows exactly one percentage at every moment.
- [ ] The upload modal makes no tracking or framing claim and its facts never interleave.
- [ ] T11890 findings delivered: the sign-in failure is either shown to be a test artifact or traced to a specific cause, with a failure-specific fix proposed to the user. No generic "use email instead" path ships.
