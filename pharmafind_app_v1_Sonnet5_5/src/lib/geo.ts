import type { Coordinates } from "./types";

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle (haversine) distance in km. Backs Location.distanceTo / isWithin. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isWithin(a: Coordinates, b: Coordinates, radiusKm: number): boolean {
  return distanceKm(a, b) <= radiusKm;
}

export function toCoordinates(l: Coordinates): Coordinates {
  return { latitude: l.latitude, longitude: l.longitude };
}
