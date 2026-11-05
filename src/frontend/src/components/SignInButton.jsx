import { LogIn } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { Button } from './shared/Button';
import { ACCOUNT_COPY } from '../config/displayNames';

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
      title={ACCOUNT_COPY.SIGN_IN}
    >
      <span className="hidden sm:inline">{ACCOUNT_COPY.SIGN_IN}</span>
    </Button>
  );
}

export default SignInButton;
