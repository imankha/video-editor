# Task 07: Annotate Export - Save Clips & Create Projects

## Objective
Update the Annotate export endpoint to:
1. Save 4+ star clips to the database and filesystem
2. Auto-create projects (one "game" project + individual "clip" projects for 5-star)
3. Generate two download files (full annotated + clips compilation with burned-in text)

## Dependencies
- Tasks 01-03 (database and API)
- Backend FFmpeg available

## Files to Modify

### `src/backend/app/routers/annotate.py`

Replace or significantly modify the export endpoint:

```python
"""
Annotate endpoints for the Video Editor API.

This router handles clip extraction from full game footage:
- /api/annotate/export - Export clips, save to DB, create projects
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from starlette.background import BackgroundTask
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any
import json
import os
import tempfile
import uuid
import subprocess
import logging
import re
import io
import base64

from app.database import get_db_connection, RAW_CLIPS_PATH

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/annotate", tags=["annotate"])


def sanitize_filename(name: str) -> str:
    """Sanitize clip name for use as filename."""
    sanitized = name.replace(':', '-')
    sanitized = sanitized.replace(' ', '_')
    sanitized = re.sub(r'[^\w\-.]', '', sanitized)
    if len(sanitized) > 50:
        sanitized = sanitized[:50]
    if not sanitized:
        sanitized = 'clip'
    return sanitized


def format_time_for_ffmpeg(seconds: float) -> str:
    """Convert seconds to HH:MM:SS.mmm format for FFmpeg."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"


def ensure_unique_filename(base_name: str, existing_names: set) -> str:
    """Ensure filename is unique by adding suffix if needed."""
    if base_name not in existing_names:
        return base_name
    counter = 1
    while f"{base_name}_{counter}" in existing_names:
        counter += 1
    return f"{base_name}_{counter}"


async def extract_clip_to_file(
    source_path: str,
    output_path: str,
    start_time: float,
    end_time: float,
    clip_name: str,
    clip_notes: str
) -> bool:
    """Extract a single clip from source video using FFmpeg."""
    duration = end_time - start_time

    cmd = [
        'ffmpeg', '-y',
        '-ss', format_time_for_ffmpeg(start_time),
        '-i', source_path,
        '-t', format_time_for_ffmpeg(duration),
        '-metadata', f'title={clip_name}',
        '-metadata', f'description={clip_notes}',
        '-c', 'copy',
        output_path
    ]

    logger.info(f"Extracting clip: {clip_name} ({start_time:.2f}s - {end_time:.2f}s)")

    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    _, stderr = process.communicate()

    if process.returncode != 0:
        logger.error(f"FFmpeg error: {stderr.decode()}")
        return False
    return True


async def create_clip_with_burned_text(
    source_path: str,
    output_path: str,
    start_time: float,
    end_time: float,
    clip_name: str,
    clip_notes: str,
    rating: int,
    tags: List[str]
) -> bool:
    """
    Extract clip with burned-in text overlay showing annotations.
    """
    duration = end_time - start_time

    # Build text overlay
    rating_stars = '★' * rating + '☆' * (5 - rating)
    tags_text = ', '.join(tags) if tags else ''

    # Escape special characters for FFmpeg drawtext
    def escape_text(text):
        return text.replace("'", "'\\''").replace(":", "\\:")

    # Build filter complex for text overlays
    # Show text in top-left with semi-transparent background
    filter_parts = []

    # Background box for text
    filter_parts.append(
        f"drawbox=x=10:y=10:w=400:h=100:color=black@0.6:t=fill"
    )

    # Clip name (large)
    filter_parts.append(
        f"drawtext=text='{escape_text(clip_name)}':fontsize=24:fontcolor=white:x=20:y=20"
    )

    # Rating stars
    filter_parts.append(
        f"drawtext=text='{rating_stars}':fontsize=20:fontcolor=gold:x=20:y=50"
    )

    # Tags (if any)
    if tags_text:
        filter_parts.append(
            f"drawtext=text='{escape_text(tags_text)}':fontsize=16:fontcolor=white:x=20:y=75"
        )

    # Notes (if any) - shown at bottom
    if clip_notes:
        filter_parts.append(
            f"drawbox=x=10:y=ih-60:w=iw-20:h=50:color=black@0.6:t=fill"
        )
        filter_parts.append(
            f"drawtext=text='{escape_text(clip_notes[:100])}':fontsize=14:fontcolor=white:x=20:y=ih-50"
        )

    filter_complex = ','.join(filter_parts)

    cmd = [
        'ffmpeg', '-y',
        '-ss', format_time_for_ffmpeg(start_time),
        '-i', source_path,
        '-t', format_time_for_ffmpeg(duration),
        '-vf', filter_complex,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-c:a', 'aac',
        output_path
    ]

    logger.info(f"Creating burned-in clip: {clip_name}")

    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    _, stderr = process.communicate()

    if process.returncode != 0:
        logger.error(f"FFmpeg error: {stderr.decode()}")
        return False
    return True


async def concatenate_videos(input_paths: List[str], output_path: str) -> bool:
    """Concatenate multiple video clips into one."""
    if not input_paths:
        return False

    # Create concat file
    concat_file = output_path + '.txt'
    with open(concat_file, 'w') as f:
        for path in input_paths:
            f.write(f"file '{path}'\n")

    cmd = [
        'ffmpeg', '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concat_file,
        '-c', 'copy',
        output_path
    ]

    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    _, stderr = process.communicate()

    # Clean up concat file
    os.remove(concat_file)

    if process.returncode != 0:
        logger.error(f"FFmpeg concat error: {stderr.decode()}")
        return False
    return True


async def create_annotated_source(
    source_path: str,
    output_path: str,
    clips: List[Dict[str, Any]],
    original_filename: str
) -> bool:
    """Create annotated source video with all clip notes embedded in metadata."""
    clips_metadata = {
        'annotate_version': '1.0',
        'original_filename': original_filename,
        'exported_at': datetime.utcnow().isoformat(),
        'clips': [
            {
                'name': clip['name'],
                'start': format_time_for_ffmpeg(clip['start_time']),
                'end': format_time_for_ffmpeg(clip['end_time']),
                'notes': clip.get('notes', ''),
                'rating': clip.get('rating', 3),
                'tags': clip.get('tags', [])
            }
            for clip in clips
        ]
    }

    metadata_json = json.dumps(clips_metadata, ensure_ascii=False)

    cmd = [
        'ffmpeg', '-y',
        '-i', source_path,
        '-metadata', f'description={metadata_json}',
        '-c', 'copy',
        output_path
    ]

    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    _, stderr = process.communicate()

    if process.returncode != 0:
        logger.error(f"FFmpeg error: {stderr.decode()}")
        return False
    return True


def cleanup_temp_dir(temp_dir: str):
    """Clean up temporary directory."""
    import shutil
    try:
        shutil.rmtree(temp_dir)
        logger.info(f"Cleaned up temp directory: {temp_dir}")
    except Exception as e:
        logger.warning(f"Failed to clean up: {e}")


@router.post("/export")
async def export_clips(
    video: UploadFile = File(...),
    clips_json: str = Form(...)
):
    """
    Export clips from source video.

    Clip JSON format:
    [
      {
        "start_time": 150.5,
        "end_time": 165.5,
        "name": "Brilliant Goal",
        "notes": "Amazing finish",
        "rating": 5,
        "tags": ["Goal", "1v1 Attack"]
      }
    ]

    Response:
    - downloads: base64 encoded files for client download
    - created: info about created raw_clips and projects
    """
    # Parse clips JSON
    try:
        clips = json.loads(clips_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid clips JSON")

    if not clips:
        raise HTTPException(status_code=400, detail="No clips defined")

    # Validate clips
    for i, clip in enumerate(clips):
        if 'start_time' not in clip or 'end_time' not in clip:
            raise HTTPException(status_code=400, detail=f"Clip {i} missing times")
        if clip['start_time'] >= clip['end_time']:
            raise HTTPException(status_code=400, detail=f"Clip {i} invalid range")

    # Create temp directory
    temp_dir = tempfile.mkdtemp(prefix="annotate_")
    logger.info(f"Created temp directory: {temp_dir}")

    try:
        # Save uploaded video
        original_filename = video.filename or "source_video.mp4"
        source_path = os.path.join(temp_dir, f"source_{uuid.uuid4().hex[:8]}.mp4")

        with open(source_path, 'wb') as f:
            content = await video.read()
            f.write(content)

        logger.info(f"Saved source video: {len(content)} bytes")

        # Separate clips by rating
        good_clips = [c for c in clips if c.get('rating', 3) >= 4]
        all_clips = clips

        used_names = set()
        created_raw_clips = []
        burned_clip_paths = []

        # Process good/brilliant clips (4+ stars) - save to DB and filesystem
        for clip in good_clips:
            clip_name = clip.get('name', 'clip')
            base_name = sanitize_filename(clip_name)
            unique_name = ensure_unique_filename(base_name, used_names)
            used_names.add(unique_name)

            filename = f"{unique_name}.mp4"
            output_path = str(RAW_CLIPS_PATH / filename)

            # Extract clip to raw_clips folder
            success = await extract_clip_to_file(
                source_path=source_path,
                output_path=output_path,
                start_time=clip['start_time'],
                end_time=clip['end_time'],
                clip_name=clip_name,
                clip_notes=clip.get('notes', '')
            )

            if success:
                # Save to database
                with get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        INSERT INTO raw_clips (filename, rating, tags)
                        VALUES (?, ?, ?)
                    """, (filename, clip['rating'], json.dumps(clip.get('tags', []))))
                    conn.commit()
                    raw_clip_id = cursor.lastrowid

                created_raw_clips.append({
                    'id': raw_clip_id,
                    'filename': filename,
                    'rating': clip['rating'],
                    'name': clip_name,
                    'tags': clip.get('tags', [])
                })

                logger.info(f"Saved raw clip {raw_clip_id}: {filename}")

        # Create projects from the saved clips
        created_projects = []

        if created_raw_clips:
            with get_db_connection() as conn:
                cursor = conn.cursor()

                # 1. Create "game" project with ALL good+brilliant clips
                video_base = os.path.splitext(original_filename)[0]
                game_project_name = f"{sanitize_filename(video_base)}_game"

                cursor.execute("""
                    INSERT INTO projects (name, aspect_ratio)
                    VALUES (?, ?)
                """, (game_project_name, '16:9'))
                game_project_id = cursor.lastrowid

                # Add all clips to game project
                for i, raw_clip in enumerate(created_raw_clips):
                    cursor.execute("""
                        INSERT INTO working_clips (project_id, raw_clip_id, sort_order)
                        VALUES (?, ?, ?)
                    """, (game_project_id, raw_clip['id'], i))

                created_projects.append({
                    'id': game_project_id,
                    'name': game_project_name,
                    'type': 'game',
                    'clip_count': len(created_raw_clips)
                })

                # 2. Create individual projects for BRILLIANT clips (5-star)
                brilliant_clips = [c for c in created_raw_clips if c['rating'] == 5]

                for raw_clip in brilliant_clips:
                    clip_project_name = f"{sanitize_filename(raw_clip['name'])}_clip"

                    cursor.execute("""
                        INSERT INTO projects (name, aspect_ratio)
                        VALUES (?, ?)
                    """, (clip_project_name, '9:16'))
                    clip_project_id = cursor.lastrowid

                    cursor.execute("""
                        INSERT INTO working_clips (project_id, raw_clip_id, sort_order)
                        VALUES (?, ?, ?)
                    """, (clip_project_id, raw_clip['id'], 0))

                    created_projects.append({
                        'id': clip_project_id,
                        'name': clip_project_name,
                        'type': 'clip',
                        'clip_count': 1
                    })

                conn.commit()

        # Generate downloads

        # 1. Full video with metadata annotations
        annotated_filename = f"{sanitize_filename(video_base)}_annotated.mp4"
        annotated_path = os.path.join(temp_dir, annotated_filename)

        await create_annotated_source(
            source_path=source_path,
            output_path=annotated_path,
            clips=all_clips,
            original_filename=original_filename
        )

        with open(annotated_path, 'rb') as f:
            annotated_data = base64.b64encode(f.read()).decode('utf-8')

        # 2. Clips compilation with burned-in text (ALL annotated clips)
        for clip in all_clips:
            clip_name = clip.get('name', 'clip')
            burned_path = os.path.join(temp_dir, f"burned_{uuid.uuid4().hex[:8]}.mp4")

            success = await create_clip_with_burned_text(
                source_path=source_path,
                output_path=burned_path,
                start_time=clip['start_time'],
                end_time=clip['end_time'],
                clip_name=clip_name,
                clip_notes=clip.get('notes', ''),
                rating=clip.get('rating', 3),
                tags=clip.get('tags', [])
            )

            if success:
                burned_clip_paths.append(burned_path)

        # Concatenate burned clips
        compilation_data = None
        if burned_clip_paths:
            compilation_path = os.path.join(temp_dir, "clips_compilation.mp4")
            if await concatenate_videos(burned_clip_paths, compilation_path):
                with open(compilation_path, 'rb') as f:
                    compilation_data = base64.b64encode(f.read()).decode('utf-8')

        logger.info(f"Export complete: {len(created_raw_clips)} clips saved, {len(created_projects)} projects created")

        return JSONResponse({
            'success': True,
            'downloads': {
                'full_annotated': {
                    'filename': annotated_filename,
                    'data': annotated_data
                },
                'clips_compilation': {
                    'filename': f"{sanitize_filename(video_base)}_clips_review.mp4",
                    'data': compilation_data
                } if compilation_data else None
            },
            'created': {
                'raw_clips': created_raw_clips,
                'projects': created_projects
            }
        }, background=BackgroundTask(cleanup_temp_dir, temp_dir))

    except HTTPException:
        cleanup_temp_dir(temp_dir)
        raise
    except Exception as e:
        logger.error(f"Export error: {e}")
        cleanup_temp_dir(temp_dir)
        raise HTTPException(status_code=500, detail=str(e))
```

## Testing Steps

### 1. Prepare Test Video

Have a test video file ready (any video, at least 30 seconds long).

### 2. Test Export API Directly

```bash
# Create test clips JSON
cat > /tmp/clips.json << 'EOF'
[
  {
    "start_time": 0,
    "end_time": 5,
    "name": "Good Play",
    "notes": "Nice pass",
    "rating": 4,
    "tags": ["Pass"]
  },
  {
    "start_time": 5,
    "end_time": 10,
    "name": "Brilliant Goal",
    "notes": "Amazing finish from distance",
    "rating": 5,
    "tags": ["Goal", "1v1 Attack"]
  },
  {
    "start_time": 10,
    "end_time": 15,
    "name": "Interesting Moment",
    "notes": "Could be useful",
    "rating": 3,
    "tags": []
  }
]
EOF

# Call the export endpoint
curl -X POST http://localhost:8000/api/annotate/export \
  -F "video=@/path/to/test-video.mp4" \
  -F "clips_json=$(cat /tmp/clips.json)" \
  -o response.json
```

### 3. Verify Response Structure

```bash
# Check response (without the large base64 data)
cat response.json | python -c "
import json, sys
data = json.load(sys.stdin)
print('Success:', data['success'])
print('Downloads:', list(data['downloads'].keys()))
print('Raw clips:', len(data['created']['raw_clips']))
print('Projects:', len(data['created']['projects']))
for p in data['created']['projects']:
    print(f\"  - {p['name']} ({p['type']}, {p['clip_count']} clips)\")
"
```

Expected output:
```
Success: True
Downloads: ['full_annotated', 'clips_compilation']
Raw clips: 2
Projects: 2
  - test-video_game (game, 2 clips)
  - Brilliant_Goal_clip (clip, 1 clips)
```

### 4. Verify Database Entries

```bash
sqlite3 user_data/a/database.sqlite << 'EOF'
.headers on
SELECT * FROM raw_clips;
SELECT * FROM projects;
SELECT * FROM working_clips;
EOF
```

Expected:
- 2 raw_clips (rating 4 and 5)
- 2 projects (one game, one clip)
- 3 working_clips (2 in game project, 1 in clip project)

### 5. Verify Files Saved

```bash
ls -la user_data/a/raw_clips/
```

Should see 2 .mp4 files.

### 6. Verify Download Files

Extract and verify the base64-encoded files:

```bash
# Extract the annotated video
cat response.json | python -c "
import json, sys, base64
data = json.load(sys.stdin)
with open('annotated.mp4', 'wb') as f:
    f.write(base64.b64decode(data['downloads']['full_annotated']['data']))
"

# Play it
ffplay annotated.mp4
```

### 7. Verify Burned-in Text

```bash
# Extract the clips compilation
cat response.json | python -c "
import json, sys, base64
data = json.load(sys.stdin)
with open('compilation.mp4', 'wb') as f:
    f.write(base64.b64decode(data['downloads']['clips_compilation']['data']))
"

# Play it - should see text overlays
ffplay compilation.mp4
```

## Success Criteria

- [ ] Export endpoint accepts video + clips_json
- [ ] Only 4+ star clips saved to raw_clips table
- [ ] Clip files saved to user_data/a/raw_clips/
- [ ] "Game" project created with all good+brilliant clips
- [ ] Individual projects created for each 5-star clip
- [ ] Working clips created linking raw clips to projects
- [ ] Full annotated video has metadata
- [ ] Clips compilation has burned-in text showing name, rating, tags, notes
- [ ] Response includes base64 data for both downloads
- [ ] Response includes info about created clips and projects
