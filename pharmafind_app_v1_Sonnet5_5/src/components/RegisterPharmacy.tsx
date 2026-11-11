"use client";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/client/api";

/** Reads a File as base64 (without the data: prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file could not be read"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

/** Registration form: pharmacy + manager account + license document. The listing stays hidden until an admin verifies it. */
export default function RegisterPharmacy({ onRegistered }: { onRegistered: () => void }) {
  const [f, setF] = useState({ pharmacyName: "", licenseNumber: "", phone: "", address: "", city: "Lubbock", accessible: "unknown", fullName: "", email: "", password: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Attach a copy of your pharmacy license (PDF, PNG or JPEG).");
    setBusy(true);
    try {
      await api("POST", "/api/pharmacies/register", {
        body: {
          pharmacyName: f.pharmacyName,
          licenseNumber: f.licenseNumber,
          phone: f.phone,
          address: f.address,
          city: f.city,
          isAccessible: f.accessible === "unknown" ? null : f.accessible === "yes",
          fullName: f.fullName,
          email: f.email,
          password: f.password,
          license: { fileName: file.name, mimeType: file.type, contentBase64: await fileToBase64(file) },
        },
      });
      onRegistered();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Register your pharmacy</h2>
      <p className="muted">Registering is free. After an administrator verifies your license, your listing goes live in search results with a “verified pharmacy” badge.</p>
      <form className="stack" onSubmit={submit}>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="grid2">
          <label>Pharmacy name<input type="text" value={f.pharmacyName} onChange={set("pharmacyName")} required /></label>
          <label>License number<input type="text" value={f.licenseNumber} onChange={set("licenseNumber")} placeholder="TX-1234567" required /><span className="hint">Demo registry knows e.g. TX-1051207; others will show as “not found”.</span></label>
          <label>Phone<input type="tel" value={f.phone} onChange={set("phone")} placeholder="(806) 555-0100" required /></label>
          <label>Street address<input type="text" value={f.address} onChange={set("address")} placeholder="Try “Downtown Lubbock”" required /><span className="hint">The demo geocoder knows a few Lubbock places (Texas Tech University, Downtown Lubbock, Depot District, South Plains Mall…).</span></label>
          <label>City<input type="text" value={f.city} onChange={set("city")} required /></label>
          <label>
            Wheelchair accessible?
            <select value={f.accessible} onChange={set("accessible")}>
              <option value="unknown">Not specified</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>Your full name<input type="text" value={f.fullName} onChange={set("fullName")} autoComplete="name" required /></label>
          <label>Login e-mail<input type="email" value={f.email} onChange={set("email")} autoComplete="email" required /></label>
          <label>
            Password
            <input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" required />
            <span className="hint">At least 8 characters, with a letter and a digit.</span>
          </label>
          <label>
            License document
            <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
            <span className="hint">PDF, PNG or JPEG, up to 2 MB.</span>
          </label>
        </div>
        <div><button className="btn primary" disabled={busy}>Submit registration</button></div>
      </form>
    </section>
  );
}
