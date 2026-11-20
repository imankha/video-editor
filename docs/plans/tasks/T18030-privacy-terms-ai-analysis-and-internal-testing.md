# T18030: Privacy policy and terms cover AI analysis and internal testing

## In plain words

The privacy policy and terms of service are pages in the app (`/privacy` and `/terms`; the landing site only links to them). Today they say a parent's video is used only as the parent directs, list Google for sign-in only, and give us a licence "solely to operate the Service on your behalf". AI Coach (the paid option that has a video model mark the plays in a game) will send game video to Google's Gemini, and to build it we need to test on real annotated games. On 2026-11-20 the owner asked for the pages to say so. This task changes the wording: an AI model may analyze a game the parent chooses; we may use uploaded videos and the parent's own marks inside ReelBallers to test and improve the product, with an opt-out by email; Google is named for AI video analysis; and we still do not train AI models on the video, sell it, publish it or show it to other users. Done when the two pages carry the new wording in production and the owner has decided how existing users are told.

**Status:** STAGING
**Impact:** 7
**Complexity:** 2
**Tier:** S (copy in two components)
**Created:** 2026-11-20

## Problem

Three sentences in the live policy would be untrue once AI Coach ships or once other users' footage is used for testing: "Video content is used only as you direct", the provider table's "Google: OAuth authentication", and "No automated identification of individuals in videos or photos is performed" (the analysis reads a jersey number when one is visible).

## Solution

Wording changes in `src/frontend/src/components/PrivacyPolicy.jsx` (sections 2, 3, 5 and 6) and `TermsOfService.jsx` (section 6, the licence), and the "Last updated" date on both.

## Waiting on the owner

1. **Lawyer review.** `docs/legal/privacy-policy.md` is marked "DRAFT, for attorney review, do not publish without legal counsel approval", and this change concerns video of children. The wording here was written by an AI, not a lawyer.
2. **How it ships.** These pages are part of the app, so they go live with a production deploy of the app (`/deploy`), not a landing deploy.
3. **Telling existing users.** Section 10 of the policy promises a notice in the application for material changes. No such notice exists yet. Until existing users have been told, only footage from accounts whose owners agreed is used for testing.
4. **The opt-out.** It is by email to privacy@reelballers.com. Nothing in the app records an opt-out yet; a list has to be kept by hand, or a setting built.
5. **Not claimed.** The wording does not say our AI provider never trains on the video, because Google's terms for our account have not been checked.

## Acceptance Criteria

- [ ] `/privacy` names AI analysis and internal testing in section 2, Google's AI video analysis in section 3, and the opt-out; `/terms` section 6 grants the matching licence.
- [ ] Neither page says video is used only as the user directs, and neither claims anything about the AI provider's own training that has not been verified.
- [ ] The owner has recorded the lawyer's answer and the decision on notifying existing users.

## Ruling

The owner's attorney approved the wording (owner, 2026-11-20). One word was changed after that approval to pass the copy glossary check: "moments" became "plays" in section 2 of the privacy policy; the owner was told. Merged as PR #852 on 2026-11-20. Live with the next production deploy of the app. The in-app notice to existing users, the in-app opt-out and the attorney drafts in `docs/legal/` are T18040.
