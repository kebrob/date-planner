'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ICON = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const ITEMS = [
  {
    href: '/',
    label: 'Home',
    icon: (
      <svg {...ICON}>
        <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9v5.5H5.5A1.5 1.5 0 0 1 4 19z" />
      </svg>
    ),
  },
  {
    href: '/plans',
    label: 'Our dates',
    icon: (
      <svg {...ICON}>
        <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
      </svg>
    ),
  },
  {
    href: '/trips',
    label: 'Trips',
    icon: (
      <svg {...ICON}>
        <rect x="3.5" y="7.5" width="17" height="12" rx="2.5" />
        <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 12.5h17" />
      </svg>
    ),
  },
];

// Full-screen flows hide the tab bar.
const HIDDEN_ON = ['/new'];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
}

/** Desktop: slim header with the same destinations. */
export function TopNav() {
  const isActive = useIsActive();
  return (
    <header className="mx-auto hidden w-full max-w-2xl items-center justify-between px-5 pt-6 sm:flex">
      <Link href="/" className="font-semibold tracking-tight">
        Date Planner
      </Link>
      <nav className="flex gap-6 text-sm">
        {ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={isActive(item.href) ? 'font-medium text-ink' : 'text-mist hover:text-ink'}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

/** Mobile: tab bar at the bottom, within thumb reach. */
export function BottomNav() {
  const isActive = useIsActive();
  const pathname = usePathname();
  if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden">
      <ul className="mx-auto flex max-w-md justify-around">
        {ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                className={`flex flex-col items-center gap-0.5 px-6 pt-3 pb-2 text-[11px] ${
                  active ? 'text-ink' : 'text-mist'
                }`}
              >
                {item.icon}
                <span className={active ? 'font-medium' : ''}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
