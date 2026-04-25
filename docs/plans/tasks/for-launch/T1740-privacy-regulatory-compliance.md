# T1740: Privacy & Regulatory Compliance for Launch

**Status:** TODO
**Impact:** 10
**Complexity:** 6
**Created:** 2026-04-24
**Updated:** 2026-04-24

## Problem

Reelballers is a California-based web app where parents/coaches upload youth sports game footage (containing minors). Before launch, we must comply with multiple federal and state privacy regulations or face severe fines — up to $53K/violation (COPPA), $7.5K/violation with triple penalties for minors' data (CCPA/CPRA).

The app currently has no privacy policy, no terms of service, no age verification, no consumer rights request mechanism, and no data deletion workflow.

**Biometric risk resolved:** Framing uses purely manual crop — no face detection/recognition. BIPA (Illinois), CUBI (Texas), and WA biometric laws do not apply.

## Applicable Regulations

### Tier 1 — Mandatory Before Launch (Highest Risk)

| Regulation | Why It Applies | Max Penalty |
|------------|----------------|-------------|
| **COPPA** (15 U.S.C. §§ 6501–6506) | Videos contain identifiable minors. 2024 rule update explicitly covers photos/videos/audio containing a child's image or voice as biometric identifiers. Users are adults but children are data subjects. | $53,088/violation |
| **CCPA/CPRA** (Cal. Civ. Code §§ 1798.100–199) | California business collecting consumers' personal information. Videos contain biometric data (faces) = "sensitive personal information." Triple penalties for minors' data. | $7,500/violation (minors), class action $100-$750/consumer for breaches |
| **CalOPPA** (Cal. Bus. & Prof. Code §§ 22575–22579) | Any commercial website collecting PII from California consumers. No size threshold. Must have conspicuous privacy policy with specific disclosures. | $2,500/violation (each page visit = separate violation) |
| **FTC Act Section 5** (15 U.S.C. § 45) | All commercial entities. Privacy policy statements are legally binding — any practice contradicting published policy is deceptive. | Consent decrees (20-year compliance orders), $50,120/violation |
| **CAN-SPAM** (15 U.S.C. § 7701) | App sends commercial emails (account notifications, export-ready, etc.). | $51,744/email in violation |
| **CA Data Breach Notification** (Cal. Civ. Code §§ 1798.29, 1798.82) | Business handling personal information of CA residents. Video with identifiable faces = biometric data, a covered category. | Civil actions, $100-$750/consumer statutory damages |

### Tier 2 — Prepare Now, Enforce Later

| Regulation | Why It Applies | Max Penalty |
|------------|----------------|-------------|
| **CA Age-Appropriate Design Code (AB 2273)** | Service likely accessed by children under 18. Currently enjoined but could become enforceable. Signals regulatory direction. | $7,500/affected child (intentional) |
| **FERPA** (20 U.S.C. § 1232g) | Doesn't apply to consumer app directly, but triggers the moment a school/league partners with us. Need contract template ready. | Loss of federal funding for school partner; contractual liability for us |
| **State Privacy Laws** (CO, VA, CT, TX, OR, etc.) | 15+ states have comprehensive privacy laws. If serving users nationwide, need multi-state compliance. All require privacy policy, consumer rights, data protection assessments for children's data. | Varies by state |
| **ADA / Unruh Act** | Commercial websites increasingly treated as public accommodations. California Unruh Act is aggressive. | $4,000 minimum/violation (Unruh) |
| **GDPR** | Not targeting EU, but if any EU user accesses the app. Privacy policy + cookie consent covers the basics. Full GDPR (DPO, DPIA, SCCs) deferred unless EU market is pursued. | Up to €20M or 4% global turnover |

## Solution

Phased approach: Tier 1 deliverables must ship before launch. Tier 2 is near-term follow-up as the app grows.

## Context

### Current App Architecture (Relevant to Compliance)

- **User isolation**: Per-user SQLite DBs, users only access their own data — this is a strong privacy-by-design foundation
- **Video storage**: Cloudflare R2 (need data processing agreement)
- **GPU processing**: Modal (need data processing agreement)
- **Hosting**: Fly.io (need data processing agreement)
- **Auth**: Google OAuth + OTP, no guest accounts (good — clear identity)
- **Email**: Resend (need CAN-SPAM compliance)
- **Framing feature**: Purely manual crop/upscale — no face detection. Biometric laws (BIPA/CUBI) do not apply.

### Relevant Files

- `src/frontend/src/` — Privacy policy page, consent banners, age verification UI
- `src/backend/app/routers/` — Consumer rights API endpoints (data export, deletion)
- `src/backend/app/services/` — Data deletion service
- `src/frontend/public/` — Privacy policy, terms of service (static or dynamic)
- Landing page at `reelballers.com` — Must link privacy policy conspicuously

### Related Tasks
- T1580 (Storage Credits) — Retention/deletion policies interact with credit system
- T1050 (Team Invitations) — Sharing features affect privacy disclosures

## Implementation

### Phase 1: Legal Documents (No Code)

These are text documents that need legal review. Draft them, then get a privacy attorney to review before launch.

1. [ ] **Privacy Policy** — Must satisfy CalOPPA + CCPA/CPRA + COPPA + FTC Act simultaneously
   - Categories of personal information collected (account data, video content, device info, usage data)
   - Categories of sensitive PI (if any — no biometric processing, but videos contain faces; disclose storage)
   - How each category is used, stored, retained, deleted
   - Third parties who receive data (Cloudflare, Modal, Fly.io, Resend, Google Auth)
   - Consumer rights: access, delete, correct, opt-out of sale/sharing, limit sensitive PI
   - How to exercise rights (web form + email minimum; toll-free number if CCPA thresholds met)
   - Do Not Track signal response disclosure
   - COPPA section: how children's data in videos is handled
   - Data retention periods
   - Effective date, update notification process
   - Operator contact info (name, physical address, phone, email)

2. [ ] **Terms of Service**
   - User represents they have authority to upload content (parent/legal guardian of minors depicted)
   - User responsibility for content legality
   - Age requirement (13+ or 18+ for account creation)
   - Acceptable use policy
   - Content ownership and license grant
   - Limitation of liability
   - Dispute resolution (arbitration clause vs. court, venue in California)
   - DMCA takedown procedure

3. [ ] **Data Retention & Deletion Policy**
   - Video retention: define timeframe (aligns with storage credits T1580 — 30-day game expiry)
   - Account data retention after deletion request
   - Backup/R2 sync deletion procedures
   - Processing artifacts (Modal GPU intermediates) — confirm auto-deleted

4. [ ] **Incident Response Plan**
   - Breach detection procedures
   - Notification timelines (CA law: "most expedient time possible"; GDPR: 72 hours)
   - Notification templates (individual notice + CA AG notice if 500+ affected)
   - Roles and responsibilities

5. [ ] **Vendor Data Processing Agreements**
   - Cloudflare R2 — review their DPA, ensure adequate
   - Modal — review their data handling terms
   - Fly.io — review their DPA
   - Resend — review their DPA
   - Google (OAuth) — review their terms

### Phase 2: Technical Implementation

6. [ ] **Privacy Policy + ToS pages in the app**
   - `/privacy` route serving privacy policy
   - `/terms` route serving terms of service
   - Conspicuous link on homepage/landing page (CalOPPA: word "privacy" must appear, distinguishable formatting)
   - Link in footer of every page
   - Link in account creation flow

7. [ ] **Age verification at signup**
   - Date of birth or age confirmation gate during account creation
   - If under 13: block account creation (or implement VPC — verifiable parental consent — which is complex)
   - If 13-17: collect parental consent for CCPA opt-in
   - Store age bracket (not DOB) to minimize data collection
   - Recommendation: require users to confirm they are 18+ (simplest COPPA compliance path since the uploaders are parents/coaches, not children)

8. [ ] **Consumer rights request mechanism**
   - Settings page section: "Your Privacy Rights"
   - "Download My Data" button — exports all user data (account info, clips, metadata) as ZIP
   - "Delete My Account" button — full deletion of user DB, R2 objects, auth records, processing artifacts
   - Email-based request fallback (privacy@reelballers.com or similar)
   - Request verification flow (confirm identity before processing)
   - 45-day response tracking (CCPA deadline)

9. [ ] **"Do Not Sell or Share" link** (CCPA/CPRA)
    - Footer link on every page
    - Currently we don't sell/share data, but the link is still required
    - Toggle in user settings
    - Honor Global Privacy Control (GPC) browser signal automatically

10. [ ] **"Limit Sensitive PI" link** (CPRA)
    - Precautionary: we don't extract biometric data, but videos contain faces and are stored
    - Footer link + settings toggle
    - Define what "limiting" means for our use case (we only use video for the user's own processing)

11. [ ] **CAN-SPAM compliance for emails**
    - Physical mailing address in email footer
    - Unsubscribe link in all commercial emails
    - Honor unsubscribe within 10 business days
    - Accurate sender/subject lines

12. [ ] **Cookie/tracking consent**
    - Audit all cookies and tracking (analytics, session cookies, etc.)
    - Cookie consent banner if using any non-essential cookies
    - CalOPPA: disclose third-party tracking in privacy policy

### Phase 3: Process & Documentation

13. [ ] **Data inventory/mapping document**
    - What PI is collected at each touchpoint
    - Where it's stored (SQLite, R2, Modal temp, Fly.io)
    - Who can access it (user-only, admin impersonation audit trail exists)
    - Retention periods for each data type
    - Cross-border transfers (where are R2/Modal/Fly.io data centers?)

14. [ ] **Annual privacy policy review process**
    - Calendar reminder to review and update annually (CCPA requirement)

15. [ ] **FERPA agreement template** (for future school/league partnerships)
    - Ready-to-use template when schools want to use the platform

## Acceptance Criteria

- [ ] Privacy policy published at `/privacy`, linked from homepage, footer, and signup
- [ ] Terms of service published at `/terms`, accepted during signup
- [ ] Age verification gate at account creation (18+ confirmation)
- [ ] Consumer rights mechanism: data download + account deletion + email contact
- [ ] "Do Not Sell or Share" link in footer (even if we don't sell data)
- [ ] "Limit Sensitive PI" link in footer
- [ ] GPC signal honored automatically
- [ ] CAN-SPAM compliant emails (unsubscribe + physical address)
- [ ] Cookie consent banner (if non-essential cookies exist)
- [ ] Vendor DPAs reviewed and on file
- [ ] Incident response plan documented
- [ ] Data retention policy defined and documented
- [ ] All documents reviewed by privacy attorney before launch

## Legal Review Note

**These deliverables should be drafted by the engineering team but MUST be reviewed by a privacy attorney before launch.** Key areas requiring attorney input:
- Privacy policy language (binding legal document)
- Terms of service (liability, arbitration, venue)
- COPPA compliance strategy (is 18+ gate sufficient or do we need VPC?)
- Whether CCPA thresholds are met (changes obligations)
- Whether storing user-uploaded video containing faces (without biometric extraction) triggers CPRA sensitive PI requirements
