import type { Coordinates } from "../types";

/** «interface - Layer 4» Directions Adapter (external: Maps and directions service). */
export interface DirectionsAdapter {
  getRouteLink(origin: Coordinates, destination: Coordinates): string;
}

/** MOCK: builds a deep link a mobile device can open in its maps app. No network call is made. */
export class MockDirectionsAdapter implements DirectionsAdapter {
  getRouteLink(origin: Coordinates, destination: Coordinates): string {
    const o = `${origin.latitude},${origin.longitude}`;
    const d = `${destination.latitude},${destination.longitude}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=driving`;
  }
}
