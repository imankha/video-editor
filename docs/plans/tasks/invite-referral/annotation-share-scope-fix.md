# Fix: Share w/Tagged Teammates Scope for Recipients

## Branch

`feature/T2910-referral-graph` (continue on this branch -- changes are additive)

## Problem

When a user receives shared annotation clips (e.g., a coach receiving clips from a player's parent), the "Share w/Tagged Teammates" button is **enabled** and shows the **original sharer's teammate tags and email mappings** as options. This is wrong -- the recipient hasn't tagged anyone themselves.

**Expected behavior:**
1. "Share w/Tagged Teammates" button should be **disabled** until the recipient tags their own teammates on clips
2. The email send list should only show teammates the **recipient** has tagged, not inherited tags from the sharer

## Root Cause

The materialization pipeline copies `tagged_teammates` blobs into the recipient's `raw_clips`, but these are **inherited athlete names** (who's in the play), NOT the recipient's own teammate tags. The frontend conflates the two:

### Data flow (current, broken)

```
SHARER'S DB:
  raw_clips.tagged_teammates = msgpack(["Jake", "Sam"])   <-- athlete names on this play
  clip_teammates table: {clip_id: 1, tag_name: "Jake"}    <-- junction for filtering
  teammate_emails table: {tag_name: "Jake", email: "jake@parent.com"}

MATERIALIZATION (_materialize_clips):
  --> copies tagged_teammates blob into recipient's raw_clips  ✓ (this is correct -- shows who's in the play)
  --> does NOT copy clip_teammates junction rows               ✓ (correct -- recipient didn't tag anyone)
  --> does NOT copy teammate_emails rows                       ✓ (correct -- recipient has no email mappings)

RECIPIENT'S FRONTEND (AnnotateScreen.jsx:267-276):
  clipRegions.forEach(r => {
    (r.tagged_teammates || []).forEach(tag => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  hasTaggedClips = Object.keys(tagCounts).length > 0;  // TRUE because inherited tags exist!
  --> "Share w/Tagged Teammates" button appears enabled
  --> Modal opens showing inherited tag names as if recipient tagged them
```

### The conflation

`tagged_teammates` on `raw_clips` serves two purposes that should be separate:
1. **Display**: Show which athletes are in this play (for the clip details UI)
2. **Share gating**: Determine if the user has tagged teammates to share with

For the sharer, these are the same data. For the recipient, they're different -- the recipient sees athlete names from the sharer's clips but hasn't tagged anyone themselves.

## Fix

### Frontend: Gate the share button on recipient's OWN tags, not inherited ones

The share button should be enabled based on the `clip_teammates` junction table (which only has rows when the USER personally tags clips), NOT the `tagged_teammates` blob (which contains inherited athlete names from shares).

**Option A (simplest):** Use the existing `GET /api/clips/teammate-tags` endpoint response to determine `hasTaggedClips`. This endpoint queries the `clip_teammates` junction table, which only has entries for clips the user personally tagged.

In [AnnotateScreen.jsx:267-276](src/frontend/src/screens/AnnotateScreen.jsx#L267-L276), change the logic:

```javascript
// CURRENT (broken): uses tagged_teammates blob from all clips including shared
const tagCounts = useMemo(() => {
  const counts = {};
  clipRegions.forEach(r => {
    (r.tagged_teammates || []).forEach(tag => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  return counts;
}, [clipRegions]);
const hasTaggedClips = Object.keys(tagCounts).length > 0;
```

The `tagCounts` memo is correct for determining WHICH tags exist and how many clips each tag has -- it's used by the ShareWithTeammatesModal. But `hasTaggedClips` (which gates the button) should also require that the user has their OWN tags, not just inherited ones.

The simplest approach: filter out clips that have `shared_by` set when computing `tagCounts` for the share button. If the user ALSO tagged received clips (e.g., a coach tagging additional players), those would show up in `clip_teammates` and should be included.

```javascript
// FIX: Only count tags from clips the user owns (not received shares)
const ownTagCounts = useMemo(() => {
  const counts = {};
  clipRegions.forEach(r => {
    if (r.shared_by) return;  // skip inherited clips
    (r.tagged_teammates || []).forEach(tag => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  return counts;
}, [clipRegions]);
const hasTaggedClips = Object.keys(ownTagCounts).length > 0;
```

The `shared_by` field is already loaded into clip regions. Check [useAnnotate.js:692](src/frontend/src/modes/annotate/hooks/useAnnotate.js#L692):
```javascript
shared_by: annotation.shared_by ?? null,
```

And displayed in [ClipDetailsEditor.jsx:195-198](src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx#L195-L198):
```jsx
{region.shared_by && (
  <span className="text-white text-xs font-medium">{region.shared_by}</span>
)}
```

**Also update** `tagClipIds` (line 278-286) with the same `shared_by` filter, so the modal only shows the user's own tagged clips.

### Frontend: ShareWithTeammatesModal email list

[ShareWithTeammatesModal.jsx:44](src/frontend/src/components/ShareWithTeammatesModal.jsx#L44) fetches `GET /api/clips/teammate-emails`. This endpoint returns all email mappings from the profile DB. Since materialization doesn't copy `teammate_emails` rows, this should already be empty for a pure recipient. But verify:

- If the recipient has NEVER used `PUT /api/clips/teammate-emails` to save mappings, the table is empty -- the modal would have no email suggestions. This is correct.
- If somehow `teammate_emails` rows leak into the recipient's DB, the backend endpoint would need filtering. But this shouldn't happen with the current code.

### No backend changes needed

The backend is already correct:
- `GET /api/clips/teammate-tags` queries `clip_teammates` junction table -- only has rows for clips the user personally tagged
- `GET /api/clips/teammate-emails` queries `teammate_emails` table -- only has rows the user explicitly saved
- Materialization correctly copies `tagged_teammates` blob (display data) without copying `clip_teammates` or `teammate_emails` (user action data)

The fix is purely frontend: don't let inherited `tagged_teammates` blobs gate the share button.

## Files to Modify

| File | Change |
|------|--------|
| [AnnotateScreen.jsx:267-286](src/frontend/src/screens/AnnotateScreen.jsx#L267-L286) | Filter `shared_by` clips from `tagCounts` and `tagClipIds` used for share gating |

## Testing

1. **Recipient with only shared clips**: Log in as a user who received shared clips. "Share w/Tagged Teammates" button should be disabled/hidden. Clips should still show athlete names in the details panel.
2. **Recipient who also tags their own clips**: If the recipient uploads their own game AND tags teammates, the button should appear for THAT game only.
3. **Sharer (no regression)**: The sharer's "Share w/Tagged Teammates" flow should work exactly as before -- their clips don't have `shared_by` set, so the filter is a no-op.

### Quick verification

After the fix, test by:
1. Sharing annotations from imankh@gmail.com to iman@launchitlabs.io
2. Opening as iman@launchitlabs.io
3. Verifying the "Share w/Tagged Teammates" button is disabled
4. Verifying the clip details still show athlete names (the `tagged_teammates` display data is unaffected)

### Run existing tests

```bash
cd src/frontend && npm test -- --run ShareWithTeammatesModal
cd src/frontend && npm test -- --run AnnotateScreen
```

## Key Code Locations

| What | Where |
|------|-------|
| Share button gate | [AnnotateScreen.jsx:276](src/frontend/src/screens/AnnotateScreen.jsx#L276) `hasTaggedClips` |
| Tag count computation | [AnnotateScreen.jsx:267-275](src/frontend/src/screens/AnnotateScreen.jsx#L267-L275) `tagCounts` memo |
| Tag clip IDs | [AnnotateScreen.jsx:278-286](src/frontend/src/screens/AnnotateScreen.jsx#L278-L286) `tagClipIds` memo |
| Share modal render gate | [AnnotateScreen.jsx:648](src/frontend/src/screens/AnnotateScreen.jsx#L648) `showShareModal && hasTaggedClips` |
| Modal component | [ShareWithTeammatesModal.jsx](src/frontend/src/components/ShareWithTeammatesModal.jsx) |
| `shared_by` in clip data | [useAnnotate.js:692](src/frontend/src/modes/annotate/hooks/useAnnotate.js#L692) |
| `shared_by` display | [ClipDetailsEditor.jsx:195-198](src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx#L195-L198) |
| Backend teammate-tags | [clips.py:1990-2001](src/backend/app/routers/clips.py#L1990-L2001) queries `clip_teammates` (correct) |
| Backend teammate-emails | [clips.py:2004-2026](src/backend/app/routers/clips.py#L2004-L2026) queries `teammate_emails` (correct) |
| Materialization insert | [materialization.py:229-257](src/backend/app/services/materialization.py#L229-L257) `_insert_clip()` copies `tagged_teammates` blob, does NOT write `clip_teammates` |
| Materialization merge | [materialization.py:276-339](src/backend/app/services/materialization.py#L276-L339) `_materialize_clips()` unions athlete lists on overlap |
