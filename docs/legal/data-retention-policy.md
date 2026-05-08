# Data Retention and Deletion Policy

**DRAFT — For Attorney Review. Do not publish without legal counsel approval.**

**Effective Date:** [DATE TBD]
**Last Updated:** May 7, 2026

---

## Overview

This policy describes how Reel Ballers retains, archives, and deletes user data. Our approach minimizes data retention while providing a functional service.

---

## Retention Periods

| Data Category | Retention Period | Trigger for Deletion |
|---------------|-----------------|---------------------|
| Game footage & clips | 30 days after game expiry | Automatic (storage credits system) |
| Exported/final videos | 30 days after game expiry | Automatic (tied to source game) |
| Processing artifacts (GPU intermediates) | Deleted immediately after function execution | Automatic (Modal function cleanup) |
| Account data (email, settings, credits) | Until account deletion request | User-initiated |
| Session tokens | 30 days maximum | Automatic expiry or logout |
| OTP codes | 10 minutes | Automatic expiry |
| Stripe customer link | Until account deletion | User-initiated |
| Cloudflare Web Analytics data | Managed by Cloudflare (no PII) | N/A — no PII collected |

---

## Account Deletion

### User-Initiated Deletion

Users may delete their account at any time via:
- Account Settings → "Delete My Account" button
- Email to [privacy@reelballers.com](mailto:privacy@reelballers.com)

### What Gets Deleted

Upon account deletion, the following are **permanently and immediately** removed:

1. **Authentication records:** User row from auth database (email, Google ID, timestamps)
2. **Sessions:** All active sessions invalidated immediately
3. **Local server data:** Entire `user_data/{user_id}/` folder
4. **Cloud storage (R2):** All objects under `{environment}/users/{user_id}/` prefix, including:
   - Raw game uploads
   - Extracted clips
   - Working/draft videos
   - Final exported videos
   - User database files (user.sqlite, profile databases)
5. **Credit transaction history**
6. **Achievement/quest progress**

### What Is NOT Retained After Deletion

- No backups are kept (R2 is the sole storage layer; we do not maintain separate backups)
- No "soft delete" or archival — deletion is permanent
- No data is retained for analytics or research purposes

### Deletion Timeline

- **Immediate:** All data removed upon confirmation of deletion request
- **Maximum 45 days:** If submitted via email, we fulfill within the CCPA-mandated 45-day window

---

## Third-Party Data Handling

| Provider | Data Retained After Deletion | Notes |
|----------|------------------------------|-------|
| **Cloudflare R2** | None | All user objects deleted |
| **Modal** | None | Processing artifacts auto-deleted after function execution |
| **Fly.io** | None | Application server only; no persistent user data |
| **Resend** | Email delivery logs (per their retention policy) | We do not control Resend's internal logs |
| **Google** | OAuth grant remains until user revokes | Users can revoke at accounts.google.com |
| **Stripe** | Transaction records (per Stripe's legal obligations) | Stripe retains payment records per financial regulations |

---

## Game Expiry (Storage Credits System)

Games have a 30-day active period per storage credits. When a game expires:

1. Game footage is marked for deletion
2. Associated clips, projects, and exports are deleted
3. R2 objects for that game are removed

Users are notified before game expiry and may purchase additional credits to extend retention.

---

## Data Export

Users may export all their data before deletion via Account Settings → "Download My Data." The export includes:

- Account information (email, creation date, settings)
- All profile metadata (games, clips, projects — structured data)
- R2 object listing with temporary download URLs for video files
- Credit balance and transaction history

Video files are provided as presigned download URLs (valid for 24 hours) rather than included directly in the export, due to file size.

---

## Contact

Questions about data retention: [privacy@reelballers.com](mailto:privacy@reelballers.com)
