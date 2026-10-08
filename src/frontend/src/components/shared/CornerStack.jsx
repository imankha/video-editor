import { Z } from '../../constants/zLayers';

/**
 * T11950: the ONE fixed bottom-right layer. flex-col-reverse puts the first child
 * (the Report button) at the bottom and stacks later children (toasts) above it,
 * so corner elements can never overlap each other. The wrapper ignores pointer
 * events; children opt back in.
 */
export function CornerStack({ children }) {
  return (
    <div
      data-testid="corner-stack"
      className={`fixed bottom-4 right-4 lg:bottom-20 ${Z.TOAST} flex flex-col-reverse items-end gap-2 w-full max-w-sm pointer-events-none`}
    >
      {children}
    </div>
  );
}

export default CornerStack;
