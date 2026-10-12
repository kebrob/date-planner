'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { findTownAction } from './actions';
import { useLeafletMap } from './leaflet-map';
import { SearchField } from './search-field';

export type Point = { name: string; lat: number; lng: number };

type Props = {
  home: Point;
  /** null = home */
  center: Point | null;
  onCenterChange: (center: Point | null) => void;
  /** null = auto */
  radiusKm: number | null;
  onRadiusChange: (km: number | null) => void;
  autoRadiusKm: number;
};

const MAX_KM = 150;

export function LocationPicker({
  home,
  center,
  onCenterChange,
  radiusKm,
  onRadiusChange,
  autoRadiusKm,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const current = center ?? home;
  const effectiveKm = radiusKm ?? autoRadiusKm;

  const { map, ready } = useLeafletMap(
    container,
    { center: current, zoom: 10, maxZoom: 18 },
    (L, m) => {
      const circle = L.circle([current.lat, current.lng], {
        radius: effectiveKm * 1000,
        color: '#1d1d1f',
        weight: 1.5,
        fillColor: '#f6d77a',
        fillOpacity: 0.35,
      }).addTo(m);
      const dot = L.circleMarker([current.lat, current.lng], {
        radius: 6,
        color: '#1d1d1f',
        fillColor: '#1d1d1f',
        fillOpacity: 1,
      }).addTo(m);
      const onResize = () => m.fitBounds(circle.getBounds(), { padding: [12, 12], animate: false });
      return { circle, dot, onResize };
    },
  );

  useEffect(() => {
    const m = map.current?.map;
    if (!m) return;
    const onClick = (e: { latlng: { lat: number; lng: number } }) =>
      onCenterChange({
        name: 'Pinned location',
        lat: Math.round(e.latlng.lat * 1000) / 1000,
        lng: Math.round(e.latlng.lng * 1000) / 1000,
      });
    m.on('click', onClick);
    return () => {
      m.off('click', onClick);
    };
  }, [map, ready, onCenterChange]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.circle.setLatLng([current.lat, current.lng]).setRadius(effectiveKm * 1000);
    m.dot.setLatLng([current.lat, current.lng]);
    // The container may have been laid out after Leaflet measured it.
    m.map.invalidateSize({ animate: false });
    m.map.fitBounds(m.circle.getBounds(), { padding: [12, 12] });
  }, [map, ready, current.lat, current.lng, effectiveKm]);

  const search = async () => {
    const q = query.trim();
    if (q.length < 2 || searching) return;
    setSearching(true);
    setNotFound(false);
    try {
      const found = await findTownAction(q);
      if (found) onCenterChange(found);
      else setNotFound(true);
    } catch {
      setNotFound(true);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <SearchField
        value={query}
        onChange={setQuery}
        onEnter={() => void search()}
        placeholder="Town, e.g. Augsburg – or tap the map"
        ariaLabel="Search a town"
        trailing={
          query.trim() && (
            <button
              type="button"
              onClick={() => void search()}
              disabled={searching}
              aria-label="Find town"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-white hover:bg-ink/85 disabled:opacity-50"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          )
        }
      />
      {notFound && <p className="text-xs text-red-600">Not found – try another spelling.</p>}

      <div ref={container} className="z-0 h-64 overflow-hidden rounded-3xl ring-1 ring-line" />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mist">
        <span>
          Around <span className="font-medium text-ink">{current.name.split(',')[0]}</span>
          {center && (
            <button
              type="button"
              onClick={() => {
                onCenterChange(null);
                setQuery('');
              }}
              className="ml-2 underline hover:text-ink"
            >
              back to home
            </button>
          )}
        </span>
        <span>{radiusKm === null ? `Fit to time · ~${autoRadiusKm} km` : `${radiusKm} km`}</span>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onRadiusChange(radiusKm === null ? autoRadiusKm : null)}
          className={`rounded-full border px-3 py-1.5 ${
            radiusKm === null
              ? 'border-butter bg-butter text-ink'
              : 'border-line hover:border-butter-deep'
          }`}
        >
          Fit to time
        </button>
        <input
          type="range"
          min={1}
          max={MAX_KM}
          value={Math.min(effectiveKm, MAX_KM)}
          onChange={(e) => onRadiusChange(Number(e.target.value))}
          className="flex-1 accent-ink"
          aria-label="Search radius in km"
        />
      </div>
    </div>
  );
}
