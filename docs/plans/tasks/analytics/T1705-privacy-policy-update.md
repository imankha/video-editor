# T1705: Privacy Policy Update for Analytics

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-05-20
**Epic:** [Open Panel Analytics](EPIC.md)
**Depends on:** [T1700](T1700-foundation.md) (need to know final tracking implementation details)

## Problem

The current privacy policy (T1740) covers Cloudflare Web Analytics (cookieless, no user identification). OpenPanel analytics introduces:
- User identification by ID and email via `identify()`
- Custom event tracking tied to identified users (uploads, exports, purchases)
- Session replay recording user interactions (enabled in T1701)
- Revenue/purchase data from Stripe webhooks sent to a third-party processor
- EU data hosting (Hetzner Germany) via OpenPanel Cloud

These are material changes to data collection practices that must be disclosed before analytics goes live in production.

## Solution

Update the existing privacy policy at `docs/legal/privacy-policy.md` and sign OpenPanel's DPA.

## Scope

### 1. Privacy Policy Sections to Update

**Section 1: Information We Collect -- "Information Collected Automatically"**
- Add analytics data category: page views, custom events (video uploads, exports, purchases), session duration, referrer, browser/OS/device type, city-level location
- Add user analytics profile: email address and user ID linked to analytics events when logged in
- Add session recordings (T1701): DOM snapshots, clicks, scrolls, mouse movements, page navigation (form inputs masked by default, 30-day retention)
- Update "Usage data" row to reference OpenPanel instead of Cloudflare Web Analytics

**Section 2: How We Use Your Information**
- Add: analyze product usage to understand feature adoption and friction points
- Add: session replay recordings to identify and fix bugs (30-day retention)

**Section 3: Service Providers**
- Add OpenPanel: analytics events, user ID, email, session recordings; data stored in EU (Germany); link to OpenPanel privacy policy and DPA

**Section 4: Data Retention**
- Add: analytics events retained while account active, deleted within 30 days of account deletion
- Add: session replay recordings auto-deleted after 30 days

**Section 7: Cookies and Tracking Technologies**
- Replace Cloudflare Web Analytics with OpenPanel
- Note: cookieless (no cookies set on user's browser), no IP storage (transiently used for geolocation then discarded), no cross-site tracking
- Disclose: when logged in, analytics events are linked to user account
- Disclose: session replay captures page interactions as structured data (form inputs masked)

**Section 5: Your Privacy Rights (CCPA/CPRA)**
- Add: deletion requests include analytics profiles and session recordings held by OpenPanel

**Section 10: International Data Transfers**
- Add: analytics data stored exclusively within the EEA (Hetzner, Germany)

### 2. Sign OpenPanel DPA

- Download DPA from openpanel.dev/dpa
- Review and sign (OpenPanel acts as data processor, Reel Ballers as data controller)
- Store signed copy

### 3. User Deletion Workflow

- Ensure account deletion flow also triggers OpenPanel profile deletion
- OpenPanel session replay auto-deletes at 30 days, but profile data needs explicit deletion on account close
- Add to existing account deletion handler: call OpenPanel API to delete user profile

### 4. OpenPanel Consent Mode (Optional)

OpenPanel supports `disabled: true` initialization with a `ready()` call to enable tracking after consent or login. Consider:
- Initialize tracking disabled for anonymous visitors
- Call `ready()` after user logs in (existing ToS/privacy policy acceptance covers this)
- This is a defensive measure, not strictly required (OpenPanel is cookieless)

## Files Affected

| File | Change |
|------|--------|
| `docs/legal/privacy-policy.md` | Update 6 sections per scope above |
| Account deletion handler (backend) | Add OpenPanel profile deletion API call |

## Acceptance Criteria

- [ ] Privacy policy updated with all 6 sections covering OpenPanel analytics
- [ ] OpenPanel DPA signed and stored
- [ ] Account deletion triggers OpenPanel profile deletion
- [ ] Privacy policy changes reviewed (current doc already marked "DRAFT -- For Attorney Review")
- [ ] No Cloudflare Web Analytics references remain in privacy policy
