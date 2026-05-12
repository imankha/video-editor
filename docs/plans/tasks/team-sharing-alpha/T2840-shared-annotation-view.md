# T2840: Shared Annotation View

**Status:** TODO
**Epic:** [Team Sharing Alpha](EPIC.md)
**Depends on:** T2830 (materialization)

## Problem

Non-users who receive a teammate share email need to see the shared annotations before signing up. They should see a playback experience showing the clips with annotation metadata (name, stars, notes), plus a clear CTA to sign up and claim the content.

## Solution

### Shared Teammate Link

Share emails include a link like `/shared/teammate/:shareToken`. This is a new route distinct from the existing `/shared/:shareToken` (which is for gallery video shares).

### Non-User View

When a non-user clicks the link:

1. **Load game + annotations** from the pending share data (stored in Postgres JSONB)
2. **Playback view**: Video player with annotation regions visible on a mini-timeline
3. **Annotation overlay**: Show clip name, star rating, and notes during playback of each clip region
4. **Navigation**: Click through clips (previous/next) or click on timeline regions
5. **CTA**: Prominent "Sign up / Sign In to annotate and make your own Reel" button
6. **Attribution**: "Shared by [sharer name]" shown on the page

### Authenticated User View

When a logged-in user clicks the link:
- If pending share exists for their email -> profile picker -> materialize -> redirect to game in their account
- If already resolved -> redirect to the game in their account

### On Signup Flow

1. New user signs up from the shared view
2. System checks `pending_teammate_shares` for their email
3. Profile picker (if needed)
4. Materialize game + annotations
5. Redirect to the game in their account

### Video Access

The shared view needs video access without the recipient having an account. Options:
- Generate a time-limited presigned R2 URL for the game video, embedded in the share token's data
- Or use public share token to proxy video (similar to existing SharedVideoOverlay pattern)

## UI Layout

```
+------------------------------------------+
|  [Reel Ballers logo]                     |
|                                          |
|  Shared by Jake's Dad                    |
|                                          |
|  +------------------------------------+ |
|  |                                    | |
|  |         Video Player               | |
|  |                                    | |
|  |  [Clip: Quick Goal  !!!!!]         | |
|  |  [Notes: Beautiful finish]         | |
|  +------------------------------------+ |
|  |  [|< ] [ < ] [ > ] [ >|]          | |
|  |  Clip 1 of 3                       | |
|  +------------------------------------+ |
|                                          |
|  +------------------------------------+ |
|  | Sign up to annotate and make your  | |
|  | own Reel                           | |
|  |         [Sign Up]  [Sign In]       | |
|  +------------------------------------+ |
+------------------------------------------+
```

## Test Scope

- Frontend unit tests for shared annotation playback component
- Backend unit tests for shared teammate token resolution
- E2E: non-user views shared link, sees annotations, signs up, content materializes

## Files Affected

- New component: `src/frontend/src/components/SharedAnnotationView.jsx`
- `src/frontend/src/App.jsx` -- new route `/shared/teammate/:shareToken`
- `src/backend/app/routers/shares.py` -- new endpoint for teammate share token
- Reuse existing video player patterns from SharedVideoOverlay

## Estimate

~250 LOC frontend, ~100 LOC backend, ~80 LOC tests
