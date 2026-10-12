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
  };
}
