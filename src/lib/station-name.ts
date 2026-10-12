/** Station names differ between sources ("München Hauptbahnhof" vs "München Hbf"). */
export function normalizeStationName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      // Platform suffixes like "München Hbf Gl.5-10".
      .replace(/\s+gl\.?\s*[\d-]+.*$/, '')
      .replace(/hauptbahnhof/g, 'hbf')
      .replace(/bahnhof/g, '')
      .replace(/[^a-zäöüß0-9]/g, '')
  );
}
