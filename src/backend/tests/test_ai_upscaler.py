"""
Comprehensive tests for AI Video Upscaler

These tests cover all major components that will be refactored into separate modules.
They use mocking to avoid requiring actual model files and GPU hardware.
"""

import pytest
import numpy as np
import sys
from pathlib import Path
from unittest.mock import Mock, MagicMock, patch, call
from typing import Dict, List, Tuple

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# We'll import the actual module, but mock heavy dependencies
with patch('torch.cuda.is_available', return_value=False):
    from app.ai_upscaler import AIVideoUpscaler


class TestUtilityFunctions:
    """Test utility functions that will go into utils.py"""

    def test_detect_aspect_ratio_16_9(self):
        """Test 16:9 aspect ratio detection"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            # 1920x1080 is 16:9 - returns TARGET resolution for upscaling (4K)
            aspect, resolution = upscaler.detect_aspect_ratio(1920, 1080)
            assert aspect == "16:9"
            assert resolution == (3840, 2160)  # Target 4K resolution

            # 3840x2160 is also 16:9 - already at 4K target
            aspect, resolution = upscaler.detect_aspect_ratio(3840, 2160)
            assert aspect == "16:9"
            assert resolution == (3840, 2160)

    def test_detect_aspect_ratio_4_3(self):
        """Test 4:3 aspect ratio detection - falls into 'other' category"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            # 1024x768 is 4:3 (ratio ~1.33) - not a special case, classified as 'other'
            # Since it's wider than tall, uses 4K width (3840) and scales height proportionally
            aspect, resolution = upscaler.detect_aspect_ratio(1024, 768)
            assert aspect == "other"
            assert resolution == (3840, 2880)  # 3840 / 1.333... = 2880

    def test_detect_aspect_ratio_vertical(self):
        """Test vertical video (9:16)"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            # 1080x1920 is 9:16 (vertical)
            aspect, resolution = upscaler.detect_aspect_ratio(1080, 1920)
            assert aspect == "9:16"
            assert resolution == (1080, 1920)


class TestKeyframeInterpolation:
    """Test keyframe interpolation functions that will go into keyframe_interpolator.py"""

    def test_interpolate_crop_single_keyframe(self):
        """Test interpolation with single keyframe returns that keyframe"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            keyframes = [
                {'time': 0.0, 'x': 100, 'y': 100, 'width': 640, 'height': 360}
            ]

            result = upscaler.interpolate_crop(keyframes, 5.0)
            assert result['x'] == 100
            assert result['y'] == 100
            assert result['width'] == 640
            assert result['height'] == 360

    def test_interpolate_crop_between_keyframes(self):
        """Test linear interpolation between two keyframes"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            keyframes = [
                {'time': 0.0, 'x': 0, 'y': 0, 'width': 640, 'height': 360},
                {'time': 10.0, 'x': 100, 'y': 100, 'width': 1280, 'height': 720}
            ]

            # At t=5.0 (halfway), should be halfway between values
            result = upscaler.interpolate_crop(keyframes, 5.0)
            assert result['x'] == 50
            assert result['y'] == 50
            assert result['width'] == 960
            assert result['height'] == 540

    def test_interpolate_crop_before_first_keyframe(self):
        """Test interpolation before first keyframe returns first keyframe"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            keyframes = [
                {'time': 5.0, 'x': 100, 'y': 100, 'width': 640, 'height': 360},
                {'time': 10.0, 'x': 200, 'y': 200, 'width': 1280, 'height': 720}
            ]

            result = upscaler.interpolate_crop(keyframes, 0.0)
            assert result['x'] == 100
            assert result['y'] == 100

    def test_interpolate_crop_after_last_keyframe(self):
        """Test interpolation after last keyframe returns last keyframe"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            keyframes = [
                {'time': 0.0, 'x': 100, 'y': 100, 'width': 640, 'height': 360},
                {'time': 5.0, 'x': 200, 'y': 200, 'width': 1280, 'height': 720}
            ]

            result = upscaler.interpolate_crop(keyframes, 10.0)
            assert result['x'] == 200
            assert result['y'] == 200


class TestFFmpegUtilities:
    """Test FFmpeg-related utilities that will go into video_encoder.py"""

    def test_parse_ffmpeg_progress(self):
        """Test FFmpeg progress parsing"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            # Test valid progress line
            line = "frame=  100 fps= 30 q=28.0 size=    1024kB time=00:00:03.33 bitrate=2514.3kbits/s speed=1.0x"
            frame_num = upscaler.parse_ffmpeg_progress(line)
            assert frame_num == 100

            # Test another format
            line = "frame=12345 fps=29.97 q=-1.0 Lsize=   45678kB time=00:06:52.50 bitrate= 907.2kbits/s speed=59.9x"
            frame_num = upscaler.parse_ffmpeg_progress(line)
            assert frame_num == 12345

            # Test invalid line
            line = "Configuration: --enable-gpl --enable-libx264"
            frame_num = upscaler.parse_ffmpeg_progress(line)
            assert frame_num is None

    def test_build_atempo_filter_no_change(self):
        """Test atempo filter with 1.0x speed (no change)"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            filter_str = upscaler.build_atempo_filter(1.0)
            assert filter_str == ""

    def test_build_atempo_filter_2x_speed(self):
        """Test atempo filter with 2.0x speed"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            filter_str = upscaler.build_atempo_filter(2.0)
            assert filter_str == "atempo=2.0"

    def test_build_atempo_filter_half_speed(self):
        """Test atempo filter with 0.5x speed"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            filter_str = upscaler.build_atempo_filter(0.5)
            assert filter_str == "atempo=0.5"

    def test_build_atempo_filter_extreme_speed(self):
        """Test atempo filter with >2x speed (requires chaining)"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            # 4x speed should chain two 2.0x filters
            filter_str = upscaler.build_atempo_filter(4.0)
            assert "atempo=2.0,atempo=2.0" in filter_str


class TestAdaptiveEnhancement:
    """Test adaptive enhancement parameters that will go into frame_enhancer.py"""

    def test_get_adaptive_params_normal_scale(self):
        """Test adaptive parameters for normal scale (<2.5x)"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            params = upscaler.get_adaptive_enhancement_params(2.0)
            assert params['enhancement_level'] == 'normal'
            assert params['bilateral_d'] == 3
            assert params['apply_clahe'] == False

    def test_get_adaptive_params_high_scale(self):
        """Test adaptive parameters for high scale (2.5-3.5x)"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            params = upscaler.get_adaptive_enhancement_params(3.0)
            assert params['enhancement_level'] == 'high'
            assert params['apply_clahe'] == True
            assert params['clahe_clip_limit'] == 3.0

    def test_get_adaptive_params_extreme_scale(self):
        """Test adaptive parameters for extreme scale (>3.5x)"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            params = upscaler.get_adaptive_enhancement_params(5.0)
            assert params['enhancement_level'] == 'optimized_raw'
            assert params['bilateral_d'] == 0  # No denoising
            assert params['apply_clahe'] == False
            assert params['apply_detail_enhancement'] == False

    def test_custom_enhancement_params_override(self):
        """Test that custom parameters override adaptive selection"""
        custom_params = {
            'bilateral_d': 99,
            'enhancement_level': 'custom'
        }

        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu', custom_enhance_params=custom_params)

            # Should return custom params regardless of scale
            params = upscaler.get_adaptive_enhancement_params(5.0)
            assert params['bilateral_d'] == 99
            assert params['enhancement_level'] == 'custom'


class TestVRAMTracking:
    """Test VRAM tracking utilities that will go into model_manager.py"""

    @patch('torch.cuda.is_available', return_value=True)
    @patch('torch.cuda.device_count', return_value=1)
    @patch('torch.cuda.get_device_name', return_value='Mock GPU')
    def test_update_peak_vram(self, mock_name, mock_count, mock_available):
        """Test peak VRAM tracking"""
        with patch('app.ai_upscaler.model_manager.RealESRGANBackend.setup', MagicMock()):
            upscaler = AIVideoUpscaler(device='cuda')

            # Initially 0
            assert upscaler.get_peak_vram_mb() == 0

            # Mock memory_allocated for the update call
            with patch('torch.cuda.memory_allocated', return_value=1024 * 1024 * 512):  # 512 MB
                upscaler.update_peak_vram()
                peak = upscaler.get_peak_vram_mb()
                assert peak == 512.0  # 512 MB

            # Reset should clear
            upscaler.reset_peak_vram()
            assert upscaler.get_peak_vram_mb() == 0


class TestModelInitialization:
    """Test model initialization that will go into model_manager.py"""

    @patch('torch.cuda.is_available', return_value=True)
    @patch('torch.cuda.device_count', return_value=2)
    @patch('torch.cuda.get_device_name', return_value='Mock GPU')
    def test_multi_gpu_detection(self, mock_name, mock_count, mock_available):
        """Test multi-GPU detection"""
        with patch('app.ai_upscaler.model_manager.RealESRGANBackend.setup', MagicMock()):
            upscaler = AIVideoUpscaler(device='cuda', enable_multi_gpu=True)

            assert upscaler.num_gpus == 2
            assert upscaler.enable_multi_gpu == True

    @patch('torch.cuda.is_available', return_value=True)
    @patch('torch.cuda.device_count', return_value=2)
    @patch('torch.cuda.get_device_name', return_value='Mock GPU')
    def test_multi_gpu_disabled(self, mock_name, mock_count, mock_available):
        """Test multi-GPU can be disabled"""
        with patch('app.ai_upscaler.model_manager.RealESRGANBackend.setup', MagicMock()):
            upscaler = AIVideoUpscaler(device='cuda', enable_multi_gpu=False)

            assert upscaler.num_gpus == 2  # Still detected
            assert upscaler.enable_multi_gpu == False  # But disabled

    def test_cpu_fallback(self):
        """Test CPU fallback when CUDA unavailable"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cuda')  # Request CUDA

            # Should fallback to CPU
            assert str(upscaler.device) == 'cpu'
            assert upscaler.num_gpus == 0


class TestFrameProcessing:
    """Test frame processing functions that will go into frame_processor.py"""

    def test_enhance_frame_opencv(self):
        """Test OpenCV-based frame enhancement (fallback)"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu')

            # Create a small test frame
            frame = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)
            target_size = (400, 400)

            enhanced = upscaler.enhance_frame_opencv(frame, target_size)

            # Should be upscaled to target size
            assert enhanced.shape[0] == 400
            assert enhanced.shape[1] == 400
            assert enhanced.shape[2] == 3


class TestExportModes:
    """Test export mode configuration"""

    def test_export_mode_quality(self):
        """Test quality export mode"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu', export_mode='quality')

            assert upscaler.export_mode == 'quality'

    def test_export_mode_fast(self):
        """Test fast export mode"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu', export_mode='fast')

            assert upscaler.export_mode == 'fast'

    def test_sr_backend_realesrgan(self):
        """Test Real-ESRGAN backend"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu', sr_backend='realesrgan')

            assert upscaler.sr_backend == 'realesrgan'

    def test_sr_backend_realbasicvsr(self):
        """Test RealBasicVSR backend"""
        with patch('torch.cuda.is_available', return_value=False):
            with patch('app.ai_upscaler.model_manager.RealBasicVSRBackend.setup', MagicMock()):
                upscaler = AIVideoUpscaler(device='cpu', sr_backend='realbasicvsr')

                assert upscaler.sr_backend == 'realbasicvsr'


class TestFFmpegCodecOverrides:
    """Test FFmpeg codec override parameters"""

    def test_ffmpeg_codec_override(self):
        """Test FFmpeg codec can be overridden"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu', ffmpeg_codec='libx265')

            # FFmpeg settings are stored on the video_encoder instance
            assert upscaler.video_encoder.ffmpeg_codec == 'libx265'

    def test_ffmpeg_preset_override(self):
        """Test FFmpeg preset can be overridden"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu', ffmpeg_preset='slow')

            # FFmpeg settings are stored on the video_encoder instance
            assert upscaler.video_encoder.ffmpeg_preset == 'slow'

    def test_ffmpeg_crf_override(self):
        """Test FFmpeg CRF can be overridden"""
        with patch('torch.cuda.is_available', return_value=False):
            upscaler = AIVideoUpscaler(device='cpu', ffmpeg_crf='18')

            # FFmpeg settings are stored on the video_encoder instance
            assert upscaler.video_encoder.ffmpeg_crf == '18'


class TestFrameInterpolator:
    """Test frame interpolation module with tiered GPU fallback"""

    def test_gpu_capabilities_detection(self):
        """Test GPU capabilities detection returns proper structure"""
        from app.ai_upscaler.frame_interpolator import GPUCapabilities

        caps = GPUCapabilities()
        assert hasattr(caps, 'has_cuda')
        assert hasattr(caps, 'has_vulkan')
        assert hasattr(caps, 'cuda_device_name')
        assert hasattr(caps, 'vulkan_device_name')
        assert hasattr(caps, 'rife_cuda_available')
        assert hasattr(caps, 'rife_ncnn_available')

    def test_interpolation_backend_enum(self):
        """Test interpolation backend enum values"""
        from app.ai_upscaler.frame_interpolator import InterpolationBackend

        assert InterpolationBackend.RIFE_CUDA.value == "rife_cuda"
        assert InterpolationBackend.RIFE_NCNN.value == "rife_ncnn"
        assert InterpolationBackend.MINTERPOLATE.value == "minterpolate"

    def test_frame_interpolator_fallback_to_minterpolate(self):
        """Test frame interpolator falls back to minterpolate when no GPU available"""
        from app.ai_upscaler.frame_interpolator import FrameInterpolator, InterpolationBackend, GPUCapabilities
        from app.ai_upscaler import frame_interpolator as fi_module

        # Reset both class-level and module-level singletons BEFORE applying mocks
        FrameInterpolator._capabilities = None
        FrameInterpolator._selected_backend = None
        fi_module._interpolator = None

        # Apply mocks for capability detection
        with patch('torch.cuda.is_available', return_value=False), \
             patch.object(FrameInterpolator, '_check_cuda', return_value=(False, None)), \
             patch.object(FrameInterpolator, '_check_vulkan', return_value=(False, None)), \
             patch.object(FrameInterpolator, '_check_rife_cuda', return_value=False), \
             patch.object(FrameInterpolator, '_check_rife_ncnn', return_value=False):

            interpolator = FrameInterpolator()

            # Should fallback to minterpolate
            assert interpolator.backend == InterpolationBackend.MINTERPOLATE

            # Backend info should indicate fallback
            info = interpolator.get_backend_info()
            assert info['is_fallback'] == True
            assert info['quality_tier'] == 'standard'

    @patch('torch.cuda.is_available', return_value=True)
    @patch('torch.cuda.get_device_name', return_value='NVIDIA GeForce RTX 3080')
    def test_frame_interpolator_detects_cuda(self, mock_name, mock_cuda):
        """Test frame interpolator detects CUDA"""
        from app.ai_upscaler.frame_interpolator import FrameInterpolator

        # Reset singleton
        FrameInterpolator._capabilities = None
        FrameInterpolator._selected_backend = None

        interpolator = FrameInterpolator()

        assert interpolator.capabilities.has_cuda == True
        assert 'RTX 3080' in interpolator.capabilities.cuda_device_name

    def test_minterpolate_filter_high_quality(self):
        """Test minterpolate filter with high quality settings"""
        from app.ai_upscaler.frame_interpolator import FrameInterpolator

        # Reset singleton
        FrameInterpolator._capabilities = None
        FrameInterpolator._selected_backend = None

        interpolator = FrameInterpolator()
        filter_str = interpolator.get_minterpolate_filter(60, high_quality=True)

        assert 'minterpolate=fps=60' in filter_str
        assert 'mi_mode=mci' in filter_str
        assert 'mc_mode=aobmc' in filter_str
        assert 'vsbmc=1' in filter_str
        assert 'scd=fdiff' in filter_str

    def test_minterpolate_filter_fast(self):
        """Test minterpolate filter with fast settings"""
        from app.ai_upscaler.frame_interpolator import FrameInterpolator

        interpolator = FrameInterpolator()
        filter_str = interpolator.get_minterpolate_filter(60, high_quality=False)

        assert 'minterpolate=fps=60' in filter_str
        assert 'mi_mode=blend' in filter_str

    def test_backend_info_structure(self):
        """Test backend info returns complete structure"""
        from app.ai_upscaler.frame_interpolator import FrameInterpolator

        interpolator = FrameInterpolator()
        info = interpolator.get_backend_info()

        assert 'backend' in info
        assert 'has_cuda' in info
        assert 'has_vulkan' in info
        assert 'cuda_device' in info
        assert 'vulkan_device' in info
        assert 'is_fallback' in info
        assert 'quality_tier' in info


class TestVideoEncoderMinterpolate:
    """Test video encoder minterpolate settings"""

    def test_get_minterpolate_filter_high_quality(self):
        """Test VideoEncoder returns high quality minterpolate filter"""
        with patch('torch.cuda.is_available', return_value=False):
            from app.ai_upscaler.video_encoder import VideoEncoder

            filter_str = VideoEncoder._get_minterpolate_filter(60, high_quality=True)

            assert 'fps=60' in filter_str
            assert 'mi_mode=mci' in filter_str
            assert 'vsbmc=1' in filter_str
            assert 'scd=fdiff' in filter_str

    def test_get_minterpolate_filter_fast(self):
        """Test VideoEncoder returns fast minterpolate filter"""
        with patch('torch.cuda.is_available', return_value=False):
            from app.ai_upscaler.video_encoder import VideoEncoder

            filter_str = VideoEncoder._get_minterpolate_filter(60, high_quality=False)

            assert 'fps=60' in filter_str
            assert 'mi_mode=blend' in filter_str


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
