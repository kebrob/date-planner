import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { BottomNav, TopNav } from './nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="flex items-center justify-between p-4">
        <Link href="/" className="font-semibold">
          Date Planner
        </Link>
        <TopNav />
      </header>
      <main className="flex-1 p-4">{children}</main>
      <footer className="p-4 pb-24 text-center text-xs text-stone-400 sm:pb-4">
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Weather data by Open-Meteo.com
        </a>
        {' · Location data based on GeoNames · Places from Google / © OpenStreetMap contributors'}
      </footer>
      <BottomNav />
    </div>
  );
}
