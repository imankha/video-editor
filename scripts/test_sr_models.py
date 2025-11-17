#!/usr/bin/env python3
"""
Test script for comparing different super-resolution models.

This script provides a command-line interface to test individual models
or run comprehensive comparisons for extreme upscaling scenarios.

Usage:
    python test_sr_models.py --list-models
    python test_sr_models.py --test-model SwinIR_4x_GAN
    python test_sr_models.py --test-all
"""

import sys
import os
import time
import argparse
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / 'src' / 'backend'))

def list_models():
    """List all available SR models."""
    models = {
        'RealESRGAN_x4plus': {
            'description': 'Real-ESRGAN x4plus (baseline)',
            'architecture': 'RRDBNet (64 feat, 23 blocks, 32 grow)',
            'weights_file': 'weights/RealESRGAN_x4plus.pth',
            'parameters': '~16.7M',
            'expected_vram': '70-100 MB',
            'speed': 'Fast'
        },
        'RealESRGAN_x4plus_anime_6B': {
            'description': 'Real-ESRGAN x4plus Anime 6B',
            'architecture': 'RRDBNet (64 feat, 6 blocks, 32 grow)',
            'weights_file': 'weights/RealESRGAN_x4plus_anime_6B.pth',
            'parameters': '~3.7M',
            'expected_vram': '40-60 MB',
            'speed': 'Very Fast'
        },
        'realesr_general_x4v3': {
            'description': 'Real-ESRGAN General v3 (newer)',
            'architecture': 'RRDBNet (64 feat, 23 blocks, 32 grow)',
            'weights_file': 'weights/realesr-general-x4v3.pth',
            'parameters': '~16.7M',
            'expected_vram': '70-100 MB',
            'speed': 'Fast'
        },
        'SwinIR_4x_GAN': {
            'description': 'SwinIR-M x4 GAN (transformer)',
            'architecture': 'SwinIR-M (180 embed, 6 RSTB blocks)',
            'weights_file': 'weights/003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_GAN.pth',
            'parameters': '~11.9M',
            'expected_vram': '200-300 MB',
            'speed': 'Medium'
        },
        'SwinIR_4x': {
            'description': 'SwinIR-M x4 PSNR (transformer)',
            'architecture': 'SwinIR-M (180 embed, 6 RSTB blocks)',
            'weights_file': 'weights/003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_PSNR.pth',
            'parameters': '~11.9M',
            'expected_vram': '200-300 MB',
            'speed': 'Medium'
        },
        'HAT_4x': {
            'description': 'HAT Hybrid Attention Transformer',
            'architecture': 'HAT (180 embed, 6 blocks, window 16)',
            'weights_file': 'weights/HAT_SRx4_ImageNet-pretrain.pth',
            'parameters': '~20.8M',
            'expected_vram': '300-500 MB',
            'speed': 'Slow',
            'note': 'Requires manual setup - see HAT repository'
        }
    }

    print("=" * 80)
    print("AVAILABLE SUPER-RESOLUTION MODELS")
    print("=" * 80)

    for name, info in models.items():
        print(f"\n{name}:")
        print(f"  Description: {info['description']}")
        print(f"  Architecture: {info['architecture']}")
        print(f"  Parameters: {info['parameters']}")
        print(f"  Expected VRAM: {info['expected_vram']}")
        print(f"  Speed: {info['speed']}")
        print(f"  Weights: {info['weights_file']}")

        # Check if weights exist
        weights_path = Path(__file__).parent.parent / info['weights_file']
        if weights_path.exists():
            size_mb = weights_path.stat().st_size / (1024 * 1024)
            print(f"  Status: AVAILABLE ({size_mb:.1f} MB)")
        else:
            print(f"  Status: NOT DOWNLOADED")

        if 'note' in info:
            print(f"  Note: {info['note']}")

    print("\n" + "=" * 80)

def test_model(model_name: str, test_size: tuple = (206, 366)):
    """Test a specific model with a synthetic image."""
    try:
        import numpy as np
        import torch
        from app.ai_upscaler import AIVideoUpscaler

        print(f"\n{'=' * 80}")
        print(f"TESTING MODEL: {model_name}")
        print(f"{'=' * 80}")

        # Create synthetic test image (extreme upscaling scenario)
        width, height = test_size
        print(f"Creating test image: {width}x{height} (simulating distant player crop)")

        # Create a test pattern with jersey-like features
        test_img = np.zeros((height, width, 3), dtype=np.uint8)

        # Green grass background
        test_img[:, :] = [0, 128, 0]

        # Simulated player (white jersey with red number)
        player_x = width // 3
        player_y = height // 4
        player_w = width // 3
        player_h = height // 2

        # Jersey
        test_img[player_y:player_y+player_h, player_x:player_x+player_w] = [255, 255, 255]

        # Number on jersey (simulated "7")
        num_x = player_x + player_w // 3
        num_y = player_y + player_h // 3
        num_w = player_w // 3
        num_h = player_h // 3
        test_img[num_y:num_y+num_h, num_x:num_x+num_w] = [0, 0, 255]  # Red number

        print(f"Test image created with simulated player and jersey number")

        # Initialize upscaler with specified model
        print(f"\nInitializing {model_name}...")
        start_init = time.time()

        upscaler = AIVideoUpscaler(
            device='cuda' if torch.cuda.is_available() else 'cpu',
            sr_model_name=model_name,
            export_mode='quality',
            enable_multipass=False
        )

        init_time = time.time() - start_init
        print(f"Model initialized in {init_time:.2f}s")

        # Check which model was loaded
        if upscaler.current_sr_model == 'swinir':
            print(f"  Active model: SwinIR")
        elif upscaler.current_sr_model == 'hat':
            print(f"  Active model: HAT")
        else:
            print(f"  Active model: Real-ESRGAN")

        # Target size (9:16 portrait for social media)
        target_w, target_h = 1080, 1920
        scale_factor = target_h / height
        print(f"\nTarget size: {target_w}x{target_h}")
        print(f"Scale factor: {scale_factor:.2f}x (EXTREME)")

        # Reset VRAM tracking
        upscaler.reset_peak_vram()

        # Run upscaling
        print(f"\nRunning upscaling...")
        start_time = time.time()

        enhanced = upscaler.enhance_frame_ai(test_img, (target_w, target_h))

        end_time = time.time()
        processing_time = end_time - start_time
        peak_vram = upscaler.get_peak_vram_mb()

        print(f"\nRESULTS:")
        print(f"  Output size: {enhanced.shape[1]}x{enhanced.shape[0]}")
        print(f"  Processing time: {processing_time:.2f}s")
        print(f"  Peak VRAM: {peak_vram:.1f} MB")
        print(f"  Speed: {1/processing_time:.2f} FPS")

        # Save test output
        import cv2
        output_dir = Path(__file__).parent.parent / 'test_outputs'
        output_dir.mkdir(exist_ok=True)

        input_path = output_dir / f'{model_name}_input.png'
        output_path = output_dir / f'{model_name}_output.png'

        cv2.imwrite(str(input_path), test_img)
        cv2.imwrite(str(output_path), enhanced)

        print(f"\n  Saved input to: {input_path}")
        print(f"  Saved output to: {output_path}")
        print(f"\nVisually inspect {output_path} to evaluate quality!")

        return {
            'model': model_name,
            'input_size': test_size,
            'output_size': (enhanced.shape[1], enhanced.shape[0]),
            'scale_factor': scale_factor,
            'processing_time': processing_time,
            'peak_vram_mb': peak_vram,
            'fps': 1/processing_time,
            'success': True
        }

    except Exception as e:
        print(f"\nERROR testing {model_name}: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'model': model_name,
            'success': False,
            'error': str(e)
        }

def test_all_models():
    """Test all available models."""
    models_to_test = [
        'RealESRGAN_x4plus',
        'SwinIR_4x_GAN',
        'realesr_general_x4v3',
        'RealESRGAN_x4plus_anime_6B'
    ]

    results = []
    for model in models_to_test:
        result = test_model(model)
        results.append(result)
        print("\n" + "=" * 80)

    # Summary
    print("\n" + "=" * 80)
    print("COMPARISON SUMMARY")
    print("=" * 80)
    print(f"{'Model':<30} {'Time (s)':<12} {'VRAM (MB)':<12} {'FPS':<10} {'Status':<10}")
    print("-" * 80)

    for r in results:
        if r['success']:
            print(f"{r['model']:<30} {r['processing_time']:<12.2f} {r['peak_vram_mb']:<12.1f} {r['fps']:<10.2f} {'SUCCESS':<10}")
        else:
            print(f"{r['model']:<30} {'N/A':<12} {'N/A':<12} {'N/A':<10} {'FAILED':<10}")

    print("-" * 80)
    print("\nNOTE: Visual quality inspection is required to determine the best model.")
    print("Check test_outputs/ directory for comparison images.")

def main():
    parser = argparse.ArgumentParser(description='Test super-resolution models')
    parser.add_argument('--list-models', action='store_true', help='List all available models')
    parser.add_argument('--test-model', type=str, help='Test a specific model')
    parser.add_argument('--test-all', action='store_true', help='Test all available models')
    parser.add_argument('--input-size', type=str, default='206x366', help='Input size (WxH)')

    args = parser.parse_args()

    if args.list_models:
        list_models()
    elif args.test_model:
        # Parse input size
        w, h = map(int, args.input_size.split('x'))
        test_model(args.test_model, (w, h))
    elif args.test_all:
        test_all_models()
    else:
        parser.print_help()

if __name__ == '__main__':
    main()
