"""
Dissolve transition strategy - Cross-dissolve between clips.

This transition uses FFmpeg's xfade filter to create a smooth
cross-dissolve effect where clips overlap and blend into each other.
"""

import subprocess
import shutil
import logging
from typing import List

from .base import TransitionStrategy, TransitionFactory
from ..ffmpeg_service import get_video_duration

logger = logging.getLogger(__name__)


class DissolveTransition(TransitionStrategy):
    """
    Cross-dissolve transition between clips.

    Uses FFmpeg's xfade filter to blend the end of one clip
    with the beginning of the next, creating a smooth transition.
    """

    @property
    def name(self) -> str:
        return "dissolve"

    def concatenate(
        self,
        clip_paths: List[str],
        output_path: str,
        duration: float = 0.5,
        include_audio: bool = True
    ) -> bool:
        """
        Concatenate clips with cross-dissolve transitions.

        Args:
            clip_paths: List of input video file paths
            output_path: Path for the concatenated output
            duration: Duration of dissolve overlap in seconds
            include_audio: Whether to include audio in output

        Returns:
            True if successful, False otherwise
        """
        if not clip_paths:
            logger.error("[DissolveTransition] No clips provided")
            return False

        if len(clip_paths) == 1:
            shutil.copy2(clip_paths[0], output_path)
            return True

        try:
            # Get clip durations
            durations = [get_video_duration(path) for path in clip_paths]

            # Build xfade chain for video
            # Example: [0:v][1:v]xfade=transition=dissolve:duration=0.5:offset=D0[v01]
            #          [v01][2:v]xfade=transition=dissolve:duration=0.5:offset=D1[outv]
            video_filter_parts = []
            current_label = "[0:v]"
            cumulative_duration = durations[0]

            for i in range(1, len(clip_paths)):
                offset = cumulative_duration - duration
                is_last = (i == len(clip_paths) - 1)
                output_label = "[outv]" if is_last else f"[v{i}]"

                video_filter_parts.append(
                    f"{current_label}[{i}:v]xfade=transition=dissolve:"
                    f"duration={duration}:offset={offset}{output_label}"
                )

                current_label = output_label
                cumulative_duration += durations[i] - duration

            # Build audio crossfade chain
            audio_filter_parts = []
            if include_audio:
                current_audio = "[0:a]"
                for i in range(1, len(clip_paths)):
                    is_last = (i == len(clip_paths) - 1)
                    output_label = "[outa]" if is_last else f"[a{i}]"
                    audio_filter_parts.append(
                        f"{current_audio}[{i}:a]acrossfade=d={duration}{output_label}"
                    )
                    current_audio = output_label

            # Combine filters
            all_filters = video_filter_parts + audio_filter_parts
            filter_complex = ';'.join(all_filters)

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

            logger.info(f"[DissolveTransition] Applying dissolve to {len(clip_paths)} clips")
            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                logger.error(f"[DissolveTransition] FFmpeg error: {result.stderr}")
                return False

            return True

        except Exception as e:
            logger.error(f"[DissolveTransition] Failed: {e}")
            return False


# Register with factory
TransitionFactory.register('dissolve', DissolveTransition)
