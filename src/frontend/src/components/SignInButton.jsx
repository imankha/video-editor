import { LogIn } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { Button } from './shared/Button';

/**
 * SignInButton — shown pre-login in the top-right cluster.
 * Opens AuthGateModal via requireAuth (no-op action, the point is the modal).
 */
export function SignInButton() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const requireAuth = useAuthStore((s) => s.requireAuth);

  if (isAuthenticated) return null;

  return (
    <Button
      variant="primary"
      size="md"
      icon={LogIn}
      onClick={() => requireAuth(() => {})}
      title="Sign in"
    >
      <span className="hidden sm:inline">Sign In</span>
    </Button>
  );
}

export default SignInButton;
