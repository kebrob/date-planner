'use client';

import type { ChosenStopInput } from '@/planner/service';
import type { PlanView } from '@/planner/view';
import type { LatLng } from '@/ports/places';
import { StopPicker } from './stop-picker';

/**
 * Pickers for adding a stop to a gap (`adding`: its position) and for replacing a stop
 * (`choosing`: its index); shared by new and saved plans. Searches look around the stops next to
 * the gap or the replaced stop, else around the chosen area.
 */
export function PlanEditPickers({
  items,
  area,
  adding,
  choosing,
  onClose,
  onAdd,
  onReplace,
}: {
  items: PlanView['items'];
  area: LatLng | null;
  adding: number | null;
  choosing: number | null;
  onClose: () => void;
  onAdd: (position: number, stop: ChosenStopInput | null) => void;
  onReplace: (index: number, stop: ChosenStopInput, mode: 'keep' | 'around') => void;
}) {
  const near = (index: number) => items[index]?.place?.location ?? area;
  // Around the stop before the gap, or the one after it.
  const nearGap = (position: number) => items[position - 1]?.place?.location ?? near(position);

  if (adding !== null) {
    return (
      <StopPicker
        heading="Add a stop"
        near={nearGap(adding)}
        onClose={onClose}
        onSurprise={() => {
          onClose();
          onAdd(adding, null);
        }}
        onPick={(picked) => {
          onClose();
          onAdd(adding, picked.stop);
        }}
      />
    );
  }
  if (choosing !== null) {
    return (
      <StopPicker
        heading={`Instead of ${items[choosing]?.title.toLowerCase() ?? 'this'}`}
        near={near(choosing)}
        askMode
        onClose={onClose}
        onPick={(picked, mode) => {
          onClose();
          onReplace(choosing, picked.stop, mode);
        }}
      />
    );
  }
  return null;
}
