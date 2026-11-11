/**
 * Static data behind the MOCKED external systems (drug reference database, geocoding service, licensing registry)
 * plus the product catalog. Everything here is already in Pharmafind's standard format and uses Pharmafind catalog IDs:
 * adapters hand it over as-is and no translation layer exists anywhere in the app.
 */
import type { Coordinates, DrugReferenceEntry, Product } from "./types";

export const DRUG_REFERENCE: Omit<DrugReferenceEntry, "lastUpdated">[] = [
  { referenceId: "ref-ibuprofen", activeIngredient: "Ibuprofen", brandName: "Advil, Motrin", genericName: "Ibuprofen", description: "NSAID used for pain, fever and inflammation. Take with food; not for long-term use without medical advice." },
  { referenceId: "ref-acetaminophen", activeIngredient: "Acetaminophen", brandName: "Tylenol", genericName: "Acetaminophen", description: "Analgesic and antipyretic for mild to moderate pain and fever. Do not exceed the daily maximum dose." },
  { referenceId: "ref-amoxicillin", activeIngredient: "Amoxicillin", brandName: "Amoxil", genericName: "Amoxicillin", description: "Penicillin-type antibiotic. Prescription only; complete the full course." },
  { referenceId: "ref-loratadine", activeIngredient: "Loratadine", brandName: "Claritin", genericName: "Loratadine", description: "Non-drowsy antihistamine for seasonal allergy symptoms." },
  { referenceId: "ref-cetirizine", activeIngredient: "Cetirizine", brandName: "Zyrtec", genericName: "Cetirizine", description: "Antihistamine for hay fever and hives; may cause mild drowsiness." },
  { referenceId: "ref-metformin", activeIngredient: "Metformin", brandName: "Glucophage", genericName: "Metformin", description: "First-line oral medicine for type 2 diabetes. Prescription only." },
  { referenceId: "ref-atorvastatin", activeIngredient: "Atorvastatin", brandName: "Lipitor", genericName: "Atorvastatin", description: "Statin that lowers cholesterol. Prescription only." },
  { referenceId: "ref-albuterol", activeIngredient: "Albuterol", brandName: "Ventolin HFA", genericName: "Albuterol", description: "Rescue bronchodilator for asthma. Prescription only." },
];

export const PRODUCTS: Product[] = [
  { catalogId: "PF-10001", brandName: "Advil", genericName: "Ibuprofen", presentation: "Tablet", dosage: "200 mg", reference: "ref-ibuprofen" },
  { catalogId: "PF-10002", brandName: "Advil", genericName: "Ibuprofen", presentation: "Oral suspension", dosage: "100 mg/5 mL", reference: "ref-ibuprofen" },
  { catalogId: "PF-10003", brandName: "Motrin", genericName: "Ibuprofen", presentation: "Tablet", dosage: "400 mg", reference: "ref-ibuprofen" },
  { catalogId: "PF-10004", brandName: "Tylenol", genericName: "Acetaminophen", presentation: "Tablet", dosage: "500 mg", reference: "ref-acetaminophen" },
  { catalogId: "PF-10005", brandName: "Tylenol", genericName: "Acetaminophen", presentation: "Oral suspension", dosage: "160 mg/5 mL", reference: "ref-acetaminophen" },
  { catalogId: "PF-10006", brandName: "Amoxil", genericName: "Amoxicillin", presentation: "Capsule", dosage: "500 mg", reference: "ref-amoxicillin" },
  { catalogId: "PF-10007", brandName: "Amoxil", genericName: "Amoxicillin", presentation: "Oral suspension", dosage: "250 mg/5 mL", reference: "ref-amoxicillin" },
  { catalogId: "PF-10008", brandName: "Claritin", genericName: "Loratadine", presentation: "Tablet", dosage: "10 mg", reference: "ref-loratadine" },
  { catalogId: "PF-10009", brandName: "Zyrtec", genericName: "Cetirizine", presentation: "Tablet", dosage: "10 mg", reference: "ref-cetirizine" },
  { catalogId: "PF-10010", brandName: "Glucophage", genericName: "Metformin", presentation: "Tablet", dosage: "500 mg", reference: "ref-metformin" },
  { catalogId: "PF-10011", brandName: "Lipitor", genericName: "Atorvastatin", presentation: "Tablet", dosage: "20 mg", reference: "ref-atorvastatin" },
  { catalogId: "PF-10012", brandName: "Ventolin HFA", genericName: "Albuterol", presentation: "Inhaler", dosage: "90 mcg/actuation", reference: "ref-albuterol" },
];

/** Mock geocoding service: places it can resolve (demo city: Lubbock, TX). Keys are lower-case. */
export const KNOWN_PLACES: Record<string, Coordinates> = {
  "texas tech university": { latitude: 33.5843, longitude: -101.8783 },
  "downtown lubbock": { latitude: 33.5779, longitude: -101.8552 },
  "depot district": { latitude: 33.583, longitude: -101.85 },
  "south plains mall": { latitude: 33.5127, longitude: -101.9086 },
  "lubbock airport": { latitude: 33.6636, longitude: -101.8228 },
  "university medical center": { latitude: 33.5826, longitude: -101.8999 },
  "lubbock, tx": { latitude: 33.5779, longitude: -101.8552 },
  "1201 broadway st": { latitude: 33.5906, longitude: -101.847 },
  "3402 82nd st": { latitude: 33.556, longitude: -101.899 },
  "2410 broadway st": { latitude: 33.588, longitude: -101.88 },
  "1824 buddy holly ave": { latitude: 33.583, longitude: -101.85 },
  "5110 slide rd": { latitude: 33.53, longitude: -101.855 },
  "6803 19th st": { latitude: 33.57, longitude: -101.93 },
  "2901 avenue q": { latitude: 33.565, longitude: -101.87 },
};

/** Mock state licensing registry. */
export const LICENSE_REGISTRY: Record<string, string> = {
  "TX-1048231": "Hub City Pharmacy",
  "TX-1048377": "South Plains Family Pharmacy",
  "TX-1049012": "Red Raider Drug",
  "TX-1049455": "Depot District Rx",
  "TX-1050120": "Southside Health Pharmacy",
  "TX-1050388": "Westgate Pharmacy",
  "TX-1051207": "New Leaf Pharmacy",
};
