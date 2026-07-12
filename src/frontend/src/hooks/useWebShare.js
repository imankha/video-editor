import { useMemo, useCallback } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';

export const ShareCapability = {
  FULL: 'full',
  LINK_ONLY: 'link',
  NONE: 'none',
};

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
}

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
  const isMobile = useMemo(() => isMobileDevice(), []);

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

    if (navigator.share) {
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
