import type { LatLng } from '@/ports/places';

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const OBLIQUITY = RAD * 23.4397;
// Sun's apparent radius plus atmospheric refraction.
const SUNSET_ALTITUDE = RAD * -0.833;

const toJulian = (date: Date) => date.getTime() / DAY_MS - 0.5 + J1970;
const fromJulian = (julian: number) => new Date((julian + 0.5 - J1970) * DAY_MS);

/**
 * Sunset for the calendar day of `day` at `location` (standard astronomical approximation,
 * accurate to a few minutes). Returns null when the sun does not set (polar day/night).
 */
export function sunsetAt(day: Date, location: LatLng): Date | null {
  const lw = RAD * -location.lng;
  const phi = RAD * location.lat;
  const d = toJulian(day) - J2000;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;

  const meanAnomaly = RAD * (357.5291 + 0.98560028 * ds);
  const center =
    RAD *
    (1.9148 * Math.sin(meanAnomaly) +
      0.02 * Math.sin(2 * meanAnomaly) +
      0.0003 * Math.sin(3 * meanAnomaly));
  const eclipticLongitude = meanAnomaly + center + RAD * 102.9372 + Math.PI;
  const declination = Math.asin(Math.sin(OBLIQUITY) * Math.sin(eclipticLongitude));

  const cosHourAngle =
    (Math.sin(SUNSET_ALTITUDE) - Math.sin(phi) * Math.sin(declination)) /
    (Math.cos(phi) * Math.cos(declination));
  if (cosHourAngle < -1 || cosHourAngle > 1) return null;
  const hourAngle = Math.acos(cosHourAngle);

  const a = 0.0009 + (hourAngle + lw) / (2 * Math.PI) + n;
  return fromJulian(
    J2000 + a + 0.0053 * Math.sin(meanAnomaly) - 0.0069 * Math.sin(2 * eclipticLongitude),
  );
}
