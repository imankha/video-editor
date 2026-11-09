import React from 'react';
import { useAuthStore, getImpersonationLandingPoint, buildImpersonationLandingUrl } from '../stores/authStore';

/**
 * T1510: Persistent, unmissable banner shown while an admin is impersonating
 * a user. Sticky, red, full-width, not dismissable — dismissing it would
 * make it too easy to forget you're acting as someone else.
 */
export default function ImpersonationBanner() {
  const impersonator = useAuthStore((s) => s.impersonator);
  const email = useAuthStore((s) => s.email);
  const stopImpersonation = useAuthStore((s) => s.stopImpersonation);

  if (!impersonator) return null;

  // T14990: the point captured at the start of THIS impersonation session
  // (startImpersonation's sessionStorage snapshot) — lets the admin wander
  // the app and jump straight back to where the user left off.
  const landingPoint = getImpersonationLandingPoint();

  return (
    <div
      role="alert"
      className="fixed bottom-0 left-0 right-0 z-[9999] w-full bg-red-600 text-white px-4 py-2 flex items-center justify-between border-t-4 border-red-900 font-semibold shadow-lg"
      style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
    >
      <span className="text-sm sm:text-base">
        Impersonating <strong>{email}</strong> as admin{' '}
        <strong>{impersonator.email}</strong>
      </span>
      <span className="flex items-center gap-2">
        {landingPoint && (
          <a
            href={buildImpersonationLandingUrl(landingPoint)}
            data-testid="reopen-their-page"
            className="text-sm underline text-white/90 hover:text-white"
          >
            Reopen their page
          </a>
        )}
        <button
          onClick={() => stopImpersonation()}
          className="ml-4 bg-white text-red-700 px-3 py-1 rounded font-bold hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-white text-sm"
        >
          Stop impersonating
        </button>
      </span>
    </div>
  );
}
