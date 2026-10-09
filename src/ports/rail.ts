import type { LatLng } from './places';

export type RailStation = { eva: string; name: string; location: LatLng };

/** One train at one station, as listed in that station's timetable. */
export type StationEvent = {
  planned: Date;
  /** Realtime estimate; equals `planned` without known changes. */
  actual: Date;
  platform: string | null;
  plannedPlatform: string | null;
  cancelled: boolean;
  /** Station names before (arrival) or after (departure) this stop, in order. */
  path: string[];
};

export type StationStop = {
  /** Timetable stop id; the part before the last two dashes identifies the train run. */
  id: string;
  /** Category such as RB, RE, S, ICE. */
  category: string;
  number: string;
  /** Display name, e.g. "RB 54" or "S 1". */
  line: string;
  arrival: StationEvent | null;
  departure: StationEvent | null;
};

export interface RailTimetable {
  /** Stops at a station between `from` and `from + hours`, with realtime changes applied. */
  stops(eva: string, from: Date, hours: number): Promise<StationStop[]>;
  /** Station number for an exact timetable name, e.g. "München Hbf Gl.5-10". */
  stationNumber(name: string): Promise<string | null>;
  /** Applies the latest realtime changes to a known stop, for live updates. */
  refresh(eva: string, stop: StationStop): Promise<StationStop>;
}

export interface RailStationFinder {
  /** Stations within `radiusKm`, closest first. */
  near(point: LatLng, radiusKm: number): Promise<RailStation[]>;
}
