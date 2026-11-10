import { place } from "./adapters/placesData";
import { PRODUCTS, REFERENCE_ENTRIES } from "./adapters/catalogData";
import type { Clock } from "./clock";
import type { RelationalDbGeo } from "./db";
import type { FileStorage } from "./fileStorage";
import { hashPassword } from "./security";
import type {
  Account,
  Admin,
  AutomaticFeed,
  DrugReferenceEntry,
  Listing,
  LicenseDocument,
  Location,
  Pharmacy,
  PharmacyStaff,
  Product,
  ScheduledJob,
  SyncLog,
  VerificationRequest,
  VerificationStatus,
} from "./types";

/** Password shared by every seeded demo account (shown on the login screens of the demo). */
export const DEMO_PASSWORD = "Demo!Pass123";

export const SEED = {
  admin: { email: "admin@pharmafind.demo", fullName: "Alex Admin" },
  pharmacies: {
    hubCity: { id: "ph-hub-city", email: "hubcity@pharmafind.demo", license: "TX-PH-10001" },
    techTerrace: { id: "ph-tech-terrace", email: "techterrace@pharmafind.demo", license: "TX-PH-10002" },
    slideRoad: { id: "ph-slide-road", email: "slideroad@pharmafind.demo", license: "TX-PH-10003" },
    canyonLakes: { id: "ph-canyon-lakes", email: "canyonlakes@pharmafind.demo", license: "TX-PH-10004" },
    southwest: { id: "ph-southwest", email: "southwest@pharmafind.demo", license: "TX-PH-10005" },
    quaker: { id: "ph-quaker", email: "quaker@pharmafind.demo", license: "TX-PH-20001" },
    indiana: { id: "ph-indiana", email: "indiana@pharmafind.demo", license: "TX-PH-30001" },
  },
} as const;

interface PharmacySeed {
  id: string;
  slug: string;
  name: string;
  staffName: string;
  email: string;
  license: string;
  phone: string;
  placeKey: string;
  accessible: boolean;
  status: VerificationStatus;
  syncedHoursAgo: number | null;
  listings: Array<[string, number, number]>; // catalogId, stock, price
  feed?: { endpoint: string; interval: number };
  rejectionReason?: string;
}

const HOUR = 3_600_000;

const PHARMACIES: PharmacySeed[] = [
  {
    id: SEED.pharmacies.hubCity.id, slug: "hub", name: "Hub City Pharmacy", staffName: "Patricia Nguyen", email: SEED.pharmacies.hubCity.email,
    license: SEED.pharmacies.hubCity.license, phone: "806-555-0101", placeKey: "hub", accessible: true, status: "verified", syncedHoursAgo: 2,
    listings: [["PF-1001", 40, 7.99], ["PF-1002", 20, 8.49], ["PF-1003", 35, 6.49], ["PF-1004", 6, 9.49], ["PF-1005", 25, 9.99], ["PF-1006", 10, 9.29], ["PF-1007", 12, 14.99], ["PF-1011", 14, 12.99], ["PF-1012", 18, 13.99], ["PF-1014", 9, 15.99]],
  },
  {
    id: SEED.pharmacies.techTerrace.id, slug: "terrace", name: "Tech Terrace Drug", staffName: "Marcus Hill", email: SEED.pharmacies.techTerrace.email,
    license: SEED.pharmacies.techTerrace.license, phone: "806-555-0102", placeKey: "terrace", accessible: false, status: "verified", syncedHoursAgo: 3,
    listings: [["PF-1001", 12, 8.49], ["PF-1003", 20, 6.99], ["PF-1005", 8, 10.49], ["PF-1006", 7, 9.79], ["PF-1009", 15, 18.99], ["PF-1013", 22, 10.99], ["PF-1015", 3, 59.99]],
  },
  {
    id: SEED.pharmacies.slideRoad.id, slug: "slide", name: "Slide Road Pharmacy", staffName: "Dana Ortiz", email: SEED.pharmacies.slideRoad.email,
    license: SEED.pharmacies.slideRoad.license, phone: "806-555-0103", placeKey: "slide", accessible: true, status: "verified", syncedHoursAgo: 1,
    listings: [["PF-1001", 0, 7.49], ["PF-1002", 5, 8.29], ["PF-1004", 0, 8.99], ["PF-1005", 12, 8.99], ["PF-1007", 20, 13.99], ["PF-1008", 8, 15.49], ["PF-1010", 40, 11.5]],
    feed: { endpoint: "https://pos.mock/slide-road", interval: 15 },
  },
  {
    id: SEED.pharmacies.canyonLakes.id, slug: "canyon", name: "Canyon Lakes Rx", staffName: "Priya Shah", email: SEED.pharmacies.canyonLakes.email,
    license: SEED.pharmacies.canyonLakes.license, phone: "806-555-0104", placeKey: "canyon", accessible: true, status: "verified", syncedHoursAgo: 5,
    listings: [["PF-1001", 25, 8.99], ["PF-1002", 14, 8.79], ["PF-1003", 15, 6.99], ["PF-1004", 11, 9.19], ["PF-1005", 19, 9.59], ["PF-1008", 4, 16.49], ["PF-1012", 33, 13.49], ["PF-1013", 10, 11.49], ["PF-1014", 20, 14.99]],
  },
  {
    id: SEED.pharmacies.southwest.id, slug: "southwest", name: "Southwest Family Pharmacy", staffName: "Tom Becker", email: SEED.pharmacies.southwest.email,
    license: SEED.pharmacies.southwest.license, phone: "806-555-0105", placeKey: "southwest", accessible: true, status: "verified", syncedHoursAgo: 30,
    listings: [["PF-1001", 8, 7.99], ["PF-1002", 30, 7.99], ["PF-1005", 17, 8.49], ["PF-1009", 22, 17.99], ["PF-1011", 40, 11.99], ["PF-1015", 5, 57.99]],
  },
  {
    id: SEED.pharmacies.quaker.id, slug: "quaker", name: "Quaker Avenue Pharmacy", staffName: "Elena Ruiz", email: SEED.pharmacies.quaker.email,
    license: SEED.pharmacies.quaker.license, phone: "806-555-0106", placeKey: "quaker", accessible: true, status: "pending", syncedHoursAgo: null,
    listings: [["PF-1001", 100, 5.0], ["PF-1002", 50, 5.0]],
  },
  {
    id: SEED.pharmacies.indiana.id, slug: "indiana", name: "Indiana Avenue Rx", staffName: "Greg Dawson", email: SEED.pharmacies.indiana.email,
    license: SEED.pharmacies.indiana.license, phone: "806-555-0107", placeKey: "indiana", accessible: false, status: "rejected", syncedHoursAgo: null,
    listings: [["PF-1001", 60, 4.5]], rejectionReason: "License could not be confirmed with the state registry.",
  },
];

const FAKE_PDF = Buffer.from("%PDF-1.4 demo license document (mock)");

/** Fills the mock databases with a demo city: verified, pending and rejected pharmacies. */
export function seedDatabase(db: RelationalDbGeo, files: FileStorage, clock: Clock): void {
  const now = clock.now();
  const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  const passwordHash = hashPassword(DEMO_PASSWORD);

  // ---- Drug reference + product catalog (standard catalog IDs) ----
  for (const r of REFERENCE_ENTRIES) {
    db.save<DrugReferenceEntry>("drugReferenceEntries", r.referenceId, { ...r, lastUpdated: iso(30 * 24 * HOUR) });
  }
  for (const p of PRODUCTS) db.save<Product>("products", p.catalogId, p);

  // ---- Admin ----
  db.save<Account>("accounts", "acc-admin", { accountId: "acc-admin", email: SEED.admin.email, passwordHash, role: "admin", isActive: true, createdAt: iso(90 * 24 * HOUR) });
  db.save<Admin>("admins", "adm-1", { adminId: "adm-1", fullName: SEED.admin.fullName, account: "acc-admin" });

  // ---- Pharmacies ----
  for (const s of PHARMACIES) {
    const loc = place(s.placeKey);
    const locationId = `loc-${s.slug}`;
    db.save<Location>("locations", locationId, { locationId, latitude: loc.latitude, longitude: loc.longitude, address: loc.address, city: loc.city, country: loc.country });

    const lastSyncAt = s.syncedHoursAgo === null ? null : iso(s.syncedHoursAgo * HOUR);
    db.save<Pharmacy>("pharmacies", s.id, {
      pharmacyId: s.id, name: s.name, licenseNumber: s.license, phone: s.phone, location: locationId,
      isAccessible: s.accessible, verificationStatus: s.status, lastSyncAt,
    });

    const accountId = `acc-${s.slug}`;
    db.save<Account>("accounts", accountId, { accountId, email: s.email, passwordHash, role: "pharmacy_staff", isActive: true, createdAt: iso(60 * 24 * HOUR) });
    db.save<PharmacyStaff>("pharmacyStaff", `staff-${s.slug}`, { staffId: `staff-${s.slug}`, fullName: s.staffName, account: accountId, pharmacy: s.id });

    // verification request + license document (supported-by)
    const requestId = `vr-${s.slug}`;
    db.save<VerificationRequest>("verificationRequests", requestId, {
      requestId, pharmacy: s.id, status: s.status, submittedAt: iso(45 * 24 * HOUR),
      reviewedAt: s.status === "pending" ? null : iso(44 * 24 * HOUR),
      reviewer: s.status === "pending" ? null : "acc-admin",
      rejectionReason: s.status === "rejected" ? (s.rejectionReason ?? "Rejected") : null,
      registryResult: null, manualCheck: null,
    });
    const storagePath = `licenses/${requestId}/license.pdf`;
    void files.store(storagePath, FAKE_PDF);
    db.save<LicenseDocument>("licenseDocuments", `doc-${s.slug}`, {
      documentId: `doc-${s.slug}`, verificationRequest: requestId, fileName: "license.pdf", storagePath, mimeType: "application/pdf", uploadedAt: iso(45 * 24 * HOUR),
    });

    // listings
    for (const [catalogId, stock, price] of s.listings) {
      const listingId = `lst-${s.slug}-${catalogId}`;
      db.save<Listing>("listings", listingId, {
        listingId, pharmacy: s.id, product: catalogId, stock, price,
        lastUpdated: lastSyncAt ?? iso(24 * HOUR),
      });
    }

    // baseline sync log (so the dashboard has a last-sync time)
    if (lastSyncAt) {
      db.save<SyncLog>("syncLogs", `log-seed-${s.slug}`, { logId: `log-seed-${s.slug}`, pharmacy: s.id, feedImport: null, syncedAt: lastSyncAt, success: true, details: "Baseline sync (seed data)" });
    }

    if (s.feed) {
      db.save<AutomaticFeed>("automaticFeeds", `feed-${s.slug}`, {
        feedId: `feed-${s.slug}`, pharmacy: s.id, posEndpoint: s.feed.endpoint, intervalMinutes: s.feed.interval, isEnabled: true, lastPulledAt: null,
      });
    }
  }

  // ---- Scheduled jobs (job table) - all due at start-up ----
  const jobs: Array<[ScheduledJob["type"], number]> = [
    ["pull_pos_feeds", 5],
    ["check_stale_sync", 60],
    ["refresh_drug_reference", 1440],
    ["retry_failed_emails", 5],
  ];
  for (const [type, intervalMinutes] of jobs) {
    db.save<ScheduledJob>("scheduledJobs", `job-${type}`, { jobId: `job-${type}`, type, intervalMinutes, nextRunAt: now.toISOString(), lastRunAt: null, status: "idle" });
  }
}
