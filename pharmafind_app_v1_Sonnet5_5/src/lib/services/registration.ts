import { z } from "zod";
import type { Ctx } from "../context";
import { AppError } from "../errors";
import { hashPassword } from "../security";
import type { Account, LicenseDocument, LicenseUpload, Location, Pharmacy, PharmacyStaff, RegistryStatus, VerificationRequest } from "../types";
import { parseInput } from "../validation";
import { passwordSchema, type AuthService } from "./auth";
import type { PharmacyService } from "./pharmacies";

const MAX_DOC_BASE64 = 1_400_000; // ~1 MB of file content
export const DOC_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;

export const licenseUploadSchema = z.object({
  fileName: z.string().min(1).max(120),
  mimeType: z.enum(DOC_MIME_TYPES, { message: "License document must be a PDF, PNG or JPEG file" }),
  contentBase64: z.string().min(1, "License document is required").max(MAX_DOC_BASE64, "License document is larger than 1 MB").regex(/^[A-Za-z0-9+/]+=*$/, "License document is not valid base64"),
});

export const registrationSchema = z.object({
  pharmacyName: z.string().trim().min(2).max(100),
  licenseNumber: z.string().trim().min(3).max(40),
  phone: z.string().trim().regex(/^[0-9+()\-.\s]{7,25}$/, "Enter a valid phone number"),
  address: z.string().trim().min(3).max(200),
  isAccessible: z.boolean(),
  staffFullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(120),
  password: passwordSchema,
  document: licenseUploadSchema,
});
export type RegistrationInput = z.input<typeof registrationSchema>;

export interface RegistrationResult {
  pharmacyId: string;
  requestId: string;
  accountId: string;
  status: "pending";
}

/**
 * Pharmacy Account Management and Verification (Layer 3): Pharmacy.register, VerificationRequest
 * submit / attachDocument / checkWithRegistry / markVerified / markRejected, LicenseDocument upload/download.
 */
export class RegistrationService {
  constructor(
    private ctx: Ctx,
    private auth: AuthService,
    private pharmacies: PharmacyService,
  ) {}

  async register(raw: unknown): Promise<RegistrationResult> {
    const input = parseInput(registrationSchema, raw, "Invalid registration");
    if (this.auth.emailTaken(input.email)) throw new AppError("CONFLICT", "An account with this e-mail already exists");
    const lic = input.licenseNumber.toLowerCase();
    if (this.ctx.db.query<Pharmacy>("pharmacies", (p) => p.licenseNumber.toLowerCase() === lic).length) {
      throw new AppError("CONFLICT", "A pharmacy with this license number is already registered");
    }
    const geo = await this.ctx.adapters.geocoding.geocode(input.address);
    if (!geo) throw new AppError("ADDRESS_NOT_FOUND", `We couldn't locate "${input.address}". Pick an address from the suggestions.`);

    const db = this.ctx.db;
    const now = this.ctx.clock.iso();
    const pharmacyId = db.nextId("ph");
    const locationId = db.nextId("loc");
    const accountId = db.nextId("acc");
    db.save<Location>("locations", locationId, { locationId, latitude: geo.latitude, longitude: geo.longitude, address: geo.address, city: geo.city, country: geo.country });
    db.save<Pharmacy>("pharmacies", pharmacyId, {
      pharmacyId, name: input.pharmacyName, licenseNumber: input.licenseNumber, phone: input.phone, location: locationId,
      isAccessible: input.isAccessible, verificationStatus: "pending", lastSyncAt: null,
    });
    db.save<Account>("accounts", accountId, { accountId, email: input.email, passwordHash: hashPassword(input.password), role: "pharmacy_staff", isActive: true, createdAt: now });
    db.save<PharmacyStaff>("pharmacyStaff", `staff-${accountId}`, { staffId: `staff-${accountId}`, fullName: input.staffFullName, account: accountId, pharmacy: pharmacyId });

    const request = await this.submit(pharmacyId, input.document);
    return { pharmacyId, requestId: request.requestId, accountId, status: "pending" };
  }

  /** VerificationRequest.submit() + attachDocument() + LicenseDocument.upload(). */
  async submit(pharmacyId: string, upload: LicenseUpload): Promise<VerificationRequest> {
    const doc = parseInput(licenseUploadSchema, upload, "Invalid license document");
    const requestId = this.ctx.db.nextId("vr");
    const now = this.ctx.clock.iso();
    const request: VerificationRequest = {
      requestId, pharmacy: pharmacyId, status: "pending", submittedAt: now, reviewedAt: null, reviewer: null, rejectionReason: null, registryResult: null, manualCheck: null,
    };
    this.ctx.db.save("verificationRequests", requestId, request);

    const safeName = doc.fileName.replace(/[^A-Za-z0-9._-]/g, "_");
    const storagePath = await this.ctx.files.store(`licenses/${requestId}/${safeName}`, Buffer.from(doc.contentBase64, "base64"));
    const documentId = this.ctx.db.nextId("doc");
    this.ctx.db.save<LicenseDocument>("licenseDocuments", documentId, { documentId, verificationRequest: requestId, fileName: doc.fileName, storagePath, mimeType: doc.mimeType, uploadedAt: now });
    return request;
  }

  /** A rejected pharmacy corrects its documents and asks again (Pharmacy 1 -- 1..* VerificationRequest). */
  async resubmit(pharmacyId: string, upload: LicenseUpload): Promise<VerificationRequest> {
    const pharmacy = this.pharmacies.get(pharmacyId);
    if (pharmacy.verificationStatus !== "rejected") throw new AppError("PRECONDITION_FAILED", "Only a rejected registration can be resubmitted");
    const request = await this.submit(pharmacyId, upload);
    this.ctx.db.save("pharmacies", pharmacyId, { ...pharmacy, verificationStatus: "pending" as const });
    return request;
  }

  /* ---------- review steps used by the admin console ---------- */

  getRequest(requestId: string): VerificationRequest {
    const r = this.ctx.db.get<VerificationRequest>("verificationRequests", requestId);
    if (!r) throw new AppError("NOT_FOUND", "Verification request not found");
    return r;
  }

  getDocument(requestId: string): LicenseDocument {
    const docs = this.ctx.db.query<LicenseDocument>("licenseDocuments", (d) => d.verificationRequest === requestId).sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
    const doc = docs[docs.length - 1];
    if (!doc) throw new AppError("NOT_FOUND", "No license document attached to this request");
    return doc;
  }

  async downloadDocument(requestId: string): Promise<{ meta: LicenseDocument; content: Buffer }> {
    const meta = this.getDocument(requestId);
    const content = await this.ctx.files.retrieve(meta.storagePath);
    if (!content) throw new AppError("NOT_FOUND", "License document file is missing from storage");
    return { meta, content };
  }

  private requirePending(request: VerificationRequest): void {
    if (request.status !== "pending") throw new AppError("PRECONDITION_FAILED", `This request was already ${request.status}`);
  }

  /** VerificationRequest.checkWithRegistry(): downloads the document, asks the licensing registry. */
  async checkWithRegistry(requestId: string): Promise<NonNullable<VerificationRequest["registryResult"]>> {
    const request = this.getRequest(requestId);
    this.requirePending(request);
    await this.downloadDocument(requestId);
    const pharmacy = this.pharmacies.get(request.pharmacy);
    let status: RegistryStatus;
    let detail: string;
    try {
      ({ status, detail } = await this.ctx.adapters.licenseCheck.checkLicense(pharmacy.licenseNumber));
    } catch {
      status = "unavailable";
      detail = "Registry unavailable";
    }
    const registryResult = { status, detail, checkedAt: this.ctx.clock.iso() };
    this.ctx.db.save("verificationRequests", requestId, { ...request, registryResult });
    return registryResult;
  }

  recordManualCheck(requestId: string, confirmed: boolean, note: string): VerificationRequest {
    const request = this.getRequest(requestId);
    this.requirePending(request);
    return this.ctx.db.save("verificationRequests", requestId, { ...request, manualCheck: { confirmed, note, checkedAt: this.ctx.clock.iso() } });
  }

  /** markVerified(): needs a conclusive check (registry valid, or an admin's manual confirmation). */
  markVerified(requestId: string, reviewerAccountId: string): VerificationRequest {
    const request = this.getRequest(requestId);
    this.requirePending(request);
    const conclusive = request.registryResult?.status === "valid" || request.manualCheck?.confirmed === true;
    if (!conclusive) throw new AppError("PRECONDITION_FAILED", "Run the license check (or confirm it manually) before approving");
    const decided = this.ctx.db.save<VerificationRequest>("verificationRequests", requestId, { ...request, status: "verified", reviewedAt: this.ctx.clock.iso(), reviewer: reviewerAccountId });
    const pharmacy = this.pharmacies.get(request.pharmacy);
    this.ctx.db.save("pharmacies", pharmacy.pharmacyId, { ...pharmacy, verificationStatus: "verified" as const });
    return decided;
  }

  markRejected(requestId: string, reviewerAccountId: string, reason: unknown): VerificationRequest {
    const why = parseInput(z.string().trim().min(1, "A rejection reason is required").max(500), reason, "Invalid reason");
    const request = this.getRequest(requestId);
    this.requirePending(request);
    const decided = this.ctx.db.save<VerificationRequest>("verificationRequests", requestId, {
      ...request, status: "rejected", reviewedAt: this.ctx.clock.iso(), reviewer: reviewerAccountId, rejectionReason: why,
    });
    const pharmacy = this.pharmacies.get(request.pharmacy);
    this.ctx.db.save("pharmacies", pharmacy.pharmacyId, { ...pharmacy, verificationStatus: "rejected" as const });
    return decided;
  }
}
