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

export function useWebShare() {
  const capability = useMemo(() => {
    if (!navigator.share || !isMobileDevice()) return ShareCapability.NONE;
    try {
      const testFile = new File([''], 'test.mp4', { type: 'video/mp4' });
      if (navigator.canShare?.({ files: [testFile] })) {
        return ShareCapability.FULL;
      }
    } catch {
      // canShare not available or threw
    }
    return ShareCapability.LINK_ONLY;
  }, []);

  const share = useCallback(async ({ downloadId, title, text, filename }) => {
    if (capability === ShareCapability.FULL) {
      const resp = await apiFetch(`${API_BASE}/api/downloads/${downloadId}/file`);
      if (!resp.ok) throw new Error('Failed to fetch video for sharing');
      const blob = await resp.blob();
      const file = new File([blob], filename, { type: 'video/mp4' });
      await navigator.share({ title, text, files: [file] });
      return 'native';
    }

    const resp = await apiFetch(`${API_BASE}/api/gallery/${downloadId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_emails: [], is_public: true }),
    });
    if (!resp.ok) throw new Error('Failed to create share link');
    const data = await resp.json();
    const shareUrl = `${window.location.origin}/shared/${data.shares[0].share_token}`;

    if (capability === ShareCapability.LINK_ONLY) {
      await navigator.share({ title, text, url: shareUrl });
      return 'link';
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    return 'clipboard';
  }, [capability]);

  return { capability, share };
}
