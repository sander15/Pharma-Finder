import type { RegistryStatus } from "../types";

export interface LicenseCheckResult {
  status: RegistryStatus;
  detail: string;
}

/** «interface - Layer 4» License Check Adapter (external: Pharmacy licensing registry). */
export interface LicenseCheckAdapter {
  checkLicense(licenseNumber: string): Promise<LicenseCheckResult>;
}

/**
 * MOCK licensing registry. Rules (documented so the demo is predictable):
 *   - TX-PH-9xxxx  -> registry "unavailable" (forces the admin's manual license check)
 *   - TX-PH-00000  -> known revoked license -> invalid
 *   - TX-PH-nnnnn  -> valid
 *   - anything else (wrong format) -> invalid
 */
export class MockLicenseCheckAdapter implements LicenseCheckAdapter {
  async checkLicense(licenseNumber: string): Promise<LicenseCheckResult> {
    if (/^TX-PH-9\d{4}$/.test(licenseNumber)) return { status: "unavailable", detail: "Registry did not respond (simulated outage). Check manually." };
    if (licenseNumber === "TX-PH-00000") return { status: "invalid", detail: "License TX-PH-00000 is revoked." };
    if (/^TX-PH-\d{5}$/.test(licenseNumber)) return { status: "valid", detail: `License ${licenseNumber} is active in the registry.` };
    return { status: "invalid", detail: `No license "${licenseNumber}" found in the registry.` };
  }
}
