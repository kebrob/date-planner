import type { Map as LeafletMap } from 'leaflet';
import { useEffect, useRef, useState, type RefObject } from 'react';

type LatLng = { lat: number; lng: number };
type Leaflet = typeof import('leaflet');

/**
 * An OpenStreetMap map in `container`, created once in the browser (Leaflet needs `window`).
 * `setup` adds the layers and returns what the component needs later; `onResize` runs whenever the
 * container changes size (initial layout, rotation, CSS loading late).
 */
export function useLeafletMap<T extends object>(
  container: RefObject<HTMLDivElement | null>,
  view: { center: LatLng; zoom: number; maxZoom: number },
  setup: (L: Leaflet, map: LeafletMap) => T & { onResize?: () => void },
) {
  const map = useRef<(T & { map: LeafletMap }) | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    void import('leaflet').then((L) => {
      if (disposed || !container.current || map.current) return;
      // A view must exist before layers can compute their bounds.
      const m = L.map(container.current, {
        center: [view.center.lat, view.center.lng],
        zoom: view.zoom,
      });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: view.maxZoom,
        attribution: '© OpenStreetMap contributors',
        // OSM's tile usage policy requires a Referer; the app-wide policy would strip it.
        referrerPolicy: 'strict-origin-when-cross-origin',
      }).addTo(m);
      const extras = setup(L, m);
      // Without animation: a zoom still running when the map is removed breaks Leaflet.
      observer = new ResizeObserver(() => {
        m.invalidateSize({ animate: false });
        extras.onResize?.();
      });
      observer.observe(container.current);
      map.current = { ...extras, map: m };
      setReady(true);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      map.current?.map.stop();
      map.current?.map.remove();
      map.current = null;
    };
    // Created once; components update layers imperatively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { map, ready };
}
