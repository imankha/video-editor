# Modal Benchmark Data

This document tracks all Modal benchmark runs to enable data-driven cost optimization decisions.

**Last Updated**: 2026-01-30

**Status**: ALL OPTIMIZATION TESTING COMPLETE - T4 BASELINE IS OPTIMAL

---

## Pricing Reference

| Resource | Per Second | Per Hour |
|----------|------------|----------|
| T4 GPU | $0.000164 | $0.59 |
| L4 GPU | $0.000222 | $0.80 |
| A10G GPU | $0.000306 | $1.10 |
| CPU (2 cores) | $0.0000262 | $0.094 |

---

## Benchmark Runs

| Date | Process | Video Duration | Frames | Hardware | Wall Time | Processing FPS | Modal Cost | Notes |
|------|---------|----------------|--------|----------|-----------|----------------|------------|-------|
| 2026-01-29 | render_overlay | 90s | ~2700 | T4 GPU | 47.6s | ~57 FPS | $0.0078 | E1 baseline |
| 2026-01-29 | process_framing_ai | 6s | 180 | T4 GPU | 192.2s | 0.94 FPS | $0.0315 | E1 baseline (cold) |
| 2026-01-30 | process_framing_ai | 6s | 180 | T4 GPU | 122.7s | 1.47 FPS | $0.0201 | E6 (warm) |
| 2026-01-30 | process_framing_ai | 6s | 180 | L4 GPU | 205.5s | 0.88 FPS | $0.0456 | E6 - L4 SLOWER |
| 2026-01-30 | **T4 baseline** | 6s | 180 | T4 GPU | **143.8s** | **1.25 FPS** | **$0.0236** | **E6 Part 2 - OPTIMAL** |
| 2026-01-30 | T4 + cudnn.benchmark | 6s | 180 | T4 GPU | 159.3s | 1.13 FPS | $0.0261 | E6 Part 2 - 11% slower |
| 2026-01-30 | T4 + torch.compile | 6s | 180 | T4 GPU | 166.7s | 1.08 FPS | $0.0273 | E6 Part 2 - 16% slower |
| 2026-01-30 | T4 + all optimizations | 6s | 180 | T4 GPU | 166.9s | 1.08 FPS | $0.0274 | E6 Part 2 - 16% slower |
| 2026-01-30 | L4 baseline | 6s | 180 | L4 GPU | 167.1s | 1.08 FPS | $0.0371 | E6 Part 2 - 16% slower than T4 |
| 2026-01-30 | L4 + cudnn.benchmark | 6s | 180 | L4 GPU | 173.4s | 1.04 FPS | $0.0385 | E6 Part 2 |
| 2026-01-30 | L4 + torch.compile | 6s | 180 | L4 GPU | 231.5s | 0.78 FPS | $0.0514 | E6 Part 2 - 39% slower |
| 2026-01-30 | L4 + all optimizations | 6s | 180 | L4 GPU | 193.4s | 0.93 FPS | $0.0429 | E6 Part 2 |
| 2026-01-29 | render_overlay | 90s | ~2700 | CPU | >600s | <4.5 FPS | - | E3 - TIMED OUT |
| 2026-01-29 | extract_clip_modal | 6s | - | CPU | ~4s | - | $0.0001 | CPU extraction |
| 2026-01-29 | create_annotated_compilation | - | - | CPU | 15.4s | - | $0.0004 | CPU compilation |

---

## E6 Part 2: Software Optimization Testing

### Objective
Test if software optimizations (cudnn.benchmark, torch.compile, TF32) can improve performance on T4 or L4.

### T4 GPU Optimization Results

| Optimization | Time | FPS | Cost | vs Baseline |
|--------------|------|-----|------|-------------|
| **baseline (vanilla PyTorch)** | **143.8s** | **1.25** | **$0.0236** | **OPTIMAL** |
| cudnn.benchmark=True | 159.3s | 1.13 | $0.0261 | 11% slower |
| torch.compile (reduce-overhead) | 166.7s | 1.08 | $0.0273 | 16% slower |
| All optimizations combined | 166.9s | 1.08 | $0.0274 | 16% slower |

### L4 GPU Optimization Results

| Optimization | Time | FPS | Cost | vs T4 Baseline |
|--------------|------|-----|------|----------------|
| baseline | 167.1s | 1.08 | $0.0371 | 16% slower, 57% more expensive |
| cudnn.benchmark=True | 173.4s | 1.04 | $0.0385 | 21% slower |
| torch.compile (max-autotune) | 231.5s | 0.78 | $0.0514 | 61% slower |
| All optimizations combined | 193.4s | 0.93 | $0.0429 | 35% slower |

### Key Finding

**All software optimizations made performance WORSE, not better.**

Reasons:
1. **torch.compile overhead**: Compilation time dominates for short runs (180 frames)
2. **cudnn.benchmark overhead**: Auto-tuning adds latency without benefit for consistent input sizes
3. **TF32 not applicable**: Real-ESRGAN's SRVGGNetCompact architecture doesn't benefit from TF32
4. **L4 architecture mismatch**: Real-ESRGAN CUDA kernels are optimized for Turing (T4), not Ada Lovelace (L4)

---

## Analysis by Process

### render_overlay (T4 GPU - OPTIMAL)

| Video Duration | Hardware | Wall Time | FPS | Cost | Cost/Frame |
|----------------|----------|-----------|-----|------|------------|
| 90s (~2700 frames) | T4 GPU | 47.6s | 57 | $0.0078 | $0.0000029 |
| 90s (~2700 frames) | CPU (2 cores) | >600s | <4.5 | - | - |

**Status**: COMPLETE. CPU times out. T4 GPU required.

### process_framing_ai (Real-ESRGAN) - T4 GPU BASELINE OPTIMAL

| Configuration | Hardware | Wall Time | FPS | Cost | Status |
|---------------|----------|-----------|-----|------|--------|
| **T4 baseline** | T4 GPU | **143.8s** | **1.25** | **$0.0236** | **OPTIMAL** |
| T4 + optimizations | T4 GPU | 166.9s | 1.08 | $0.0274 | 16% slower |
| L4 baseline | L4 GPU | 167.1s | 1.08 | $0.0371 | 16% slower, 57% more expensive |
| L4 + optimizations | L4 GPU | 193.4s | 0.93 | $0.0429 | 35% slower, 82% more expensive |

**Status**: COMPLETE. T4 baseline is optimal. All optimizations rejected.

### extract_clip_modal (CPU - OPTIMAL)

| Operation | Hardware | Wall Time | Cost |
|-----------|----------|-----------|------|
| 6s clip extraction | CPU (2 cores) | ~4s | $0.0001 |

**Status**: COMPLETE. CPU is optimal.

### create_annotated_compilation (CPU - OPTIMAL)

| Operation | Hardware | Wall Time | Cost |
|-----------|----------|-----------|------|
| Multi-clip compilation | CPU (2 cores) | 15.4s | $0.0004 |

**Status**: COMPLETE. CPU is optimal.

---

## Decision Matrix (FINAL)

| Process | Optimal Config | Tested Alternatives | Result |
|---------|----------------|---------------------|--------|
| render_overlay | **T4 GPU baseline** | CPU (timeout) | CPU not viable |
| process_framing_ai | **T4 GPU baseline** | L4 GPU, torch.compile, cudnn.benchmark, TF32 | All alternatives slower |
| process_multi_clip_modal | **T4 GPU baseline** | - | Same as process_framing_ai |
| extract_clip_modal | **CPU** | - | FFmpeg-only |
| create_annotated_compilation | **CPU** | - | FFmpeg-only |
| detect_players_modal | **T4 GPU** | - | YOLO requires GPU |

---

## Cost Projections (Based on Real Data)

### Single Clip Workflow: 15s clip (450 frames)

| Operation | Hardware | Time | Cost |
|-----------|----------|------|------|
| extract_clip_modal | CPU | ~5s | $0.0001 |
| process_framing_ai | T4 GPU | ~360s | $0.059 |
| render_overlay | T4 GPU | ~8s | $0.001 |
| **TOTAL** | | **~6.2 min** | **$0.060** |

### Multi-Clip Workflow: 8 × 15s clips (3600 frames)

| Operation | Hardware | Time | Cost |
|-----------|----------|------|------|
| extract_clip_modal (×8) | CPU | ~40s | $0.001 |
| process_multi_clip_modal | T4 GPU | ~2880s | $0.472 |
| render_overlay | T4 GPU | ~63s | $0.010 |
| **TOTAL** | | **~50 min** | **$0.483** |

---

## Optimization Testing Summary

### Tested and Rejected

| Optimization | Result | Why It Failed |
|--------------|--------|---------------|
| L4 GPU | 16% slower, 57% more expensive | Architecture mismatch with Real-ESRGAN |
| cudnn.benchmark | 11% slower | Auto-tune overhead > benefit |
| torch.compile | 16-39% slower | Compilation overhead dominates |
| TF32 precision | No improvement | Model architecture incompatible |
| Parallel overlay | 3-4x more expensive | Cold start overhead |
| CPU overlay | Timeout | Too slow without GPU |

### Not Worth Testing

| Option | Reason |
|--------|--------|
| A10G/A100/H100 | L4 results show newer GPUs don't help |
| TensorRT conversion | High effort, Real-ESRGAN not optimized for it |
| Batch frame processing | Would require significant code changes |

---

## Raw Results Files

- E1 baseline: `src/backend/experiments/e1_results.json`
- E3 CPU vs GPU: `src/backend/experiments/e3_cpu_vs_gpu_results.json`
- E6 L4 vs T4: `src/backend/experiments/e6_l4_benchmark_results.json`
- E6 Part 2 optimized: `src/backend/experiments/e6_optimized_results.json`
- E7 parallel: `src/backend/experiments/e_parallel_results.json`
