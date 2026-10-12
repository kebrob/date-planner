'use client';

import 'leaflet/dist/leaflet.css';
import { useRef, useState } from 'react';
import { useLeafletMap } from '../leaflet-map';
import { saveHomePinAction } from './actions';
import { Message, primary, secondary, useAction } from './forms';

type LatLng = { lat: number; lng: number };

type Props = {
  town: LatLng;
  pin: LatLng | null;
};

/** Exact home location, set by tapping the map; no address is entered or geocoded. */
export function HomePin({ town, pin }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<LatLng | null>(pin);
  const { pending, message, run } = useAction();
  const changed = draft?.lat !== pin?.lat || draft?.lng !== pin?.lng;

  const start = pin ?? town;
  const { map } = useLeafletMap(
    container,
    { center: start, zoom: pin ? 16 : 13, maxZoom: 19 },
    (L, m) => {
      const dot = L.circleMarker([start.lat, start.lng], {
        radius: 8,
        color: '#1d1d1f',
        weight: 2,
        fillColor: '#f6d77a',
        fillOpacity: pin ? 1 : 0,
        opacity: pin ? 1 : 0,
      }).addTo(m);
      m.on('click', (e: { latlng: LatLng }) => {
        const next = {
          lat: Math.round(e.latlng.lat * 10_000) / 10_000,
          lng: Math.round(e.latlng.lng * 10_000) / 10_000,
        };
        dot.setLatLng([next.lat, next.lng]).setStyle({ opacity: 1, fillOpacity: 1 });
        setDraft(next);
      });
      return { dot };
    },
  );

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-mist">
        Tap your home on the map for accurate walking times and routes. Only the coordinates are
        stored here; place searches and weather keep using the rounded town location.
      </p>
      <div ref={container} className="z-0 h-56 overflow-hidden rounded-3xl ring-1 ring-line" />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-mist">
          {pin ? 'Home pinned.' : 'No pin yet – travel starts from the town centre.'}
        </span>
        <div className="flex gap-2">
          {pin && (
            <button
              type="button"
              className={secondary}
              disabled={pending}
              onClick={() =>
                run(
                  () => saveHomePinAction(null),
                  () => {
                    setDraft(null);
                    map.current?.dot.setStyle({ opacity: 0, fillOpacity: 0 });
                    return 'Pin removed.';
                  },
                )
              }
            >
              Remove
            </button>
          )}
          <button
            type="button"
            className={primary}
            disabled={pending || !draft || !changed}
            onClick={() =>
              draft &&
              run(
                () => saveHomePinAction(draft),
                () => 'Home pin saved.',
              )
            }
          >
            Save pin
          </button>
        </div>
      </div>
      <Message message={message} />
    </div>
  );
}
