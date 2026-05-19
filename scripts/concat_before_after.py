"""
Concatenate multiple before/after clip pairs into final landing page videos.

Usage:
    python scripts/concat_before_after.py --input-dir ./before_after_clips/ --output-dir src/landing/public/

Input directory should contain pairs like:
    before_0.mp4, after_0.mp4
    before_1.mp4, after_1.mp4
    ...

Output: before.mp4 and after.mp4 in the output directory.
Uses FFmpeg concat demuxer (no re-encoding when formats match).
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile


def find_pairs(input_dir: str) -> list[tuple[str, str]]:
    """Find matching before_*.mp4 / after_*.mp4 pairs, sorted by index."""
    before_files = {}
    after_files = {}

    for f in os.listdir(input_dir):
        m = re.match(r'before_(\d+)\.mp4$', f)
        if m:
            before_files[int(m.group(1))] = os.path.join(input_dir, f)
            continue
        m = re.match(r'after_(\d+)\.mp4$', f)
        if m:
            after_files[int(m.group(1))] = os.path.join(input_dir, f)

    indices = sorted(set(before_files.keys()) & set(after_files.keys()))
    if not indices:
        print("ERROR: No matching before_N.mp4 / after_N.mp4 pairs found.")
        sys.exit(1)

    pairs = [(before_files[i], after_files[i]) for i in indices]
    print(f"Found {len(pairs)} before/after pair(s): indices {indices}")
    return pairs


def concat_with_demuxer(file_paths: list[str], output_path: str) -> bool:
    """Concatenate files using FFmpeg concat demuxer (no re-encoding)."""
    if len(file_paths) == 1:
        subprocess.run(['ffmpeg', '-y', '-i', file_paths[0], '-c', 'copy', output_path],
                       capture_output=True)
        return os.path.exists(output_path)

    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        for path in file_paths:
            f.write(f"file '{os.path.abspath(path)}'\n")
        list_path = f.name

    try:
        result = subprocess.run([
            'ffmpeg', '-y',
            '-f', 'concat', '-safe', '0',
            '-i', list_path,
            '-c', 'copy',
            output_path
        ], capture_output=True, text=True)

        if result.returncode != 0:
            print(f"FFmpeg concat demuxer failed, falling back to re-encode:\n{result.stderr}")
            return concat_with_reencode(file_paths, output_path)

        return os.path.exists(output_path)
    finally:
        os.unlink(list_path)


def concat_with_reencode(file_paths: list[str], output_path: str) -> bool:
    """Fallback: concatenate with re-encoding via concat filter."""
    inputs = []
    filter_parts = []
    for i, path in enumerate(file_paths):
        inputs.extend(['-i', path])
        filter_parts.append(f'[{i}:v]fps=30[v{i}];')

    concat_inputs = ''.join(f'[v{i}]' for i in range(len(file_paths)))
    filter_complex = f"{''.join(filter_parts)}{concat_inputs}concat=n={len(file_paths)}:v=1:a=0[outv]"

    cmd = [
        'ffmpeg', '-y',
        *inputs,
        '-filter_complex', filter_complex,
        '-map', '[outv]',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
        output_path
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"FFmpeg re-encode concat failed:\n{result.stderr}")
        return False
    return os.path.exists(output_path)


def main():
    parser = argparse.ArgumentParser(description="Concatenate before/after clip pairs into landing page videos")
    parser.add_argument('--input-dir', required=True, help="Directory with before_N.mp4 / after_N.mp4 files")
    parser.add_argument('--output-dir', required=True, help="Output directory for before.mp4 and after.mp4")
    args = parser.parse_args()

    if not os.path.isdir(args.input_dir):
        print(f"ERROR: Input directory not found: {args.input_dir}")
        sys.exit(1)

    os.makedirs(args.output_dir, exist_ok=True)

    pairs = find_pairs(args.input_dir)

    before_files = [b for b, _ in pairs]
    after_files = [a for _, a in pairs]

    before_out = os.path.join(args.output_dir, "before.mp4")
    after_out = os.path.join(args.output_dir, "after.mp4")

    print(f"Concatenating {len(before_files)} before clips -> {before_out}")
    if not concat_with_demuxer(before_files, before_out):
        print("ERROR: Failed to concatenate before clips")
        sys.exit(1)
    print(f"  -> {os.path.getsize(before_out):,} bytes")

    print(f"Concatenating {len(after_files)} after clips -> {after_out}")
    if not concat_with_demuxer(after_files, after_out):
        print("ERROR: Failed to concatenate after clips")
        sys.exit(1)
    print(f"  -> {os.path.getsize(after_out):,} bytes")

    print("Done.")


if __name__ == '__main__':
    main()
