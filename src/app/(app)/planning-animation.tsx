'use client';

import { useEffect, useRef, useState } from 'react';

// One loop: three legs (travel, then a short stop), the arrival at the heart, a fade-out.
const LEG_MS = 1100;
const PAUSE_MS = 300;
const ARRIVE_MS = 1300;
const FADE_MS = 400;
const LEGS = 3;
const LOOP_MS = LEGS * (LEG_MS + PAUSE_MS) + ARRIVE_MS + FADE_MS;
// The second dot walks this far behind the first one (SVG units along the route).
const TRAIL = 15;

const STEPS = [
  'Checking the weather',
  'Finding places that are open',
  'Fitting it into your time',
  'Almost ready',
];

// Stops on the way; legs between them are curves with horizontal tangents.
const STOPS = [
  { x: 32, y: 86 },
  { x: 120, y: 46 },
  { x: 208, y: 86 },
  { x: 290, y: 46 },
];
const LEG_PATHS = STOPS.slice(1).map((to, i) => {
  const from = STOPS[i]!;
  return `M${from.x} ${from.y} C${from.x + 40} ${from.y} ${to.x - 40} ${to.y} ${to.x} ${to.y}`;
});
const ROUTE = `M${STOPS[0]!.x} ${STOPS[0]!.y} ${LEG_PATHS.map((p) => p.slice(p.indexOf('C'))).join(' ')}`;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

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

function StopIcon({ index }: { index: number }) {
  switch (index) {
    case 0:
      return <path d="M-5 4.5v-5L0-4.5l5 4v5z" />;
    case 1:
      return (
        <>
          <circle r={3} />
          <path d="M0-7v1.6M0 5.4V7M-7 0h1.6M5.4 0H7M-4.9-4.9l1.1 1.1M3.8 3.8l1.1 1.1M-4.9 4.9l1.1-1.1M3.8-3.8l1.1-1.1" />
        </>
      );
    case 2:
      return (
        <>
          <path d="M0 6.5s-4.5-4.2-4.5-7.5a4.5 4.5 0 0 1 9 0C4.5 2.3 0 6.5 0 6.5z" />
          <circle cy={-1} r={1.4} />
        </>
      );
    default:
      return (
        <path d="M0 5C-3.6 2.4-5.5.3-5.5-1.8a2.9 2.9 0 0 1 5.5-1.3 2.9 2.9 0 0 1 5.5 1.3C5.5.3 3.6 2.4 0 5z" />
      );
  }
}

// Fill of each stop once reached.
const REACHED_FILL = ['#ffffff', '#f6d77a', '#f6d77a', '#f7c4b5'];

/** Shown while a plan is put together: the two of you travelling along your date. */
export function PlanningAnimation() {
  const reduced = usePrefersReducedMotion();
  const route = useRef<SVGPathElement>(null);
  const drawn = useRef<SVGPathElement>(null);
  const legs = useRef<(SVGPathElement | null)[]>([]);
  const lead = useRef<SVGGElement>(null);
  const follow = useRef<SVGGElement>(null);
  const [reached, setReached] = useState(1);
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<'travel' | 'arrived' | 'fade'>('travel');
  const [loop, setLoop] = useState(0);

  useEffect(() => {
    const path = route.current;
    if (!path) return;
    const total = path.getTotalLength();
    const lengths = legs.current.map((l) => l?.getTotalLength() ?? total / LEGS);
    const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
    const place = (el: SVGGElement | null, at: number) => {
      const p = path.getPointAtLength(Math.max(0, Math.min(total, at)));
      el?.setAttribute('transform', `translate(${p.x} ${p.y})`);
    };
    const begin = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      // The frame timestamp can be slightly earlier than `begin`.
      const elapsed = Math.max(0, now - begin);
      const t = elapsed % LOOP_MS;
      setLoop(Math.floor(elapsed / LOOP_MS));
      const travelEnd = LEGS * (LEG_MS + PAUSE_MS);
      let length = total;
      if (t < travelEnd) {
        const leg = Math.floor(t / (LEG_MS + PAUSE_MS));
        const progress = Math.min(1, (t - leg * (LEG_MS + PAUSE_MS)) / LEG_MS);
        length = starts[leg]! + easeInOut(progress) * lengths[leg]!;
        setReached(leg + (progress >= 1 ? 2 : 1));
        setStep(leg);
        setPhase('travel');
      } else {
        setReached(LEGS + 1);
        setStep(STEPS.length - 1);
        setPhase(t < travelEnd + ARRIVE_MS ? 'arrived' : 'fade');
      }
      if (reduced) {
        length = total;
        setReached(LEGS + 1);
      }
      drawn.current?.setAttribute('stroke-dashoffset', String(total - length));
      place(lead.current, length);
      place(follow.current, length - TRAIL);
      frame = requestAnimationFrame(tick);
    };
    drawn.current?.setAttribute('stroke-dasharray', String(total));
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  const arrived = phase !== 'travel' && !reduced;

  return (
    <div className="flex flex-col items-center gap-3 rounded-[28px] bg-cream px-4 pt-7 pb-6">
      <svg
        viewBox="0 18 322 92"
        className={`w-full max-w-sm transition-opacity duration-400 ${
          phase === 'fade' && !reduced ? 'opacity-0' : 'opacity-100'
        }`}
        fill="none"
        aria-hidden
      >
        <defs>
          <filter id="planning-dot-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
              dx="0"
              dy="1"
              stdDeviation="1.2"
              floodColor="#1d1d1f"
              floodOpacity="0.18"
            />
          </filter>
        </defs>
        {LEG_PATHS.map((d, i) => (
          <path
            key={d}
            ref={(el) => {
              legs.current[i] = el;
            }}
            d={d}
            visibility="hidden"
          />
        ))}
        <path
          ref={route}
          d={ROUTE}
          stroke="#e4dcc4"
          strokeWidth={2}
          strokeDasharray="1 6"
          strokeLinecap="round"
        />
        <path ref={drawn} d={ROUTE} stroke="#1d1d1f" strokeWidth={2} strokeLinecap="round" />

        {/* Below the stops: the dots disappear into a stop when they arrive. */}
        <g
          className="transition-opacity duration-300"
          style={{ opacity: arrived || reduced ? 0 : 1 }}
          filter="url(#planning-dot-shadow)"
        >
          <g ref={follow}>
            <circle r={5.5} fill="#f7c4b5" stroke="#ffffff" strokeWidth={2} />
          </g>
          <g ref={lead}>
            <circle r={5.5} fill="#e9bf45" stroke="#ffffff" strokeWidth={2} />
          </g>
        </g>
        {STOPS.map((stop, i) => {
          const isReached = i < reached;
          const isHeart = i === STOPS.length - 1;
          return (
            <g key={i} transform={`translate(${stop.x} ${stop.y})`}>
              {isHeart && arrived && (
                <circle key={loop} r={14} className="planning-ripple" fill="#f7c4b5" />
              )}
              <g
                className="transition-transform duration-500 ease-[cubic-bezier(.34,1.56,.64,1)]"
                style={{
                  transformBox: 'fill-box',
                  transformOrigin: 'center',
                  transform: `scale(${isHeart && arrived ? 1.12 : isReached ? 1 : 0.88})`,
                }}
              >
                <circle
                  r={13}
                  fill={isReached ? REACHED_FILL[i] : '#ffffff'}
                  stroke={isReached ? '#1d1d1f' : '#e4dcc4'}
                  strokeWidth={1.5}
                  className="transition-colors duration-300"
                />
                <g
                  stroke={isReached ? '#1d1d1f' : '#b9b3a3'}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-colors duration-300"
                >
                  <StopIcon index={i} />
                </g>
              </g>
            </g>
          );
        })}
      </svg>
      <p
        key={step}
        role="status"
        aria-live="polite"
        className="planning-text text-[17px] font-medium tracking-tight"
      >
        {STEPS[step]}
      </p>
    </div>
  );
}
