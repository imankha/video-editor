# Privacy Policy

**DRAFT — For Attorney Review. Do not publish without legal counsel approval.**

**Effective Date:** [DATE TBD]
**Last Updated:** May 7, 2026

Reel Ballers ("we," "us," or "our") operates the Reel Ballers video editing application (the "Service"). This Privacy Policy describes how we collect, use, disclose, and protect your personal information when you use our Service.

This policy is designed to comply with the California Consumer Privacy Act (CCPA/CPRA), California Online Privacy Protection Act (CalOPPA), Children's Online Privacy Protection Act (COPPA), the FTC Act, and other applicable privacy laws.

---

## Table of Contents

1. [Information We Collect](#1-information-we-collect)
2. [How We Use Your Information](#2-how-we-use-your-information)
3. [How We Share Your Information](#3-how-we-share-your-information)
4. [Data Retention](#4-data-retention)
5. [Your Privacy Rights (CCPA/CPRA)](#your-rights)
6. [Children's Privacy (COPPA)](#6-childrens-privacy-coppa)
7. [Cookies and Tracking Technologies](#7-cookies-and-tracking-technologies)
8. [Do Not Track / Global Privacy Control](#8-do-not-track--global-privacy-control)
9. [Security](#9-security)
10. [Changes to This Policy](#10-changes-to-this-policy)
11. [Contact Us](#11-contact-us)

---

## 1. Information We Collect

### Information You Provide

| Category | Examples | Purpose |
|----------|----------|---------|
| Account Information | Email address, Google profile picture URL, Google ID | Account creation and authentication |
| Video Content | Game footage uploaded by you (may contain identifiable minors) | Video processing, clip extraction, highlight creation |
| Payment Information | Credit card data (processed entirely by Stripe; we do not store card numbers) | Payment for storage credits |

### Information Collected Automatically

| Category | Examples | Purpose |
|----------|----------|---------|
| Session Data | Session tokens (httponly cookie: `rb_session`) | Authentication and session management |
| Usage Analytics | Page views, feature usage (collected via Cloudflare Web Analytics — no cookies, no PII) | Service improvement |

### Information We Do NOT Collect

- We do not collect biometric data. Video framing/cropping is performed manually by users.
- We do not use facial recognition or automated identification of individuals in videos.
- We do not collect location data, device identifiers, or advertising identifiers.

---

## 2. How We Use Your Information

We use your personal information to:

- Provide, maintain, and improve the Service
- Process video uploads and generate highlights
- Process payments and manage storage credits
- Send transactional emails (OTP codes, share notifications)
- Respond to support requests
- Comply with legal obligations

We do **not** use your information to:

- Sell to third parties
- Target advertising
- Build user profiles for marketing purposes
- Train AI/ML models on your video content

---

## 3. How We Share Your Information

We share your information only with service providers who assist in operating the Service:

| Service Provider | Data Shared | Purpose |
|-----------------|-------------|---------|
| **Cloudflare R2** | Video files, user databases | Cloud storage (bucket: `reel-ballers-users`) |
| **Modal** | Video files (temporary) | GPU video processing; files are deleted after processing completes |
| **Fly.io** | Application data | Application hosting |
| **Resend** | Email addresses | Transactional email delivery (OTP codes, share notifications) |
| **Google** | Google ID, email, profile picture | OAuth authentication |
| **Stripe** | Payment data (handled entirely by Stripe) | Payment processing |
| **Cloudflare Web Analytics** | Anonymous page view data (no PII) | Privacy-preserving analytics |

**We do not sell or share your personal information** as defined by the CCPA/CPRA. We have no advertising partners, data brokers, or third-party tracking.

---

## 4. Data Retention

| Data Type | Retention Period |
|-----------|-----------------|
| Game footage & clips | 30 days after game expiry (per storage credits system) |
| Account data (email, settings) | Retained until you request deletion |
| Processing artifacts (GPU intermediates) | Automatically deleted after export completes |
| Session tokens | 30 days maximum, or until logout |
| OTP codes | Expire after 10 minutes |

Upon account deletion request, all data is permanently deleted within 45 days (CCPA compliance deadline). See our [Data Retention Policy](data-retention-policy.md) for details.

---

<a id="your-rights"></a>
## 5. Your Privacy Rights (CCPA/CPRA)

If you are a California resident (or where otherwise required by law), you have the following rights:

### Right to Know / Access
You may request a copy of all personal information we hold about you. Use the "Download My Data" button in Account Settings or email us.

### Right to Delete
You may request deletion of your personal information. Use the "Delete My Account" button in Account Settings or email us. Deletion is permanent and immediate.

### Right to Correct
You may request correction of inaccurate personal information by contacting us.

### Right to Opt-Out of Sale/Sharing
**We do not sell or share your personal information.** This right is automatically honored. The "Do Not Sell or Share" indicator in Account Settings confirms this status.

### Right to Limit Use of Sensitive Personal Information
Video content containing identifiable minors is used solely for the purpose you direct (video processing). We do not use it for any other purpose.

### Non-Discrimination
We will not discriminate against you for exercising any of your privacy rights.

### How to Exercise Your Rights

- **In-app:** Account Settings → Your Privacy Rights
- **Email:** [privacy@reelballers.com](mailto:privacy@reelballers.com)

We will verify your identity before fulfilling requests. We respond within 45 days as required by CCPA.

---

## 6. Children's Privacy (COPPA)

**Reel Ballers is designed for adults (18+).** Our users are parents, guardians, and coaches who upload youth sports footage.

- **Children do not create accounts.** All account holders must confirm they are 18 years of age or older.
- **Children may appear in video content** uploaded by their parent, guardian, or authorized coach.
- **We do not knowingly collect personal information from children under 13** (or under 16 for CCPA purposes).
- **No biometric data is extracted.** Video framing and cropping are manual operations performed by the user.
- **No automated identification** of individuals in videos is performed.

If you believe a child under 13 has somehow created an account, please contact us immediately at [privacy@reelballers.com](mailto:privacy@reelballers.com) and we will delete the account.

**Parental rights:** Parents/guardians who have uploaded video content of their children retain full control. They may delete any content at any time through the app, or request full account deletion.

---

## 7. Cookies and Tracking Technologies

### Cookies We Use

| Cookie | Type | Purpose | Duration |
|--------|------|---------|----------|
| `rb_session` | Strictly necessary (functional) | Authentication session | 30 days |

We use **one** cookie, which is strictly necessary for the Service to function. It is an httponly, secure session cookie used solely for authentication. No consent is required for strictly necessary cookies.

### Analytics

We use **Cloudflare Web Analytics**, which is a privacy-preserving analytics service that:
- Does **not** set any cookies
- Does **not** collect personally identifiable information
- Does **not** track users across websites
- Does **not** use fingerprinting

### What We Do NOT Use

- No advertising cookies
- No third-party tracking pixels
- No Google Analytics
- No social media tracking
- No cross-site tracking of any kind

---

## 8. Do Not Track / Global Privacy Control

- **Do Not Track (DNT):** Our analytics (Cloudflare Web Analytics) do not use cookies or track across sites, so DNT signals are effectively honored by default.
- **Global Privacy Control (GPC):** We honor the GPC signal (`Sec-GPC: 1`). Since we do not sell or share personal information, receiving a GPC signal requires no change in our behavior — your data is already protected. We log GPC signals for compliance record-keeping.

---

## 9. Security

We implement appropriate technical and organizational measures to protect your personal information:

- All data transmitted over HTTPS/TLS
- Session cookies are httponly and secure
- Video files stored in encrypted-at-rest cloud storage (Cloudflare R2)
- Per-user database isolation (each user's data stored in separate SQLite databases)
- No shared access between user accounts
- Processing artifacts deleted immediately after use

---

## 10. Changes to This Policy

We will notify you of material changes to this policy by:
- Displaying a notice in the application
- Updating the "Last Updated" date at the top of this page

Your continued use of the Service after changes constitutes acceptance of the updated policy. If you disagree with changes, you may delete your account at any time.

---

## 11. Contact Us

**Reel Ballers**

**Privacy inquiries:** [privacy@reelballers.com](mailto:privacy@reelballers.com)

For California residents: You may also designate an authorized agent to make a request on your behalf. The authorized agent must provide proof of authorization.
