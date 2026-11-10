import { PLACES } from "./placesData";

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  country: string;
}

/** «interface - Layer 4» Geocoding Adapter (external: Geolocation / geocoding service). */
export interface GeocodingAdapter {
  geocode(address: string): Promise<GeocodeResult | null>;
}

/** MOCK geocoder backed by a small gazetteer of the demo city. Unknown addresses return null. */
export class MockGeocodingAdapter implements GeocodingAdapter {
  async geocode(address: string): Promise<GeocodeResult | null> {
    const q = address.trim().toLowerCase();
    if (!q) return null;
    const hit = PLACES.find((p) => p.address.toLowerCase() === q) ?? PLACES.find((p) => p.address.toLowerCase().includes(q) && q.length >= 4);
    if (!hit) return null;
    return { latitude: hit.latitude, longitude: hit.longitude, address: hit.address, city: hit.city, country: hit.country };
  }

  /** Demo helper for address pick-lists in the UI (not part of the production interface). */
  suggestions(): string[] {
    return PLACES.map((p) => p.address);
  }
}
