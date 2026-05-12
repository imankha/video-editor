# Privacy Policy

**DRAFT — For Attorney Review. Do not publish without legal counsel approval.**

**Effective Date:** [DATE TBD]
**Last Updated:** May 8, 2026

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
10. [International Data Transfers](#10-international-data-transfers)
11. [Data Breach Notification](#11-data-breach-notification)
12. [Changes to This Policy](#12-changes-to-this-policy)
13. [Contact Us](#13-contact-us)

---

## 1. Information We Collect

### Information You Provide

| Category | Specific Data | Source |
|----------|--------------|--------|
| **Account data** | Email address | User-provided (Google OAuth or email OTP) |
| **Account data** | Google ID (`sub` claim) | Google OAuth |
| **Account data** | Profile picture URL | Google OAuth |
| **Game metadata** | Opponent name, game date, tournament name, game type | User-provided when adding a game |
| **Payment data** | Credit card and billing details | Processed entirely by Stripe; never stored on our servers |

### Information Collected Automatically

| Category | Specific Data | Source |
|----------|--------------|--------|
| **Session data** | Session token (httponly cookie: `rb_session`) | Generated at login; used solely for authentication |
| **Payment data** | Stripe customer ID | Created by Stripe when you make a purchase |
| **Usage data** | Page views (anonymous, no PII) | Cloudflare Web Analytics (cookieless, privacy-focused) |
| **Device data** | User agent string | HTTP headers; logged only in admin impersonation audit trail |

### Information Derived from Your Content

| Category | Specific Data | How We Derive It |
|----------|--------------|-----------------|
| **Video metadata** | Duration, resolution, frame rate, file size, file hash (blake3) | Automatically extracted from videos you upload |
| **Editing data** | Clip selections, crop keyframes, overlay settings, export job records | Created through your editing actions in the Service |

### Video Content

**Video files and metadata.** Video files you upload from your own device, along with derived metadata such as duration, resolution, frame rate, file hashes, and game identification signals. Video files contain visual depictions of individuals, including minors participating in sporting events. All video content is uploaded by the user from their own device; Reel Ballers does not access, download, scrape, or pull content from any third-party platform or service on a user's behalf.

We do not extract biometric data from videos. Our framing (crop/zoom) feature uses manual crop controls, not facial recognition or detection. We do not extract GPS or location data from video metadata. We do not verify the source, ownership, or licensing status of video content uploaded by users.

### Information We Do NOT Collect

- No biometric data (video framing/cropping is performed manually by users)
- No facial recognition or automated identification of individuals in videos
- No location data (beyond what may exist in video metadata, which we do not extract)
- No advertising identifiers
- No cross-site tracking
- No contact lists or social graphs
- No data from children directly (children do not create accounts)
- No special categories of sensitive personal data (racial/ethnic origin, political opinions, religious beliefs, health data, sexual orientation) are intentionally collected or processed, except to the extent incidentally present in sports video footage

---

## 2. How We Use Your Information

We use your personal information to:

- **Provide the Service:** Process, enhance, crop, overlay, and export your video clips solely as you direct.
- **Authenticate you:** Verify your identity and maintain your session.
- **Process payments:** Complete purchases via Stripe.
- **Video content:** We use video you upload for processing, enhancement, and export as you direct. We may also analyze video metadata and content to identify games across multiple users' uploads, enabling shared viewing experiences and collaborative features in the future. This analysis may include comparing video characteristics (timing, location, visual similarity) to determine whether separate uploads depict the same game.
- **Improve the Service:** Understand usage patterns through anonymous, aggregate analytics (Cloudflare Web Analytics).
- **Communicate with you:** Send transactional emails related to your account (OTP codes, export completion, share notifications).
- **Comply with legal obligations.**

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

**With other users (future feature).** We may introduce features that allow users who recorded the same game to share or access each other's uploads. If we do, we will provide you with controls to opt in or out of such sharing, and we will notify you before enabling any sharing of your content. We will never share your video with other users without your explicit consent at the time of sharing.

**User-initiated sharing.** When you use the Service's sharing features (share links), you are directing us to make that content accessible to the recipients you choose. We do not independently select, curate, or recommend content for distribution. You are solely responsible for ensuring you have the right to share content depicting any individuals, including obtaining any required consents from parents or guardians of minors.

**Legal requirements.** We may disclose information if required by law, subpoena, or other legal process, or if we believe in good faith that disclosure is necessary to protect our rights, protect your safety or the safety of others, or investigate fraud.

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

**Reel Ballers is designed for parents, guardians, and coaches** of youth athletes. Children do not create accounts on our Service.

- **Children are data subjects in videos, not account holders.** Our users are adults who upload and edit video of youth sporting events. Children appear in video content uploaded by their parent, guardian, or authorized coach.
- **We do not knowingly collect personal information from children under 13** (or under 16 for CCPA purposes).
- **No biometric data is extracted.** Video framing and cropping are manual operations performed by the user. We do not use facial recognition or detection.
- **No automated identification** of individuals in videos is performed.
- **No profiles of depicted individuals.** We do not build profiles of individuals who appear in videos.

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
- **Global Privacy Control (GPC):** We honor the GPC signal (`Sec-GPC: 1`). We do not sell your personal information or share it for cross-context behavioral advertising (as those terms are defined under the CCPA/CPRA). We do disclose limited data to service providers who help operate the Service (see Section 3), but these disclosures are for operational purposes only and do not constitute "selling" or "sharing" under California law. Receiving a GPC signal requires no change in our behavior. We log GPC signals for compliance record-keeping.

---

## 9. Security

We implement appropriate technical and organizational measures to protect your personal information:

- All data transmitted over HTTPS/TLS
- Session cookies are httponly and secure
- Video files stored in encrypted-at-rest cloud storage (Cloudflare R2)
- Per-user database isolation (each user's data stored in separate SQLite databases)
- No shared access between user accounts
- Processing artifacts deleted immediately after use
- Access to personal data is limited to personnel with a legitimate business need, who are subject to a duty of confidentiality

While we take reasonable precautions, no method of transmission over the Internet or electronic storage is 100% secure. We cannot guarantee absolute security of your data. You are responsible for maintaining the confidentiality of your account credentials.

---

## 10. International Data Transfers

Your data may be processed by our service providers in locations outside your jurisdiction. Our service providers (Cloudflare, Modal, Fly.io, Stripe, Resend) may process data in the United States and other countries. We rely on each provider's compliance frameworks (including Standard Contractual Clauses where applicable) to ensure adequate protection of your data during any cross-border transfer.

---

## 11. Data Breach Notification

In the event of a security breach that results in unauthorized access to your personal information, we will notify affected users within the timeframes required by applicable law (72 hours under CCPA where feasible). Notification will be sent via the email address associated with your account. We will also notify relevant regulatory authorities as required by law.

---

## 12. Changes to This Policy

We will notify you of material changes to this policy by:
- Displaying a notice in the application
- Updating the "Last Updated" date at the top of this page

Your continued use of the Service after changes constitutes acceptance of the updated policy. If you disagree with changes, you may delete your account at any time.

---

## 13. Contact Us

**Reel Ballers**

**Privacy inquiries:** [privacy@reelballers.com](mailto:privacy@reelballers.com)

For California residents: You may also designate an authorized agent to make a request on your behalf. The authorized agent must provide proof of authorization.
