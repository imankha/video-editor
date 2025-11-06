from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from datetime import datetime
import ffmpeg
import json
import os
import tempfile
import uuid
import traceback
import sys
from pathlib import Path
from typing import List, Dict, Any

# Environment detection
ENV = os.getenv("ENV", "development")  # "development" or "production"
IS_DEV = ENV == "development"

app = FastAPI(
    title="Video Editor API",
    version="0.1.0",
    description="Backend API for video editing application"
)

# Configure CORS to allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # Alternative port
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Custom exception handler for development mode
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """
    Global exception handler that provides detailed errors in dev mode
    and sanitized errors in production
    """
    if IS_DEV:
        # Development: return full error details with stack trace
        error_detail = {
            "error": type(exc).__name__,
            "message": str(exc),
            "traceback": traceback.format_exception(type(exc), exc, exc.__traceback__),
            "request_url": str(request.url),
            "method": request.method
        }
        return JSONResponse(
            status_code=500,
            content=error_detail
        )
    else:
        # Production: return sanitized error
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal Server Error",
                "message": "An error occurred while processing your request"
            }
        )



# Response model
class HelloResponse(BaseModel):
    message: str
    timestamp: str
    tech_stack: dict
    fun_fact: str


@app.get("/")
async def root():
    """Root endpoint - API info"""
    return {
        "message": "Video Editor API is running! 🚀",
        "version": "0.1.0",
        "status": "healthy",
        "docs": "/docs"
    }


@app.get("/api/hello", response_model=HelloResponse)
async def hello_world():
    """
    Hello World endpoint that demonstrates:
    - FastAPI (Python web framework)
    - Pydantic (data validation)
    - Async/await support
    """
    return HelloResponse(
        message="Hello from FastAPI + Python! 🐍",
        timestamp=datetime.now().isoformat(),
        tech_stack={
            "backend": "FastAPI",
            "language": "Python 3.11+",
            "async": True,
            "validation": "Pydantic"
        },
        fun_fact="FastAPI is one of the fastest Python frameworks, thanks to Starlette and Pydantic!"
    )


@app.get("/api/status")
async def get_status():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "video-editor-api",
        "timestamp": datetime.now().isoformat()
    }


# Crop Export Models
class CropKeyframe(BaseModel):
    time: float
    x: int
    y: int
    width: int
    height: int


class CropExportRequest(BaseModel):
    keyframes: List[CropKeyframe]


def interpolate_crop(keyframes: List[Dict[str, Any]], time: float) -> Dict[str, float]:
    """
    Interpolate crop values between keyframes for a given time
    """
    if len(keyframes) == 0:
        raise ValueError("No keyframes provided")

    if len(keyframes) == 1:
        return keyframes[0]

    # Find surrounding keyframes
    before_kf = None
    after_kf = None

    for kf in keyframes:
        if kf['time'] <= time:
            before_kf = kf
        if kf['time'] > time and after_kf is None:
            after_kf = kf
            break

    # If before first keyframe, return first
    if before_kf is None:
        return keyframes[0]

    # If after last keyframe, return last
    if after_kf is None:
        return before_kf

    # Linear interpolation between keyframes
    duration = after_kf['time'] - before_kf['time']
    progress = (time - before_kf['time']) / duration

    return {
        'x': before_kf['x'] + (after_kf['x'] - before_kf['x']) * progress,
        'y': before_kf['y'] + (after_kf['y'] - before_kf['y']) * progress,
        'width': before_kf['width'] + (after_kf['width'] - before_kf['width']) * progress,
        'height': before_kf['height'] + (after_kf['height'] - before_kf['height']) * progress
    }


def generate_crop_filter(keyframes: List[Dict[str, Any]], duration: float, fps: float = 30.0) -> Dict[str, Any]:
    """
    Generate FFmpeg crop filter with keyframe interpolation

    Returns:
        dict: Contains both filter string and structured parameters
            {
                'filter_string': str,  # Complete filter string for logging
                'width_expr': str,     # Width expression
                'height_expr': str,    # Height expression
                'x_expr': str,         # X position expression
                'y_expr': str          # Y position expression
            }
    """
    if len(keyframes) == 0:
        raise ValueError("No keyframes provided")

    # If only one keyframe, use static crop
    if len(keyframes) == 1:
        kf = keyframes[0]
        w_expr = str(int(kf['width']))
        h_expr = str(int(kf['height']))
        x_expr = str(int(kf['x']))
        y_expr = str(int(kf['y']))

        return {
            'filter_string': f"crop={w_expr}:{h_expr}:{x_expr}:{y_expr}",
            'width_expr': w_expr,
            'height_expr': h_expr,
            'x_expr': x_expr,
            'y_expr': y_expr
        }

    # For multiple keyframes, we need to create an expression that changes over time
    # FFmpeg's crop filter supports expressions, but for smooth interpolation
    # we'll use a different approach with the zoompan filter or crop with expressions

    # Build crop filter with time-based expressions
    # We'll use linear interpolation between keyframes
    crop_expressions = []

    for i in range(len(keyframes) - 1):
        kf1 = keyframes[i]
        kf2 = keyframes[i + 1]

        # Time range for this segment
        t1 = kf1['time']
        t2 = kf2['time']
        duration_segment = t2 - t1

        # Generate interpolation expressions
        # FFmpeg's 't' variable represents current time in seconds
        crop_expressions.append({
            'start': t1,
            'end': t2,
            'x1': kf1['x'],
            'y1': kf1['y'],
            'w1': kf1['width'],
            'h1': kf1['height'],
            'x2': kf2['x'],
            'y2': kf2['y'],
            'w2': kf2['width'],
            'h2': kf2['height']
        })

    # For FFmpeg, we'll use a complex expression with if statements
    # Format: if(condition, true_value, false_value)

    def build_expression(param1_values, param2_values):
        """Build nested if expression for parameter interpolation"""
        expr = f"{int(keyframes[-1][param1_values])}"  # Default to last keyframe

        for i in range(len(crop_expressions) - 1, -1, -1):
            seg = crop_expressions[i]
            t1, t2 = seg['start'], seg['end']
            v1, v2 = seg[param1_values], seg[param2_values]

            # Linear interpolation: v1 + (v2 - v1) * (t - t1) / (t2 - t1)
            duration_seg = t2 - t1
            if duration_seg > 0:
                interp = f"{v1}+({v2}-{v1})*(t-{t1})/{duration_seg}"
            else:
                interp = f"{v1}"

            expr = f"if(gte(t,{t1})*lt(t,{t2}),{interp},{expr})"

        # Handle before first keyframe
        expr = f"if(lt(t,{keyframes[0]['time']}),{int(keyframes[0][param1_values])},{expr})"

        return expr

    x_expr = build_expression('x1', 'x2')
    y_expr = build_expression('y1', 'y2')
    w_expr = build_expression('w1', 'w2')
    h_expr = build_expression('h1', 'h2')

    return {
        'filter_string': f"crop=w={w_expr}:h={h_expr}:x={x_expr}:y={y_expr}",
        'width_expr': w_expr,
        'height_expr': h_expr,
        'x_expr': x_expr,
        'y_expr': y_expr
    }


@app.post("/api/export/crop")
async def export_crop(
    video: UploadFile = File(...),
    keyframes_json: str = Form(...)
):
    """
    Export video with crop applied
    Accepts video file and crop keyframes, returns cropped video
    """
    # Parse keyframes
    try:
        keyframes_data = json.loads(keyframes_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid keyframes JSON: {str(e)}")

    keyframes = [CropKeyframe(**kf) for kf in keyframes_data]

    if len(keyframes) == 0:
        raise HTTPException(status_code=400, detail="No crop keyframes provided")

    # Create temporary directory for processing
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, f"input_{uuid.uuid4().hex}{Path(video.filename).suffix}")
    output_path = os.path.join(temp_dir, f"output_{uuid.uuid4().hex}.mp4")

    # Save uploaded file
    with open(input_path, 'wb') as f:
        content = await video.read()
        f.write(content)

    # Get video info
    probe = ffmpeg.probe(input_path)
    video_info = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    duration = float(probe['format']['duration'])
    fps = eval(video_info['r_frame_rate'])  # e.g., "30/1" -> 30.0

    # Convert keyframes to dict format
    keyframes_dict = [
        {
            'time': kf.time,
            'x': kf.x,
            'y': kf.y,
            'width': kf.width,
            'height': kf.height
        }
        for kf in keyframes
    ]

    # Sort keyframes by time
    keyframes_dict.sort(key=lambda k: k['time'])

    # Generate crop filter with structured parameters
    crop_params = generate_crop_filter(keyframes_dict, duration, fps)

    # Process video with FFmpeg
    try:
        stream = ffmpeg.input(input_path)
        # Use structured parameters instead of fragile string parsing
        stream = ffmpeg.filter(stream, 'crop',
                             w=crop_params['width_expr'],
                             h=crop_params['height_expr'],
                             x=crop_params['x_expr'],
                             y=crop_params['y_expr'])
        stream = ffmpeg.output(stream, output_path,
                             vcodec='libx264',
                             crf=23,
                             preset='medium',
                             acodec='aac',
                             audio_bitrate='192k')
        ffmpeg.run(stream, overwrite_output=True, capture_stdout=True, capture_stderr=True)
    except ffmpeg.Error as e:
        # If complex expressions don't work, fall back to simpler approach
        # For videos with animated crops, we'll process frame by frame
        # For now, use the average crop from all keyframes
        print(f"[FFmpeg] Complex crop filter failed, falling back to average crop. Error: {e.stderr.decode()}")

        avg_crop = {
            'x': int(sum(kf['x'] for kf in keyframes_dict) / len(keyframes_dict)),
            'y': int(sum(kf['y'] for kf in keyframes_dict) / len(keyframes_dict)),
            'width': int(sum(kf['width'] for kf in keyframes_dict) / len(keyframes_dict)),
            'height': int(sum(kf['height'] for kf in keyframes_dict) / len(keyframes_dict))
        }

        stream = ffmpeg.input(input_path)
        stream = ffmpeg.filter(stream, 'crop',
                             avg_crop['width'], avg_crop['height'],
                             avg_crop['x'], avg_crop['y'])
        stream = ffmpeg.output(stream, output_path,
                             vcodec='libx264',
                             crf=23,
                             preset='medium',
                             acodec='aac',
                             audio_bitrate='192k')
        ffmpeg.run(stream, overwrite_output=True, capture_stdout=True, capture_stderr=True)

    # Return the cropped video file
    return FileResponse(
        output_path,
        media_type='video/mp4',
        filename=f"cropped_{video.filename}",
        background=None  # Don't delete file immediately, let FileResponse handle it
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
