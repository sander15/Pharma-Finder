"use client";

import { useCallback, useEffect, useState } from "react";
import type { PendingRequestSummary, RequestDetail } from "@/lib/services/admin";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";
import { useSession } from "@/lib/client/useSession";
import LoginCard from "./LoginCard";

/** Layer 1 «boundary» Admin Console: showPendingRegistrations, showRequestDetails, showLicenseDocument, recordDecision. */
export default function AdminConsole() {
  const { account, loading, login, logout } = useSession();

  if (loading) return <p className="muted">Loading...</p>;
  if (!account) {
    return <LoginCard title="Administrator sign in" onLogin={login} allowReset={false} hint={<>Demo admin: <span className="mono">admin@pharmafind.demo</span> / <span className="mono">Demo!Pass123</span></>} />;
  }
  if (account.role !== "admin") {
    return (
      <section className="card">
        <h2>Admin console</h2>
        <div className="alert warn">You are signed in as pharmacy staff ({account.email}). Sign out and use an administrator account.</div>
        <button className="btn secondary" onClick={() => void logout()}>Sign out</button>
      </section>
    );
  }
  return <Console name={account.fullName} onLogout={() => void logout()} />;
}

function Console({ name, onLogout }: { name: string; onLogout: () => void }) {
  const [pending, setPending] = useState<PendingRequestSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPending(await api<PendingRequestSummary[]>("GET", "/api/admin/requests"));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <section className="card">
        <div className="row spread">
          <div><h1 style={{ marginBottom: 2 }}>Admin console</h1><div className="muted small">Signed in as {name}</div></div>
          <button className="btn secondary small" onClick={onLogout}>Sign out</button>
        </div>
      </section>
      {error && <div className="alert err" role="alert">{error}</div>}

      <section className="card">
        <div className="row spread"><h2>Pending registrations ({pending.length})</h2><button className="btn secondary small" onClick={() => void load()}>Refresh</button></div>
        {pending.length === 0 ? <p className="muted">No pending requests. Register a pharmacy in the <a href="/portal">portal</a> to see one here.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pharmacy</th><th>License</th><th>Submitted</th><th /></tr></thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.requestId}>
                    <td><strong>{p.pharmacyName}</strong></td>
                    <td className="mono">{p.licenseNumber}</td>
                    <td className="small">{dateTime(p.submittedAt)}</td>
                    <td><button className="btn small" onClick={() => setSelected(p.requestId)}>Review</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && <RequestPanel key={selected} requestId={selected} onClose={() => setSelected(null)} onDecided={() => { setSelected(null); void load(); }} />}
    </div>
  );
}

function RequestPanel({ requestId, onClose, onDecided }: { requestId: string; onClose: () => void; onDecided: () => void }) {
  const [d, setD] = useState<RequestDetail | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    void api<RequestDetail>("GET", `/api/admin/requests/${requestId}`).then(setD).catch((e) => setMsg({ ok: false, text: errorMessage(e) }));
  }, [requestId]);

  async function act<T>(fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      after?.(r);
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function openDocument() {
    await act(() => api<{ fileName: string; mimeType: string; contentBase64: string }>("GET", `/api/admin/requests/${requestId}/document`), (doc) => {
      const bytes = Uint8Array.from(atob(doc.contentBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: doc.mimeType }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  }

  if (!d) return <section className="card"><p className="muted">{msg ? msg.text : "Loading..."}</p></section>;
  const reg = d.registryResult;
  const manual = d.request.manualCheck;
  const conclusive = reg?.status === "valid" || manual?.confirmed === true;

  return (
    <section className="card" style={{ borderColor: "var(--brand)" }} aria-labelledby="req-h">
      <div className="row spread"><h2 id="req-h">{d.pharmacy.name}</h2><button className="btn secondary small" onClick={onClose}>Close</button></div>
      <dl className="grid-2 small" style={{ margin: 0 }}>
        <div><dt className="muted">License number</dt><dd style={{ margin: 0 }} className="mono">{d.pharmacy.licenseNumber}</dd></div>
        <div><dt className="muted">Phone</dt><dd style={{ margin: 0 }}>{d.pharmacy.phone}</dd></div>
        <div><dt className="muted">Address</dt><dd style={{ margin: 0 }}>{d.pharmacy.address}</dd></div>
        <div><dt className="muted">Wheelchair accessible (declared)</dt><dd style={{ margin: 0 }}>{d.pharmacy.isAccessible ? "Yes" : "No / not stated"}</dd></div>
      </dl>

      <div className="row" style={{ margin: "12px 0" }}>
        <span className="small">Document: <strong>{d.document.fileName}</strong> ({d.document.mimeType})</span>
        <button className="btn secondary small" disabled={busy} onClick={() => void openDocument()}>View license document</button>
      </div>

      {msg && <div className={`alert ${msg.ok ? "ok" : "err"}`} role="alert">{msg.text}</div>}

      <h3>1. License check</h3>
      <button className="btn" disabled={busy} onClick={() => void act(() => api<RequestDetail>("POST", `/api/admin/requests/${requestId}/review`), setD)}>Check with licensing registry</button>
      {reg && (
        <div className={`alert ${reg.status === "valid" ? "ok" : reg.status === "invalid" ? "err" : "warn"}`} style={{ marginTop: 10 }}>
          Registry result: <strong>{reg.status}</strong>. {reg.detail}
        </div>
      )}
      {reg && reg.status !== "valid" && (
        <div className="stack" style={{ marginTop: 8 }}>
          <p className="small muted">Registry unavailable or inconclusive? Check the license manually (e.g. with the state board) and record the outcome.</p>
          <label className="field"><span className="label">Manual check note</span><input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
          <div className="row">
            <button className="btn secondary small" disabled={busy} onClick={() => void act(() => api<RequestDetail>("POST", `/api/admin/requests/${requestId}/manual-check`, { confirmed: true, note }), setD)}>License is valid (manual)</button>
            <button className="btn secondary small" disabled={busy} onClick={() => void act(() => api<RequestDetail>("POST", `/api/admin/requests/${requestId}/manual-check`, { confirmed: false, note }), setD)}>License is NOT valid (manual)</button>
          </div>
        </div>
      )}
      {manual && <p className="small">Manual check: <strong>{manual.confirmed ? "confirmed valid" : "not valid"}</strong>{manual.note ? ` - ${manual.note}` : ""}</p>}

      <h3 style={{ marginTop: 16 }}>2. Decision</h3>
      <div className="stack">
        <button className="btn" disabled={busy || !conclusive} onClick={() => void act(() => api("POST", `/api/admin/requests/${requestId}/approve`), onDecided)}>Approve - make listing live</button>
        {!conclusive && <p className="small muted">Approve unlocks after a valid registry result or a manual confirmation.</p>}
        <label className="field"><span className="label">Rejection reason (shown to the pharmacy)</span><input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
        <button className="btn danger" disabled={busy || !reason.trim()} onClick={() => void act(() => api("POST", `/api/admin/requests/${requestId}/reject`, { reason }), onDecided)}>Reject registration</button>
      </div>
    </section>
  );
}
