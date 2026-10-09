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
        <Link href="/settings/security" className="text-sm text-stone-500">
          Security
        </Link>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
