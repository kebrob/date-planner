import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Date Planner',
    short_name: 'Dates',
    start_url: '/',
    display: 'standalone',
    background_color: '#fafaf9',
    theme_color: '#e11d48',
  };
}
