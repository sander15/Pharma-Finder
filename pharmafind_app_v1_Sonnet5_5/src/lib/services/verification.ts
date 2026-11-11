import type { Ctx } from "../context";
import { AppError } from "../errors";
import { hashPassword } from "../security";
import type { Account, LicenseDocument, LicenseUpload, Location, Pharmacy, PharmacyStaff, VerificationRequest, VerificationStatus } from "../types";
import type { PharmacyService } from "./pharmacies";

export const MAX_LICENSE_BYTES = 2_000_000;
export const ALLOWED_LICENSE_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface RegistrationDetails {
  pharmacyName: string;
  licenseNumber: string;
  phone: string;
  address: string;
  city: string;
  isAccessible: boolean | null;
  fullName: string;
  email: string;
  password: string;
  license: LicenseUpload;
}

/**
 * Pharmacy account management and verification (Layer 3): Pharmacy.register(), VerificationRequest.submit/attachDocument/
 * checkWithRegistry/markVerified/markRejected and LicenseDocument.upload/download. Registration and verification are
 * separate steps: a registered pharmacy stays hidden from searchers until an admin verifies it.
 */
export class VerificationService {
  constructor(private ctx: Ctx, private pharmacies: PharmacyService) {}

  /* ------------------------------------------------------------------------------------------ registration */

  private decodeLicense(upload: LicenseUpload): Buffer {
    if (!ALLOWED_LICENSE_TYPES.includes(upload.mimeType)) throw new AppError("VALIDATION_ERROR", "The license must be a PDF, PNG or JPEG file");
    if (upload.contentBase64.length === 0 || upload.contentBase64.length % 4 !== 0 || !BASE64.test(upload.contentBase64)) throw new AppError("VALIDATION_ERROR", "The license file could not be read");
    const bytes = Buffer.from(upload.contentBase64, "base64");
    if (bytes.length === 0) throw new AppError("VALIDATION_ERROR", "The license file is empty");
    if (bytes.length > MAX_LICENSE_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "The license file is larger than 2 MB");
    return bytes;
  }

  /** LicenseDocument.upload() -> File Storage */
  private attachDocument(requestId: string, upload: LicenseUpload, bytes: Buffer): LicenseDocument {
    const storagePath = this.ctx.files.store("license-documents", upload.fileName, bytes);
    const documentId = this.ctx.db.nextId("doc");
    return this.ctx.db.save<LicenseDocument>("licenseDocuments", documentId, { documentId, verificationRequest: requestId, fileName: upload.fileName, storagePath, mimeType: upload.mimeType, uploadedAt: this.ctx.clock.iso() });
  }

  /** VerificationRequest.submit() */
  private submit(pharmacyId: string, upload: LicenseUpload, bytes: Buffer): VerificationRequest {
    const requestId = this.ctx.db.nextId("vr");
    const request = this.ctx.db.save<VerificationRequest>("verificationRequests", requestId, {
      requestId, pharmacy: pharmacyId, status: "pending", submittedAt: this.ctx.clock.iso(), reviewedAt: null, reviewer: null, rejectionReason: null, registryResult: null, manualCheck: null,
    });
    this.attachDocument(requestId, upload, bytes);
    return request;
  }

  async register(d: RegistrationDetails): Promise<{ pharmacyId: string; requestId: string; accountId: string }> {
    const bytes = this.decodeLicense(d.license);
    const email = d.email.trim().toLowerCase();
    if (this.ctx.db.query<Account>("accounts", (a) => a.email.toLowerCase() === email).length) throw new AppError("CONFLICT", "An account with this e-mail already exists");
    if (this.ctx.db.query<Pharmacy>("pharmacies", (p) => p.licenseNumber === d.licenseNumber).length) throw new AppError("CONFLICT", "A pharmacy with this license number is already registered");
    let coords;
    try {
      coords = await this.ctx.adapters.geocoding.geocode(d.address); // Location.geocoded-via GeocodingAdapter
    } catch {
      throw new AppError("VALIDATION_ERROR", "We could not find that address. Check it and try again.");
    }
    // Everything below only runs after all checks passed, so a failed registration leaves nothing behind.
    const now = this.ctx.clock.iso();
    const locationId = this.ctx.db.nextId("loc");
    this.ctx.db.save<Location>("locations", locationId, { locationId, address: d.address, city: d.city, country: "US", ...coords });
    const accountId = this.ctx.db.nextId("acc");
    this.ctx.db.save<Account>("accounts", accountId, { accountId, email, passwordHash: hashPassword(d.password), role: "pharmacy_staff", isActive: true, createdAt: now, tokenVersion: 0 });
    const pharmacyId = this.ctx.db.nextId("ph");
    this.ctx.db.save<Pharmacy>("pharmacies", pharmacyId, { pharmacyId, name: d.pharmacyName, licenseNumber: d.licenseNumber, phone: d.phone, location: locationId, isAccessible: d.isAccessible, verificationStatus: "pending", lastSyncAt: null });
    const staffId = this.ctx.db.nextId("staff");
    this.ctx.db.save<PharmacyStaff>("pharmacyStaff", staffId, { staffId, fullName: d.fullName, account: accountId, pharmacy: pharmacyId });
    const request = this.submit(pharmacyId, d.license, bytes);
    return { pharmacyId, requestId: request.requestId, accountId };
  }

  /** A rejected pharmacy may send a new license: a fresh pending request, status back to pending. */
  resubmit(pharmacyId: string, upload: LicenseUpload): VerificationRequest {
    const pharmacy = this.mustGetPharmacy(pharmacyId);
    if (pharmacy.verificationStatus !== "rejected") throw new AppError("CONFLICT", pharmacy.verificationStatus === "pending" ? "Your registration is already waiting for review" : "Your pharmacy is already verified");
    const bytes = this.decodeLicense(upload);
    const request = this.submit(pharmacyId, upload, bytes);
    this.ctx.db.save("pharmacies", pharmacyId, { ...pharmacy, verificationStatus: "pending" as VerificationStatus });
    return request;
  }

  /* ------------------------------------------------------------------------------------------- status views */

  private mustGetPharmacy(pharmacyId: string): Pharmacy {
    const p = this.pharmacies.get(pharmacyId);
    if (!p) throw new AppError("NOT_FOUND", "Pharmacy not found");
    return p;
  }

  private requestsFor(pharmacyId: string): VerificationRequest[] {
    return this.ctx.db.query<VerificationRequest>("verificationRequests", (v) => v.pharmacy === pharmacyId).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.requestId.localeCompare(b.requestId, undefined, { numeric: true }));
  }

  /** What the pharmacy manager sees (PharmacyStaff.viewVerificationStatus()). */
  statusFor(pharmacyId: string) {
    const pharmacy = this.mustGetPharmacy(pharmacyId);
    const latest = this.requestsFor(pharmacyId).at(-1);
    return {
      verificationStatus: pharmacy.verificationStatus,
      isVisibleInSearch: this.pharmacies.isVisibleInSearch(pharmacy),
      latestRequest: latest ? { requestId: latest.requestId, status: latest.status, submittedAt: latest.submittedAt, reviewedAt: latest.reviewedAt, rejectionReason: latest.rejectionReason } : null,
    };
  }

  /* --------------------------------------------------------------------------------------------- admin side */

  private mustGetRequest(requestId: string): VerificationRequest {
    const r = this.ctx.db.get<VerificationRequest>("verificationRequests", requestId);
    if (!r) throw new AppError("NOT_FOUND", "Verification request not found");
    return r;
  }

  /** Admin.listPendingRequests() (or any status). */
  listRequests(status: VerificationStatus | "all" = "pending") {
    return this.ctx.db
      .query<VerificationRequest>("verificationRequests", (v) => status === "all" || v.status === status)
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.requestId.localeCompare(b.requestId, undefined, { numeric: true }))
      .map((v) => {
        const p = this.pharmacies.get(v.pharmacy);
        return { requestId: v.requestId, pharmacyId: v.pharmacy, pharmacyName: p?.name ?? "(unknown)", licenseNumber: p?.licenseNumber ?? "", status: v.status, submittedAt: v.submittedAt };
      });
  }

  /** Admin.reviewRegistration(): runs checkWithRegistry() and downloads the license from File Storage. */
  async review(requestId: string) {
    let request = this.mustGetRequest(requestId);
    const pharmacy = this.mustGetPharmacy(request.pharmacy);
    if (request.status === "pending") {
      let registryResult: NonNullable<VerificationRequest["registryResult"]>;
      const checkedAt = this.ctx.clock.iso();
      try {
        const r = await this.ctx.adapters.licenseCheck.checkLicense(pharmacy.licenseNumber);
        registryResult = r.found
          ? { status: "valid", detail: `Registry lists ${pharmacy.licenseNumber} for "${r.holderName}"`, checkedAt }
          : { status: "invalid", detail: `License ${pharmacy.licenseNumber} was not found in the state registry`, checkedAt };
      } catch {
        registryResult = { status: "unavailable", detail: "The licensing registry could not be reached. Compare the document manually.", checkedAt };
      }
      request = this.ctx.db.save("verificationRequests", requestId, { ...request, registryResult });
    }
    const doc = this.ctx.db.query<LicenseDocument>("licenseDocuments", (d) => d.verificationRequest === requestId)[0];
    let document: { documentId: string; fileName: string; mimeType: string; contentBase64: string } | null = null;
    if (doc) {
      try {
        document = { documentId: doc.documentId, fileName: doc.fileName, mimeType: doc.mimeType, contentBase64: this.ctx.files.retrieve(doc.storagePath).toString("base64") }; // LicenseDocument.download()
      } catch {
        document = null;
      }
    }
    const loc = this.pharmacies.getLocation(pharmacy);
    return {
      request,
      pharmacy: { pharmacyId: pharmacy.pharmacyId, name: pharmacy.name, licenseNumber: pharmacy.licenseNumber, phone: pharmacy.phone, isAccessible: pharmacy.isAccessible, address: loc.address, city: loc.city },
      registryResult: request.registryResult,
      document,
    };
  }

  /** Admin.checkLicenseManually(): the admin's own comparison of document vs registry. */
  recordManualCheck(requestId: string, confirmed: boolean, note: string): VerificationRequest {
    const request = this.mustGetRequest(requestId);
    this.mustBePending(request);
    return this.ctx.db.save("verificationRequests", requestId, { ...request, manualCheck: { confirmed, note, checkedAt: this.ctx.clock.iso() } });
  }

  private mustBePending(r: VerificationRequest) {
    if (r.status !== "pending") throw new AppError("CONFLICT", "This request has already been decided");
  }

  /** VerificationRequest.markVerified() -> Pharmacy.updateProfile(verificationStatus = verified) */
  approve(requestId: string, reviewerAccountId: string) {
    const request = this.mustGetRequest(requestId);
    this.mustBePending(request);
    if (!request.manualCheck?.confirmed) throw new AppError("CONFLICT", "Complete the manual license check (and confirm it) before approving");
    return this.decide(request, "verified", reviewerAccountId, null);
  }

  /** VerificationRequest.markRejected(reason) */
  reject(requestId: string, reviewerAccountId: string, reason: string) {
    const request = this.mustGetRequest(requestId);
    this.mustBePending(request);
    return this.decide(request, "rejected", reviewerAccountId, reason);
  }

  private decide(request: VerificationRequest, status: "verified" | "rejected", reviewer: string, reason: string | null) {
    const pharmacy = this.mustGetPharmacy(request.pharmacy);
    const saved = this.ctx.db.save("verificationRequests", request.requestId, { ...request, status, reviewer, reviewedAt: this.ctx.clock.iso(), rejectionReason: reason });
    this.ctx.db.save("pharmacies", pharmacy.pharmacyId, { ...pharmacy, verificationStatus: status });
    return { request: saved, pharmacyId: pharmacy.pharmacyId, verificationStatus: status };
  }
}
