# T444: Push Notifications & App Badges

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-28

## Problem

Once users leave the app, there's no way to pull them back. Export completion, shared clips from teammates, and new content all go unnoticed until the user happens to open the app again. This kills the sharing loop — a parent shares a clip but the recipient doesn't see it for days.

## Solution

1. **Push Notifications** — server-sent notifications for key events even when app is closed
2. **Badging API** — app icon shows unread count (lighter touch than notifications)

## Events That Trigger Notifications

| Event | Message | Priority |
|-------|---------|----------|
| Export complete | "Your reel '{name}' is ready to share!" | High |
| Shared clip received | "{sender} shared a clip with you" | High |
| Shared reel received | "{sender} shared a highlight reel with you" | Medium |
| Storage credits expiring | "Your game '{name}' expires in 3 days" | Low |

## Events That Update Badge Count

- Pending shared clips/reels (unviewed)
- Completed exports not yet downloaded/shared
- Badge clears when user views the relevant item

## Architecture

### Push Notification Flow

```
Backend event (export complete / share created)
       ↓
Backend sends push via Web Push protocol (VAPID)
       ↓
Push service (FCM/APNs) delivers to device
       ↓
Service worker receives `push` event
       ↓
self.registration.showNotification(title, { body, icon, data: { url } })
       ↓
User taps notification → app opens to relevant page
```

### Subscription Flow

```
App (on install or first login)
       ↓
Request notification permission: Notification.requestPermission()
       ↓
Subscribe: registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC })
       ↓
Send subscription to backend: POST /api/push/subscribe { endpoint, keys }
       ↓
Backend stores subscription per user (in auth.sqlite or user DB)
```

### Backend Push Infrastructure

```python
# New endpoint: POST /api/push/subscribe
# Stores: push_subscriptions(user_id, endpoint, p256dh_key, auth_key, created_at)

# On event:
from pywebpush import webpush
webpush(subscription_info, data=json.dumps(payload), vapid_private_key=VAPID_PRIVATE)
```

### Badging API

```javascript
// Set badge count
navigator.setAppBadge(count);

// Clear badge
navigator.clearAppBadge();

// Update on app focus
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) updateBadgeCount();
});
```

## Key Decisions

- **Permission timing**: ask on first export completion (user just got value, more likely to accept) — NOT on first visit
- **VAPID keys**: generate once, store private key as Fly.io secret, public key in frontend env
- **pywebpush** library for backend push delivery (lightweight, no external service needed)
- **Badge count** = pending shares + completed-but-unviewed exports
- **Notification click** opens the app to the relevant page (gallery for exports, inbox for shares)
- **iOS Safari 16.4+** supports Web Push for installed PWAs — covers our audience

## Implementation

1. [ ] Generate VAPID key pair, store private in Fly secrets, public in frontend .env
2. [ ] Backend: `push_subscriptions` table + `POST /api/push/subscribe` endpoint
3. [ ] Backend: `send_push_notification(user_id, payload)` utility using pywebpush
4. [ ] Frontend: permission request component (shown after first export, not on load)
5. [ ] Frontend: subscribe to push on permission grant, send subscription to backend
6. [ ] Service worker: handle `push` event → showNotification with icon + action URL
7. [ ] Service worker: handle `notificationclick` → open app to relevant page
8. [ ] Hook into export completion: send push when export finishes
9. [ ] Hook into share creation: send push to recipient when clip/reel shared
10. [ ] Badging: `useAppBadge` hook that syncs count from pending shares + exports
11. [ ] Clear badge on app focus + when user views pending items
12. [ ] Fallback: no-op on unsupported browsers (badge and push degrade to nothing)

## Acceptance Criteria

- [ ] Notification permission requested at appropriate time (after first export, not on first visit)
- [ ] Push notification received when export completes (app closed)
- [ ] Push notification received when someone shares a clip with user
- [ ] Tapping notification opens app to correct page
- [ ] App icon shows badge count for pending items
- [ ] Badge clears when items are viewed
- [ ] Works on Android Chrome, desktop Chrome/Edge, iOS Safari 16.4+
- [ ] No notification spam — only high-value events trigger push
- [ ] Graceful no-op on unsupported browsers
