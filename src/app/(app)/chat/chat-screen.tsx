'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import type { ChatTurn } from '@/ai/chat';
import { AskClaude } from '../ask-claude';
import { SessionResult, usePlanSession } from '../plan-session';

export function ChatScreen({
  history,
  enabled,
  initialQuery,
}: {
  history: ChatTurn[];
  enabled: boolean;
  initialQuery?: string;
}) {
  const session = usePlanSession();
  // Drop ?q= right away so a reload does not send the question again.
  useEffect(() => {
    if (initialQuery) window.history.replaceState(null, '', '/chat');
  }, [initialQuery]);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Link
          href="/"
          aria-label="Back"
          className="grid h-10 w-10 place-items-center rounded-full hover:bg-cream"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 3 5 9l6 6" />
          </svg>
        </Link>
        <h1 className="text-[28px] font-semibold tracking-tight">Ask Claude</h1>
      </div>
      <AskClaude
        initial={history}
        enabled={enabled}
        initialQuery={initialQuery}
        onPlans={(plans) => {
          const latest = plans.at(-1);
          if (latest) session.show(latest);
        }}
      />
      {session.message && <p className="text-sm text-red-600">{session.message}</p>}
      <SessionResult session={session} />
    </div>
  );
}
