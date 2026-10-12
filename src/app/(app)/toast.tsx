'use client';

import { useEffect } from 'react';

const VISIBLE_MS = 6000;

/** Short message above the tab bar, so feedback is visible wherever the page is scrolled. */
export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDone, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message, onDone]);

  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center">
      <button
        type="button"
        role="status"
        aria-live="polite"
        onClick={onDone}
        className="pointer-events-auto max-w-md rounded-2xl bg-ink px-4 py-3 text-left text-sm text-white shadow-lg"
      >
        {message}
      </button>
    </div>
  );
}
