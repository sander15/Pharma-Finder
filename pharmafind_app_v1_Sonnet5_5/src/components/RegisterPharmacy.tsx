"use client";

import { useEffect, useState } from "react";
import { api, errorMessage, readFileAsBase64 } from "@/lib/client/api";

export default function RegisterPharmacy({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ pharmacyName: "", licenseNumber: "", phone: "", address: "", isAccessible: false, staffFullName: "", email: "", password: "" });
  const [file, setFile] = useState<File | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void api<string[]>("GET", "/api/geocode/suggestions").then(setSuggestions).catch(() => undefined);
  }, []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((cur) => ({ ...cur, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Attach your pharmacy license (PDF, PNG or JPEG, max 1 MB).");
    setBusy(true);
    setError(null);
    try {
      const contentBase64 = await readFileAsBase64(file);
      await api("POST", "/api/pharmacies/register", { ...f, document: { fileName: file.name, mimeType: file.type, contentBase64 } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="card">
        <h2>Registration received</h2>
        <div className="alert info">Your verification is <strong>pending</strong>. Your listing will not appear in search until an administrator verifies your license.</div>
        <p>You can already sign in to prepare your listings. In this demo, approve your registration from the <a href="/admin">Admin console</a>.</p>
        <button className="btn" onClick={onDone}>Go to sign in</button>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Register your pharmacy</h2>
      <p className="muted">Registration and verification are separate steps: you can register now, but your listing goes live only after verification.</p>
      {error && <div className="alert err" role="alert">{error}</div>}
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <label className="field"><span className="label">Pharmacy name</span><input type="text" required value={f.pharmacyName} onChange={set("pharmacyName")} /></label>
          <label className="field"><span className="label">License number</span><input type="text" required value={f.licenseNumber} onChange={set("licenseNumber")} placeholder="TX-PH-12345" /></label>
          <label className="field"><span className="label">Phone</span><input type="text" required value={f.phone} onChange={set("phone")} placeholder="806-555-0100" /></label>
          <label className="field">
            <span className="label">Address</span>
            <input type="text" required list="reg-addr" value={f.address} onChange={set("address")} placeholder="Pick a suggested address" />
            <datalist id="reg-addr">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={f.isAccessible} onChange={set("isAccessible")} /><span>My pharmacy is wheelchair accessible</span></label>
        <div className="grid-2">
          <label className="field"><span className="label">Your full name</span><input type="text" required value={f.staffFullName} onChange={set("staffFullName")} autoComplete="name" /></label>
          <label className="field"><span className="label">Your e-mail</span><input type="email" required value={f.email} onChange={set("email")} autoComplete="email" /></label>
          <label className="field"><span className="label">Password (8+ characters)</span><input type="password" required minLength={8} value={f.password} onChange={set("password")} autoComplete="new-password" /></label>
          <label className="field"><span className="label">License document</span><input type="file" required accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        </div>
        <p className="small muted">Demo hint: license numbers like <span className="mono">TX-PH-55555</span> pass the mock registry; <span className="mono">TX-PH-9xxxx</span> makes the registry &quot;unavailable&quot; (manual check); <span className="mono">TX-PH-00000</span> is invalid.</p>
        <button className="btn" disabled={busy}>{busy ? "Submitting..." : "Register pharmacy"}</button>
      </form>
    </section>
  );
}
