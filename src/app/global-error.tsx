'use client';

import './globals.css';

// Replaces the root layout when that fails, so it renders its own document.
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body className="grid min-h-dvh place-items-center p-6">
        <div role="alert" className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-[28px] font-semibold tracking-tight">Something went wrong</h1>
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-full bg-ink px-5 py-3.5 text-sm font-medium text-white hover:bg-ink/85"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
