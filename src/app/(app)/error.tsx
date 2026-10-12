'use client';

import Link from 'next/link';

export default function ErrorPage({ unstable_retry }: { unstable_retry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-4 pt-10">
      <h1 className="text-[28px] font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-mist">
        Maybe the connection dropped. Your saved plans are safe – try again in a moment.
      </p>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="rounded-full bg-ink px-5 py-3.5 text-sm font-medium text-white hover:bg-ink/85"
        >
          Try again
        </button>
        <Link href="/" className="text-sm text-mist underline hover:text-ink">
          Home
        </Link>
      </div>
    </div>
  );
}
