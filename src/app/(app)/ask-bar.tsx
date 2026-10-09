'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Entry to Claude: the "search" on the home screen. */
export function AskBar() {
  const router = useRouter();
  const [text, setText] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.trim();
        router.push(q ? `/chat?q=${encodeURIComponent(q)}` : '/chat');
      }}
      className="flex items-center gap-3 rounded-full bg-white px-5 py-3.5 ring-1 ring-line focus-within:ring-2 focus-within:ring-ink"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="shrink-0 text-mist"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
        placeholder="Ask Claude for a date idea"
        aria-label="Describe your date for Claude"
        className="w-full bg-transparent text-[15px] outline-none placeholder:text-mist"
      />
    </form>
  );
}
