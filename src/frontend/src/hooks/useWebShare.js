import { useMemo, useCallback } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
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

  const webShare = useCallback(async ({ downloadId, title, text, filename }) => {
    if (capability === ShareCapability.FULL) {
      const resp = await apiFetch(`${API_BASE}/api/downloads/${downloadId}/file`);
      if (!resp.ok) throw new Error('Failed to fetch video for sharing');
      const blob = await resp.blob();
      const file = new File([blob], filename, { type: 'video/mp4' });
      await navigator.share({ title, text, files: [file] });
      return 'native';
    }

    const shareUrl = await createShareUrl(downloadId);

    // Gate on `capability` (isMobile-aware), not the raw navigator.share
    // feature check -- some desktop Chromium builds expose navigator.share
    // for URL-only shares even without touch, which would otherwise pop the
    // bare OS share sheet on desktop instead of respecting the mobile-only
    // capability this hook already computed above.
    if (capability !== ShareCapability.NONE && navigator.share) {
      await navigator.share({ title, text, url: shareUrl });
      return 'link';
    }

    await copyToClipboard(shareUrl);
    return 'clipboard';
  }, [capability]);

  // Legacy: single share function that picks the best method
  const share = useCallback(async (opts) => {
    if (capability !== ShareCapability.NONE) {
      return webShare(opts);
    }
    return copyLink(opts);
  }, [capability, webShare, copyLink]);

  return { capability, isMobile, share, copyLink, webShare };
}
