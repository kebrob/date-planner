import { requireSession } from '@/auth/session';
import { BottomNav, TopNav } from './nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return (
    <div className="flex min-h-dvh flex-col">
      <TopNav />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pt-6 pb-8">{children}</main>
      <footer className="mx-auto w-full max-w-2xl px-5 pb-28 text-center text-[11px] text-mist sm:pb-6">
        <a
          href="https://open-meteo.com/"
          target="_blank"
          rel="noreferrer"
          className="hover:text-ink"
        >
          Weather data by Open-Meteo.com
        </a>
        {' · Location data based on GeoNames · Places from Google / © OpenStreetMap contributors'}
      </footer>
      <BottomNav />
    </div>
  );
}
