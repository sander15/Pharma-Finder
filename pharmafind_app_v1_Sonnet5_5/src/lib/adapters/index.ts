import type { Clock } from "../clock";
import { MockDirectionsAdapter, type DirectionsAdapter } from "./directions";
import { MockDrugReferenceAdapter, type DrugReferenceAdapter } from "./drugReference";
import { MockEmailAdapter } from "./email";
import { MockGeocodingAdapter } from "./geocoding";
import { MockLicenseCheckAdapter, type LicenseCheckAdapter } from "./licenseCheck";
import { MockPosFeedConnector, type PosFeedConnector } from "./posFeed";

/**
 * SUBSYSTEM Integration Adapters ("replaceable with mocks"). Each field is typed by its
 * interface; swapping a mock for a real client later only touches this file.
 * The email / geocoding mocks are typed concretely because the demo uses their extras
 * (outbox, outage switch, address suggestions).
 */
export interface Adapters {
  email: MockEmailAdapter;
  drugReference: DrugReferenceAdapter;
  posFeed: PosFeedConnector;
  licenseCheck: LicenseCheckAdapter;
  directions: DirectionsAdapter;
  geocoding: MockGeocodingAdapter;
}

export function createMockAdapters(clock: Clock): Adapters {
  return {
    email: new MockEmailAdapter(clock),
    drugReference: new MockDrugReferenceAdapter(clock),
    posFeed: new MockPosFeedConnector(),
    licenseCheck: new MockLicenseCheckAdapter(),
    directions: new MockDirectionsAdapter(),
    geocoding: new MockGeocodingAdapter(),
  };
}

export { MockPosFeedConnector };
