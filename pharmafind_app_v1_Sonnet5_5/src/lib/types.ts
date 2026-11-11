/** Domain entities from the class diagram (Layers 2-3). Dates are ISO-8601 strings. */

export type Role = "pharmacy_staff" | "admin";
export type VerificationStatus = "pending" | "verified" | "rejected";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface Location extends Coordinates {
  locationId: string;
  address: string;
  city: string;
  country: string;
}

export interface Account {
  accountId: string;
  email: string;
  passwordHash: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  /** Bumped on password reset so previously issued session tokens stop working. */
  tokenVersion: number;
}

/** Account as exposed to clients after login (never contains the hash). */
export interface SessionAccount {
  accountId: string;
  email: string;
  role: Role;
  fullName: string;
  pharmacyId: string | null;
}

export interface PharmacyStaff {
  staffId: string;
  fullName: string;
  account: string; // accountId
  pharmacy: string; // pharmacyId
}

export interface Admin {
  adminId: string;
  fullName: string;
  account: string; // accountId
}

export interface Pharmacy {
  pharmacyId: string;
  name: string;
  licenseNumber: string;
  phone: string;
  location: string; // locationId
  /** true / false when known, null when the pharmacy has not provided accessibility data. */
  isAccessible: boolean | null;
  verificationStatus: VerificationStatus;
  lastSyncAt: string | null;
}

export type RegistryStatus = "valid" | "invalid" | "unavailable";

export interface VerificationRequest {
  requestId: string;
  pharmacy: string;
  status: VerificationStatus;
  submittedAt: string;
  reviewedAt: string | null;
  reviewer: string | null; // accountId of the admin
  rejectionReason: string | null;
  registryResult: { status: RegistryStatus; detail: string; checkedAt: string } | null;
  manualCheck: { confirmed: boolean; note: string; checkedAt: string } | null;
}

export interface LicenseDocument {
  documentId: string;
  verificationRequest: string;
  fileName: string;
  storagePath: string;
  mimeType: string;
  uploadedAt: string;
}

export interface DrugReferenceEntry {
  referenceId: string;
  activeIngredient: string;
  brandName: string;
  genericName: string;
  description: string;
  lastUpdated: string;
}

export interface Product {
  catalogId: string;
  brandName: string;
  genericName: string;
  presentation: string;
  dosage: string;
  reference: string; // referenceId
}

export interface Listing {
  listingId: string;
  pharmacy: string;
  product: string; // catalogId
  stock: number;
  price: number;
  lastUpdated: string;
}

export interface AutomaticFeed {
  feedId: string;
  pharmacy: string;
  posEndpoint: string;
  intervalMinutes: number;
  isEnabled: boolean;
  lastPulledAt: string | null;
}

export type FeedSource = "csv" | "pos";

export interface Rejection {
  row: number; // 1-based data row (header excluded); 0 when the whole file/feed is rejected
  reason: string;
}

export interface FeedImport {
  importId: string;
  pharmacy: string;
  source: FeedSource;
  feed: string | null; // AutomaticFeed id when source = "pos"
  fileName: string | null;
  storedFilePath: string | null;
  status: "accepted" | "rejected";
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  rejections: Rejection[];
  startedAt: string;
}

export interface SyncLog {
  logId: string;
  pharmacy: string;
  feedImport: string | null; // null for manual portal edits and the seeded baseline
  syncedAt: string;
  success: boolean;
  details: string;
}

export type NotificationType = "security_code" | "stale_sync";

export interface Notification {
  notificationId: string;
  recipient: string; // accountId
  type: NotificationType;
  subject: string;
  body: string;
  status: "pending" | "sent" | "failed";
  retryCount: number;
  createdAt: string;
}

export interface SecurityCode {
  codeId: string;
  account: string;
  codeHash: string;
  expiresAt: string;
  isUsed: boolean;
  failedAttempts: number;
  notification: string | null;
}

export type JobType = "pull_pos_feeds" | "check_stale_sync" | "refresh_drug_reference" | "retry_failed_emails";

export interface ScheduledJob {
  jobId: string;
  type: JobType;
  intervalMinutes: number;
  nextRunAt: string;
  lastRunAt: string | null;
  status: "idle" | "running";
}

export interface SearchRecord {
  searchId: string;
  queryText: string;
  origin: Coordinates;
  performedAt: string;
  maxDistanceKm: number;
  needsAccessibleAccess: boolean;
}

export interface LicenseUpload {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}

/** A listing as shown to searchers and in the pharmacy portal. Ages are computed by the SERVER clock. */
export interface ListingItem {
  listingId: string;
  catalogId: string;
  brandName: string;
  genericName: string;
  presentation: string;
  dosage: string;
  stock: number;
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
  price: number;
  lastUpdated: string;
  ageMinutes: number;
  isStale: boolean;
}
