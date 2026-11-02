/** T11500: DEV-only view. Props only. */
export default function DevAccountPicker({ presets, stackId, error, pendingPreset, onPick, onUseRealSignIn }) {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md bg-gray-800 rounded-xl border border-gray-700 p-8 space-y-4">
        <h1 className="text-xl font-semibold text-white">Dev account</h1>
        <p className="text-sm text-gray-400">
          Each pick creates a new account{stackId ? ` (stack ${stackId})` : ''}.
        </p>
        {error && (
          <div className="px-3 py-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">{error}</div>
        )}
        {presets.map((p) => {
          const pending = pendingPreset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              disabled={!p.available || !!pendingPreset}
              onClick={() => onPick(p.id)}
              className="w-full text-left p-4 rounded-lg border border-gray-600 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <div className="font-medium text-white">{p.label}{pending ? ' (signing in...)' : ''}</div>
              <div className="text-sm text-gray-300">{p.description}</div>
              <div className="text-xs text-gray-500">creates a new account</div>
              {!p.available && p.unavailable_reason && (
                <div className="text-xs text-red-300 mt-1">{p.unavailable_reason}</div>
              )}
            </button>
          );
        })}
        <button type="button" onClick={onUseRealSignIn} className="text-sm text-gray-400 hover:text-gray-200 underline">
          Use the real sign-in screen
        </button>
      </div>
    </div>
  );
}
