import type { Ctx } from "../context";
import { AppError } from "../errors";
import type { AutomaticFeed, FeedImport, LicenseUpload, Listing, Pharmacy, Product, SessionAccount, VerificationRequest } from "../types";
import type { AuthService, Permission } from "./auth";
import type { CatalogService } from "./catalog";
import type { FeedImportService } from "./feedImport";
import type { ListingInput, ListingService } from "./listings";
import type { PharmacyService } from "./pharmacies";
import type { RegistrationService } from "./registration";
import type { SyncLogService } from "./syncLogs";

export interface ListingPreviewRow {
  catalogId: string;
  brandName: string;
  genericName: string;
  presentation: string;
  dosage: string;
  stock: number;
  price: number;
  lastUpdated: string;
  inStock: boolean;
}

export interface Dashboard {
  pharmacy: { pharmacyId: string; name: string; address: string; phone: string; isAccessible: boolean; verificationStatus: Pharmacy["verificationStatus"]; isVerified: boolean; isLive: boolean };
  lastSyncAt: string | null;
  lastAttempt: { syncedAt: string; success: boolean; details: string } | null;
  isStale: boolean;
  staleAfterHours: number;
  feed: AutomaticFeed | null;
  listingsPreview: ListingPreviewRow[];
  recentImports: FeedImport[];
}

export interface VerificationStatusView {
  verificationStatus: Pharmacy["verificationStatus"];
  isVerified: boolean;
  isLive: boolean;
  rejectionReason: string | null;
  requests: Array<Pick<VerificationRequest, "requestId" | "status" | "submittedAt" | "reviewedAt" | "rejectionReason">>;
}

/**
 * PharmacyStaff actor operations (Pharmacy Portal). Every operation first checks
 * Account.hasPermission() and Account.canAccessPharmacy() - "own pharmacy data only".
 */
export class PortalService {
  constructor(
    private ctx: Ctx,
    private auth: AuthService,
    private pharmacies: PharmacyService,
    private listings: ListingService,
    private catalog: CatalogService,
    private feedImport: FeedImportService,
    private syncLogs: SyncLogService,
    private registration: RegistrationService,
  ) {}

  private guard(account: SessionAccount, permission: Permission, pharmacyId: string): Pharmacy {
    this.auth.authorize(account, permission, pharmacyId);
    return this.pharmacies.get(pharmacyId);
  }

  async updateListing(account: SessionAccount, pharmacyId: string, input: ListingInput): Promise<Listing> {
    this.guard(account, "listing:update", pharmacyId);
    return this.listings.setListing(pharmacyId, input);
  }

  async uploadCsv(account: SessionAccount, pharmacyId: string, fileName: string, csvText: string): Promise<FeedImport> {
    this.guard(account, "csv:upload", pharmacyId);
    return this.feedImport.importCsv(pharmacyId, csvText, fileName);
  }

  async configureAutomaticFeed(account: SessionAccount, pharmacyId: string, input: { posEndpoint: string; intervalMinutes: number }): Promise<AutomaticFeed> {
    this.guard(account, "feed:configure", pharmacyId);
    const { posEndpoint, intervalMinutes } = input;
    if (typeof posEndpoint !== "string" || posEndpoint.length < 3 || posEndpoint.length > 200) throw new AppError("VALIDATION_ERROR", "Enter the POS endpoint address");
    if (typeof intervalMinutes !== "number" || !Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 1440) {
      throw new AppError("VALIDATION_ERROR", "Sync interval must be a whole number of minutes between 5 and 1440");
    }

    const test = await this.ctx.adapters.posFeed.testConnection(posEndpoint); // AutomaticFeed.testConnection()
    if (!test.ok) throw new AppError("CONNECTION_FAILED", `Could not connect to the POS system. ${test.message} Check the endpoint and try again.`);

    const existing = this.ctx.db.query<AutomaticFeed>("automaticFeeds", (f) => f.pharmacy === pharmacyId)[0];
    const feed: AutomaticFeed = {
      feedId: existing?.feedId ?? this.ctx.db.nextId("feed"), pharmacy: pharmacyId, posEndpoint, intervalMinutes, isEnabled: true, lastPulledAt: existing?.lastPulledAt ?? null,
    };
    return this.ctx.db.save("automaticFeeds", feed.feedId, feed); // AutomaticFeed.enable(); scheduled by the job worker
  }

  async disableAutomaticFeed(account: SessionAccount, pharmacyId: string): Promise<AutomaticFeed> {
    this.guard(account, "feed:configure", pharmacyId);
    const feed = this.ctx.db.query<AutomaticFeed>("automaticFeeds", (f) => f.pharmacy === pharmacyId)[0];
    if (!feed) throw new AppError("NOT_FOUND", "No automatic feed is configured");
    return this.ctx.db.save("automaticFeeds", feed.feedId, { ...feed, isEnabled: false });
  }

  async viewDashboard(account: SessionAccount, pharmacyId: string): Promise<Dashboard> {
    const pharmacy = this.guard(account, "dashboard:view", pharmacyId);
    const latest = this.syncLogs.getLatestFor(pharmacyId);
    return {
      pharmacy: {
        pharmacyId, name: pharmacy.name, address: this.pharmacies.location(pharmacy).address, phone: pharmacy.phone, isAccessible: pharmacy.isAccessible,
        verificationStatus: pharmacy.verificationStatus, isVerified: this.pharmacies.isVerified(pharmacy), isLive: this.pharmacies.isVisibleInSearch(pharmacy),
      },
      lastSyncAt: pharmacy.lastSyncAt,
      lastAttempt: latest ? { syncedAt: latest.syncedAt, success: latest.success, details: latest.details } : null,
      isStale: this.feedImport.isSyncStale(pharmacyId),
      staleAfterHours: 24,
      feed: this.ctx.db.query<AutomaticFeed>("automaticFeeds", (f) => f.pharmacy === pharmacyId)[0] ?? null,
      listingsPreview: this.listings.getListings(pharmacyId).map((l) => this.previewRow(l)),
      recentImports: this.feedImport.recentImports(pharmacyId),
    };
  }

  private previewRow(l: Listing): ListingPreviewRow {
    const p = this.catalog.getProduct(l.product) as Product;
    return {
      catalogId: p.catalogId, brandName: p.brandName, genericName: p.genericName, presentation: p.presentation, dosage: p.dosage,
      stock: l.stock, price: l.price, lastUpdated: l.lastUpdated, inStock: this.listings.isInStock(l),
    };
  }

  async viewVerificationStatus(account: SessionAccount, pharmacyId: string): Promise<VerificationStatusView> {
    const pharmacy = this.guard(account, "verification:view", pharmacyId);
    const requests = this.ctx.db
      .query<VerificationRequest>("verificationRequests", (r) => r.pharmacy === pharmacyId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.requestId.localeCompare(a.requestId, undefined, { numeric: true }));
    return {
      verificationStatus: pharmacy.verificationStatus,
      isVerified: this.pharmacies.isVerified(pharmacy),
      isLive: this.pharmacies.isVisibleInSearch(pharmacy),
      rejectionReason: requests.find((r) => r.status === "rejected")?.rejectionReason ?? null,
      requests: requests.map(({ requestId, status, submittedAt, reviewedAt, rejectionReason }) => ({ requestId, status, submittedAt, reviewedAt, rejectionReason })),
    };
  }

  async resubmitVerification(account: SessionAccount, pharmacyId: string, upload: LicenseUpload): Promise<VerificationRequest> {
    this.guard(account, "verification:resubmit", pharmacyId);
    return this.registration.resubmit(pharmacyId, upload);
  }
}
