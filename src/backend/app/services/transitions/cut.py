"""
Cut transition strategy - Simple concatenation with no transition effect.

This is the fastest transition option as it uses FFmpeg's concat demuxer
for direct concatenation without re-encoding (when possible).
"""

import os
import subprocess
import tempfile
import logging
from typing import List

from .base import TransitionStrategy, TransitionFactory

logger = logging.getLogger(__name__)


class CutTransition(TransitionStrategy):
    """
    Simple cut transition - direct concatenation with no effects.

    Uses FFmpeg's concat demuxer which is fast and preserves quality.
    """

    @property
    def name(self) -> str:
        return "cut"

    def concatenate(
        self,
        clip_paths: List[str],
        output_path: str,
        duration: float = 0.0,  # Ignored for cut
        include_audio: bool = True
    ) -> bool:
        """
        Concatenate clips with simple cuts (no transition).

        Args:
            clip_paths: List of input video file paths
            output_path: Path for the concatenated output
            duration: Ignored for cut transitions
            include_audio: Whether to include audio in output

        Returns:
            True if successful, False otherwise
        """
        if not clip_paths:
            logger.error("[CutTransition] No clips provided")
            return False

        if len(clip_paths) == 1:
            # Single clip - just copy
            import shutil
            shutil.copy2(clip_paths[0], output_path)
            return True

        # Create concat file for FFmpeg demuxer
        concat_file = None
        try:
            with tempfile.NamedTemporaryFile(
                mode='w',
                suffix='.txt',
                delete=False,
                encoding='utf-8'
            ) as f:
                concat_file = f.name
                for path in clip_paths:
                    # FFmpeg concat demuxer requires escaped paths
                    escaped_path = path.replace("'", "'\\''")
                    f.write(f"file '{escaped_path}'\n")

            cmd = [
                'ffmpeg', '-y',
                '-f', 'concat',
                '-safe', '0',
                '-i', concat_file,
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '18',
                '-pix_fmt', 'yuv420p',
            ]

            if include_audio:
                cmd.extend(['-c:a', 'aac', '-b:a', '192k'])
            else:
                cmd.append('-an')

            cmd.append(output_path)

            logger.info(f"[CutTransition] Concatenating {len(clip_paths)} clips")
            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                logger.error(f"[CutTransition] FFmpeg error: {result.stderr}")
                return False

            return True

        except Exception as e:
            logger.error(f"[CutTransition] Failed: {e}")
            return False

        finally:
            if concat_file and os.path.exists(concat_file):
                os.remove(concat_file)


# Register with factory
TransitionFactory.register('cut', CutTransition)
