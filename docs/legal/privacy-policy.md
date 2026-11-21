# Privacy Policy

**Approved by legal counsel on November 20, 2026.** This file mirrors the live page in the app (`src/frontend/src/components/PrivacyPolicy.jsx`, served at `/privacy`); the app page is the published text. Change both together.

**Last Updated:** November 20, 2026

---

ReelBallers (“we,” “us,” or “our”) operates the ReelBallers video editing application (the “Service”). This Privacy Policy describes how we collect, use, disclose, and protect your personal information when you use our Service.

## 1. Information We Collect

### Information You Provide

- **Account data:** Email address, Google ID, profile picture URL
- **Game metadata:** Opponent name, game date, tournament name, game type
- **Intro card data:** A player photo, the player's name, and short display facts (position, graduation year/class, team) plus any free text you type onto an Athlete Intro Card, along with a parental-consent attestation recorded when you first create a card. No birthdate, age, address, or school is collected.
- **Payment data:** Credit card and billing details processed entirely by Stripe — never stored on our servers

### Information Collected Automatically

- **Session data:** Session token via httponly cookie (`rb_session`), used solely for authentication
- **Payment data:** Stripe customer ID, created when you make a purchase
- **Usage data:** Anonymous page views via Cloudflare Web Analytics (cookieless, no PII)
- **Device data:** User agent string, logged only in admin impersonation audit trail

### Information Derived from Your Content

- **Video metadata:** Duration, resolution, frame rate, file size, file hash
- **Editing data:** Highlight selections, crop keyframes, overlay settings, export job records

### Video Content

Video files you upload, along with derived metadata such as duration, resolution, frame rate, file hashes, and game identification signals. Video files contain visual depictions of individuals, including minors participating in sporting events. We do not extract biometric data from videos. Our framing feature uses manual crop controls, not facial recognition or detection.

### Intro cards

You can build “intro card” graphics for a youth player from a photo you upload, the player's name, and a small fixed set of display facts you type (position, graduation year, team). Because a card depicts a minor, we record a parental-consent attestation before the first card is created and warn you that a card attached to a shared highlight or collection is publicly visible to anyone with the link. We do not run facial recognition or biometric templating on player photos; optional background removal is image segmentation only.

### Information We Do NOT Collect

- No biometric data (video/photo cropping is manual; background removal is segmentation, not facial recognition)
- No birthdate, age, address, or school for players featured in intro cards
- No location data (beyond what may exist in video metadata, which we do not extract)
- No advertising identifiers or cross-site tracking
- No contact lists or social graphs
- No data from children directly (children do not create accounts)

## 2. How We Use Your Information

We use your personal information to:

- **Provide the Service:** Process, enhance, crop, overlay, and export your videos as you direct
- **Authenticate you:** Verify your identity and maintain your session
- **Process payments:** Complete purchases via Stripe
- **Video content:** We may analyze video metadata and content to identify games across multiple users' uploads, enabling shared viewing experiences and collaborative features in the future. This analysis may include comparing video characteristics (timing, location, visual similarity) to determine whether separate uploads depict the same game.
- **Improve the Service:** Understand usage patterns through anonymous, aggregate analytics
- **AI analysis you choose:** Where the Service offers a feature that has an AI model watch a game for you (for example, to mark plays), choosing it sends that game's video to our AI provider to be analyzed. The result is stored with your game.
- **Test and improve our features:** We may use videos you upload, and the plays, ratings, and notes you add to them, inside ReelBallers to test and improve the Service, for example to check that automatic play detection finds the plays parents mark by hand. This is done by our own staff and by the service providers listed in Section 3 acting on our behalf, and may include having an AI provider analyze a video. It is never published or shown to other users. You can opt out at any time by turning off “Use my videos to help test and improve ReelBallers” under “Your privacy rights” in Account settings, or by emailing [privacy@reelballers.com](mailto:privacy@reelballers.com); opting out does not affect your use of the Service.
- **Communicate with you:** Send transactional emails (OTP codes, export completion, share notifications)

We do **not** use your information to:

- Sell to third parties
- Target advertising
- Build user profiles for marketing
- Train AI/ML models on your video content. Analyzing a video with an AI model, as described above, is not training a model on it.

## 3. How We Share Your Information

We share data only with service providers who help operate the Service:

| Provider | Purpose |
|---|---|
| Cloudflare R2 | Cloud file storage |
| Modal | GPU video processing (temporary) |
| Fly.io | Application hosting |
| Resend | Transactional email |
| Google | OAuth authentication; AI video analysis (Gemini) for features you choose and for our internal testing |
| Stripe | Payment processing |
| Cloudflare Web Analytics | Privacy-preserving analytics (no PII) |

**With other users (future feature):** We may introduce features that allow users who recorded the same game to share or access each other's uploads. If we do, we will provide you with controls to opt in or out of such sharing, and we will notify you before enabling any sharing of your content. We will never share your video with other users without your explicit consent at the time of sharing.

**Legal requirements:** We may disclose information if required by law, subpoena, or other legal process, or if we believe in good faith that disclosure is necessary to protect our rights, protect your safety or the safety of others, or investigate fraud.

We do not sell or share your personal information as defined by CCPA/CPRA.

## 4. Data Retention

- Game footage: 30 days after game expiry
- Account data: retained until you request deletion
- Processing artifacts: deleted immediately after generation
- Sessions: 30 days max, or until logout
- OTP codes: expire after 10 minutes

Upon deletion request, your personal data is permanently removed immediately (within 45 days if via email), apart from the limited records described next.

Transaction records (payment amounts keyed to an opaque account id, with no name, email, or card details) are retained after account deletion to meet our tax and accounting obligations. We also keep a record that the account was deleted, including when and through which path, to evidence that the erasure happened, and, where support staff accessed the account, the security log of that access to protect the account and our systems. We also keep the text of any bug reports you submitted, with your email, device details, and attachments removed, to help us fix the problems you reported.

We also keep, under the same opaque account id, usage and activity statistics and the attribution signals that first brought you to ReelBallers (such as which campaign, referral link, or page you arrived from, and which sport you were browsing), collectively our “retained usage statistics,” to understand how the product is used and which channels bring people to it. To let us recognize a person who deletes their account and signs up again, without restoring any of their deleted data, we keep a one-way cryptographic hash of the deleted account's email address; the original email cannot be recovered from it. Retaining these records does not delay or limit erasure of your personal data.

## 5. Your Privacy Rights (CCPA/CPRA)

California residents (and others where required by law) have the following rights:

- **Right to Know/Access:** Request a copy of your data via “Download My Data” in Account Settings
- **Right to Delete:** Delete your account via “Delete My Account” in Account Settings. Deletion is permanent and immediate. A limited set of records survives deletion (transaction records, the record that the account was deleted, security logs of any staff access, de-identified bug reports, a one-way hash of your email so a future sign-up can be recognized as returning, and the retained usage statistics described in the Data Retention section above); retaining them never delays or limits erasure of your personal data.
- **Right to Correct:** Contact us to correct inaccurate information
- **Right to Opt-Out of Sale/Sharing:** We do not sell or share your data. This right is automatically honored.
- **Right to Limit Sensitive PI:** Video content is used as you direct and, unless you opt out, to test and improve the Service as described in Section 2. To opt out, turn off “Use my videos to help test and improve ReelBallers” under “Your privacy rights” in Account settings, or email privacy@reelballers.com.
- **Non-Discrimination:** We will not discriminate against you for exercising rights

**How to exercise your rights:**

- In-app: Account settings, then Your privacy rights
- Email: [privacy@reelballers.com](mailto:privacy@reelballers.com)

## 6. Children's Privacy (COPPA)

ReelBallers is designed for parents, guardians, and coaches of youth athletes.

- **Children are data subjects in videos, not account holders.** Our users are adults who upload and edit video of youth sporting events.
- We do not knowingly collect personal information from children under 13 (or under 16 for CCPA purposes).
- No biometric data is extracted. Video/photo framing and cropping are manual; player-photo background removal is segmentation, not facial recognition.
- No facial recognition or biometric identification of individuals in videos or photos is performed. Where an AI model analyzes a game, it describes the play (for example a team's kit color, a player's position, or a jersey number visible on screen); it does not identify anyone by face.
- **Intro cards are parent-created and consent-gated.** You provide the photo, name, and display facts (position, graduation year, team); we record your parent/guardian consent before the first card and collect no birthdate, age, address, or school. A shared card is publicly visible to anyone with the link.

**Parental rights:** Parents/guardians who have uploaded video or created intro cards for their children retain full control. All Athlete Intro Card data (photo, parent-typed facts, and consent record) is included in a data export and erased when you delete the card or your account.

If you believe a child under 13 has created an account, contact us at [privacy@reelballers.com](mailto:privacy@reelballers.com).

## 7. Cookies and Tracking

We use **one cookie**:

| Cookie | Type | Purpose |
|---|---|---|
| rb_session | Strictly necessary | Authentication |

We use **Cloudflare Web Analytics** which does not set cookies, collect PII, or track across sites.

We do not use advertising cookies, tracking pixels, Google Analytics, or cross-site tracking of any kind.

## 8. Do Not Track / Global Privacy Control

- **Do Not Track (DNT):** Effectively honored — our analytics don't use cookies or cross-site tracking.
- **Global Privacy Control (GPC):** We honor the GPC signal. Since we don't sell or share data, no behavioral change is needed — your data is already protected.

## 9. Security

- All data transmitted over HTTPS/TLS
- Session cookies are httponly and secure
- Video files stored in encrypted-at-rest cloud storage
- Per-user database isolation
- No shared access between user accounts
- Processing artifacts deleted immediately after use

## 10. Changes to This Policy

We will notify you of material changes by displaying a notice in the application and updating the “Last Updated” date. Continued use after changes constitutes acceptance.

## 11. Contact Us

**ReelBallers**

Privacy inquiries: [privacy@reelballers.com](mailto:privacy@reelballers.com)
