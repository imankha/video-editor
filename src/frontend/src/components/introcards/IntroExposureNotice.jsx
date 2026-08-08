// T5220 Scope F — the public-exposure notice, extracted from
// IntroCardCarousel.jsx (2nd use). Compliance-single-source (T5230): the
// exposure wording must live in exactly one place so a future edit can't
// diverge between the picker and the share dialog.

import { AlertTriangle } from 'lucide-react';

export function IntroExposureNotice({ linkLabel = "reel's link" }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-400/90 leading-snug">
      <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
      This card includes a photo — it will be publicly visible to anyone
      with this {linkLabel}.
    </p>
  );
}

export default IntroExposureNotice;
