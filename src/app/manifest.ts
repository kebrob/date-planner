import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Date Planner',
    short_name: 'Dates',
    description: 'Date ideas and plans for the two of you',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Page background (paper): splash screen and status bar match the app.
    background_color: '#fbfbf8',
    theme_color: '#fbfbf8',
    // Generated from assets/icons/*.svg; maskable keeps the motif inside Android's safe zone.
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
