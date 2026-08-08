# T5230: Children's-data compliance hardening

**Status:** WIP
**Impact:** 7 | **Complexity:** 4
**Epic:** [Player Intro + Rich Text](EPIC.md) — gates public launch

> Read [EPIC.md](EPIC.md) § Compliance posture for the summary. This task implements the guardrails
> and records the compliance analysis. Threads through [T5190](T5190-card-image-upload-consent.md)
> (consent + image storage), [T5215](T5215-intro-attachment.md) and
> [T5220](T5220-add-intro-integration.md) (public exposure).

> **Retargeted 2026-08-03.** The risk is unchanged in kind and slightly REDUCED in degree: epic
> decision 3 dropped the structured athlete field set entirely, so there is no birthdate, no
> height, no high school and no grad year in the database. What a card holds is **a minor's photo
> plus free text the parent typed**, publicly visible when shared. Everything below about DOB
> encryption is therefore contingent — if no DOB is collected, that clause is satisfied by not
> collecting it, and the retention/deletion, consent, public-exposure and no-face-recognition
> clauses carry the full weight. Retention/purge must cover: the `intro_cards` rows, their
> `text_elements` (free text can contain anything), and the R2 images under the per-profile
> `intro/` prefix.

## Compliance analysis (research 2026-07-15, with cites)

**Does COPPA apply?** Most likely **no**. COPPA governs personal information collected *from*
children under 13 by a *child-directed* service (or with actual knowledge the user is under 13).
This service is directed at **adult parents**, and the child's photo/birthdate is provided **by the
parent**, not collected from the child. The FTC is explicit that COPPA "does not cover information
collected from adults that may pertain to children."
- [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
- [FTC — Not Just for Kids' Sites](https://www.ftc.gov/business-guidance/resources/childrens-online-privacy-protection-rule-not-just-kids-sites)

**Caveats that still bind us:**
- The **2025 COPPA amendments** (effective 2025-06-23; full compliance by 2026-04-22) added
  **biometric identifiers (facial templates)** to "personal information," and a photo/video of a
  child is itself personal information.
  ([Federal Register 2025 Rule](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule),
  [FTC finalizes amendments](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data))
- **State laws reach this data regardless of COPPA:** CCPA/CPRA heightened protection for under-16
  ($7,500/violation), state **biometric** laws (Illinois BIPA, Texas, Colorado), and GDPR-K for any
  EU users.
  ([DataGrail CCPA/CPRA children](https://www.datagrail.io/blog/data-privacy/california-privacy-ccpa-cpra-childrens-data-protection/),
  [Persona kids/teens privacy](https://withpersona.com/blog/kids-teens-online-privacy-and-safety-regulations-/),
  [BCLP biometric tracker](https://www.bclplaw.com/en-US/events-insights-news/us-biometric-laws-and-pending-legislation-tracker.html))

**Conclusion:** COPPA likely doesn't strictly apply, but we adopt a children's-data security
posture anyway (state laws, GDPR-K, future COPPA 2.0, breach/PR risk). **Encryption is one control,
not compliance by itself** — minimization, consent, deletion, and the public-exposure warning
matter more.

## Guardrails to implement

1. **Data minimization (default).** Collect **graduation year / age-band, not full DOB**
   ([T5190](T5190-athlete-profile-fields-photo.md)). DOB is opt-in only.
2. **Encryption:**
   - Rely on **R2 SSE (AES-256 at rest) + TLS in transit** as the baseline — already in place.
   - **Application-encrypt `birthdate`** if it is ever stored (defense-in-depth). Pick a keyed
     scheme (env-held key; document key handling). Do NOT app-encrypt the photo (must decrypt to
     render/share) — protect via SSE + per-profile access control.
3. **Parental-consent record.** `intro_consent_at` captured at setup ([T5190](T5190-athlete-profile-fields-photo.md));
   an attestation the account holder is the parent/guardian with authority to use + share the
   likeness. Gate intro use on it.
4. **Public-exposure UX.** The warning on the "Add intro" toggle ([T5220](T5220-add-intro-integration.md));
   full name + high school optional.
5. **Retention & deletion.** Wire the new intro fields + photo/cut-out R2 objects into
   `privacy.py` `POST /export-data` (CCPA export) and `DELETE /delete-account`
   (`_purge_user_data`), plus a **per-intro delete** ("remove player intro" clears fields +
   deletes the R2 objects).
6. **No biometrics.** Never run face-recognition/templating on the photos (the cut-out in
   [T5200](T5200-player-cutout.md) is matting, not recognition). Add a guardrail note/test.
7. **Policy update.** Update `docs/legal/privacy-policy.md` + the `PrivacyPolicy.jsx` display to
   describe collection/sharing of player photos + facts and the parent-consent basis.

## Relevant files
- `src/backend/app/routers/privacy.py` (export + delete)
- `src/backend/app/services/user_db.py` (encrypted-DOB read/write, if kept)
- `docs/legal/privacy-policy.md`, `src/frontend/src/components/PrivacyPolicy.jsx`
- Consent field + warning UX from T5190 / T5220

## Classification hint
M/L-tier: backend (privacy.py wiring, optional field encryption), legal-copy update, guardrail
test. Ties into T5190 (consent field, DOB) and T5220 (warning). **Must ship before the feature is
exposed publicly.** Get a human sign-off on the legal copy.

## Acceptance criteria
- [x] Grad-year default; DOB opt-in and app-encrypted if stored. **Satisfied by absence** — no DOB/birthdate/age/height/school field exists anywhere in the schema (verified: `INTRO_FACT_FIELDS == ('position','class','team')`, `class` = grad year free text). Per CLAUDE.md no speculative code was built; guarded by `test_no_dob_or_biometric_field_in_intro_schema`. Contingency: a future DOB feature must be app-encrypted on top of R2 SSE.
- [x] Consent attestation gate enforced before intro use. `create_intro_card` refuses (**403**) unless `get_intro_consent` is set; attach-time gates already existed in downloads/collections (also 403). Raw photo upload is intentionally NOT gated — see reviewer decision below.
- [x] Intro fields + photo/cut-out included in privacy export AND account/intro deletion. Export wired in `privacy.py`; purge already covers R2 `intro/` via whole-prefix `delete_user_r2_data` — **verified against a real R2 object key** by `test_purge_deletes_r2_intro_object` (T6090 lesson).
- [ ] Public-exposure warning present (verified with T5220). **PENDING on T5220** (branch `feature/T5220-intro-egress`, not yet merged as of 2026-08-08 — `IntroExposureNotice.jsx`/`intro_egress.py` absent). T5220 owns that UI; this task did not touch its files. Privacy-policy copy DOES describe the public-visibility risk.
- [x] No face-recognition in any intro path (guardrail note/test). Notes added to `intro_cards.py` router+service and `intro_media.py`; static grep guardrail `test_no_face_recognition_in_intro_pipeline` (with a red-first self-check). Note: `player_intro.py` inline comment deliberately SKIPPED because it is a T5220-owned file — the guardrail test greps it (read-only) so it is still covered.
- [ ] Privacy policy updated + human-reviewed. Copy DRAFTED in `docs/legal/privacy-policy.md` + `PrivacyPolicy.jsx` (player-intro collection/sharing + parent-consent basis). **DRAFT pending human/attorney sign-off — not self-certified.**

## Progress Log

**2026-08-08 (T5230 implementation, M-tier)**
- Code Expert audit confirmed: consent gate absent on card CREATE (only attach); purge already covers R2 `intro/` + user.sqlite KV via whole-prefix delete + rmtree (T6090-clean); export missing all intro data; NO DOB field anywhere.
- Implemented: consent gate on `create_intro_card` (400); export of `intro_cards` rows + free text + `intro_consent_at`/position/class/team/full_name/photo_key (incl. uncached-profile KV via `get_all_intro_*`); no-biometrics notes; `tests/test_t5230_intro_compliance.py` (9 tests, all green) covering consent gate, export, real-R2-object purge proof, biometric grep guardrail (+ red-first self-check), DOB-absence guardrail.
- Privacy policy: intro-card collection/sharing + parent-consent basis added to md + jsx, flagged DRAFT for attorney review.
- Knowledge doc `backend-services.md` § Intro card library updated with the compliance guarantees.
- **DOB clause satisfied by absence** — no speculative encryption scaffolding built (CLAUDE.md).
- **Public-exposure-warning criterion pending on T5220** (unmerged); T5220's files untouched.
- Legal copy is a DRAFT pending human sign-off.

**Reviewer round (fresh-context, M-tier) — resolved:**
- Confirmed SOUND: purge/export completeness (whole-prefix R2 delete provably covers `intro/`; export degrades safely), the biometric grep guardrail (genuinely red-capable, doesn't match prose), consent-gate profile scoping.
- **MAJOR raised:** photo upload (`profiles.upload_intro_image`) ingests the minor's photo with no consent gate. **DECISION: declined, by design.** EPIC.md § Compliance posture is explicit — *"the real risk is PUBLIC EXPOSURE, not storage"* — and enumerates the photo's protections as SSE + per-profile access control + the public-exposure warning, deliberately NOT a consent gate on upload. The photo lands in a private per-profile prefix and only becomes shareable once a card is created (now gated) and attached (already gated). Gating upload would also break T5190's shipped upload contract and exceed this task's "block card creation (at minimum)" scope. Rationale recorded in `intro_cards.py` module docstring + knowledge doc. Left as an OPTIONAL future defense-in-depth hardening for the supervisor to weigh, not implemented here.
- **MINOR (status code):** create-gate changed from the kickoff's literal 400 to **403** so the whole consent surface (create + 3 attach gates) fails identically and the frontend handles one status. Deliberate, documented deviation from the kickoff's "400".
- MINOR (export of uncached-profile card free-text): acknowledged as an inherent local-cache export boundary (KV consent/facts still export; R2 objects still listed); not a regression.
