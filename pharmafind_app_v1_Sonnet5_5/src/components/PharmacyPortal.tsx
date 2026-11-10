"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dashboard, VerificationStatusView } from "@/lib/services/portal";
import type { AutomaticFeed, FeedImport, Product } from "@/lib/types";
import { api, errorMessage, readFileAsBase64, readFileAsText } from "@/lib/client/api";
import { dateTime, money, timeAgo } from "@/lib/client/format";
import { useSession } from "@/lib/client/useSession";
import LoginCard from "./LoginCard";
import RegisterPharmacy from "./RegisterPharmacy";

type Tab = "dashboard" | "listings" | "csv" | "feed" | "verification";
const TABS: Array<[Tab, string]> = [["dashboard", "Dashboard"], ["listings", "Edit listings"], ["csv", "CSV upload"], ["feed", "Automatic feed"], ["verification", "Verification"]];

const SAMPLE_CSV = "catalogId,stock,price\nPF-1001,40,7.99\nPF-1002,20,8.49\nPF-1005,25,9.99\n";

/** Layer 1 «boundary» Pharmacy Portal. */
export default function PharmacyPortal() {
  const { account, loading, login, logout } = useSession();
  const [view, setView] = useState<"login" | "register">("login");

  if (loading) return <p className="muted">Loading...</p>;

  if (!account) {
    return (
      <div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={view === "login"} className="tab" onClick={() => setView("login")}>Sign in</button>
          <button role="tab" aria-selected={view === "register"} className="tab" onClick={() => setView("register")}>Register a pharmacy</button>
        </div>
        {view === "login" ? (
          <LoginCard
            title="Pharmacy sign in"
            onLogin={login}
            hint={<>Demo accounts (password <span className="mono">Demo!Pass123</span>): <span className="mono">hubcity@pharmafind.demo</span> (verified, fresh data), <span className="mono">southwest@pharmafind.demo</span> (stale sync), <span className="mono">quaker@pharmafind.demo</span> (pending), <span className="mono">indiana@pharmafind.demo</span> (rejected).</>}
          />
        ) : (
          <RegisterPharmacy onDone={() => setView("login")} />
        )}
      </div>
    );
  }

  if (account.role !== "pharmacy_staff" || !account.pharmacyId) {
    return (
      <section className="card">
        <h2>Pharmacy portal</h2>
        <div className="alert warn">You are signed in as an administrator ({account.email}). Sign out and use a pharmacy account to open the portal.</div>
        <button className="btn secondary" onClick={() => void logout()}>Sign out</button>
      </section>
    );
  }

  return <PortalHome pharmacyId={account.pharmacyId} name={account.fullName} onLogout={() => void logout()} />;
}

function PortalHome({ pharmacyId, name, onLogout }: { pharmacyId: string; name: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDash(await api<Dashboard>("GET", `/api/pharmacies/${pharmacyId}/dashboard`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [pharmacyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div>
      <section className="card">
        <div className="row spread">
          <div>
            <h1 style={{ marginBottom: 2 }}>{dash?.pharmacy.name ?? "Pharmacy portal"}</h1>
            <div className="muted small">Signed in as {name}</div>
          </div>
          <div className="row">
            {dash && <StatusBadge status={dash.pharmacy.verificationStatus} />}
            <button className="btn secondary small" onClick={onLogout}>Sign out</button>
          </div>
        </div>
      </section>

      {error && <div className="alert err" role="alert">{error}</div>}

      <div className="tabs" role="tablist" aria-label="Portal sections">
        {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className="tab" onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {tab === "dashboard" && dash && <DashboardTab dash={dash} onRefresh={reload} />}
      {tab === "listings" && <ListingsTab pharmacyId={pharmacyId} dash={dash} onChanged={reload} />}
      {tab === "csv" && <CsvTab pharmacyId={pharmacyId} onChanged={reload} />}
      {tab === "feed" && <FeedTab pharmacyId={pharmacyId} feed={dash?.feed ?? null} onChanged={reload} />}
      {tab === "verification" && <VerificationTab pharmacyId={pharmacyId} onChanged={reload} />}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "verified") return <span className="badge ok">✓ Verified · listing live</span>;
  if (status === "pending") return <span className="badge warn">Verification pending · not live</span>;
  return <span className="badge err">Verification rejected · not live</span>;
}

/* ---------------------------------- dashboard ---------------------------------- */
function DashboardTab({ dash, onRefresh }: { dash: Dashboard; onRefresh: () => void }) {
  return (
    <div>
      {dash.isStale && (
        <div className="alert warn" role="alert">
          <strong>Your data is stale.</strong> It has not synced within the expected {dash.staleAfterHours}-hour window{dash.lastSyncAt ? ` (last sync ${timeAgo(dash.lastSyncAt)})` : " (no sync yet)"}. Searchers may see outdated stock and prices. Upload a CSV or check your automatic feed.
        </div>
      )}
      {!dash.pharmacy.isLive && <div className="alert info">Your listing is <strong>not visible to searchers</strong> until your pharmacy is verified.</div>}

      <section className="card">
        <div className="row spread">
          <h2>Last sync</h2>
          <button className="btn secondary small" onClick={onRefresh}>Refresh</button>
        </div>
        <p style={{ marginBottom: 4 }}>
          <strong>{dash.lastSyncAt ? dateTime(dash.lastSyncAt) : "Never synced"}</strong>{" "}
          {dash.lastSyncAt && <span className="muted">({timeAgo(dash.lastSyncAt)})</span>}{" "}
          {dash.isStale ? <span className="badge warn">Stale</span> : <span className="badge ok">Fresh</span>}
        </p>
        {dash.lastAttempt && !dash.lastAttempt.success && <p className="small" style={{ color: "var(--err-fg)" }}>Latest attempt failed ({timeAgo(dash.lastAttempt.syncedAt)}): {dash.lastAttempt.details}</p>}
        <p className="small muted">Automatic feed: {dash.feed ? (dash.feed.isEnabled ? `enabled, every ${dash.feed.intervalMinutes} min (${dash.feed.posEndpoint})` : "configured but disabled") : "not set up"}</p>
      </section>

      <section className="card">
        <h2>Preview of your public listing</h2>
        <p className="small muted">This is what searchers see{dash.pharmacy.isLive ? "" : " once you are verified"}.</p>
        {dash.listingsPreview.length === 0 ? <p className="muted">No products listed yet. Add some in “Edit listings” or upload a CSV.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Presentation</th><th>Stock</th><th>Price</th><th>Updated</th></tr></thead>
              <tbody>
                {dash.listingsPreview.map((r) => (
                  <tr key={r.catalogId}>
                    <td><strong>{r.brandName === "Generic" ? `${r.genericName} (generic)` : r.brandName}</strong><div className="small muted">{r.catalogId}</div></td>
                    <td>{r.dosage}<div className="small muted">{r.presentation}</div></td>
                    <td>{r.inStock ? r.stock : <span className="badge err">Out</span>}</td>
                    <td>{money(r.price)}</td>
                    <td className="small">{timeAgo(r.lastUpdated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Recent imports</h2>
        {dash.recentImports.length === 0 ? <p className="muted">No imports yet.</p> : <ImportTable imports={dash.recentImports} />}
      </section>
    </div>
  );
}

function ImportTable({ imports }: { imports: FeedImport[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>When</th><th>Source</th><th>Result</th><th>Rows (valid / rejected / total)</th></tr></thead>
        <tbody>
          {imports.map((i) => (
            <tr key={i.importId}>
              <td className="small">{dateTime(i.startedAt)}</td>
              <td>{i.source === "csv" ? `CSV${i.fileName ? ` (${i.fileName})` : ""}` : "POS feed"}</td>
              <td>{i.status === "accepted" ? <span className="badge ok">Accepted</span> : <span className="badge err">Rejected</span>}</td>
              <td>{i.validRows} / {i.rejectedRows} / {i.totalRows}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------- manual listings ---------------------------------- */
function ListingsTab({ pharmacyId, dash, onChanged }: { pharmacyId: string; dash: Dashboard | null; onChanged: () => void }) {
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [catalogId, setCatalogId] = useState("");
  const [stock, setStock] = useState("");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<Product[]>("GET", "/api/catalog").then((c) => { setCatalog(c); setCatalogId((cur) => cur || c[0]?.catalogId || ""); }).catch(() => undefined);
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      // The form hands over numbers; the server validates them strictly (no coercion server-side).
      const body = { catalogId, stock: stock === "" ? undefined : Number(stock), price: price === "" ? undefined : Number(price) };
      await api("PUT", `/api/pharmacies/${pharmacyId}/listings`, body);
      setMsg({ ok: true, text: `Saved ${catalogId}. Last-updated time refreshed.` });
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <section className="card">
        <h2>Update stock and price</h2>
        {msg && <div className={`alert ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</div>}
        <form className="stack" onSubmit={save}>
          <label className="field">
            <span className="label">Product</span>
            <select value={catalogId} onChange={(e) => setCatalogId(e.target.value)}>
              {catalog.map((p) => <option key={p.catalogId} value={p.catalogId}>{p.catalogId} · {p.brandName === "Generic" ? `${p.genericName} (generic)` : p.brandName} {p.dosage} · {p.presentation}</option>)}
            </select>
          </label>
          <div className="grid-2">
            <label className="field"><span className="label">Stock (whole number, 0 = out of stock)</span><input type="number" inputMode="numeric" min={0} step={1} required value={stock} onChange={(e) => setStock(e.target.value)} /></label>
            <label className="field"><span className="label">Price (USD)</span><input type="number" inputMode="decimal" min={0.01} step={0.01} required value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          </div>
          <button className="btn" disabled={busy}>{busy ? "Saving..." : "Save listing"}</button>
        </form>
      </section>

      <section className="card">
        <h2>Your listings</h2>
        {!dash || dash.listingsPreview.length === 0 ? <p className="muted">Nothing listed yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Stock</th><th>Price</th><th /></tr></thead>
              <tbody>
                {dash.listingsPreview.map((r) => (
                  <tr key={r.catalogId}>
                    <td>{r.catalogId} · {r.brandName === "Generic" ? `${r.genericName} (generic)` : r.brandName} <span className="muted small">{r.dosage}</span></td>
                    <td>{r.stock}</td>
                    <td>{money(r.price)}</td>
                    <td><button className="btn secondary small" onClick={() => { setCatalogId(r.catalogId); setStock(String(r.stock)); setPrice(String(r.price)); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------- CSV ---------------------------------- */
function CsvTab({ pharmacyId, onChanged }: { pharmacyId: string; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("pasted.csv");
  const [result, setResult] = useState<FeedImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api<FeedImport>("POST", `/api/pharmacies/${pharmacyId}/csv`, { fileName, content: text }));
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <section className="card">
        <h2>Upload a CSV from your inventory system</h2>
        <p className="muted">Files must use the Pharmafind standard format exactly. Rows that don&apos;t comply are rejected, never corrected.</p>
        <pre className="mono card" style={{ background: "var(--surface-2)", overflowX: "auto", margin: "0 0 0.75rem" }}>{SAMPLE_CSV}</pre>
        <ul className="small muted" style={{ paddingLeft: 20, marginTop: 0 }}>
          <li>First line is exactly <span className="mono">catalogId,stock,price</span></li>
          <li><span className="mono">catalogId</span>: a Pharmafind catalog ID such as PF-1001 (upper-case, no spaces)</li>
          <li><span className="mono">stock</span>: whole number, 0 or more · <span className="mono">price</span>: positive, up to 2 decimals, no currency symbol</li>
        </ul>
        {error && <div className="alert err" role="alert">{error}</div>}
        <div className="stack">
          <label className="field"><span className="label">CSV file</span>
            <input type="file" accept=".csv,text/csv,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFileName(f.name); setText(await readFileAsText(f)); } }} />
          </label>
          <label className="field"><span className="label">…or paste CSV text</span><textarea value={text} onChange={(e) => { setText(e.target.value); setFileName("pasted.csv"); }} spellCheck={false} /></label>
          <div className="row">
            <button className="btn" disabled={busy || !text} onClick={() => void upload()}>{busy ? "Importing..." : "Import"}</button>
            <button className="btn secondary" type="button" onClick={() => { setText(SAMPLE_CSV); setFileName("sample.csv"); }}>Load sample</button>
          </div>
        </div>
      </section>

      {result && (
        <section className="card" aria-live="polite">
          <h2>Import summary</h2>
          <div className={`alert ${result.status === "accepted" ? "ok" : "err"}`}>
            {result.status === "accepted" ? `Import accepted: ${result.validRows} saved, ${result.rejectedRows} rejected, ${result.totalRows} total rows. Sync time recorded.` : `Feed rejected: nothing was saved. ${result.rejections[0]?.reason ?? ""}`}
          </div>
          {result.rejections.length > 0 && result.status === "accepted" && (
            <div className="table-wrap">
              <table><thead><tr><th>Row</th><th>Why it was rejected</th></tr></thead><tbody>{result.rejections.map((r) => <tr key={r.row}><td>{r.row}</td><td>{r.reason}</td></tr>)}</tbody></table>
            </div>
          )}
          {result.status === "rejected" && result.rejections.length > 1 && (
            <div className="table-wrap">
              <table><thead><tr><th>Row</th><th>Why it was rejected</th></tr></thead><tbody>{result.rejections.map((r) => <tr key={r.row}><td>{r.row}</td><td>{r.reason}</td></tr>)}</tbody></table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/* ---------------------------------- automatic feed ---------------------------------- */
function FeedTab({ pharmacyId, feed, onChanged }: { pharmacyId: string; feed: AutomaticFeed | null; onChanged: () => void }) {
  const [endpoint, setEndpoint] = useState(feed?.posEndpoint ?? "");
  const [interval, setIntervalMin] = useState(String(feed?.intervalMinutes ?? 15));
  const [endpoints, setEndpoints] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ posEndpoints: string[] }>("GET", "/api/demo/state").then((s) => setEndpoints(s.posEndpoints)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (feed) { setEndpoint(feed.posEndpoint); setIntervalMin(String(feed.intervalMinutes)); }
  }, [feed]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("PUT", `/api/pharmacies/${pharmacyId}/feed`, { posEndpoint: endpoint, intervalMinutes: Number(interval) });
      setMsg({ ok: true, text: "Connection successful. Automatic feed is active and will sync on schedule." });
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await api("DELETE", `/api/pharmacies/${pharmacyId}/feed`);
      setMsg({ ok: true, text: "Automatic feed disabled." });
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Automatic POS feed</h2>
      <p className="muted">Connect your point-of-sale system so stock and prices sync without double entry. We test the connection first, then enable the feed.</p>
      {feed && <div className={`alert ${feed.isEnabled ? "ok" : "warn"}`}>{feed.isEnabled ? `Feed active: ${feed.posEndpoint} every ${feed.intervalMinutes} min. Last pull: ${feed.lastPulledAt ? timeAgo(feed.lastPulledAt) : "not yet"}.` : "Feed is configured but disabled."}</div>}
      {msg && <div className={`alert ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</div>}
      <form className="stack" onSubmit={connect}>
        <label className="field">
          <span className="label">POS endpoint</span>
          <input type="text" list="pos-endpoints" required value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://pos.mock/hub-city" />
          <datalist id="pos-endpoints">{endpoints.map((x) => <option key={x} value={x} />)}</datalist>
        </label>
        <label className="field" style={{ maxWidth: 260 }}>
          <span className="label">Sync every (minutes, 5-1440)</span>
          <input type="number" inputMode="numeric" min={5} max={1440} step={1} required value={interval} onChange={(e) => setIntervalMin(e.target.value)} />
        </label>
        <div className="row">
          <button className="btn" disabled={busy}>{busy ? "Connecting..." : "Test connection & enable"}</button>
          {feed?.isEnabled && <button className="btn secondary" type="button" disabled={busy} onClick={() => void disable()}>Disable feed</button>}
        </div>
      </form>
      <details style={{ marginTop: 12 }}>
        <summary className="small">Demo POS endpoints</summary>
        <ul className="small mono" style={{ paddingLeft: 20 }}>
          <li>https://pos.mock/hub-city, /slide-road, /canyon-lakes, /tech-terrace: compliant feeds</li>
          <li>https://pos.mock/mixed: some rows rejected</li>
          <li>https://pos.mock/non-compliant: connects, but every row is rejected</li>
          <li>https://pos.mock/down: connection error</li>
        </ul>
        <p className="small muted">Scheduled pulls run in the background worker; trigger one from the <a href="/demo">Demo panel</a>.</p>
      </details>
    </section>
  );
}

/* ---------------------------------- verification ---------------------------------- */
function VerificationTab({ pharmacyId, onChanged }: { pharmacyId: string; onChanged: () => void }) {
  const [v, setV] = useState<VerificationStatusView | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setV(await api<VerificationStatusView>("GET", `/api/pharmacies/${pharmacyId}/verification`)); } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
  }, [pharmacyId]);
  useEffect(() => { void load(); }, [load]);

  async function resubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      await api("POST", `/api/pharmacies/${pharmacyId}/verification/resubmit`, { fileName: file.name, mimeType: file.type, contentBase64: await readFileAsBase64(file) });
      setMsg({ ok: true, text: "Resubmitted. Your verification is pending again." });
      await load();
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  if (!v) return <p className="muted">Loading...</p>;
  return (
    <section className="card">
      <h2>Verification status</h2>
      <p><StatusBadge status={v.verificationStatus} /></p>
      {v.verificationStatus === "pending" && <div className="alert info">An administrator is reviewing your license. Your listing is not live yet.</div>}
      {v.verificationStatus === "verified" && <div className="alert ok">Your pharmacy is verified. Searchers see the “verified pharmacy” indicator on your listing.</div>}
      {v.verificationStatus === "rejected" && <div className="alert err">Your registration was rejected{v.rejectionReason ? `: ${v.rejectionReason}` : "."} You can upload a corrected license document below.</div>}
      {msg && <div className={`alert ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</div>}
      {v.verificationStatus === "rejected" && (
        <form className="stack" onSubmit={resubmit}>
          <label className="field"><span className="label">New license document (PDF, PNG or JPEG)</span><input type="file" required accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <button className="btn" disabled={busy || !file}>{busy ? "Submitting..." : "Resubmit for verification"}</button>
        </form>
      )}
      <h3 style={{ marginTop: 16 }}>History</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Submitted</th><th>Status</th><th>Reviewed</th><th>Note</th></tr></thead>
          <tbody>{v.requests.map((r) => <tr key={r.requestId}><td className="small">{dateTime(r.submittedAt)}</td><td>{r.status}</td><td className="small">{r.reviewedAt ? dateTime(r.reviewedAt) : "-"}</td><td className="small">{r.rejectionReason ?? ""}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
