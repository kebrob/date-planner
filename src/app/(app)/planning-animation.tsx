'use client';

import { useEffect, useRef, useState } from 'react';

// One loop: the couple walks home → sun → pin → heart, then waits briefly at the heart.
const LOOP_MS = 6000;
const WALK_SHARE = 0.8;
const STEPS = [
  'Checking the weather',
  'Finding places that are open',
  'Fitting it into your time',
  'Almost ready',
];

// Three equal arcs, so each leg takes the same time at constant speed.
const ROUTE = 'M30 84 Q70 34 110 84 Q150 34 190 84 Q230 34 270 84';
const STOPS = [110, 190, 270];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function Partner({ x, fill }: { x: number; fill: string }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <circle r={11} fill={fill} />
      <circle cx={-3.5} cy={-2} r={1.4} fill="currentColor" stroke="none" />
      <circle cx={3.5} cy={-2} r={1.4} fill="currentColor" stroke="none" />
      <path d="M-4 3q4 4 8 0" />
    </g>
  );
}

function StopIcon({ kind }: { kind: 'sun' | 'pin' | 'heart' }) {
  switch (kind) {
    case 'sun':
      return (
        <>
          <circle r={5} />
          <path d="M0-10v2M0 8v2M-10 0h2M8 0h2M-7-7l1.5 1.5M5.5 5.5 7 7M-7 7l1.5-1.5M5.5-5.5 7-7" />
        </>
      );
    case 'pin':
      return (
        <>
          <path d="M0 9s-7-6.5-7-11.5a7 7 0 0 1 14 0C7 2.5 0 9 0 9z" />
          <circle cy={-2.5} r={2.2} />
        </>
      );
    case 'heart':
      return (
        <path d="M0 8c-6-4.5-9-8-9-11.5a4.6 4.6 0 0 1 9-1.5 4.6 4.6 0 0 1 9 1.5C9 0 6 3.5 0 8z" />
      );
  }
}

/** Shown while a plan is being put together: the two of you on your way to the date. */
export function PlanningAnimation() {
  const reduced = usePrefersReducedMotion();
  const route = useRef<SVGPathElement>(null);
  const couple = useRef<SVGGElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    // Same clock as the CSS animations, which start when the element mounts.
    const start = performance.now();
    const length = route.current?.getTotalLength() ?? 0;
    let frame = 0;
    const tick = (now: number) => {
      const t = ((now - start) % LOOP_MS) / LOOP_MS;
      const walked = Math.min(1, t / WALK_SHARE);
      setStep(t >= WALK_SHARE ? 3 : Math.floor(walked * 3));
      if (!reduced && route.current && couple.current) {
        const p = route.current.getPointAtLength(walked * length);
        couple.current.setAttribute('transform', `translate(${p.x} ${p.y})`);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  return (
    <div className="flex flex-col items-center gap-4 rounded-[28px] bg-cream px-4 pt-6 pb-7">
      <svg
        viewBox="0 24 300 92"
        className="w-full max-w-sm text-ink"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <defs>
          <mask id="planning-route-drawn">
            <path
              d={ROUTE}
              stroke="white"
              strokeWidth={8}
              pathLength={1}
              className={reduced ? undefined : 'planning-route'}
            />
          </mask>
        </defs>
        <path ref={route} d={ROUTE} className="text-line" strokeDasharray="0.5 7" strokeWidth={3} />
        <path d={ROUTE} strokeDasharray="0.5 7" strokeWidth={3} mask="url(#planning-route-drawn)" />

        {/* Home, where you set off. */}
        <g transform="translate(30 100)">
          <circle r={12} fill="white" />
          <path d="M-6 6v-6l6-5.5 6 5.5v6z" fill="var(--color-mint)" />
        </g>
        {STOPS.map((x, i) => (
          <g key={x} transform={`translate(${x} 100)`}>
            <g
              className={reduced ? undefined : 'planning-stop'}
              style={{ animationDelay: `${((i + 1) / 3) * WALK_SHARE * LOOP_MS}ms` }}
            >
              <circle r={12} fill="white" />
              <g fill={i === 2 ? 'var(--color-blush)' : 'var(--color-butter)'}>
                <StopIcon kind={(['sun', 'pin', 'heart'] as const)[i]!} />
              </g>
            </g>
          </g>
        ))}

        {!reduced && (
          <g transform="translate(270 50)">
            {[-10, 0, 10].map((dx, i) => (
              <path
                key={dx}
                d="M0 4c-3-2.2-4.5-4-4.5-5.8a2.3 2.3 0 0 1 4.5-.7 2.3 2.3 0 0 1 4.5.7C4.5 0 3 1.8 0 4z"
                transform={`translate(${dx} 0)`}
                fill="var(--color-blush)"
                stroke="none"
                className="planning-heart"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </g>
        )}

        <g ref={couple} transform={reduced ? 'translate(270 84)' : 'translate(30 84)'}>
          <g transform="translate(0 -10)">
            <g className={reduced ? undefined : 'planning-hop'}>
              <path d="M-4 5q4 3 8 0" />
              <Partner x={-11} fill="var(--color-butter)" />
              <Partner x={11} fill="var(--color-blush)" />
            </g>
          </g>
        </g>
      </svg>
      <p role="status" aria-live="polite" className="text-[17px] font-medium">
        {STEPS[step]}…
      </p>
    </div>
  );
}
