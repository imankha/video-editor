/** T11500: DEV-only auth wall container. Picker when the probe succeeded, else real sign-in. */
import { useDevAccountStore } from '../stores/devAccountStore';
import { SignInScreen } from './SignInScreen';
import DevAccountPicker from './DevAccountPicker';

export default function DevAuthWall() {
  const { presets, stackId, error, pendingPreset, useRealSignIn, pick, showRealSignIn } = useDevAccountStore();
  if (!presets || useRealSignIn) return <SignInScreen />;
  return (
    <DevAccountPicker
      presets={presets}
      stackId={stackId}
      error={error}
      pendingPreset={pendingPreset}
      onPick={pick}
      onUseRealSignIn={showRealSignIn}
    />
  );
}
