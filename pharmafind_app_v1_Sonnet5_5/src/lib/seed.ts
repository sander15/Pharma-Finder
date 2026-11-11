/**
 * Demo data for the mock database. Everything is in Pharmafind's standard format and uses catalog IDs.
 * Timestamps are relative to the app clock when the app starts, so "N hours ago" is always meaningful.
 */
import type { Adapters } from "./adapters";
import { DRUG_REFERENCE, PRODUCTS } from "./mockData";
import { HOUR_MS, MINUTE_MS, type Ctx } from "./context";
import { listingIdFor } from "./services/listings";
import { hashPassword } from "./security";
import type { Account, Admin, AutomaticFeed, JobType, LicenseDocument, Listing, Location, Pharmacy, PharmacyStaff, ScheduledJob, SyncLog, VerificationRequest } from "./types";

export const DEMO_PASSWORD = "Demo!Pass123";
export const DEMO_ADMIN_EMAIL = "admin@pharmafind.demo";
export const HUB_CITY_POS = "https://hubcity.demo-pos.example/feed";

type Row = [catalogId: string, stock: number, price: number];

interface SeedPharmacy {
  slug: string;
  name: string;
  address: string;
  phone: string;
  license: string;
  lat: number;
  lng: number;
  accessible: boolean | null;
  status: Pharmacy["verificationStatus"];
  manager: string;
  hoursSinceSync: number;
  listings: Row[];
}

const PHARMACIES: SeedPharmacy[] = [
  { slug: "hubcity", name: "Hub City Pharmacy", address: "1201 Broadway St", phone: "(806) 555-0101", license: "TX-1048231", lat: 33.5906, lng: -101.847, accessible: true, status: "verified", manager: "Patricia Gómez", hoursSinceSync: 2,
    listings: [["PF-10001", 25, 9.49], ["PF-10002", 8, 9.99], ["PF-10003", 15, 12.49], ["PF-10004", 40, 7.49], ["PF-10006", 20, 14.99], ["PF-10008", 30, 10.99], ["PF-10010", 22, 12.99], ["PF-10012", 5, 39.99]] },
  { slug: "plains", name: "South Plains Family Pharmacy", address: "3402 82nd St", phone: "(806) 555-0102", license: "TX-1048377", lat: 33.556, lng: -101.899, accessible: false, status: "verified", manager: "Robert Hale", hoursSinceSync: 14,
    listings: [["PF-10001", 18, 8.79], ["PF-10003", 0, 11.99], ["PF-10004", 25, 6.99], ["PF-10005", 9, 8.49], ["PF-10007", 6, 13.49], ["PF-10009", 14, 9.99], ["PF-10011", 10, 18.99]] },
  { slug: "raider", name: "Red Raider Drug", address: "2410 Broadway St", phone: "(806) 555-0103", license: "TX-1049012", lat: 33.588, lng: -101.88, accessible: true, status: "verified", manager: "Dana Whitfield", hoursSinceSync: 5,
    listings: [["PF-10001", 40, 8.99], ["PF-10002", 0, 9.49], ["PF-10003", 12, 11.49], ["PF-10004", 30, 7.99], ["PF-10005", 3, 8.99], ["PF-10008", 20, 10.49], ["PF-10009", 25, 9.49], ["PF-10012", 4, 41.99]] },
  { slug: "depot", name: "Depot District Rx", address: "1824 Buddy Holly Ave", phone: "(806) 555-0104", license: "TX-1049455", lat: 33.583, lng: -101.85, accessible: false, status: "verified", manager: "Lee Park", hoursSinceSync: 9,
    listings: [["PF-10001", 10, 9.99], ["PF-10004", 15, 7.29], ["PF-10006", 8, 15.49], ["PF-10007", 12, 12.99], ["PF-10010", 18, 11.99], ["PF-10011", 7, 19.49]] },
  { slug: "southside", name: "Southside Health Pharmacy", address: "5110 Slide Rd", phone: "(806) 555-0105", license: "TX-1050120", lat: 33.53, lng: -101.855, accessible: null, status: "verified", manager: "Amira Hassan", hoursSinceSync: 20,
    listings: [["PF-10002", 14, 8.99], ["PF-10003", 9, 10.99], ["PF-10005", 11, 7.99], ["PF-10008", 16, 9.99], ["PF-10009", 20, 8.99], ["PF-10012", 6, 38.99]] },
  { slug: "westgate", name: "Westgate Pharmacy", address: "6803 19th St", phone: "(806) 555-0106", license: "TX-1050388", lat: 33.57, lng: -101.93, accessible: true, status: "verified", manager: "Tom Brennan", hoursSinceSync: 30, // already stale: demonstrates the 24 h label
    listings: [["PF-10001", 22, 8.59], ["PF-10004", 35, 6.79], ["PF-10006", 15, 13.99], ["PF-10009", 18, 9.29], ["PF-10010", 25, 11.49]] },
  { slug: "newleaf", name: "New Leaf Pharmacy", address: "2901 Avenue Q", phone: "(806) 555-0107", license: "TX-1051207", lat: 33.565, lng: -101.87, accessible: true, status: "pending", manager: "Grace Okafor", hoursSinceSync: 3, // registered, awaiting admin verification: hidden from search
    listings: [["PF-10001", 50, 7.99], ["PF-10004", 50, 5.99]] },
];

const JOB_INTERVALS: Record<JobType, number> = { pull_pos_feeds: 5, check_stale_sync: 60, refresh_drug_reference: 1440, retry_failed_emails: 5 };

export function seed(ctx: Ctx, adapters: Adapters): void {
  const { db, clock, files } = ctx;
  const now = clock.now().getTime();
  const ago = (hours: number) => new Date(now - hours * HOUR_MS).toISOString();
  const nowIso = clock.iso();

  for (const e of DRUG_REFERENCE) db.save("drugReferenceEntries", e.referenceId, { ...e, lastUpdated: ago(6) });
  for (const p of PRODUCTS) db.save("products", p.catalogId, p);

  const adminAccountId = "acc-admin";
  db.save<Account>("accounts", adminAccountId, { accountId: adminAccountId, email: DEMO_ADMIN_EMAIL, passwordHash: hashPassword(DEMO_PASSWORD), role: "admin", isActive: true, createdAt: nowIso, tokenVersion: 0 });
  db.save<Admin>("admins", "adm-1", { adminId: "adm-1", fullName: "Alex Admin", account: adminAccountId });

  for (const s of PHARMACIES) {
    const pharmacyId = `ph-${s.slug}`;
    const locationId = `loc-${s.slug}`;
    const accountId = `acc-${s.slug}`;
    const syncedAt = ago(s.hoursSinceSync);
    db.save<Location>("locations", locationId, { locationId, address: s.address, city: "Lubbock", country: "US", latitude: s.lat, longitude: s.lng });
    db.save<Account>("accounts", accountId, { accountId, email: `${s.slug}@pharmafind.demo`, passwordHash: hashPassword(DEMO_PASSWORD), role: "pharmacy_staff", isActive: true, createdAt: nowIso, tokenVersion: 0 });
    db.save<PharmacyStaff>("pharmacyStaff", `staff-${s.slug}`, { staffId: `staff-${s.slug}`, fullName: s.manager, account: accountId, pharmacy: pharmacyId });
    db.save<Pharmacy>("pharmacies", pharmacyId, { pharmacyId, name: s.name, licenseNumber: s.license, phone: s.phone, location: locationId, isAccessible: s.accessible, verificationStatus: s.status, lastSyncAt: syncedAt });
    for (const [catalogId, stock, price] of s.listings) {
      const listingId = listingIdFor(pharmacyId, catalogId);
      db.save<Listing>("listings", listingId, { listingId, pharmacy: pharmacyId, product: catalogId, stock, price, lastUpdated: syncedAt });
    }
    db.save<SyncLog>("syncLogs", `log-seed-${s.slug}`, { logId: `log-seed-${s.slug}`, pharmacy: pharmacyId, feedImport: null, syncedAt, success: true, details: "Initial data load" });

    // Verification history: verified pharmacies went through review; New Leaf is waiting in the admin queue.
    const requestId = `vr-seed-${s.slug}`;
    const submittedAt = ago(s.status === "pending" ? 1 : 24 * 30);
    db.save<VerificationRequest>("verificationRequests", requestId, {
      requestId, pharmacy: pharmacyId, status: s.status, submittedAt,
      reviewedAt: s.status === "pending" ? null : ago(24 * 29), reviewer: s.status === "pending" ? null : adminAccountId,
      rejectionReason: null, registryResult: null,
      manualCheck: s.status === "pending" ? null : { confirmed: true, note: "Matches registry", checkedAt: ago(24 * 29) },
    });
    const bytes = Buffer.from(`%PDF-1.4\n% Demo license document for ${s.name} (${s.license})\n`);
    db.save<LicenseDocument>("licenseDocuments", `doc-seed-${s.slug}`, {
      documentId: `doc-seed-${s.slug}`, verificationRequest: requestId, fileName: `${s.slug}-license.pdf`,
      storagePath: files.store("license-documents", `${s.slug}-license.pdf`, bytes), mimeType: "application/pdf", uploadedAt: submittedAt,
    });
  }

  // Hub City connects its POS system: the mock POS serves its current inventory in the standard format.
  const hub = PHARMACIES[0]!;
  adapters.posFeed.registerEndpoint(HUB_CITY_POS, hub.listings.map(([catalogId, stock, price]) => ({ catalogId, stock, price })));
  db.save<AutomaticFeed>("automaticFeeds", "feed-hubcity", { feedId: "feed-hubcity", pharmacy: "ph-hubcity", posEndpoint: HUB_CITY_POS, intervalMinutes: 60, isEnabled: true, lastPulledAt: ago(2) });

  for (const type of Object.keys(JOB_INTERVALS) as JobType[]) {
    const intervalMinutes = JOB_INTERVALS[type];
    db.save<ScheduledJob>("scheduledJobs", `job-${type}`, { jobId: `job-${type}`, type, intervalMinutes, nextRunAt: new Date(now + intervalMinutes * MINUTE_MS).toISOString(), lastRunAt: null, status: "idle" });
  }
}
