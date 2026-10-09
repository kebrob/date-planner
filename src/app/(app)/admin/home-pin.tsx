'use client';

import 'leaflet/dist/leaflet.css';
import type { CircleMarker, Map as LeafletMap } from 'leaflet';
import { useEffect, useRef, useState } from 'react';
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
  const map = useRef<{ map: LeafletMap; dot: CircleMarker } | null>(null);
  const [draft, setDraft] = useState<LatLng | null>(pin);
  const { pending, message, run } = useAction();
  const changed = draft?.lat !== pin?.lat || draft?.lng !== pin?.lng;

  // Leaflet needs `window`, so it is loaded only in the browser.
  useEffect(() => {
    let disposed = false;
    void import('leaflet').then((L) => {
      if (disposed || !container.current || map.current) return;
      const start = pin ?? town;
      const m = L.map(container.current, { center: [start.lat, start.lng], zoom: pin ? 16 : 13 });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
        // OSM's tile usage policy requires a Referer; the app-wide policy would strip it.
        referrerPolicy: 'strict-origin-when-cross-origin',
      }).addTo(m);
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
      const observer = new ResizeObserver(() => m.invalidateSize());
      observer.observe(container.current);
      m.on('unload', () => observer.disconnect());
      map.current = { map: m, dot };
    });
    return () => {
      disposed = true;
      map.current?.map.remove();
      map.current = null;
    };
    // Initialise once; the marker is moved imperatively on click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
