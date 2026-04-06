/**
 * Dev-only: remove before public launch.
 */
export default function DebugReset() {
  function handleClick() {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    window.location.reload();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="fixed bottom-3 right-3 z-[9999] rounded-md border border-gray-400/40 bg-gray-900/20 px-2 py-1 text-[10px] font-medium text-gray-700 opacity-40 backdrop-blur-sm transition hover:opacity-70 active:opacity-100 sm:bottom-4 sm:right-4 sm:text-xs"
      aria-label="Reset session (debug)"
    >
      Reset session
    </button>
  );
}
