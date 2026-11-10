import { z } from "zod";
import type { Ctx } from "../context";
import type { Pharmacy, SessionAccount, VerificationRequest } from "../types";
import { parseInput } from "../validation";
import type { AuthService } from "./auth";
import type { PharmacyService } from "./pharmacies";
import type { RegistrationService } from "./registration";

export interface PendingRequestSummary {
  requestId: string;
  pharmacyId: string;
  pharmacyName: string;
  licenseNumber: string;
  submittedAt: string;
  status: VerificationRequest["status"];
}

export interface RequestDetail {
  request: VerificationRequest;
  pharmacy: { pharmacyId: string; name: string; licenseNumber: string; phone: string; address: string; isAccessible: boolean; verificationStatus: Pharmacy["verificationStatus"] };
  document: { fileName: string; mimeType: string; uploadedAt: string };
  registryResult: VerificationRequest["registryResult"];
}

const manualCheckSchema = z.object({ confirmed: z.boolean(), note: z.string().trim().max(500).default("") });

/** Admin actor operations (Admin Console): list, review, manual check, approve, reject. */
export class AdminService {
  constructor(
    private ctx: Ctx,
    private auth: AuthService,
    private registration: RegistrationService,
    private pharmacies: PharmacyService,
  ) {}

  private guard(account: SessionAccount): void {
    this.auth.authorize(account, "verification:review");
  }

  async listPendingRequests(account: SessionAccount): Promise<PendingRequestSummary[]> {
    this.guard(account);
    return this.ctx.db
      .query<VerificationRequest>("verificationRequests", (r) => r.status === "pending")
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
      .map((r) => {
        const p = this.pharmacies.get(r.pharmacy);
        return { requestId: r.requestId, pharmacyId: p.pharmacyId, pharmacyName: p.name, licenseNumber: p.licenseNumber, submittedAt: r.submittedAt, status: r.status };
      });
  }

  private detail(requestId: string): RequestDetail {
    const request = this.registration.getRequest(requestId);
    const p = this.pharmacies.get(request.pharmacy);
    const doc = this.registration.getDocument(requestId);
    return {
      request,
      pharmacy: { pharmacyId: p.pharmacyId, name: p.name, licenseNumber: p.licenseNumber, phone: p.phone, address: this.pharmacies.location(p).address, isAccessible: p.isAccessible, verificationStatus: p.verificationStatus },
      document: { fileName: doc.fileName, mimeType: doc.mimeType, uploadedAt: doc.uploadedAt },
      registryResult: request.registryResult,
    };
  }

  /** Read-only view of a request (no registry call). */
  async viewRequest(account: SessionAccount, requestId: string): Promise<RequestDetail> {
    this.guard(account);
    return this.detail(requestId);
  }

  /** reviewRegistration(): runs the registry check through VerificationRequest.checkWithRegistry. */
  async reviewRegistration(account: SessionAccount, requestId: string): Promise<RequestDetail & { registryResult: NonNullable<RequestDetail["registryResult"]> }> {
    this.guard(account);
    const registryResult = await this.registration.checkWithRegistry(requestId);
    return { ...this.detail(requestId), registryResult };
  }

  /** checkLicenseManually(): the admin records the outcome of their own check (registry down/inconclusive). */
  async checkLicenseManually(account: SessionAccount, requestId: string, input: { confirmed: boolean; note?: string }): Promise<RequestDetail> {
    this.guard(account);
    const v = parseInput(manualCheckSchema, input, "Invalid manual check");
    this.registration.recordManualCheck(requestId, v.confirmed, v.note);
    return this.detail(requestId);
  }

  async approve(account: SessionAccount, requestId: string): Promise<RequestDetail> {
    this.guard(account);
    this.registration.markVerified(requestId, account.accountId);
    return this.detail(requestId);
  }

  async reject(account: SessionAccount, requestId: string, reason: string): Promise<RequestDetail> {
    this.guard(account);
    this.registration.markRejected(requestId, account.accountId, reason);
    return this.detail(requestId);
  }

  async getLicenseDocument(account: SessionAccount, requestId: string): Promise<{ fileName: string; mimeType: string; contentBase64: string }> {
    this.guard(account);
    const { meta, content } = await this.registration.downloadDocument(requestId);
    return { fileName: meta.fileName, mimeType: meta.mimeType, contentBase64: content.toString("base64") };
  }
}
