"""
Fade transition strategy - Fade to black between clips.

This transition applies a fade-out at the end of each clip (except the last)
and a fade-in at the start of each clip (except the first), creating a
"fade through black" effect.
"""

import subprocess
import logging
from typing import List

from .base import TransitionStrategy, TransitionFactory
from ..ffmpeg_service import get_video_duration

logger = logging.getLogger(__name__)


class FadeTransition(TransitionStrategy):
    """
    Fade to black transition between clips.

    Creates a smooth transition by fading out each clip before the
    next one fades in, with a brief black screen between them.
    """

    @property
    def name(self) -> str:
        return "fade"

    def concatenate(
        self,
        clip_paths: List[str],
        output_path: str,
        duration: float = 0.5,
        include_audio: bool = True
    ) -> bool:
        """
        Concatenate clips with fade to black transitions.

        Args:
            clip_paths: List of input video file paths
            output_path: Path for the concatenated output
            duration: Duration of fade in/out in seconds
            include_audio: Whether to include audio in output

        Returns:
            True if successful, False otherwise
        """
        if not clip_paths:
            logger.error("[FadeTransition] No clips provided")
            return False

        if len(clip_paths) == 1:
            import shutil
            shutil.copy2(clip_paths[0], output_path)
            return True

        try:
            # Get clip durations
            durations = [get_video_duration(path) for path in clip_paths]

            # Build complex filter
            filter_parts = []
            video_labels = []
            audio_labels = []

            for i, (path, dur) in enumerate(zip(clip_paths, durations)):
                is_first = (i == 0)
                is_last = (i == len(clip_paths) - 1)

                # Video filter: fade in/out
                effects = []

                if not is_last:
                    # Fade out at end
                    fade_start = max(0, dur - duration)
                    effects.append(f"fade=t=out:st={fade_start}:d={duration}")

                if not is_first:
                    # Fade in at start
                    effects.append(f"fade=t=in:st=0:d={duration}")

                if effects:
                    filter_parts.append(f"[{i}:v]{','.join(effects)}[v{i}]")
                else:
                    filter_parts.append(f"[{i}:v]copy[v{i}]")
                video_labels.append(f"[v{i}]")

                # Audio filter: fade in/out (if audio included)
                if include_audio:
                    audio_effects = []

                    if not is_last:
                        fade_start = max(0, dur - duration)
                        audio_effects.append(f"afade=t=out:st={fade_start}:d={duration}")

                    if not is_first:
                        audio_effects.append(f"afade=t=in:st=0:d={duration}")

                    if audio_effects:
                        filter_parts.append(f"[{i}:a]{','.join(audio_effects)}[a{i}]")
                    else:
                        filter_parts.append(f"[{i}:a]acopy[a{i}]")
                    audio_labels.append(f"[a{i}]")

            # Concatenate video streams
            video_concat = ''.join(video_labels) + f"concat=n={len(clip_paths)}:v=1:a=0[outv]"
            filter_parts.append(video_concat)

            # Concatenate audio streams (if audio included)
            if include_audio:
                audio_concat = ''.join(audio_labels) + f"concat=n={len(clip_paths)}:v=0:a=1[outa]"
                filter_parts.append(audio_concat)

            filter_complex = ';'.join(filter_parts)

            # Build FFmpeg command
            cmd = ['ffmpeg', '-y']
            for path in clip_paths:
                cmd.extend(['-i', path])

            cmd.extend(['-filter_complex', filter_complex])
            cmd.extend(['-map', '[outv]'])

            if include_audio:
                cmd.extend(['-map', '[outa]'])
                cmd.extend(['-c:a', 'aac', '-b:a', '192k'])
            else:
                cmd.append('-an')

            cmd.extend([
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '18',
                '-pix_fmt', 'yuv420p'
            ])
            cmd.append(output_path)

            logger.info(f"[FadeTransition] Applying fade transitions to {len(clip_paths)} clips")
            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                logger.error(f"[FadeTransition] FFmpeg error: {result.stderr}")
                return False

            return True

        except Exception as e:
            logger.error(f"[FadeTransition] Failed: {e}")
            return False


# Register with factory
TransitionFactory.register('fade', FadeTransition)
