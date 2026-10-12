'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SearchField } from './search-field';

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
    >
      <SearchField
        value={text}
        onChange={setText}
        maxLength={1000}
        placeholder="Ask Claude for a date idea"
        ariaLabel="Describe your date for Claude"
      />
    </form>
  );
}
