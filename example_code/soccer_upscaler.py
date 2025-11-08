"""
Soccer Highlight Video Upscaler
AI-powered video enhancement for sports footage
"""

import cv2
import torch
import numpy as np
from pathlib import Path
import subprocess
import os
import sys
from tqdm import tqdm
import argparse
from PIL import Image
import warnings
warnings.filterwarnings('ignore')

# Suppress Real-ESRGAN tile logging (including stderr output)
import logging
logging.getLogger('basicsr').setLevel(logging.CRITICAL)
logging.getLogger('realesrgan').setLevel(logging.CRITICAL)

# Also suppress tqdm output from Real-ESRGAN
os.environ['REALESRGAN_VERBOSE'] = '0'

class SoccerVideoUpscaler:
    def __init__(self, model_name='RealESRGAN_x4plus', device='cuda'):
        """
        Initialize the video upscaler with Real-ESRGAN model
        
        Args:
            model_name: Model to use for upscaling
            device: 'cuda' for GPU or 'cpu' for CPU processing
        """
        self.device = torch.device(device if torch.cuda.is_available() else 'cpu')
        print(f"Using device: {self.device}")
        
        # We'll use Real-ESRGAN for upscaling
        self.model = None
        self.model_name = model_name
        self.setup_model()
        
    def setup_model(self):
        """Download and setup Real-ESRGAN model"""
        try:
            from basicsr.archs.rrdbnet_arch import RRDBNet
            from realesrgan import RealESRGANer
            
            # Model configuration
            if self.model_name == 'RealESRGAN_x4plus':
                model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, 
                               num_block=23, num_grow_ch=32, scale=4)
                model_path = 'weights/RealESRGAN_x4plus.pth'
                
            # Download weights if not present
            if not os.path.exists(model_path):
                os.makedirs('weights', exist_ok=True)
                print("Downloading Real-ESRGAN weights...")
                import wget
                wget.download(
                    'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
                    out='weights/'
                )
            
            # Initialize upsampler with tiling for memory efficiency
            # tile=512 means process in 512x512 chunks to avoid GPU memory issues
            self.upsampler = RealESRGANer(
                scale=4,
                model_path=model_path,
                dni_weight=None,
                model=model,
                tile=512,  # Process in tiles to save GPU memory
                tile_pad=10,
                pre_pad=0,
                half=True if self.device.type == 'cuda' else False,
                device=self.device
            )
            print("Model loaded successfully!")
            print(f"Using tile size: 512x512 for memory efficiency")
            
        except ImportError:
            print("Real-ESRGAN not installed. Using fallback OpenCV method.")
            self.upsampler = None
    
    def get_video_info(self, video_path):
        """Get video information without loading frames"""
        cap = cv2.VideoCapture(str(video_path))
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        return fps, total_frames
    
    def enhance_frame_opencv(self, frame, scale=2):
        """Fallback enhancement using OpenCV (if Real-ESRGAN not available)"""
        # Upscale using cubic interpolation
        height, width = frame.shape[:2]
        upscaled = cv2.resize(frame, (width * scale, height * scale), 
                             interpolation=cv2.INTER_CUBIC)
        
        # Apply enhancement filters
        # Denoise
        denoised = cv2.fastNlMeansDenoisingColored(upscaled, None, 10, 10, 7, 21)
        
        # Sharpen
        kernel = np.array([[-1,-1,-1],
                          [-1, 9,-1],
                          [-1,-1,-1]])
        sharpened = cv2.filter2D(denoised, -1, kernel)
        
        # Enhance contrast using CLAHE
        lab = cv2.cvtColor(sharpened, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
        enhanced_l = clahe.apply(l)
        enhanced = cv2.merge([enhanced_l, a, b])
        final = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)
        
        return final
    
    def enhance_frame_ai(self, frame, scale=4):
        """Enhance a single frame using AI model (suppresses tile output)"""
        if self.upsampler is not None:
            # Suppress tile logging by redirecting stderr temporarily
            import contextlib

            # Redirect stderr to suppress tile progress
            with contextlib.redirect_stderr(open(os.devnull, 'w')):
                # Use Real-ESRGAN with specified output scale
                enhanced, _ = self.upsampler.enhance(frame, outscale=scale)
            return enhanced
        else:
            # Fallback to OpenCV
            return self.enhance_frame_opencv(frame, scale=scale)
    
    def process_video(self, input_path, output_path, scale=4,
                     target_fps=30):
        """
        Process entire video with AI enhancement (memory-efficient)

        Args:
            input_path: Path to input video
            output_path: Path to output video
            scale: Upscaling factor (2 or 4)
            target_fps: Output FPS (30 or 60)
        """
        input_path = Path(input_path)
        output_path = Path(output_path)

        # Get video info
        original_fps, total_frames = self.get_video_info(input_path)
        print(f"Video info: {total_frames} frames @ {original_fps} fps")
        print(f"Output will be @ {target_fps} fps")

        # Create temp directory for enhanced frames only
        enhanced_dir = Path("enhanced_frames")
        enhanced_dir.mkdir(exist_ok=True)

        try:
            # Open video for reading
            cap = cv2.VideoCapture(str(input_path))

            # Process each frame directly (stream processing, no frame storage)
            print(f"🚀 Enhancing {total_frames} frames with AI...")
            print(f"💾 Tile output below can be ignored - watch the progress line:\n")

            import time
            start_time = time.time()
            frame_count = 0

            # Simple progress without tqdm to avoid conflicts
            last_update = 0

            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                # Enhance frame with AI
                try:
                    enhanced = self.enhance_frame_ai(frame, scale=scale)

                    # Save enhanced frame
                    enhanced_path = enhanced_dir / f"enhanced_{frame_count:06d}.png"
                    cv2.imwrite(str(enhanced_path), enhanced)

                    frame_count += 1

                    # Update progress every frame but only print every 5 frames
                    current_time = time.time()
                    if current_time - last_update >= 2.0 or frame_count == total_frames:  # Update every 2 seconds
                        elapsed = current_time - start_time
                        fps = frame_count / elapsed if elapsed > 0 else 0
                        remaining_frames = total_frames - frame_count
                        eta_seconds = remaining_frames / fps if fps > 0 else 0

                        # Format ETA
                        eta_mins = int(eta_seconds // 60)
                        eta_secs = int(eta_seconds % 60)
                        percent = (frame_count / total_frames) * 100

                        # Print progress (will appear between tile spam)
                        print(f"\n>>> PROGRESS: {percent:5.1f}% | {frame_count}/{total_frames} frames | "
                              f"Speed: {fps:.2f} fps | ETA: {eta_mins}m {eta_secs}s <<<\n", flush=True)

                        last_update = current_time

                    # Clear GPU cache periodically
                    if frame_count % 10 == 0:
                        torch.cuda.empty_cache()

                except Exception as e:
                    print(f"\n⚠️ Error enhancing frame {frame_count}: {e}")
                    print("Continuing with next frame...")
                    continue

            cap.release()

            print(f"\n✅ Enhanced {frame_count} frames")

            # Reassemble video using ffmpeg
            print("🎬 Reassembling video with FFmpeg...")

            try:
                self.create_video_from_frames(enhanced_dir, output_path, target_fps, str(input_path))
                print(f"✅ Video saved to: {output_path}")

                # Only cleanup if encoding succeeded
                import shutil
                if enhanced_dir.exists():
                    print("🧹 Cleaning up temporary files...")
                    shutil.rmtree(enhanced_dir)

            except Exception as e:
                print(f"\n❌ Video encoding failed: {e}")
                print(f"\n⚠️ Enhanced frames are saved in: {enhanced_dir.absolute()}")
                print(f"You can try encoding them manually with retry_encode.bat")
                raise

        finally:
            # Final GPU cleanup (always do this)
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
    
    def create_video_from_frames(self, frames_dir, output_path, fps):
        """Create video from enhanced frames using ffmpeg with memory-efficient encoding"""
        frames_pattern = str(frames_dir / "enhanced_%06d.png")

        print(f"Encoding video with FFmpeg (this may take a few minutes)...")

        # Use faster preset and GPU encoding if available for 8K videos
        # Note: Changed from 'slow' to 'medium' to reduce memory usage
        cmd = [
            'ffmpeg',
            '-y',  # Overwrite output
            '-framerate', str(fps),
            '-i', frames_pattern,
            '-c:v', 'libx264',  # H.264 codec
            '-preset', 'medium',  # Faster encoding, less memory usage
            '-crf', '20',  # Good quality (slightly lower than 18, saves memory)
            '-pix_fmt', 'yuv420p',  # Compatibility
            '-movflags', '+faststart',  # Web optimization
            '-max_muxing_queue_size', '9999',  # Increase buffer for high res
            '-bufsize', '5000k',  # Limit buffer size
            str(output_path)
        ]

        try:
            # Run ffmpeg with output visible
            result = subprocess.run(cmd, check=True, capture_output=False)
        except subprocess.CalledProcessError as e:
            print(f"\n⚠️ FFmpeg encoding failed with error code: {e.returncode}")
            print(f"This usually means the output resolution is too large for available memory.")
            print(f"\nTrying alternative encoding method...")

            # Try with even more memory-conservative settings
            cmd_fallback = [
                'ffmpeg',
                '-y',
                '-framerate', str(fps),
                '-i', frames_pattern,
                '-c:v', 'libx264',
                '-preset', 'ultrafast',  # Fastest encoding
                '-crf', '23',  # Lower quality but works
                '-pix_fmt', 'yuv420p',
                '-vf', 'scale=3840:2160',  # Downscale to 4K if too large
                '-movflags', '+faststart',
                '-max_muxing_queue_size', '9999',
                str(output_path)
            ]
            subprocess.run(cmd_fallback, check=True)
    
    def add_slow_motion(self, video_path, output_path, segments):
        """
        Add slow motion to specific segments
        
        Args:
            video_path: Input video
            output_path: Output video
            segments: List of (start_time, end_time, speed) tuples
                     e.g., [(2.5, 4.0, 0.5)] for 50% speed from 2.5-4.0 seconds
        """
        # This would use ffmpeg's complex filter for speed ramping
        # Implementation would be quite complex, so showing structure
        pass

def main():
    parser = argparse.ArgumentParser(description='AI Soccer Highlight Enhancer')
    parser.add_argument('input', help='Input video path')
    parser.add_argument('output', help='Output video path')
    parser.add_argument('--scale', type=int, default=4, help='Upscale factor (2 or 4)')
    parser.add_argument('--fps', type=int, default=30, help='Output FPS (30 or 60)')
    parser.add_argument('--cpu', action='store_true', help='Use CPU instead of GPU')
    
    args = parser.parse_args()
    
    # Initialize upscaler
    device = 'cpu' if args.cpu else 'cuda'
    upscaler = SoccerVideoUpscaler(device=device)
    
    # Process video
    upscaler.process_video(
        args.input,
        args.output,
        scale=args.scale,
        target_fps=args.fps
    )

if __name__ == "__main__":
    main()
