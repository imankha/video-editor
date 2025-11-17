from fastapi import FastAPI, UploadFile, File, Form, HTTPException, WebSocket, WebSocketDisconnect
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
import logging
import asyncio
import subprocess

# Configure logging with timestamps
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# AI upscaler will be imported on-demand to avoid import errors
# if dependencies aren't installed
AIVideoUpscaler = None
try:
    from app.ai_upscaler import AIVideoUpscaler as _AIVideoUpscaler
    AIVideoUpscaler = _AIVideoUpscaler
    logger.info("AI upscaler module loaded successfully")
except ImportError as e:
    logger.warning("=" * 80)
    logger.warning("AI upscaler dependencies not installed")
    logger.warning("The /api/export/upscale endpoint will not work")
    logger.warning("To enable AI upscaling, install dependencies:")
    logger.warning("  cd src/backend")
    logger.warning("  pip install -r requirements.txt")
    logger.warning("=" * 80)
    AIVideoUpscaler = None

# Global progress tracking for exports
# Format: {export_id: {"progress": 0-100, "message": "...", "status": "processing|complete|error"}}
export_progress = {}

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        # Store active connections by export_id
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, export_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[export_id] = websocket
        logger.info(f"WebSocket connected for export_id: {export_id}")

    def disconnect(self, export_id: str):
        if export_id in self.active_connections:
            del self.active_connections[export_id]
            logger.info(f"WebSocket disconnected for export_id: {export_id}")

    async def send_progress(self, export_id: str, data: dict):
        if export_id in self.active_connections:
            try:
                await self.active_connections[export_id].send_json(data)
            except Exception as e:
                logger.error(f"Error sending progress to {export_id}: {e}")
                self.disconnect(export_id)

manager = ConnectionManager()

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


def get_git_version_info():
    """Get git commit hash and branch name for logging"""
    try:
        # Get current commit hash
        commit_hash = subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()

        # Get short commit hash
        short_hash = subprocess.check_output(
            ['git', 'rev-parse', '--short', 'HEAD'],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()

        # Get current branch name
        branch = subprocess.check_output(
            ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()

        # Get commit date
        commit_date = subprocess.check_output(
            ['git', 'log', '-1', '--format=%cd', '--date=iso'],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()

        # Check if there are uncommitted changes
        dirty = subprocess.call(
            ['git', 'diff-index', '--quiet', 'HEAD', '--'],
            stderr=subprocess.DEVNULL
        ) != 0

        return {
            'commit': commit_hash,
            'short_commit': short_hash,
            'branch': branch,
            'commit_date': commit_date,
            'dirty': dirty
        }
    except Exception as e:
        logger.warning(f"Could not retrieve git version info: {e}")
        return None


@app.on_event("startup")
async def startup_event():
    """Log version information on startup"""
    logger.info("=" * 80)
    logger.info("VIDEO EDITOR BACKEND STARTING")
    logger.info("=" * 80)

    # Log git version info
    git_info = get_git_version_info()
    if git_info:
        logger.info("Git Version Information:")
        logger.info(f"  Branch: {git_info['branch']}")
        logger.info(f"  Commit: {git_info['short_commit']} ({git_info['commit'][:12]}...)")
        logger.info(f"  Date: {git_info['commit_date']}")
        if git_info['dirty']:
            logger.warning("  Status: DIRTY (uncommitted changes present)")
        else:
            logger.info("  Status: Clean")
    else:
        logger.info("Git version info not available (not a git repository or git not installed)")

    logger.info(f"Environment: {ENV}")
    logger.info(f"Python version: {sys.version.split()[0]}")
    logger.info("=" * 80)


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


@app.get("/api/export/progress/{export_id}")
async def get_export_progress(export_id: str):
    """
    Get the progress of an ongoing export operation (legacy - use WebSocket instead)
    """
    if export_id not in export_progress:
        raise HTTPException(status_code=404, detail="Export ID not found")

    return export_progress[export_id]


@app.websocket("/ws/export/{export_id}")
async def websocket_export_progress(websocket: WebSocket, export_id: str):
    """
    WebSocket endpoint for real-time export progress updates
    """
    await manager.connect(export_id, websocket)
    try:
        # Keep connection alive and wait for messages
        while True:
            # Wait for any message from client (ping/pong)
            try:
                await websocket.receive_text()
            except WebSocketDisconnect:
                break
    except Exception as e:
        logger.error(f"WebSocket error for {export_id}: {e}")
    finally:
        manager.disconnect(export_id)


# Crop Export Models
class CropKeyframe(BaseModel):
    time: float
    x: float
    y: float
    width: float
    height: float


class CropExportRequest(BaseModel):
    keyframes: List[CropKeyframe]


# Highlight Export Models
class HighlightKeyframe(BaseModel):
    time: float
    x: float
    y: float
    radiusX: float  # Horizontal radius of ellipse
    radiusY: float  # Vertical radius of ellipse (larger for upright players)
    opacity: float
    color: str


class HighlightExportRequest(BaseModel):
    keyframes: List[HighlightKeyframe]


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
        # Use float values with 3 decimal precision
        w_expr = str(round(kf['width'], 3))
        h_expr = str(round(kf['height'], 3))
        x_expr = str(round(kf['x'], 3))
        y_expr = str(round(kf['y'], 3))

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
        # Map expression parameter names to actual keyframe keys
        param_map = {
            'x1': 'x', 'x2': 'x',
            'y1': 'y', 'y2': 'y',
            'w1': 'width', 'w2': 'width',
            'h1': 'height', 'h2': 'height'
        }

        # Get the actual keyframe key for default value
        kf_key = param_map.get(param1_values, param1_values)
        expr = f"{round(keyframes[-1][kf_key], 3)}"  # Default to last keyframe

        for i in range(len(crop_expressions) - 1, -1, -1):
            seg = crop_expressions[i]
            t1, t2 = seg['start'], seg['end']
            v1, v2 = round(seg[param1_values], 3), round(seg[param2_values], 3)

            # Linear interpolation: v1 + (v2 - v1) * (t - t1) / (t2 - t1)
            duration_seg = t2 - t1
            if duration_seg > 0:
                interp = f"{v1}+({v2}-{v1})*(t-{t1})/{duration_seg}"
            else:
                interp = f"{v1}"

            expr = f"if(gte(t,{t1})*lt(t,{t2}),{interp},{expr})"

        # Handle before first keyframe
        kf_key_first = param_map.get(param1_values, param1_values)
        expr = f"if(lt(t,{keyframes[0]['time']}),{round(keyframes[0][kf_key_first], 3)},{expr})"

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
                             vcodec='libx265',
                             crf=10,
                             preset='veryslow',
                             **{'x265-params': 'aq-mode=3:aq-strength=1.0:deblock=-1,-1:me=star:subme=7:merange=57:ref=6:psy-rd=2.5:psy-rdoq=1.0:bframes=8:b-adapt=2:rc-lookahead=60:rect=1:amp=1:rd=6'},
                             acodec='aac',
                             audio_bitrate='256k',
                             pix_fmt='yuv420p',
                             colorspace='bt709',
                             color_primaries='bt709',
                             color_trc='bt709',
                             color_range='tv')
        ffmpeg.run(stream, overwrite_output=True, capture_stdout=True, capture_stderr=True)
    except ffmpeg.Error as e:
        # If complex expressions don't work, fall back to simpler approach
        # For videos with animated crops, we'll process frame by frame
        # For now, use the average crop from all keyframes
        print(f"[FFmpeg] Complex crop filter failed, falling back to average crop. Error: {e.stderr.decode()}")

        avg_crop = {
            'x': round(sum(kf['x'] for kf in keyframes_dict) / len(keyframes_dict), 3),
            'y': round(sum(kf['y'] for kf in keyframes_dict) / len(keyframes_dict), 3),
            'width': round(sum(kf['width'] for kf in keyframes_dict) / len(keyframes_dict), 3),
            'height': round(sum(kf['height'] for kf in keyframes_dict) / len(keyframes_dict), 3)
        }

        stream = ffmpeg.input(input_path)
        stream = ffmpeg.filter(stream, 'crop',
                             avg_crop['width'], avg_crop['height'],
                             avg_crop['x'], avg_crop['y'])
        stream = ffmpeg.output(stream, output_path,
                             vcodec='libx265',
                             crf=10,
                             preset='veryslow',
                             **{'x265-params': 'aq-mode=3:aq-strength=1.0:deblock=-1,-1:me=star:subme=7:merange=57:ref=6:psy-rd=2.5:psy-rdoq=1.0:bframes=8:b-adapt=2:rc-lookahead=60:rect=1:amp=1:rd=6'},
                             acodec='aac',
                             audio_bitrate='256k',
                             pix_fmt='yuv420p',
                             colorspace='bt709',
                             color_primaries='bt709',
                             color_trc='bt709',
                             color_range='tv')
        ffmpeg.run(stream, overwrite_output=True, capture_stdout=True, capture_stderr=True)

    # Return the cropped video file
    return FileResponse(
        output_path,
        media_type='video/mp4',
        filename=f"cropped_{video.filename}",
        background=None  # Don't delete file immediately, let FileResponse handle it
    )


@app.post("/api/export/upscale")
async def export_with_ai_upscale(
    video: UploadFile = File(...),
    keyframes_json: str = Form(...),
    target_fps: int = Form(30),
    export_id: str = Form(...),
    export_mode: str = Form("quality"),
    segment_data_json: str = Form(None),
    include_audio: str = Form("true"),
    highlight_keyframes_json: str = Form(None),
    enable_source_preupscale: str = Form("false"),
    enable_diffusion_sr: str = Form("false")
):
    """
    Export video with AI upscaling and de-zoom

    This endpoint:
    1. Extracts frames with crop applied (de-zoom - removes digital zoom)
    2. Detects aspect ratio and determines target resolution:
       - 16:9 videos → 4K (3840x2160)
       - 9:16 videos → 1080x1920
    3. Upscales each frame using Real-ESRGAN AI model
    4. Reassembles into final video

    Args:
        video: Video file to process
        keyframes_json: JSON array of crop keyframes
        target_fps: Output framerate (default 30)
        export_id: Unique ID for tracking export progress
        export_mode: Export mode - "fast" or "quality" (default "quality")
        include_audio: Include audio in export - "true" or "false" (default "true")
        highlight_keyframes_json: JSON array of highlight keyframes (optional)
        enable_source_preupscale: Pre-upscale source frame before cropping (default "false")
        enable_diffusion_sr: Enable Stable Diffusion upscaler for extreme cases (default "false")

    Returns:
        AI-upscaled video file
    """
    # Initialize progress tracking (10% to match upload completion)
    export_progress[export_id] = {
        "progress": 10,
        "message": "Starting export...",
        "status": "processing"
    }
    # Parse include_audio parameter
    include_audio_bool = include_audio.lower() == "true"
    logger.info(f"Audio setting: {'Include audio' if include_audio_bool else 'Video only'}")

    # Parse extreme upscaling parameters
    enable_source_preupscale_bool = enable_source_preupscale.lower() == "true"
    enable_diffusion_sr_bool = enable_diffusion_sr.lower() == "true"
    if enable_source_preupscale_bool:
        logger.info("Source pre-upscaling: ENABLED (will pre-upscale source frame before cropping)")
    if enable_diffusion_sr_bool:
        logger.info("Diffusion SR: ENABLED (will use Stable Diffusion for extreme upscaling >5x)")

    # Parse keyframes
    try:
        keyframes_data = json.loads(keyframes_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid keyframes JSON: {str(e)}")

    keyframes = [CropKeyframe(**kf) for kf in keyframes_data]

    if len(keyframes) == 0:
        raise HTTPException(status_code=400, detail="No crop keyframes provided")

    # Parse segment data (speed/trim) if provided
    segment_data = None
    if segment_data_json:
        try:
            segment_data = json.loads(segment_data_json)
            logger.info("=" * 80)
            logger.info("SEGMENT DATA RECEIVED FROM CLIENT")
            logger.info("=" * 80)
            logger.info(json.dumps(segment_data, indent=2))
            logger.info("=" * 80)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid segment data JSON: {str(e)}")
    else:
        logger.info("No segment data provided - processing without speed/trim adjustments")

    # Parse highlight keyframes (optional)
    highlight_keyframes = []
    highlight_keyframes_dict = []
    if highlight_keyframes_json:
        try:
            highlight_keyframes_data = json.loads(highlight_keyframes_json)
            highlight_keyframes = [HighlightKeyframe(**kf) for kf in highlight_keyframes_data]
            # Convert to dict format for upscaler
            highlight_keyframes_dict = [
                {
                    'time': hkf.time,
                    'x': hkf.x,
                    'y': hkf.y,
                    'radiusX': hkf.radiusX,
                    'radiusY': hkf.radiusY,
                    'opacity': hkf.opacity,
                    'color': hkf.color
                }
                for hkf in highlight_keyframes
            ]
            logger.info("=" * 80)
            logger.info("HIGHLIGHT KEYFRAMES RECEIVED FROM CLIENT")
            logger.info("=" * 80)
            logger.info(f"Number of highlight keyframes: {len(highlight_keyframes)}")
            logger.info(json.dumps(highlight_keyframes_data, indent=2))
            logger.info("=" * 80)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid highlight keyframes JSON: {str(e)}")
    else:
        logger.info("No highlight keyframes provided - exporting without highlight overlay")

    # Create temporary directory for processing
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, f"input_{uuid.uuid4().hex}{Path(video.filename).suffix}")
    output_path = os.path.join(temp_dir, f"upscaled_{uuid.uuid4().hex}.mp4")

    try:
        # Save uploaded file
        with open(input_path, 'wb') as f:
            content = await video.read()
            f.write(content)

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

        # Check if AI upscaler is available
        if AIVideoUpscaler is None:
            logger.error("=" * 80)
            logger.error("❌ AI upscaling not available - dependencies not installed")
            logger.error("=" * 80)
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "AI upscaling dependencies not installed",
                    "message": "To enable AI upscaling, install the required dependencies:",
                    "instructions": [
                        "cd src/backend",
                        "pip install -r requirements.txt",
                        "# Restart the backend"
                    ],
                    "see_also": "INSTALL_AI_DEPENDENCIES.md for detailed instructions"
                }
            )

        # Initialize AI upscaler
        logger.info("=" * 80)
        logger.info("INITIALIZING AI UPSCALER")
        logger.info("=" * 80)
        upscaler = AIVideoUpscaler(
            device='cuda',
            export_mode=export_mode,
            enable_source_preupscale=enable_source_preupscale_bool,
            enable_diffusion_sr=enable_diffusion_sr_bool
        )

        # Verify AI model is loaded - fail if not available (no low-quality fallback)
        if upscaler.upsampler is None:
            logger.error("=" * 80)
            logger.error("❌ CRITICAL: Real-ESRGAN AI model failed to load!")
            logger.error("Cannot proceed with AI upscaling")
            logger.error("=" * 80)
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "Real-ESRGAN model failed to load",
                    "message": "AI upscaling requires Real-ESRGAN to be properly initialized.",
                    "instructions": [
                        "Check the server logs for detailed error messages",
                        "Common fixes:",
                        "  1. pip install 'numpy<2.0.0' --force-reinstall",
                        "  2. pip install 'opencv-python>=4.8.0,<4.10.0' --force-reinstall",
                        "  3. pip install -r requirements.txt",
                        "  4. Restart the backend"
                    ],
                    "see_also": "INSTALL_AI_DEPENDENCIES.md"
                }
            )

        logger.info("✓ Real-ESRGAN AI model loaded and ready for maximum quality upscaling")

        # Process video with AI upscaling
        logger.info("=" * 80)
        logger.info("STARTING AI UPSCALE PROCESS WITH DE-ZOOM")
        logger.info("=" * 80)

        # Capture the event loop BEFORE entering the thread
        loop = asyncio.get_running_loop()

        # Define progress allocations based on export mode (from empirical timing data)
        # Upload: 0-10% (handled by frontend)
        # Backend: 10-100% (handled here)
        # FAST: AI=95.2%, Encode=4.8%
        # QUALITY: AI=18.5%, Pass1=52.8%, Pass2=28.7%
        if export_mode == "FAST":
            progress_ranges = {
                'ai_upscale': (10, 95),      # 85% of progress bar
                'ffmpeg_encode': (95, 100)    # 5% of progress bar
            }
        else:  # QUALITY
            progress_ranges = {
                'ai_upscale': (10, 28),       # 18% of progress bar (18.5% of time)
                'ffmpeg_pass1': (28, 81),     # 53% of progress bar (52.8% of time)
                'ffmpeg_encode': (81, 100)    # 19% of progress bar (28.7% of time)
            }

        def progress_callback(current, total, message, phase='ai_upscale'):
            """
            Update progress tracking with phase-aware calculations

            Args:
                current: Current item number in this phase
                total: Total items in this phase
                message: Progress message
                phase: Current phase - 'ai_upscale', 'ffmpeg_pass1', or 'ffmpeg_encode'
            """
            # Get progress range for this phase
            if phase not in progress_ranges:
                logger.warning(f"Unknown phase: {phase}, defaulting to ai_upscale")
                phase = 'ai_upscale'

            start_percent, end_percent = progress_ranges[phase]

            # Calculate progress within this phase
            phase_progress = (current / total) if total > 0 else 0
            overall_percent = start_percent + (phase_progress * (end_percent - start_percent))

            progress_data = {
                "progress": overall_percent,
                "message": message,
                "status": "processing",
                "current": current,
                "total": total,
                "phase": phase
            }
            export_progress[export_id] = progress_data
            logger.info(f"Progress: {overall_percent:.1f}% - {message}")

            # Send update via WebSocket using the captured event loop
            try:
                asyncio.run_coroutine_threadsafe(
                    manager.send_progress(export_id, progress_data),
                    loop
                )
            except Exception as e:
                logger.error(f"Failed to send WebSocket update: {e}")

        # Update progress - initializing (10% to match upload completion)
        init_timestamp = datetime.now()
        logger.info("=" * 80)
        logger.info(f"[EXPORT_PHASE] INITIALIZATION START - {init_timestamp.isoformat()}")
        logger.info("=" * 80)
        init_data = {
            "progress": 10,
            "message": "Initializing AI upscaler...",
            "status": "processing"
        }
        export_progress[export_id] = init_data
        await manager.send_progress(export_id, init_data)

        # Run AI upscaling in a separate thread to not block the event loop
        # This allows WebSocket messages to be sent while processing
        result = await asyncio.to_thread(
            upscaler.process_video_with_upscale,
            input_path=input_path,
            output_path=output_path,
            keyframes=keyframes_dict,
            target_fps=target_fps,
            export_mode=export_mode,
            progress_callback=progress_callback,
            segment_data=segment_data,
            include_audio=include_audio_bool,
            highlight_keyframes=highlight_keyframes_dict
        )

        complete_timestamp = datetime.now()
        total_duration = (complete_timestamp - init_timestamp).total_seconds()
        logger.info("=" * 80)
        logger.info(f"[EXPORT_PHASE] EXPORT COMPLETE - {complete_timestamp.isoformat()}")
        logger.info(f"[EXPORT_PHASE] TOTAL_DURATION - {total_duration:.2f} seconds ({total_duration/60:.2f} minutes)")
        logger.info(f"✓ AI UPSCALING COMPLETE!")
        logger.info(f"Result: {result}")
        logger.info(f"Output: {output_path}")
        logger.info(f"File size: {os.path.getsize(output_path) / (1024*1024):.2f} MB")
        logger.info("=" * 80)

        # Update progress - complete
        complete_data = {
            "progress": 100,
            "message": "Export complete!",
            "status": "complete"
        }
        export_progress[export_id] = complete_data
        await manager.send_progress(export_id, complete_data)

        # Return the upscaled video file
        return FileResponse(
            output_path,
            media_type='video/mp4',
            filename=f"upscaled_{video.filename}",
            background=None
        )

    except Exception as e:
        logger.error(f"AI upscaling failed: {str(e)}", exc_info=True)

        # Update progress - error
        error_data = {
            "progress": 0,
            "message": f"Export failed: {str(e)}",
            "status": "error"
        }
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

        # Clean up temp files on error
        if os.path.exists(temp_dir):
            import shutil
            shutil.rmtree(temp_dir)
        raise HTTPException(status_code=500, detail=f"AI upscaling failed: {str(e)}")


@app.post("/api/export/upscale-comparison")
async def export_with_upscale_comparison(
    video: UploadFile = File(...),
    keyframes_json: str = Form(...),
    target_fps: int = Form(30),
    export_id: str = Form(...),
    export_mode: str = Form("quality"),
    segment_data_json: str = Form(None),
    include_audio: str = Form("true"),
    highlight_keyframes_json: str = Form(None)
):
    """
    Export video with multiple enhancement settings for A/B comparison testing.

    Generates multiple videos with different permutations of extreme upscaling settings:
    1. baseline - Standard Real-ESRGAN (single pass, no extras)
    2. multipass - Multi-pass upscaling for >4x scales
    3. preupscale - Pre-upscale source frame before cropping
    4. multipass_preupscale - Both multi-pass and pre-upscaling

    Note: Diffusion SR is excluded by default due to very long processing time (10-60s/frame).

    All videos are saved to a timestamped directory and paths are returned.
    """
    # Initialize progress tracking
    export_progress[export_id] = {
        "progress": 5,
        "message": "Starting comparison export...",
        "status": "processing"
    }

    # Parse parameters
    include_audio_bool = include_audio.lower() == "true"

    # Parse keyframes
    try:
        keyframes_data = json.loads(keyframes_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid keyframes JSON: {str(e)}")

    keyframes = [CropKeyframe(**kf) for kf in keyframes_data]
    if len(keyframes) == 0:
        raise HTTPException(status_code=400, detail="No crop keyframes provided")

    keyframes_dict = [
        {'time': kf.time, 'x': kf.x, 'y': kf.y, 'width': kf.width, 'height': kf.height}
        for kf in keyframes
    ]

    # Parse segment data
    segment_data = None
    if segment_data_json:
        try:
            segment_data = json.loads(segment_data_json)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid segment data JSON: {str(e)}")

    # Parse highlight keyframes
    highlight_keyframes_dict = []
    if highlight_keyframes_json:
        try:
            highlight_keyframes_data = json.loads(highlight_keyframes_json)
            highlight_keyframes = [HighlightKeyframe(**kf) for kf in highlight_keyframes_data]
            highlight_keyframes_dict = [
                {'time': kf.time, 'x': kf.x, 'y': kf.y, 'radiusX': kf.radiusX,
                 'radiusY': kf.radiusY, 'opacity': kf.opacity, 'color': kf.color}
                for kf in highlight_keyframes
            ]
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid highlight keyframes JSON: {str(e)}")

    if AIVideoUpscaler is None:
        raise HTTPException(status_code=503, detail="AI upscaling dependencies not installed")

    # Create output directory for comparison videos in project root (accessible location)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    # Save to exports directory in project root for easy access
    project_root = Path(__file__).parent.parent.parent.parent  # Go up from main.py to project root
    exports_dir = project_root / "exports"
    exports_dir.mkdir(exist_ok=True)
    comparison_dir = exports_dir / f"comparison_{timestamp}"
    comparison_dir.mkdir(exist_ok=True)

    # Define permutations to test different AI super-resolution models
    # Focus on model quality comparison for extreme upscaling (5x+)
    # Testing: Real-ESRGAN vs SwinIR vs HAT variants
    permutations = [
        {
            'name': 'realesrgan_x4plus',
            'description': 'Real-ESRGAN x4plus (baseline, proven performer)',
            'sr_model_name': 'RealESRGAN_x4plus',
            'enable_source_preupscale': False,
            'enable_diffusion_sr': False,
            'enable_multipass': False,
            'pre_enhance_source': False,
            'tile_size': 0,
            'ffmpeg_codec': 'libx264',
            'ffmpeg_preset': 'fast',
            'ffmpeg_crf': '18',
            'custom_enhance_params': {
                'bilateral_d': 0,
                'unsharp_weight': 1.0,
                'unsharp_blur_weight': 0.0,
                'apply_clahe': False,
                'apply_detail_enhancement': False,
                'apply_edge_enhancement': False,
                'enhancement_level': 'none'
            }
        },
        {
            'name': 'swinir_4x_gan',
            'description': 'SwinIR-M x4 GAN (transformer-based, better global context)',
            'sr_model_name': 'SwinIR_4x_GAN',
            'enable_source_preupscale': False,
            'enable_diffusion_sr': False,
            'enable_multipass': False,
            'pre_enhance_source': False,
            'tile_size': 0,
            'ffmpeg_codec': 'libx264',
            'ffmpeg_preset': 'fast',
            'ffmpeg_crf': '18',
            'custom_enhance_params': {
                'bilateral_d': 0,
                'unsharp_weight': 1.0,
                'unsharp_blur_weight': 0.0,
                'apply_clahe': False,
                'apply_detail_enhancement': False,
                'apply_edge_enhancement': False,
                'enhancement_level': 'none'
            }
        },
        {
            'name': 'realesr_general_x4v3',
            'description': 'Real-ESRGAN General v3 (newer general model)',
            'sr_model_name': 'realesr_general_x4v3',
            'enable_source_preupscale': False,
            'enable_diffusion_sr': False,
            'enable_multipass': False,
            'pre_enhance_source': False,
            'tile_size': 0,
            'ffmpeg_codec': 'libx264',
            'ffmpeg_preset': 'fast',
            'ffmpeg_crf': '18',
            'custom_enhance_params': {
                'bilateral_d': 0,
                'unsharp_weight': 1.0,
                'unsharp_blur_weight': 0.0,
                'apply_clahe': False,
                'apply_detail_enhancement': False,
                'apply_edge_enhancement': False,
                'enhancement_level': 'none'
            }
        },
        {
            'name': 'realesrgan_anime_6b',
            'description': 'Real-ESRGAN x4plus Anime 6B (lighter model, different training)',
            'sr_model_name': 'RealESRGAN_x4plus_anime_6B',
            'enable_source_preupscale': False,
            'enable_diffusion_sr': False,
            'enable_multipass': False,
            'pre_enhance_source': False,
            'tile_size': 0,
            'ffmpeg_codec': 'libx264',
            'ffmpeg_preset': 'fast',
            'ffmpeg_crf': '18',
            'custom_enhance_params': {
                'bilateral_d': 0,
                'unsharp_weight': 1.0,
                'unsharp_blur_weight': 0.0,
                'apply_clahe': False,
                'apply_detail_enhancement': False,
                'apply_edge_enhancement': False,
                'enhancement_level': 'none'
            }
        }
    ]

    # Save input video to temp location
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, f"input_{uuid.uuid4().hex}{Path(video.filename).suffix}")

    try:
        # Save uploaded file
        with open(input_path, 'wb') as f:
            content = await video.read()
            f.write(content)

        logger.info("=" * 80)
        logger.info("STARTING COMPARISON EXPORT")
        logger.info("=" * 80)
        logger.info(f"Output directory: {comparison_dir}")
        logger.info(f"Permutations to test: {len(permutations)}")
        for perm in permutations:
            logger.info(f"  - {perm['name']}: {perm['description']}")
        logger.info("=" * 80)

        # Capture the event loop
        loop = asyncio.get_running_loop()

        results = []
        total_permutations = len(permutations)

        for idx, perm in enumerate(permutations):
            perm_name = perm['name']
            output_path = comparison_dir / f"{perm_name}_{timestamp}.mp4"

            # Update progress for this permutation
            base_progress = 5 + (idx / total_permutations * 90)  # 5-95% range
            progress_data = {
                "progress": base_progress,
                "message": f"Processing {perm_name} ({idx+1}/{total_permutations}): {perm['description']}",
                "status": "processing",
                "current_permutation": perm_name,
                "permutation_index": idx + 1,
                "total_permutations": total_permutations
            }
            export_progress[export_id] = progress_data
            await manager.send_progress(export_id, progress_data)

            logger.info("=" * 80)
            logger.info(f"PERMUTATION {idx+1}/{total_permutations}: {perm_name}")
            logger.info(f"Description: {perm['description']}")
            logger.info(f"Output: {output_path}")
            logger.info("=" * 80)

            try:
                # Initialize upscaler with this permutation's settings
                upscaler = AIVideoUpscaler(
                    device='cuda',
                    export_mode=export_mode,
                    enable_source_preupscale=perm['enable_source_preupscale'],
                    enable_diffusion_sr=perm['enable_diffusion_sr'],
                    enable_multipass=perm.get('enable_multipass', True),
                    custom_enhance_params=perm.get('custom_enhance_params', None),
                    pre_enhance_source=perm.get('pre_enhance_source', False),
                    pre_enhance_params=perm.get('pre_enhance_params', None),
                    tile_size=perm.get('tile_size', 0),
                    ffmpeg_codec=perm.get('ffmpeg_codec', None),
                    ffmpeg_preset=perm.get('ffmpeg_preset', None),
                    ffmpeg_crf=perm.get('ffmpeg_crf', None),
                    sr_model_name=perm.get('sr_model_name', 'RealESRGAN_x4plus')
                )

                # Check if model was loaded successfully
                model_loaded = (
                    upscaler.upsampler is not None or
                    upscaler.swinir_model is not None or
                    upscaler.hat_model is not None
                )
                if not model_loaded:
                    raise RuntimeError(f"SR model '{perm.get('sr_model_name', 'RealESRGAN_x4plus')}' failed to load")

                # Reset VRAM tracking for this permutation
                upscaler.reset_peak_vram()

                # Progress callback for this permutation
                def make_progress_callback(perm_idx, perm_name):
                    def progress_callback(current, total, message, phase='ai_upscale'):
                        # Map phase progress to permutation progress slice
                        perm_start = 5 + (perm_idx / total_permutations * 90)
                        perm_end = 5 + ((perm_idx + 1) / total_permutations * 90)
                        phase_progress = (current / total) if total > 0 else 0
                        overall = perm_start + (phase_progress * (perm_end - perm_start))

                        progress_data = {
                            "progress": overall,
                            "message": f"[{perm_name}] {message}",
                            "status": "processing",
                            "current_permutation": perm_name,
                            "permutation_index": perm_idx + 1,
                            "total_permutations": total_permutations,
                            "phase": phase
                        }
                        export_progress[export_id] = progress_data
                        try:
                            asyncio.run_coroutine_threadsafe(
                                manager.send_progress(export_id, progress_data),
                                loop
                            )
                        except Exception as e:
                            logger.error(f"Failed to send WebSocket update: {e}")
                    return progress_callback

                # Process video
                start_time = datetime.now()
                result = await asyncio.to_thread(
                    upscaler.process_video_with_upscale,
                    input_path=input_path,
                    output_path=str(output_path),
                    keyframes=keyframes_dict,
                    target_fps=target_fps,
                    export_mode=export_mode,
                    progress_callback=make_progress_callback(idx, perm_name),
                    segment_data=segment_data,
                    include_audio=include_audio_bool,
                    highlight_keyframes=highlight_keyframes_dict
                )
                end_time = datetime.now()
                duration = (end_time - start_time).total_seconds()

                file_size = os.path.getsize(output_path) / (1024 * 1024)  # MB
                peak_vram = upscaler.get_peak_vram_mb()

                results.append({
                    'name': perm_name,
                    'description': perm['description'],
                    'path': str(output_path),
                    'success': True,
                    'duration_seconds': duration,
                    'file_size_mb': file_size,
                    'peak_vram_mb': peak_vram,
                    'resolution': result.get('target_resolution', (0, 0)),
                    'sr_model_name': perm.get('sr_model_name', 'RealESRGAN_x4plus')
                })

                logger.info(f"✓ {perm_name} (model: {perm.get('sr_model_name', 'RealESRGAN_x4plus')}) completed in {duration:.2f}s, size: {file_size:.2f}MB, peak VRAM: {peak_vram:.1f}MB")

            except Exception as e:
                logger.error(f"✗ {perm_name} failed: {str(e)}")
                results.append({
                    'name': perm_name,
                    'description': perm['description'],
                    'path': None,
                    'success': False,
                    'error': str(e)
                })

        # Generate summary
        logger.info("=" * 80)
        logger.info("COMPARISON EXPORT COMPLETE")
        logger.info("=" * 80)
        logger.info(f"Output directory: {comparison_dir}")
        for r in results:
            if r['success']:
                logger.info(f"✓ {r['name']}: {r['duration_seconds']:.2f}s, {r['file_size_mb']:.2f}MB, VRAM: {r.get('peak_vram_mb', 0):.1f}MB")
            else:
                logger.info(f"✗ {r['name']}: FAILED - {r.get('error', 'Unknown error')}")
        logger.info("=" * 80)

        # Generate report file
        report_path = comparison_dir / "report.txt"
        with open(report_path, 'w') as f:
            f.write("=" * 80 + "\n")
            f.write(f"UPSCALING COMPARISON REPORT\n")
            f.write(f"Generated: {timestamp}\n")
            f.write("=" * 80 + "\n\n")

            f.write("SETTINGS:\n")
            f.write(f"  Export Mode: {export_mode}\n")
            f.write(f"  Target FPS: {target_fps}\n")
            f.write(f"  Include Audio: {include_audio_bool}\n")
            if keyframes_dict:
                first_kf = keyframes_dict[0]
                f.write(f"  Initial Crop: {int(first_kf['width'])}x{int(first_kf['height'])}\n")
            f.write("\n")

            f.write("RESULTS:\n")
            f.write("-" * 80 + "\n")
            f.write(f"{'Name':<25} {'Duration':>12} {'Size':>12} {'Peak VRAM':>12} {'Status':<10}\n")
            f.write("-" * 80 + "\n")

            for r in results:
                if r['success']:
                    f.write(f"{r['name']:<25} {r['duration_seconds']:>10.2f}s {r['file_size_mb']:>10.2f}MB {r.get('peak_vram_mb', 0):>10.1f}MB {'SUCCESS':<10}\n")
                else:
                    f.write(f"{r['name']:<25} {'N/A':>12} {'N/A':>12} {'N/A':>12} {'FAILED':<10}\n")

            f.write("-" * 80 + "\n\n")

            f.write("DETAILED RESULTS:\n")
            for r in results:
                f.write(f"\n{r['name']}:\n")
                f.write(f"  Description: {r['description']}\n")
                if r['success']:
                    f.write(f"  Path: {r['path']}\n")
                    f.write(f"  Duration: {r['duration_seconds']:.2f} seconds ({r['duration_seconds']/60:.2f} minutes)\n")
                    f.write(f"  File Size: {r['file_size_mb']:.2f} MB\n")
                    f.write(f"  Peak VRAM: {r.get('peak_vram_mb', 0):.1f} MB\n")
                    f.write(f"  Resolution: {r.get('resolution', 'N/A')}\n")
                else:
                    f.write(f"  Error: {r.get('error', 'Unknown error')}\n")

            f.write("\n" + "=" * 80 + "\n")
            f.write("RECOMMENDATION:\n")
            successful = [r for r in results if r['success']]
            if successful:
                # Sort by quality (we don't know quality, so sort by processing time as proxy for complexity)
                fastest = min(successful, key=lambda x: x['duration_seconds'])
                f.write(f"  Fastest: {fastest['name']} ({fastest['duration_seconds']:.2f}s)\n")
                smallest_vram = min(successful, key=lambda x: x.get('peak_vram_mb', 0))
                f.write(f"  Lowest VRAM: {smallest_vram['name']} ({smallest_vram.get('peak_vram_mb', 0):.1f}MB)\n")
                smallest_file = min(successful, key=lambda x: x['file_size_mb'])
                f.write(f"  Smallest File: {smallest_file['name']} ({smallest_file['file_size_mb']:.2f}MB)\n")
            f.write("=" * 80 + "\n")

        logger.info(f"Report saved to: {report_path}")

        # Update progress - complete
        complete_data = {
            "progress": 100,
            "message": f"Comparison export complete! {len([r for r in results if r['success']])} videos generated",
            "status": "complete",
            "results": results,
            "output_directory": str(comparison_dir)
        }
        export_progress[export_id] = complete_data
        await manager.send_progress(export_id, complete_data)

        # Return results summary (videos are saved to disk for review)
        return {
            "status": "complete",
            "output_directory": str(comparison_dir),
            "results": results,
            "summary": f"Generated {len([r for r in results if r['success']])} comparison videos. Review them at: {comparison_dir}"
        }

    except Exception as e:
        logger.error(f"Comparison export failed: {str(e)}", exc_info=True)
        error_data = {
            "progress": 0,
            "message": f"Export failed: {str(e)}",
            "status": "error"
        }
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)
        raise HTTPException(status_code=500, detail=f"Comparison export failed: {str(e)}")

    finally:
        # Clean up input file temp directory
        if os.path.exists(temp_dir):
            import shutil
            shutil.rmtree(temp_dir)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
