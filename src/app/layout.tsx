import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Date Planner',
  description: 'Private date planner',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: 'Date Planner', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  // Matches the page background (paper), so the browser and status bar blend in.
  themeColor: '#fbfbf8',
  width: 'device-width',
  initialScale: 1,
  // Lets the bottom tab bar extend under the iPhone home indicator (padded via safe-area inset).
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
