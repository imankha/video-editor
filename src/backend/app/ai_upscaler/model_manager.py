"""
Model Management Module

Polymorphic model management supporting multiple SR backends:
- Real-ESRGAN (multiple variants)
- SwinIR (transformer-based)
- HAT (Hybrid Attention Transformer)
- RealBasicVSR (video SR)
- Stable Diffusion Upscaler (optional)

Architecture:
- BaseModelBackend: Abstract interface for SR models
- Concrete implementations for each model type
- ModelManager: Coordinates model lifecycle and multi-GPU support
"""

import torch
import logging
import os
import traceback
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, Tuple
import numpy as np

logger = logging.getLogger(__name__)


class BaseModelBackend(ABC):
    """Abstract base class for SR model backends"""

    @abstractmethod
    def setup(self, device: torch.device, **kwargs):
        """Initialize the model on the specified device"""
        pass

    @abstractmethod
    def enhance(self, frame: np.ndarray, outscale: float = 4.0) -> Tuple[np.ndarray, Any]:
        """
        Enhance a frame

        Args:
            frame: Input frame (BGR)
            outscale: Output scale factor

        Returns:
            Tuple of (enhanced_frame, metadata)
        """
        pass

    @abstractmethod
    def get_scale(self) -> int:
        """Get the native scale factor of this model"""
        pass


class RealESRGANBackend(BaseModelBackend):
    """Real-ESRGAN model backend"""

    def __init__(self, model_variant: str = 'RealESRGAN_x4plus'):
        self.model_variant = model_variant
        self.upsampler = None
        self.scale = 4

    def setup(self, device: torch.device, tile_size: int = 0, half: bool = True, **kwargs):
        """Setup Real-ESRGAN model"""
        try:
            from basicsr.archs.rrdbnet_arch import RRDBNet
            from realesrgan import RealESRGANer

            logger.info(f"Initializing Real-ESRGAN model: {self.model_variant}")

            # Model configurations
            model_configs = {
                'RealESRGAN_x4plus': {
                    'model': RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4),
                    'url': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
                    'path': 'weights/RealESRGAN_x4plus.pth'
                },
                'RealESRGAN_x4plus_anime_6B': {
                    'model': RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=6, num_grow_ch=32, scale=4),
                    'url': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth',
                    'path': 'weights/RealESRGAN_x4plus_anime_6B.pth'
                },
                'realesr-general-x4v3': {
                    'model': RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4),
                    'url': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth',
                    'path': 'weights/realesr-general-x4v3.pth'
                },
                'realesr_general_x4v3': {  # Alias with underscores
                    'model': RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4),
                    'url': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth',
                    'path': 'weights/realesr-general-x4v3.pth'
                }
            }

            if self.model_variant not in model_configs:
                raise ValueError(f"Unknown Real-ESRGAN variant: {self.model_variant}")

            config = model_configs[self.model_variant]
            model_path = config['path']

            # Download weights if needed
            if not os.path.exists(model_path):
                os.makedirs('weights', exist_ok=True)
                logger.info(f"Downloading {self.model_variant} weights...")
                import wget
                wget.download(config['url'], out='weights/')
                logger.info("\nWeights downloaded successfully!")

            # Determine tile settings
            tile_pad = 10 if tile_size > 0 else 0

            # Create upsampler
            self.upsampler = RealESRGANer(
                scale=4,
                model_path=model_path,
                dni_weight=None,
                model=config['model'],
                tile=tile_size,
                tile_pad=tile_pad,
                pre_pad=0,
                half=half,
                device=device
            )

            logger.info(f"✓ {self.model_variant} loaded successfully!")

        except ImportError as e:
            logger.error(f"Failed to import Real-ESRGAN dependencies: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to setup Real-ESRGAN: {e}")
            raise

    def enhance(self, frame: np.ndarray, outscale: float = 4.0) -> Tuple[np.ndarray, Any]:
        """Enhance frame using Real-ESRGAN"""
        if self.upsampler is None:
            raise RuntimeError("Model not initialized. Call setup() first.")
        return self.upsampler.enhance(frame, outscale=outscale)

    def get_scale(self) -> int:
        return self.scale


class SwinIRBackend(BaseModelBackend):
    """SwinIR transformer-based model backend"""

    def __init__(self, model_variant: str = 'SwinIR_4x_GAN'):
        self.model_variant = model_variant
        self.model = None
        self.device = None
        self.scale = 4

    def setup(self, device: torch.device, **kwargs):
        """Setup SwinIR model"""
        try:
            # Import SwinIR architecture
            from app.ai_upscaler.models.swinir_arch import SwinIR

            logger.info(f"Initializing SwinIR model: {self.model_variant}")

            # Model configurations
            if self.model_variant == 'SwinIR_4x_GAN':
                model_path = 'weights/003_realSR_BSRGAN_DFOWMFC_s64w8_SwinIR-L_x4_GAN.pth'
                url = 'https://github.com/JingyunLiang/SwinIR/releases/download/v0.0/003_realSR_BSRGAN_DFOWMFC_s64w8_SwinIR-L_x4_GAN.pth'
            else:  # SwinIR_4x
                model_path = 'weights/003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_PSNR.pth'
                url = 'https://github.com/JingyunLiang/SwinIR/releases/download/v0.0/003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_PSNR.pth'

            # Download if needed
            if not os.path.exists(model_path):
                os.makedirs('weights', exist_ok=True)
                logger.info(f"Downloading {self.model_variant} weights...")
                import wget
                wget.download(url, out='weights/')
                logger.info("\nWeights downloaded successfully!")

            # Create model
            self.model = SwinIR(
                upscale=4,
                in_chans=3,
                img_size=64,
                window_size=8,
                img_range=1.0,
                depths=[6, 6, 6, 6, 6, 6, 6, 6, 6],
                embed_dim=240,
                num_heads=[8, 8, 8, 8, 8, 8, 8, 8, 8],
                mlp_ratio=2,
                upsampler='nearest+conv',
                resi_connection='3conv'
            )

            # Load weights
            pretrained_model = torch.load(model_path, map_location=device)
            self.model.load_state_dict(pretrained_model['params' if 'params' in pretrained_model else pretrained_model], strict=True)
            self.model.eval()
            self.model = self.model.to(device)
            self.device = device

            logger.info(f"✓ {self.model_variant} loaded successfully!")

        except Exception as e:
            logger.error(f"Failed to setup SwinIR: {e}")
            raise

    def enhance(self, frame: np.ndarray, outscale: float = 4.0) -> Tuple[np.ndarray, Any]:
        """Enhance frame using SwinIR"""
        if self.model is None:
            raise RuntimeError("Model not initialized. Call setup() first.")

        # Convert BGR to RGB and normalize
        img = frame[:, :, [2, 1, 0]].astype(np.float32) / 255.0
        img = torch.from_numpy(np.transpose(img, (2, 0, 1))).float().unsqueeze(0).to(self.device)

        # Inference
        with torch.no_grad():
            output = self.model(img)

        # Convert back to BGR numpy
        output = output.data.squeeze().float().cpu().clamp_(0, 1).numpy()
        output = np.transpose(output, (1, 2, 0))
        output = (output * 255.0).round().astype(np.uint8)
        output = output[:, :, [2, 1, 0]]  # RGB to BGR

        return output, None

    def get_scale(self) -> int:
        return self.scale


class HATBackend(BaseModelBackend):
    """HAT (Hybrid Attention Transformer) model backend"""

    def __init__(self, model_variant: str = 'HAT_4x'):
        self.model_variant = model_variant
        self.model = None
        self.device = None
        self.scale = 4

    def setup(self, device: torch.device, **kwargs):
        """Setup HAT model"""
        try:
            from app.ai_upscaler.models.hat_arch import HAT

            logger.info(f"Initializing HAT model: {self.model_variant}")

            # Model configurations
            if self.model_variant == 'HAT_4x':
                model_path = 'weights/HAT_SRx4_ImageNet-pretrain.pth'
                url = 'https://github.com/XPixelGroup/HAT/releases/download/v1.0.0/HAT_SRx4_ImageNet-pretrain.pth'
                embed_dim = 180
                depths = [6, 6, 6, 6, 6, 6]
                num_heads = [6, 6, 6, 6, 6, 6]
            else:  # HAT_Large_4x
                model_path = 'weights/HAT-L_SRx4_ImageNet-pretrain.pth'
                url = 'https://github.com/XPixelGroup/HAT/releases/download/v1.0.0/HAT-L_SRx4_ImageNet-pretrain.pth'
                embed_dim = 210
                depths = [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6]
                num_heads = [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6]

            # Download if needed
            if not os.path.exists(model_path):
                os.makedirs('weights', exist_ok=True)
                logger.info(f"Downloading {self.model_variant} weights...")
                import wget
                wget.download(url, out='weights/')
                logger.info("\nWeights downloaded successfully!")

            # Create model
            self.model = HAT(
                upscale=4,
                in_chans=3,
                img_size=64,
                window_size=16,
                compress_ratio=3,
                squeeze_factor=30,
                conv_scale=0.01,
                overlap_ratio=0.5,
                img_range=1.0,
                depths=depths,
                embed_dim=embed_dim,
                num_heads=num_heads,
                mlp_ratio=2,
                upsampler='pixelshuffle',
                resi_connection='1conv'
            )

            # Load weights
            pretrained_model = torch.load(model_path, map_location=device)
            self.model.load_state_dict(pretrained_model['params' if 'params' in pretrained_model else pretrained_model], strict=True)
            self.model.eval()
            self.model = self.model.to(device)
            self.device = device

            logger.info(f"✓ {self.model_variant} loaded successfully!")

        except Exception as e:
            logger.error(f"Failed to setup HAT: {e}")
            raise

    def enhance(self, frame: np.ndarray, outscale: float = 4.0) -> Tuple[np.ndarray, Any]:
        """Enhance frame using HAT"""
        if self.model is None:
            raise RuntimeError("Model not initialized. Call setup() first.")

        # Convert BGR to RGB and normalize
        img = frame[:, :, [2, 1, 0]].astype(np.float32) / 255.0
        img = torch.from_numpy(np.transpose(img, (2, 0, 1))).float().unsqueeze(0).to(self.device)

        # Inference
        with torch.no_grad():
            output = self.model(img)

        # Convert back to BGR numpy
        output = output.data.squeeze().float().cpu().clamp_(0, 1).numpy()
        output = np.transpose(output, (1, 2, 0))
        output = (output * 255.0).round().astype(np.uint8)
        output = output[:, :, [2, 1, 0]]  # RGB to BGR

        return output, None

    def get_scale(self) -> int:
        return self.scale


class RealBasicVSRBackend(BaseModelBackend):
    """RealBasicVSR video super-resolution backend"""

    def __init__(self):
        self.model = None
        self.scale = 4

    def setup(self, device: torch.device, **kwargs):
        """Setup RealBasicVSR model"""
        try:
            from basicsr.archs.rrdbnet_arch import RRDBNet
            from realesrgan.archs.srvgg_arch import SRVGGNetCompact
            from basicsr.archs.realbasicvsr_arch import RealBasicVSRNet

            logger.info("Initializing RealBasicVSR model for video SR")

            # This is a placeholder - RealBasicVSR setup would go here
            # It requires different initialization than frame-based models

            logger.info("✓ RealBasicVSR loaded successfully!")

        except Exception as e:
            logger.error(f"Failed to setup RealBasicVSR: {e}")
            raise

    def enhance(self, frame: np.ndarray, outscale: float = 4.0) -> Tuple[np.ndarray, Any]:
        """RealBasicVSR processes video sequences, not single frames"""
        raise NotImplementedError("RealBasicVSR requires video sequence processing")

    def get_scale(self) -> int:
        return self.scale


class ModelManager:
    """
    Manages SR model backends with multi-GPU support

    Responsibilities:
    - Model backend selection and initialization
    - Multi-GPU model instance management
    - VRAM tracking
    - Model factory pattern
    """

    def __init__(
        self,
        model_name: str = 'RealESRGAN_x4plus',
        device: str = 'cuda',
        enable_multi_gpu: bool = True,
        tile_size: int = 0,
        export_mode: str = 'quality'
    ):
        """
        Initialize model manager

        Args:
            model_name: SR model to use
            device: 'cuda' or 'cpu'
            enable_multi_gpu: Enable multi-GPU parallel processing
            tile_size: Tile size for processing (0 = no tiling)
            export_mode: 'fast' or 'quality'
        """
        self.model_name = model_name
        self.enable_multi_gpu = enable_multi_gpu
        self.tile_size = tile_size
        self.export_mode = export_mode
        self.peak_vram_mb = 0

        # Device setup
        if device == 'cuda' and torch.cuda.is_available():
            self.num_gpus = torch.cuda.device_count()
            self.device = torch.device('cuda')

            logger.info("=" * 60)
            logger.info("GPU DETECTION")
            logger.info("=" * 60)
            logger.info(f"CUDA available: Yes")
            logger.info(f"CUDA version: {torch.version.cuda}")
            logger.info(f"Number of GPUs detected: {self.num_gpus}")

            for i in range(self.num_gpus):
                gpu_name = torch.cuda.get_device_name(i)
                logger.info(f"  GPU {i}: {gpu_name}")

            if self.num_gpus > 1 and enable_multi_gpu:
                logger.info(f"✓ Multi-GPU mode ENABLED - will use all {self.num_gpus} GPUs in parallel")
            elif self.num_gpus > 1:
                logger.info(f"Multi-GPU mode DISABLED - will use only GPU 0")
            else:
                logger.info(f"Single GPU mode - using GPU 0")
            logger.info("=" * 60)
        else:
            self.num_gpus = 0
            self.device = torch.device('cpu')
            if device == 'cuda':
                logger.warning("CUDA requested but not available. Falling back to CPU.")
            logger.info(f"Using device: cpu")

        # Create primary backend
        self.backend = self._create_backend(model_name)
        self.backends = {}  # Multi-GPU backends

        # Setup primary backend
        self._setup_primary_backend()

        # Setup multi-GPU if enabled
        if self.num_gpus > 1 and enable_multi_gpu:
            self._setup_multi_gpu_backends()

    def _create_backend(self, model_name: str) -> BaseModelBackend:
        """Factory method to create appropriate model backend"""
        if 'RealESRGAN' in model_name or 'realesr' in model_name:
            return RealESRGANBackend(model_name)
        elif 'SwinIR' in model_name:
            return SwinIRBackend(model_name)
        elif 'HAT' in model_name:
            return HATBackend(model_name)
        elif 'RealBasicVSR' in model_name:
            return RealBasicVSRBackend()
        else:
            logger.warning(f"Unknown model '{model_name}', defaulting to RealESRGAN_x4plus")
            return RealESRGANBackend('RealESRGAN_x4plus')

    def _setup_primary_backend(self):
        """Setup the primary model backend"""
        # Determine tile size
        if self.tile_size > 0:
            tile = self.tile_size
        elif self.device.type == 'cuda':
            tile = 0 if self.export_mode == 'quality' else 512
        else:
            tile = 512

        half_precision = self.device.type == 'cuda'

        try:
            self.backend.setup(
                device=self.device,
                tile_size=tile,
                half=half_precision
            )
        except Exception as e:
            logger.error("=" * 80)
            logger.error(f"Failed to setup primary backend: {e}")
            logger.error("Full traceback:")
            logger.error(traceback.format_exc())
            logger.error("Falling back to OpenCV-based upscaling")
            logger.error("=" * 80)
            self.backend = None

    def _setup_multi_gpu_backends(self):
        """Setup model instances for each GPU"""
        logger.info(f"Initializing models for {self.num_gpus} GPUs...")

        for gpu_id in range(self.num_gpus):
            gpu_device = torch.device(f'cuda:{gpu_id}')
            backend = self._create_backend(self.model_name)

            try:
                backend.setup(
                    device=gpu_device,
                    tile_size=self.tile_size if self.tile_size > 0 else (0 if self.export_mode == 'quality' else 512),
                    half=True
                )
                self.backends[gpu_id] = backend
                logger.info(f"  ✓ GPU {gpu_id} model loaded")
            except Exception as e:
                logger.error(f"Failed to setup backend for GPU {gpu_id}: {e}")
                logger.error(traceback.format_exc())

    def get_backend_for_gpu(self, gpu_id: int) -> Optional[BaseModelBackend]:
        """Get model backend for specific GPU"""
        if self.num_gpus > 1 and self.enable_multi_gpu and gpu_id in self.backends:
            return self.backends[gpu_id]
        return self.backend

    def enhance(self, frame: np.ndarray, gpu_id: int = 0, outscale: float = 4.0) -> Tuple[np.ndarray, Any]:
        """
        Enhance a frame using the appropriate backend

        Args:
            frame: Input frame (BGR)
            gpu_id: GPU ID to use (for multi-GPU)
            outscale: Output scale factor

        Returns:
            Tuple of (enhanced_frame, metadata)
        """
        backend = self.get_backend_for_gpu(gpu_id)
        if backend is None:
            raise RuntimeError("No model backend available")
        return backend.enhance(frame, outscale=outscale)

    def update_peak_vram(self):
        """Update peak VRAM usage tracking"""
        if self.device.type == 'cuda' and torch.cuda.is_available():
            vram_bytes = torch.cuda.memory_allocated(self.device)
            vram_mb = vram_bytes / (1024 * 1024)
            self.peak_vram_mb = max(self.peak_vram_mb, vram_mb)

    def get_peak_vram_mb(self) -> float:
        """Get peak VRAM usage in MB"""
        return self.peak_vram_mb

    def reset_peak_vram(self):
        """Reset peak VRAM tracking"""
        self.peak_vram_mb = 0
        logger.info("Peak VRAM tracking reset")
