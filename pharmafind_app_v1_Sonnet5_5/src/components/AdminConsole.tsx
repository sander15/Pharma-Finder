"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { useSession } from "@/lib/client/hooks";
import { formatDateTime } from "@/lib/client/format";
import type { VerificationRequest, VerificationStatus } from "@/lib/types";
import LoginCard from "./LoginCard";

interface RequestRow { requestId: string; pharmacyId: string; pharmacyName: string; licenseNumber: string; status: VerificationStatus; submittedAt: string }
interface RequestDetails {
  request: VerificationRequest;
  pharmacy: { pharmacyId: string; name: string; licenseNumber: string; phone: string; isAccessible: boolean | null; address: string; city: string };
  registryResult: VerificationRequest["registryResult"];
  document: { documentId: string; fileName: string; mimeType: string; contentBase64: string } | null;
}

const registryBadge = (s: "valid" | "invalid" | "unavailable") => (s === "valid" ? <span className="badge ok">✓ Found in registry</span> : s === "invalid" ? <span className="badge danger">✗ Not found in registry</span> : <span className="badge warn">Registry unavailable</span>);

function RequestDetail({ requestId, onDecided, onBack }: { requestId: string; onDecided: () => void; onBack: () => void }) {
  const [d, setD] = useState<RequestDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setD((await api<RequestDetails>("GET", `/api/admin/requests/${requestId}`)).data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [requestId]);
  useEffect(() => void load(), [load]);

  async function act(path: string, body?: unknown, done?: string) {
    setMsg(null);
    try {
      await api("POST", `/api/admin/requests/${requestId}/${path}`, { body });
      if (path === "approve" || path === "reject") return onDecided();
      setMsg({ kind: "ok", text: done ?? "Saved" });
      await load();
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    }
  }

  if (error) return <div className="stack"><div className="alert error" role="alert">{error}</div><button className="btn" onClick={onBack}>Back</button></div>;
  if (!d) return <div className="empty"><span className="spinner" /> Loading…</div>;

  const pending = d.request.status === "pending";
  const doc = d.document;
  const dataUrl = doc ? `data:${doc.mimeType};base64,${doc.contentBase64}` : null;

  return (
    <div className="stack">
      <div><button className="btn small" onClick={onBack}>← Pending requests</button></div>
      <section className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>{d.pharmacy.name}</h2>
          <span className={`badge ${d.request.status === "verified" ? "ok" : d.request.status === "rejected" ? "danger" : "warn"}`}>{d.request.status}</span>
        </div>
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>License number</dt><dd className="mono">{d.pharmacy.licenseNumber}</dd>
          <dt>Address</dt><dd>{d.pharmacy.address}, {d.pharmacy.city}</dd>
          <dt>Phone</dt><dd>{d.pharmacy.phone}</dd>
          <dt>Wheelchair accessible</dt><dd>{d.pharmacy.isAccessible === null ? "not specified" : d.pharmacy.isAccessible ? "yes" : "no"}</dd>
          <dt>Submitted</dt><dd>{formatDateTime(d.request.submittedAt)}</dd>
        </dl>
      </section>

      <section className="card">
        <h3>Licensing registry result</h3>
        {d.registryResult ? <div className="stack"><div>{registryBadge(d.registryResult.status)}</div><p className="muted" style={{ margin: 0 }}>{d.registryResult.detail}</p></div> : <p className="muted">Not checked.</p>}
      </section>

      <section className="card">
        <h3>License document</h3>
        {doc && dataUrl ? (
          <div className="stack">
            <div className="row">
              <span className="mono">{doc.fileName}</span>
              <a className="btn small" href={dataUrl} download={doc.fileName}>Download</a>
            </div>
            {doc.mimeType.startsWith("image/") ? <img src={dataUrl} alt={`License document ${doc.fileName}`} style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid var(--border)" }} /> : <div className="pre">{atob(doc.contentBase64).slice(0, 600)}</div>}
          </div>
        ) : <p className="alert warn">The document could not be retrieved.</p>}
      </section>

      {pending ? (
        <section className="card stack">
          <h3>Decision</h3>
          <div className="alert info">Compare the document with the registry result, record your manual check, then approve or reject.</div>
          {d.request.manualCheck && <p className="alert ok">Manual check recorded: <strong>{d.request.manualCheck.confirmed ? "document matches" : "problem found"}</strong>{d.request.manualCheck.note ? ` — ${d.request.manualCheck.note}` : ""}</p>}
          <label>Manual check note (optional)<input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
          <div className="row">
            <button className="btn" onClick={() => void act("manual-check", { confirmed: true, note }, "Manual check recorded: document matches.")}>✓ Document matches</button>
            <button className="btn" onClick={() => void act("manual-check", { confirmed: false, note }, "Manual check recorded: problem found.")}>✗ Problem with document</button>
          </div>
          <div className="row">
            <button className="btn primary" disabled={!d.request.manualCheck?.confirmed} onClick={() => void act("approve")}>Approve & verify</button>
          </div>
          <label>Rejection reason (shown to the pharmacy)<input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
          <div><button className="btn danger" onClick={() => void act("reject", { reason })}>Reject</button></div>
          {msg && <div className={`alert ${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}>{msg.text}</div>}
        </section>
      ) : (
        <section className="card">
          <h3>Decision</h3>
          <p>{d.request.status === "verified" ? "Approved" : "Rejected"} on {formatDateTime(d.request.reviewedAt)}{d.request.rejectionReason ? `: ${d.request.rejectionReason}` : ""}</p>
        </section>
      )}
    </div>
  );
}

export default function AdminConsole() {
  const { account, loading, refresh, logout } = useSession();
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = account?.role === "admin";

  const load = useCallback(async () => {
    try {
      setRows((await api<{ requests: RequestRow[] }>("GET", "/api/admin/requests", { query: { status } })).data.requests);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [status]);
  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  if (loading) return <div className="empty"><span className="spinner" /> Loading…</div>;
  if (!account) return <div className="stack"><h1>Admin console</h1><LoginCard title="Administrator login" demoHint="Demo: admin@pharmafind.demo / Demo!Pass123" onLoggedIn={() => void refresh()} /></div>;
  if (!isAdmin) return <div className="stack"><div className="alert warn">You are logged in as a pharmacy manager. The admin console is for administrators.</div><div><button className="btn" onClick={() => void logout()}>Log out</button></div></div>;

  return (
    <div className="stack">
      <div className="row between">
        <div><h1 style={{ marginBottom: 2 }}>Admin console</h1><small className="muted">Signed in as {account.fullName}</small></div>
        <button className="btn" onClick={() => void logout()}>Log out</button>
      </div>
      {selected ? (
        <RequestDetail requestId={selected} onBack={() => setSelected(null)} onDecided={() => { setSelected(null); void load(); }} />
      ) : (
        <section className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Registrations</h2>
            <label style={{ minWidth: 170 }}><span className="sr-only">Filter</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as "pending" | "all")}>
                <option value="pending">Pending review</option>
                <option value="all">All requests</option>
              </select>
            </label>
          </div>
          {error && <div className="alert error" role="alert">{error}</div>}
          {!rows ? <div className="empty"><span className="spinner" /></div> : rows.length === 0 ? <p className="empty">Nothing waiting for review.</p> : (
            <table className="items">
              <thead><tr><th>Pharmacy</th><th>License</th><th>Submitted</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.requestId}>
                    <td data-label="Pharmacy"><strong>{r.pharmacyName}</strong></td>
                    <td data-label="License" className="mono">{r.licenseNumber}</td>
                    <td data-label="Submitted">{formatDateTime(r.submittedAt)}</td>
                    <td data-label="Status"><span className={`badge ${r.status === "verified" ? "ok" : r.status === "rejected" ? "danger" : "warn"}`}>{r.status}</span></td>
                    <td><button className="btn small primary" onClick={() => setSelected(r.requestId)}>Review</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
