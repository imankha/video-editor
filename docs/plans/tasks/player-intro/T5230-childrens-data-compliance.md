# T5230: Children's-data compliance hardening

**Status:** TODO
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
- [ ] Grad-year default; DOB opt-in and app-encrypted if stored.
- [ ] Consent attestation gate enforced before intro use.
- [ ] Intro fields + photo/cut-out included in privacy export AND account/intro deletion.
- [ ] Public-exposure warning present (verified with T5220).
- [ ] No face-recognition in any intro path (guardrail note/test).
- [ ] Privacy policy updated + human-reviewed.
