import { useMemo, useCallback } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { fetchReelDownload } from '../utils/reelDownload';
import { useIsCoarsePointer } from './useIsMobile';

export const ShareCapability = {
  FULL: 'full',
  LINK_ONLY: 'link',
  NONE: 'none',
};

// In-flight dedup: rapid repeat clicks await the SAME request instead of
// queueing N identical POSTs behind the backend's per-user write lock (the
// endpoint is idempotent - every call returns the same public link anyway).
const inflightShareUrl = new Map();

async function createShareUrl(downloadId) {
  if (inflightShareUrl.has(downloadId)) return inflightShareUrl.get(downloadId);
  const request = (async () => {
    const resp = await apiFetch(`${API_BASE}/api/gallery/${downloadId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_emails: [], is_public: true }),
    });
    if (!resp.ok) throw new Error('Failed to create share link');
    const data = await resp.json();
    return `${window.location.origin}/shared/${data.shares[0].share_token}`;
  })();
  inflightShareUrl.set(downloadId, request);
  try {
    return await request;
  } finally {
    inflightShareUrl.delete(downloadId);
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
}

export function useWebShare() {
  // T7350: mobile-vs-desktop routing MUST use pointer capability, never a
  // navigator.userAgent regex. This is the THIRD occurrence of the same
  // landmine: T6300 removed a UA sniff from ReelTile/DownloadsPanel because it
  // misdetected touch-Windows as desktop; T5220 (8a051985) then reintroduced a
  // UA regex here to keep desktop Chromium (which exposes navigator.share) on
  // ShareModal — but that regex silently misclassifies in-app webviews,
  // "Request Desktop Site" mode, and unlisted UA strings, dropping those real
  // mobile users onto the desktop modal with no native OS share sheet.
  // useIsCoarsePointer() is the same live matchMedia gate ReelTile/DraftTile
  // already use: coarse pointer (touch/pen) => mobile share path; fine pointer
  // (mouse) => ShareModal, even on Chromium builds exposing navigator.share.
  const isMobile = useIsCoarsePointer();

  const capability = useMemo(() => {
    if (!navigator.share || !isMobile) return ShareCapability.NONE;
    try {
      const testFile = new File([''], 'test.mp4', { type: 'video/mp4' });
      if (navigator.canShare?.({ files: [testFile] })) {
        return ShareCapability.FULL;
      }
    } catch {
      // canShare not available or threw
    }
    return ShareCapability.LINK_ONLY;
  }, [isMobile]);

  const copyLink = useCallback(async ({ downloadId }) => {
    const shareUrl = await createShareUrl(downloadId);
    await copyToClipboard(shareUrl);
    return 'clipboard';
  }, []);

  // T10180 (design §2.4): link-ready needs to SHOW the URL before any copy, so
  // copyLink's create-and-immediately-copy shape can't drive it. Mints/reuses
  // the SAME single-video share token as copyLink (in-flight-deduped via
  // createShareUrl) and RETURNS the url string, with NO clipboard write.
  // Additive -- copyLink/webShare stay unchanged for their existing callers.
  const createShareLink = useCallback(async ({ downloadId }) => {
    return createShareUrl(downloadId);
  }, []);

  // T10860: re-point an EXISTING share token to a moved final_video_id after a
  // private re-export (the "Update shared version" gesture). Distinct from
  // createShareLink/copyLink, which mint or reuse a token for the CURRENT
  // video -- this preserves the already-distributed URL in place.
  const repointShareLink = useCallback(async ({ downloadId, shareToken }) => {
    const resp = await apiFetch(`${API_BASE}/api/gallery/${downloadId}/share/repoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share_token: shareToken }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      const err = new Error(data.detail || 'Failed to update shared version');
      err.code = data.code;
      // T10860 (design §5): 404/403/400/410 are plain HTTPExceptions with no
      // machine-readable `code` field -- the caller needs the HTTP status to
      // pick the right copy for those.
      err.status = resp.status;
      throw err;
    }
    const data = await resp.json();
    // changed: false on the idempotent no-op (already current) vs true on a
    // real re-point -- design §5 shows distinct success copy for each.
    return { shareUrl: data.share_url, changed: data.changed };
  }, []);

  // T11510: a file and a link are two different shares (EPIC decision 1), so
  // they are two intent-named functions instead of one that picks a payload
  // by capability. The CALLER decides which to offer, using `capability`
  // (FULL -> both; LINK_ONLY -> shareLink only) -- these two never branch on
  // capability themselves.
  const shareVideoFile = useCallback(async ({ downloadId, title, text, filename }) => {
    const { response } = await fetchReelDownload(downloadId);
    const blob = await response.blob();
    const file = new File([blob], filename, { type: 'video/mp4' });
    await navigator.share({ title, text, files: [file] });
  }, []);

  const shareLink = useCallback(async ({ url, title, text }) => {
    await navigator.share({ title, text, url });
  }, []);

  return {
    capability, isMobile, copyLink, createShareLink, repointShareLink,
    shareVideoFile, shareLink,
  };
}
