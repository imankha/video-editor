# T1581 Design: Storage Extension UX

## Current State

```
GameCard (ProjectManager.jsx:1106)
┌──────────────────────────────────────────┐
│ 🎮 Vs Carlsbad SC Dec 6                 │
│    [New] or [Expired]     [🗑]           │
│    12/06 • 5 clips • 3★ • Quality: 8    │
└──────────────────────────────────────────┘

- "Expired" badge shown when storage_status === 'expired'
- Expired cards are dimmed (opacity-50) and non-clickable
- No way to extend storage or see when a game expires
- Game list does NOT return video_size (needed for cost calc)
```

## Target State

```
GameCard (ProjectManager.jsx)
┌──────────────────────────────────────────┐
│ 🎮 Vs Carlsbad SC Dec 6                 │
│    [New] [12d ⏱]                  [🗑]  │
│    12/06 • 5 clips • 3★ • Quality: 8    │
└──────────────────────────────────────────┘

ExpirationBadge:
  >= 14 days: hidden
  1-13 days: "Nd" yellow/amber
  expired: "Expired" yellow (clickable → extension modal)

Click badge OR expired card → StorageExtensionModal:

┌──────────────────────────────────────────┐
│  Extend Storage                      [✕] │
│──────────────────────────────────────────│
│  Vs Carlsbad SC Dec 6                    │
│  Expires in 12 days (May 14)             │
│                                          │
│  Keep until:                             │
│  |=====[O]===============|               │
│  May 14         ->        May 2, 2027    │
│  (current)              (+1 yr)          │
│                                          │
│  Extension: +52 days → Jul 5              │
│  Game size: 2.5 GB                       │
│  Cost: 1 credit                          │
│                                          │
│  [ Extend Storage - 1 credit ]           │
│  Balance: 12 credits                     │
│                                          │
│  (insufficient? → opens BuyCreditsModal) │
└──────────────────────────────────────────┘
```

## Implementation Plan

### 1. Backend: Add `video_size` to game list response

**File:** `src/backend/app/routers/games.py`

Add `g.video_size` to the list_games query SELECT and include it in the response dict:

```python
# In the SELECT query (~line 630):
g.video_size,

# In the response dict (~line 696):
'video_size': row['video_size'],
```

### 2. Backend: `POST /api/games/{game_id}/extend-storage`

**File:** `src/backend/app/routers/games.py`

```python
class ExtendStorageRequest(BaseModel):
    days: int = Field(..., ge=1, le=365)

@router.post("/{game_id}/extend-storage")
async def extend_game_storage(game_id: int, request: ExtendStorageRequest):
    """Extend storage for a game by N days. Deducts credits."""
    user_id = get_current_user_id()
    profile_id = get_current_profile_id()

    with get_db() as conn:
        cursor = conn.cursor()

        # Get game + current expiry + size
        game = cursor.execute(
            "SELECT id, storage_expires_at, video_size FROM games WHERE id = ?",
            (game_id,)
        ).fetchone()
        if not game:
            raise HTTPException(404, "Game not found")

        game_size = game['video_size'] or 0
        cost = calculate_extension_cost(game_size, request.days)

        # Deduct credits
        result = deduct_credits(user_id, cost, source="storage_extension", reference_id=str(game_id))
        if not result["success"]:
            raise HTTPException(402, {
                "error": "insufficient_credits",
                "required": cost,
                "balance": result["balance"],
            })

        # Compute new expiry: extend from current expiry (or now if expired)
        current_expiry = game['storage_expires_at']
        if current_expiry:
            base = max(datetime.fromisoformat(current_expiry), datetime.utcnow())
        else:
            base = datetime.utcnow()
        new_expiry = storage_expires_at(from_dt=base, days=request.days)
        new_expiry_str = new_expiry.isoformat()

        # Update game
        cursor.execute(
            "UPDATE games SET storage_expires_at = ? WHERE id = ?",
            (new_expiry_str, game_id)
        )
        conn.commit()

    # Update auth_db storage ref (uses blake3_hash from game_videos)
    # Re-insert with new expiry
    with get_db() as conn:
        rows = conn.execute(
            "SELECT blake3_hash, video_size FROM game_videos WHERE game_id = ?",
            (game_id,)
        ).fetchall()
    for vr in rows:
        insert_game_storage_ref(
            user_id, profile_id, vr["blake3_hash"],
            vr["video_size"] or 0, new_expiry_str,
        )

    return {
        "success": True,
        "new_expires_at": new_expiry_str,
        "cost_credits": cost,
        "new_balance": result["balance"],
    }
```

### 3. Frontend: `storageCost.js` — add helpers

**File:** `src/frontend/src/utils/storageCost.js`

```javascript
export function daysPerCredit(fileSizeBytes) {
  const sizeGb = fileSizeBytes / (1024 ** 3);
  if (sizeGb <= 0) return 30;
  return Math.floor(30 * CREDIT_VALUE / (sizeGb * R2_RATE_PER_GB_MONTH * (1 + MARGIN)));
}
```

Examples:
- 2.5 GB → 52 days/credit
- 5.0 GB → 26 days/credit
- 10.0 GB → 13 days/credit

### 5. Frontend: `ExpirationBadge` component

**File:** `src/frontend/src/components/ExpirationBadge.jsx` (new)

Small inline badge showing days remaining. Visible only when < 14 days. Always yellow. Click opens extension modal.

```jsx
function ExpirationBadge({ expiresAt, onClick }) {
  const daysLeft = // compute from expiresAt
  if (daysLeft >= 14) return null;

  const label = daysLeft <= 0 ? 'Expired' : `${daysLeft}d`;

  return (
    <button onClick={onClick} className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400">
      <Clock size={10} /> {label}
    </button>
  );
}
```

### 6. Frontend: `StorageExtensionModal` component

**File:** `src/frontend/src/components/StorageExtensionModal.jsx` (new)

- **Credit-based slider:** steps in increments of `daysPerCredit(videoSize)`. Each step = 1 more credit. Min = 1 credit (1 step), max = enough steps to reach +1 year.
- Slider label shows "N credits → extend until {date}"
- Extend button → `POST /api/games/{game_id}/extend-storage`
- Insufficient credits → open BuyCreditsModal (same frictionless pattern as GameDetailsModal)
- On success → refetch games, toast, close

### 6. Frontend: Integrate into GameCard

**File:** `src/frontend/src/components/ProjectManager.jsx`

- Replace static "Expired" badge with `<ExpirationBadge>`
- Add `extensionGame` state to parent section
- Render `<StorageExtensionModal>` when extensionGame is set
- Make expired cards clickable → open extension modal instead of being disabled

## Risks & Open Questions

1. **Expired card behavior change:** Currently expired cards are `cursor-not-allowed`. New behavior: clicking opens extension modal. User can still see their game data (clips, ratings) but can't load the annotate screen until extended.

2. **Re-activation after extension:** When an expired game is extended, it becomes active again. The video should still be on R2 (daily sweep hasn't deleted it yet). If the video IS already deleted, extension should fail gracefully.
