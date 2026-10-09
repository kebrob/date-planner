'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { deleteTripAction, setTripFavoriteAction } from '../../ai-actions';

const iconButton =
  'grid h-10 w-10 place-items-center rounded-full bg-cream text-ink hover:bg-butter disabled:opacity-50';

export function TripActions({ id, isFavorite }: { id: string; isFavorite: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        className={`${iconButton} ${isFavorite ? 'bg-butter' : ''}`}
        disabled={pending}
        aria-pressed={isFavorite}
        aria-label={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
        onClick={() =>
          startTransition(() => setTripFavoriteAction(id, !isFavorite).then(() => router.refresh()))
        }
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill={isFavorite ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
        </svg>
      </button>
      <button
        type="button"
        className={iconButton}
        disabled={pending}
        aria-label="Delete trip"
        onClick={() =>
          confirm('Delete this trip?') &&
          startTransition(async () => {
            await deleteTripAction(id);
            router.push('/trips');
          })
        }
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
        </svg>
      </button>
    </div>
  );
}
