/**
 * Mock gazetteer shared by the Geocoding mock and the seed data (all addresses are fictional,
 * coordinates are around Lubbock, TX so the demo region is a single city as in the requirements).
 */
export interface Place {
  key: string;
  address: string;
  latitude: number;
  longitude: number;
  city: string;
  country: string;
}

const city = "Lubbock";
const country = "US";

export const PLACES: Place[] = [
  { key: "ttu", address: "Texas Tech University", latitude: 33.5843, longitude: -101.8783, city, country },
  { key: "downtown", address: "Downtown Lubbock", latitude: 33.5779, longitude: -101.8552, city, country },
  { key: "depot", address: "Depot District, Lubbock", latitude: 33.5815, longitude: -101.847, city, country },
  { key: "airport", address: "Lubbock Preston Smith International Airport", latitude: 33.6636, longitude: -101.8228, city, country },
  { key: "mall", address: "South Plains Mall, Lubbock", latitude: 33.5223, longitude: -101.913, city, country },
  { key: "hub", address: "1201 Texas Ave, Lubbock, TX", latitude: 33.58, longitude: -101.853, city, country },
  { key: "terrace", address: "2412 Main St, Lubbock, TX", latitude: 33.5836, longitude: -101.8742, city, country },
  { key: "slide", address: "6101 Slide Rd, Lubbock, TX", latitude: 33.518, longitude: -101.9075, city, country },
  { key: "canyon", address: "1802 Canyon Lake Dr, Lubbock, TX", latitude: 33.57, longitude: -101.815, city, country },
  { key: "southwest", address: "7405 82nd St, Lubbock, TX", latitude: 33.508, longitude: -101.933, city, country },
  { key: "quaker", address: "5002 Quaker Ave, Lubbock, TX", latitude: 33.547, longitude: -101.896, city, country },
  { key: "indiana", address: "4010 Indiana Ave, Lubbock, TX", latitude: 33.536, longitude: -101.887, city, country },
];

export const place = (key: string): Place => {
  const p = PLACES.find((x) => x.key === key);
  if (!p) throw new Error(`Unknown place ${key}`);
  return p;
};
