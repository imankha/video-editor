# T74: Incremental Framing Export

**Status:** TODO
**Impact:** MEDIUM
**Complexity:** MEDIUM
**Created:** 2026-02-12

## Problem

When re-exporting a multi-clip project after editing just one clip's framing, the entire project is re-processed. For a 5-clip project, editing 1 clip means re-rendering all 5.

## Proposed Solution

Cache individual rendered clips and only re-render clips whose framing changed.

### How It Works

1. **On export**: Store each rendered clip separately in R2
   - Path: `working_clips/{project_id}/clip_{index}_{hash}.mp4`
   - Hash = hash of (crop keyframes, segments, trim, speed, source video)

2. **On re-export**:
   - Compute hash for each clip
   - Compare to cached clips
   - Re-render only clips with changed hash
   - Re-concatenate all clips (fast - no re-encoding)

3. **Cleanup**: Purge cached clips after N days or when project is archived

### Storage Structure

```
R2:
  working_clips/
    {project_id}/
      clip_0_{hash}.mp4
      clip_1_{hash}.mp4
      clip_2_{hash}.mp4
  working_videos/
    working_{project_id}_{uuid}.mp4  (concatenated - could be deleted if we regenerate)
```

### Database Changes

```sql
-- Track cached rendered clips
CREATE TABLE rendered_clip_cache (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  clip_index INTEGER NOT NULL,
  source_hash TEXT NOT NULL,      -- Hash of source video
  framing_hash TEXT NOT NULL,     -- Hash of crop/trim/speed data
  r2_key TEXT NOT NULL,
  duration REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

### Trade-offs

| Pros | Cons |
|------|------|
| Much faster re-exports for 1-clip edits | ~2x storage per project |
| Same Modal GPU cost (pay per frame anyway) | Additional complexity |
| Better UX for iterative editing | Cache invalidation logic |

### Cleanup Strategy

- Purge clips not used in 7 days
- Purge all clips when project is archived
- Or: Don't store concatenated video, regenerate on-demand (saves storage)

## Acceptance Criteria

- [ ] Rendered clips cached in R2 with content hash
- [ ] Re-export only processes changed clips
- [ ] Concatenation uses cached + new clips
- [ ] Cleanup job purges old cached clips
- [ ] Works with both Modal and local GPU

## Notes

- Concatenation with FFmpeg concat demuxer is fast (no re-encoding)
- Hash should include source video hash to detect re-uploads
- Consider storing duration in cache to avoid probing on concat
