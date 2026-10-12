import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { formatDuration } from '@/lib/duration';
import { listUpcoming } from '@/planner/saved';
import { nextOuting } from '@/planner/outing';
import { ideasForNextOuting } from '@/planner/service';
import { nextTrain } from '@/planner/live';
import { listRatingPrompts } from '@/ratings/service';
import { AskBar } from './ask-bar';
import { LiveTrainCard } from './live-train';
import { PlanCard } from './plan-card';
import { RatingPromptCard } from './rating';
import { STEPS } from './new/step-list';
import { longDayFormat } from '@/lib/time';

function PlayDot({ tone }: { tone: 'butter' | 'ink' | 'white' }) {
  const colors = {
    butter: 'bg-butter text-ink',
    ink: 'bg-ink text-white',
    white: 'bg-white text-ink',
  }[tone];
  return (
    <span
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${colors}`}
      aria-hidden
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
        <path d="M3 1.8v10.4a.8.8 0 0 0 1.2.7l8.6-5.2a.8.8 0 0 0 0-1.4L4.2 1.1A.8.8 0 0 0 3 1.8z" />
      </svg>
    </span>
  );
}

function Pill({ children, onDark }: { children: React.ReactNode; onDark?: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] whitespace-nowrap text-ink ${onDark ? 'bg-white' : 'bg-white/80 ring-1 ring-line'}`}
    >
      {children}
    </span>
  );
}

export default async function HomePage() {
  await requireSession();
  const { when } = nextOuting();
  const [upcoming, ideas, train, prompts] = await Promise.all([
    listUpcoming(),
    ideasForNextOuting(),
    nextTrain().catch(() => null),
    listRatingPrompts().catch(() => []),
  ]);

  return (
    <div className="flex flex-col gap-7">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-sm text-mist">{longDayFormat.format(new Date())}</p>
          <h1 className="text-[34px] leading-tight font-semibold tracking-tight">Hi, you two!</h1>
        </div>
        <Link
          href="/admin"
          aria-label="Settings and catalog"
          className="grid h-11 w-11 place-items-center rounded-full bg-butter hover:bg-butter-deep"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden
          >
            <circle cx="12" cy="8.5" r="3.5" />
            <path d="M5 19.5c1.2-3.3 3.9-5 7-5s5.8 1.7 7 5" strokeLinecap="round" />
          </svg>
        </Link>
      </header>

      {train && <LiveTrainCard initial={train} />}

      {prompts.slice(0, 1).map((p) => (
        <RatingPromptCard key={p.id} prompt={p} />
      ))}

      <AskBar />

      <section className="grid grid-cols-2 gap-3">
        <Link
          href="/new"
          className="flex min-h-48 flex-col justify-between rounded-[28px] bg-ink p-5 text-white hover:bg-ink/90"
        >
          <span className="text-xl leading-snug font-semibold">Plan a date</span>
          <span className="flex items-end justify-between">
            <PlayDot tone="butter" />
            <Pill onDark>{STEPS.length} steps</Pill>
          </span>
        </Link>
        <Link
          href="/new?quick=1"
          className="flex min-h-48 flex-col justify-between rounded-[28px] bg-butter p-5 hover:bg-butter-deep"
        >
          <span className="text-xl leading-snug font-semibold">Surprise us {when}</span>
          <span className="flex items-end justify-between">
            <PlayDot tone="ink" />
            <Pill>instant</Pill>
          </span>
        </Link>
      </section>

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Coming up</h2>
            <Link href="/plans" className="text-sm text-mist hover:text-ink">
              See all
            </Link>
          </div>
          {upcoming.slice(0, 2).map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </section>
      )}

      {ideas.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Ideas for {when}</h2>
          {ideas.map((idea, i) => (
            <Link
              key={idea.id}
              href={`/new?quick=1&idea=${idea.id}`}
              className={`flex items-center justify-between gap-3 rounded-3xl p-4 ${
                i === 0
                  ? 'bg-cream hover:bg-butter'
                  : 'bg-white ring-1 ring-line hover:ring-butter-deep'
              }`}
            >
              <span className="flex flex-col gap-2">
                <span className="font-medium">{idea.title}</span>
                <span className="flex flex-wrap gap-1.5">
                  <Pill>{formatDuration(idea.durationMinutes)}</Pill>
                  <Pill>
                    {idea.costMaxEur === 0 ? 'free' : `${idea.costMinEur}–${idea.costMaxEur} €`}
                  </Pill>
                </span>
              </span>
              <PlayDot tone={i === 0 ? 'white' : 'butter'} />
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
