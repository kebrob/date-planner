'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { deleteTripAction, setTripFavoriteAction } from '../../ai-actions';

export function TripActions({ id, isFavorite }: { id: string; isFavorite: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex shrink-0 items-center gap-3">
      <button
        type="button"
        className="text-2xl"
        disabled={pending}
        aria-label={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
        onClick={() =>
          startTransition(() => setTripFavoriteAction(id, !isFavorite).then(() => router.refresh()))
        }
      >
        {isFavorite ? '★' : '☆'}
      </button>
      <button
        type="button"
        className="text-sm text-red-600"
        disabled={pending}
        onClick={() =>
          confirm('Delete this trip?') &&
          startTransition(async () => {
            await deleteTripAction(id);
            router.push('/trips');
          })
        }
      >
        Delete
      </button>
    </div>
  );
}
