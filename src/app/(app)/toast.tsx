'use client';

import { useEffect } from 'react';

const VISIBLE_MS = 6000;

/**
 * Short message above the tab bar, so feedback is visible wherever the page is scrolled. The live
 * region stays mounted, so screen readers announce each new message. `persist`: stays until
 * tapped (errors).
 */
export function Toast({
  message,
  onDone,
  persist = false,
}: {
  message: string | null;
  onDone: () => void;
  persist?: boolean;
}) {
  useEffect(() => {
    if (!message || persist) return;
    const timer = setTimeout(onDone, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message, onDone, persist]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center"
    >
      {message && (
        <button
          type="button"
          onClick={onDone}
          className="pointer-events-auto max-w-md rounded-2xl bg-ink px-4 py-3 text-left text-sm text-white shadow-lg"
        >
          {message}
          <span className="sr-only"> (dismiss)</span>
        </button>
      )}
    </div>
  );
}
