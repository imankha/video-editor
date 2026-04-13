import { useAuthStore } from '../stores/authStore';
import { LoginScreen } from './LoginScreen';

/**
 * AppAuthGate — top-level render gate for the app shell.
 *
 * Three branches:
 *  - `isCheckingSession` true: show a loading spinner. NEVER show the login
 *    screen here, to avoid a login-flash for returning users with a valid
 *    cookie (their /me will succeed and flip straight to authenticated).
 *  - not authenticated + done checking: render <LoginScreen />.
 *  - authenticated: render `children` (the app).
 *
 * Keep the gate cheap — `children` should not even render while unauthenticated
 * so that App.jsx's data fetches never fire for guests.
 */
export function AppAuthGate({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isCheckingSession = useAuthStore((s) => s.isCheckingSession);

  if (isCheckingSession) {
    return (
      <div
        data-testid="auth-gate-loading"
        className="fixed inset-0 bg-gray-900 flex items-center justify-center"
      >
        <div className="w-10 h-10 border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return children;
}
