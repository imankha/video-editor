import { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';

/**
 * PosterFramePreview - shows the ACTUAL still that will be used as the share-link
 * preview image (T6510). The heart of the request: the user must SEE the frame,
 * not just a marker position on the timeline.
 *
 * Why a dedicated, hidden <video> instead of the playback element:
 * grabbing a frame means seeking, and seeking the live playback element would
 * yank the user's scrub position and fight the timeline. This element is
 * playback-independent -- `preload="metadata"` + a range-served seek pulls only
 * the bytes around the target time (a lightweight frame grab, per the task
 * brief), never a server-side poster render. The frame is drawn to a canvas for
 * DISPLAY only (no pixel readback), so a cross-origin R2 URL tainting the canvas
 * is irrelevant -- drawImage-for-display does not require CORS.
 *
 * Updates whenever `sourceTime` changes -- so a marker drag-end, "Use current
 * frame", or a revert re-grabs and re-shows the still immediately.
 *
 * Presentational: URL + time in, a still out. No store, no API.
 *
 * @param {Object} props
 * @param {string} props.videoUrl - the overlay working-video URL to grab from
 * @param {number} props.sourceTime - source-time seconds of the frame to show
 */
export default function PosterFramePreview({ videoUrl, sourceTime = 0 }) {
  const videoElRef = useRef(null);
  const canvasRef = useRef(null);
  const [state, setState] = useState('loading'); // 'loading' | 'ready' | 'error'

  useEffect(() => {
    const video = videoElRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !videoUrl) return undefined;

    let cancelled = false;
    setState('loading');

    const draw = () => {
      if (cancelled) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) {
        setState('error');
        return;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);
      setState('ready');
    };

    const seekTo = () => {
      const target = Math.max(0, sourceTime || 0);
      // Nudge below any known duration so a seek exactly at the end still lands
      // on a decodable frame rather than hanging past EOF.
      const dur = Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(target, Math.max(0, video.duration - 0.05))
        : target;
      if (Math.abs(video.currentTime - dur) < 0.001 && video.readyState >= 2) {
        draw(); // already parked on the frame (e.g. re-mount) -- draw straight away
      } else {
        video.currentTime = dur;
      }
    };

    const onSeeked = () => draw();
    const onError = () => { if (!cancelled) setState('error'); };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);

    if (video.readyState >= 1) {
      seekTo();
    } else {
      video.addEventListener('loadedmetadata', seekTo, { once: true });
    }

    return () => {
      cancelled = true;
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', seekTo);
    };
  }, [videoUrl, sourceTime]);

  return (
    <div className="relative w-full rounded-md overflow-hidden bg-gray-900 border border-gray-700 aspect-video">
      {/* Hidden source element -- seeked to the target frame, never played.
          NO crossOrigin: the frame is drawn to the canvas for DISPLAY only (we
          never read pixels back), so tainting is irrelevant -- and requesting
          CORS would make a presigned R2 URL that omits CORS headers fail to load
          entirely. drawImage-for-display needs no CORS. */}
      <video
        ref={videoElRef}
        src={videoUrl}
        preload="metadata"
        muted
        playsInline
        data-testid="poster-frame-source"
        className="hidden"
      />
      <canvas
        ref={canvasRef}
        data-testid="poster-frame-canvas"
        className={`w-full h-full object-contain transition-opacity ${state === 'ready' ? 'opacity-100' : 'opacity-0'}`}
      />
      {state !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
          {state === 'error'
            ? <ImageOff size={20} />
            : <span className="text-xs">Loading preview...</span>}
        </div>
      )}
    </div>
  );
}
