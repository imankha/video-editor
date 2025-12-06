# Multi-Clip Backend Export Implementation

## Overview

Implement the backend `/api/export/multi-clip` endpoint that processes multiple video clips with independent crop/trim/speed settings and concatenates them with transitions.

## Current Architecture Understanding

### Existing Components

1. **`AIVideoUpscaler`** (`app/ai_upscaler/__init__.py`)
   - Main entry point for video processing
   - `process_video_with_upscale()` - processes a single video with keyframes
   - Handles: crop interpolation, AI upscaling, segment speed changes, trim optimization

2. **`VideoEncoder`** (`app/ai_upscaler/video_encoder.py`)
   - FFmpeg-based encoding with segment speed support
   - `create_video_from_frames()` - assembles frames into video
   - Handles: frame interpolation, audio tempo changes, multi-pass encoding

3. **`FrameProcessor`** (`app/ai_upscaler/frame_processor.py`)
   - Single frame processing with crop/upscale
   - Multi-GPU parallel processing support

4. **Export Router** (`app/routers/export.py`)
   - `/api/export/upscale` - single video export with AI upscaling
   - `/api/export/overlay` - overlay-only export

### Current Single-Clip Flow

```
Frontend → POST /api/export/upscale
         ├── Upload video file
         ├── Parse keyframes_json (crop keyframes)
         ├── Parse segment_data_json (speed/trim)
         └── AIVideoUpscaler.process_video_with_upscale()
              ├── Extract frames with crop (de-zoom)
              ├── AI upscale each frame
              └── VideoEncoder.create_video_from_frames()
                   ├── Apply segment speeds
                   ├── Apply trim
                   └── Encode final video
```

## Multi-Clip Export Requirements

### Input Format

The frontend sends:
- Multiple video files as `video_0`, `video_1`, `video_2`, etc.
- JSON data structure:

```json
{
  "clips": [
    {
      "clipIndex": 0,
      "fileName": "video1.mp4",
      "duration": 12.3,
      "sourceWidth": 1920,
      "sourceHeight": 1080,
      "segments": {
        "boundaries": [0, 12.3],
        "trimRange": null,
        "segmentSpeeds": {}
      },
      "cropKeyframes": [
        { "time": 0, "x": 100, "y": 50, "width": 608, "height": 1080 },
        { "time": 12.3, "x": 200, "y": 50, "width": 608, "height": 1080 }
      ],
      "trimRange": null
    },
    {
      "clipIndex": 1,
      "fileName": "video2.mp4",
      ...
    }
  ],
  "globalAspectRatio": "9:16",
  "transition": {
    "type": "fade",    // "cut" | "fade" | "dissolve"
    "duration": 0.5    // seconds
  }
}
```

### Output

Single concatenated video with:
- Each clip processed with its own crop/trim/speed settings
- All clips at same resolution (derived from globalAspectRatio)
- Transitions between clips

## Implementation Plan

### Step 1: Update Endpoint Signature

Modify `export_multi_clip` to accept multiple video files:

```python
from fastapi import Request

@router.post("/multi-clip")
async def export_multi_clip(
    request: Request,
    export_id: str = Form(...),
    multi_clip_data_json: str = Form(...),
    include_audio: str = Form("true"),
    target_fps: int = Form(30),
    export_mode: str = Form("fast"),
):
    # Parse form data to get video files
    form = await request.form()

    # Extract video files (video_0, video_1, etc.)
    video_files = {}
    for key, value in form.items():
        if key.startswith('video_'):
            index = int(key.split('_')[1])
            video_files[index] = value  # UploadFile object
```

### Step 2: Process Each Clip Independently

For each clip:
1. Save uploaded file to temp directory
2. Parse clip's crop keyframes and segment data
3. Call `AIVideoUpscaler.process_video_with_upscale()` with clip-specific settings
4. Output to temporary file

```python
async def process_single_clip(
    clip_data: dict,
    video_file: UploadFile,
    temp_dir: str,
    target_resolution: tuple,
    target_fps: int,
    export_mode: str,
    include_audio: bool,
    progress_callback
) -> str:
    """
    Process a single clip with its crop/trim/speed settings.
    Returns path to processed clip.
    """
    clip_index = clip_data['clipIndex']

    # Save video to temp
    input_path = os.path.join(temp_dir, f"input_{clip_index}.mp4")
    with open(input_path, 'wb') as f:
        content = await video_file.read()
        f.write(content)

    # Output path for this clip
    output_path = os.path.join(temp_dir, f"processed_{clip_index}.mp4")

    # Convert crop keyframes to expected format
    keyframes = [
        {
            'time': kf['time'],
            'x': kf['x'],
            'y': kf['y'],
            'width': kf['width'],
            'height': kf['height']
        }
        for kf in clip_data.get('cropKeyframes', [])
    ]

    # Build segment_data from clip's segments
    segment_data = None
    if clip_data.get('segments'):
        segments = clip_data['segments']
        trim_range = clip_data.get('trimRange')

        segment_data = {}
        if trim_range:
            segment_data['trim_start'] = trim_range['start']
            segment_data['trim_end'] = trim_range['end']

        # Convert segment speeds if present
        if segments.get('segmentSpeeds'):
            # Build segments array from boundaries + speeds
            boundaries = segments.get('boundaries', [])
            speeds = segments.get('segmentSpeeds', {})

            segment_list = []
            for i in range(len(boundaries) - 1):
                segment_list.append({
                    'start': boundaries[i],
                    'end': boundaries[i + 1],
                    'speed': speeds.get(str(i), 1.0)
                })
            segment_data['segments'] = segment_list

    # Process with AIVideoUpscaler
    upscaler = AIVideoUpscaler(
        device='cuda',
        export_mode=export_mode,
        sr_model_name='realesr_general_x4v3'
    )

    result = upscaler.process_video_with_upscale(
        input_path=input_path,
        output_path=output_path,
        keyframes=keyframes,
        target_fps=target_fps,
        export_mode=export_mode,
        progress_callback=progress_callback,
        segment_data=segment_data,
        include_audio=include_audio
    )

    return output_path
```

### Step 3: Calculate Consistent Target Resolution

All clips must have the same output resolution:

```python
def calculate_multi_clip_resolution(
    clips_data: list,
    global_aspect_ratio: str
) -> tuple:
    """
    Calculate target resolution for all clips based on global aspect ratio.
    Uses the smallest crop dimensions across all clips to determine base size.
    """
    # Parse aspect ratio
    ratio_w, ratio_h = map(int, global_aspect_ratio.split(':'))
    target_ratio = ratio_w / ratio_h

    # Find minimum crop size across all clips
    min_crop_width = float('inf')
    min_crop_height = float('inf')

    for clip in clips_data:
        for kf in clip.get('cropKeyframes', []):
            min_crop_width = min(min_crop_width, kf['width'])
            min_crop_height = min(min_crop_height, kf['height'])

    # Calculate target resolution (4x upscale, capped at 1440p)
    sr_w = int(min_crop_width * 4)
    sr_h = int(min_crop_height * 4)

    max_w, max_h = 2560, 1440
    scale_limit = min(max_w / sr_w, max_h / sr_h, 1.0)

    target_w = int(sr_w * scale_limit)
    target_h = int(sr_h * scale_limit)

    # Ensure even dimensions
    target_w = target_w - (target_w % 2)
    target_h = target_h - (target_h % 2)

    return (target_w, target_h)
```

### Step 4: Concatenate Clips with Transitions

Use FFmpeg to concatenate processed clips:

```python
def concatenate_clips_with_transition(
    clip_paths: list,
    output_path: str,
    transition: dict,
    include_audio: bool = True
) -> None:
    """
    Concatenate processed clips with transitions.

    Transition types:
    - "cut": Simple concatenation (no transition effect)
    - "fade": Fade to black between clips
    - "dissolve": Cross-dissolve between clips
    """
    transition_type = transition.get('type', 'cut')
    transition_duration = transition.get('duration', 0.5)

    if transition_type == 'cut' or len(clip_paths) == 1:
        # Simple concatenation using concat demuxer
        concat_file = os.path.join(os.path.dirname(output_path), 'concat.txt')
        with open(concat_file, 'w') as f:
            for path in clip_paths:
                f.write(f"file '{path}'\n")

        cmd = [
            'ffmpeg', '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', concat_file,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '18',
            '-c:a', 'aac' if include_audio else '-an',
            output_path
        ]
        subprocess.run(cmd, check=True)

    elif transition_type == 'fade':
        # Fade to black between clips
        # This requires complex filtergraph
        filter_complex = build_fade_transition_filter(
            clip_paths, transition_duration
        )
        run_ffmpeg_with_filter(clip_paths, output_path, filter_complex, include_audio)

    elif transition_type == 'dissolve':
        # Cross-dissolve between clips
        filter_complex = build_dissolve_transition_filter(
            clip_paths, transition_duration
        )
        run_ffmpeg_with_filter(clip_paths, output_path, filter_complex, include_audio)


def build_fade_transition_filter(clip_paths: list, fade_duration: float) -> str:
    """
    Build FFmpeg filter for fade to black transitions.

    For each clip (except last):
    - Fade out last {fade_duration} seconds
    For each clip (except first):
    - Fade in first {fade_duration} seconds
    Then concatenate.
    """
    # Get clip durations using ffprobe
    durations = []
    for path in clip_paths:
        probe = ffmpeg.probe(path)
        duration = float(probe['format']['duration'])
        durations.append(duration)

    filter_parts = []
    output_labels = []
    audio_labels = []

    for i, (path, dur) in enumerate(zip(clip_paths, durations)):
        is_first = (i == 0)
        is_last = (i == len(clip_paths) - 1)

        # Video filter
        video_filter = f"[{i}:v]"

        if not is_last:
            # Fade out at end
            fade_start = dur - fade_duration
            video_filter += f"fade=t=out:st={fade_start}:d={fade_duration}"

        if not is_first:
            # Fade in at start
            if not is_last:
                video_filter += ","
            video_filter += f"fade=t=in:st=0:d={fade_duration}"

        video_filter += f"[v{i}]"
        filter_parts.append(video_filter)
        output_labels.append(f"[v{i}]")

        # Audio filter (similar fade)
        audio_filter = f"[{i}:a]"
        if not is_last:
            audio_filter += f"afade=t=out:st={dur - fade_duration}:d={fade_duration}"
        if not is_first:
            if not is_last:
                audio_filter += ","
            audio_filter += f"afade=t=in:st=0:d={fade_duration}"
        audio_filter += f"[a{i}]"
        filter_parts.append(audio_filter)
        audio_labels.append(f"[a{i}]")

    # Concatenate
    video_concat = ''.join(output_labels) + f"concat=n={len(clip_paths)}:v=1:a=0[outv]"
    audio_concat = ''.join(audio_labels) + f"concat=n={len(clip_paths)}:v=0:a=1[outa]"

    filter_parts.append(video_concat)
    filter_parts.append(audio_concat)

    return ';'.join(filter_parts)


def build_dissolve_transition_filter(clip_paths: list, dissolve_duration: float) -> str:
    """
    Build FFmpeg filter for cross-dissolve transitions.

    Uses xfade filter between consecutive clips.
    Note: xfade requires clips to have same resolution and pixel format.
    """
    # Get clip durations
    durations = []
    for path in clip_paths:
        probe = ffmpeg.probe(path)
        duration = float(probe['format']['duration'])
        durations.append(duration)

    # Build xfade chain
    # [0:v][1:v]xfade=transition=dissolve:duration=0.5:offset=D0[v01]
    # [v01][2:v]xfade=transition=dissolve:duration=0.5:offset=D1[v012]
    # etc.

    filter_parts = []
    current_label = "[0:v]"
    cumulative_duration = durations[0]

    for i in range(1, len(clip_paths)):
        offset = cumulative_duration - dissolve_duration
        output_label = f"[v{i}]" if i < len(clip_paths) - 1 else "[outv]"

        filter_parts.append(
            f"{current_label}[{i}:v]xfade=transition=dissolve:duration={dissolve_duration}:offset={offset}{output_label}"
        )

        current_label = output_label
        cumulative_duration += durations[i] - dissolve_duration

    # Audio crossfade using acrossfade
    current_audio = "[0:a]"
    for i in range(1, len(clip_paths)):
        output_label = f"[a{i}]" if i < len(clip_paths) - 1 else "[outa]"
        filter_parts.append(
            f"{current_audio}[{i}:a]acrossfade=d={dissolve_duration}{output_label}"
        )
        current_audio = output_label

    return ';'.join(filter_parts)
```

### Step 5: Complete Endpoint Implementation

```python
@router.post("/multi-clip")
async def export_multi_clip(
    request: Request,
    export_id: str = Form(...),
    multi_clip_data_json: str = Form(...),
    include_audio: str = Form("true"),
    target_fps: int = Form(30),
    export_mode: str = Form("fast"),
):
    """
    Export multiple video clips with transitions.
    """
    import shutil

    # Initialize progress
    export_progress[export_id] = {
        "progress": 5,
        "message": "Starting multi-clip export...",
        "status": "processing"
    }

    # Parse form data
    form = await request.form()

    # Extract video files
    video_files = {}
    for key, value in form.multi_items():
        if key.startswith('video_'):
            index = int(key.split('_')[1])
            video_files[index] = value

    # Parse multi-clip data
    multi_clip_data = json.loads(multi_clip_data_json)
    clips_data = multi_clip_data.get('clips', [])
    global_aspect_ratio = multi_clip_data.get('globalAspectRatio', '9:16')
    transition = multi_clip_data.get('transition', {'type': 'cut', 'duration': 0.5})

    include_audio_bool = include_audio.lower() == "true"

    # Validate
    if len(video_files) != len(clips_data):
        raise HTTPException(
            status_code=400,
            detail=f"Mismatch: {len(video_files)} videos but {len(clips_data)} clip configs"
        )

    # Create temp directory
    temp_dir = tempfile.mkdtemp()

    try:
        # Calculate consistent target resolution
        target_resolution = calculate_multi_clip_resolution(clips_data, global_aspect_ratio)
        logger.info(f"[Multi-Clip] Target resolution: {target_resolution}")

        # Process each clip
        processed_paths = []
        total_clips = len(clips_data)

        for i, clip_data in enumerate(sorted(clips_data, key=lambda x: x['clipIndex'])):
            clip_index = clip_data['clipIndex']
            video_file = video_files.get(clip_index)

            if not video_file:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing video file for clip {clip_index}"
                )

            # Update progress
            base_progress = 10 + int((i / total_clips) * 70)
            progress_data = {
                "progress": base_progress,
                "message": f"Processing clip {i + 1}/{total_clips}...",
                "status": "processing"
            }
            export_progress[export_id] = progress_data
            await manager.send_progress(export_id, progress_data)

            # Progress callback for this clip
            loop = asyncio.get_running_loop()
            def clip_progress_callback(current, total, message, phase='ai_upscale'):
                clip_start = 10 + int((i / total_clips) * 70)
                clip_end = 10 + int(((i + 1) / total_clips) * 70)
                clip_progress = clip_start + int((current / total) * (clip_end - clip_start))

                progress_data = {
                    "progress": clip_progress,
                    "message": f"Clip {i + 1}/{total_clips}: {message}",
                    "status": "processing"
                }
                export_progress[export_id] = progress_data

                asyncio.run_coroutine_threadsafe(
                    manager.send_progress(export_id, progress_data),
                    loop
                )

            # Process this clip
            output_path = await process_single_clip(
                clip_data=clip_data,
                video_file=video_file,
                temp_dir=temp_dir,
                target_resolution=target_resolution,
                target_fps=target_fps,
                export_mode=export_mode,
                include_audio=include_audio_bool,
                progress_callback=clip_progress_callback
            )

            processed_paths.append(output_path)
            logger.info(f"[Multi-Clip] Clip {clip_index} processed: {output_path}")

        # Concatenate clips
        progress_data = {
            "progress": 85,
            "message": "Concatenating clips...",
            "status": "processing"
        }
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        final_output = os.path.join(temp_dir, f"final_{export_id}.mp4")
        concatenate_clips_with_transition(
            clip_paths=processed_paths,
            output_path=final_output,
            transition=transition,
            include_audio=include_audio_bool
        )

        logger.info(f"[Multi-Clip] Final output: {final_output}")

        # Complete
        progress_data = {
            "progress": 100,
            "message": "Export complete!",
            "status": "complete"
        }
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        # Return the file
        def cleanup():
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)

        return FileResponse(
            final_output,
            media_type='video/mp4',
            filename=f"multi_clip_{export_id}.mp4",
            background=BackgroundTask(cleanup)
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Multi-Clip] Export failed: {str(e)}", exc_info=True)
        error_data = {
            "progress": 0,
            "message": f"Export failed: {str(e)}",
            "status": "error"
        }
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

        raise HTTPException(status_code=500, detail=str(e))
```

## Testing Checklist

1. [ ] Single clip export still works (regression test)
2. [ ] Two clips with "cut" transition
3. [ ] Two clips with "fade" transition
4. [ ] Two clips with "dissolve" transition
5. [ ] Three+ clips concatenation
6. [ ] Different source resolutions (should normalize)
7. [ ] Clips with different trim settings
8. [ ] Clips with speed changes (0.5x slow-mo)
9. [ ] Audio handling across clips
10. [ ] Progress tracking across multiple clips
11. [ ] Error handling (missing video, invalid keyframes)
12. [ ] Cleanup of temp files on success and failure

## Performance Considerations

1. **Parallel Processing**: Consider processing clips in parallel if GPU memory allows
2. **Disk Space**: Multiple large videos + processed clips need significant temp space
3. **Memory**: Each clip processing loads a new AIVideoUpscaler instance
4. **Progress Granularity**: Update progress for each clip's sub-operations

## Future Enhancements

1. **Custom transitions**: Support custom xfade transitions (wipe, fade, etc.)
2. **Per-clip transition**: Different transitions between different clips
3. **Preview generation**: Low-res preview before full export
4. **Resume support**: Continue interrupted multi-clip export
