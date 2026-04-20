import { useAuthStore } from '../stores/authStore';
import { ReportProblemButton } from './ReportProblemButton';

/**
 * AuthErrorBanner — shows a dismissible error banner at the top of the page
 * when there's an auth-level error (e.g. cookies blocked after sign-in).
 * Mounted once in main.jsx so it's always visible.
 */
export function AuthErrorBanner() {
  const authError = useAuthStore((s) => s.authError);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Don't show if authenticated (error was resolved) or no error
  if (isAuthenticated || !authError) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-red-900/95 border-b border-red-700 px-4 py-3 text-sm text-red-100 text-center">
      <span>{authError}</span>
      <button
        onClick={() => useAuthStore.setState({ authError: null })}
        className="ml-3 text-red-300 hover:text-white underline"
      >
        Dismiss
      </button>
      <span className="mx-2 text-red-700">|</span>
      <ReportProblemButton className="inline text-red-300 hover:text-white" />
    </div>
  );
}
