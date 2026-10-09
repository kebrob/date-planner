// Usage: npm run rail:stations
// Downloads all DB stations (StaDa API, CC BY 4.0) and writes the compact list used to find the
// nearest station: [eva, name, lat, lng]. Re-run occasionally when stations change.
import { existsSync, writeFileSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const clientId = process.env.DB_CLIENT_ID;
const apiKey = process.env.DB_API_KEY;
if (!clientId || !apiKey) throw new Error('DB_CLIENT_ID / DB_API_KEY are not set');

type Station = {
  name: string;
  evaNumbers?: { number: number; geographicCoordinates?: { coordinates: [number, number] } }[];
};

const res = await fetch(
  'https://apis.deutschebahn.com/db-api-marketplace/apis/station-data/v2/stations?limit=10000',
  { headers: { 'DB-Client-Id': clientId, 'DB-Api-Key': apiKey, accept: 'application/json' } },
);
if (!res.ok) throw new Error(`StaDa responded ${res.status}`);
const body = (await res.json()) as { result: Station[] };

const round = (n: number) => Math.round(n * 1e5) / 1e5;
const rows = body.result
  .flatMap((s) =>
    (s.evaNumbers ?? []).flatMap((e) => {
      const coords = e.geographicCoordinates?.coordinates;
      return coords ? [[String(e.number), s.name, round(coords[1]), round(coords[0])]] : [];
    }),
  )
  .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

writeFileSync('src/rail/stations.json', JSON.stringify(rows) + '\n');
console.log(`Wrote ${rows.length} stations.`);
