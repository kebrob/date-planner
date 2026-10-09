import Link from 'next/link';
import { requireSession } from '@/auth/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="flex items-center justify-between p-4">
        <Link href="/" className="font-semibold">
          Date Planner
        </Link>
        <nav className="flex gap-4 text-sm text-stone-500">
          <Link href="/plans">Our dates</Link>
          <Link href="/admin">Admin</Link>
          <Link href="/settings/security">Security</Link>
        </nav>
      </header>
      <main className="flex-1 p-4">{children}</main>
      <footer className="p-4 text-center text-xs text-stone-400">
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Weather data by Open-Meteo.com
        </a>
        {' · Location data based on GeoNames · Places from Google / © OpenStreetMap contributors'}
      </footer>
    </div>
  );
}
