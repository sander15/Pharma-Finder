"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { useSession } from "@/lib/client/hooks";
import { formatAge, formatDateTime, formatPrice, stockLabel } from "@/lib/client/format";
import type { AutomaticFeed, ListingItem, Product, Rejection, VerificationStatus } from "@/lib/types";
import LoginCard from "./LoginCard";
import RegisterPharmacy, { fileToBase64 } from "./RegisterPharmacy";

interface Dashboard {
  pharmacy: { pharmacyId: string; name: string; verificationStatus: VerificationStatus; isVisibleInSearch: boolean };
  lastSyncAt: string | null;
  ageMinutes: number | null;
  isStale: boolean;
  latestSync: { success: boolean; details: string; syncedAt: string } | null;
  feed: AutomaticFeed | null;
  listingCount: number;
}
interface VerificationView {
  verificationStatus: VerificationStatus;
  isVisibleInSearch: boolean;
  latestRequest: { requestId: string; status: VerificationStatus; submittedAt: string; reviewedAt: string | null; rejectionReason: string | null } | null;
}
interface ImportSummary { importId: string; status: "accepted" | "rejected"; totalRows: number; validRows: number; rejectedRows: number; rejections: Rejection[] }

type Tab = "overview" | "listings" | "csv" | "feed" | "preview";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "listings", label: "Stock & prices" },
  { id: "csv", label: "CSV upload" },
  { id: "feed", label: "Automatic feed" },
  { id: "preview", label: "Public preview" },
];

const statusBadge = (s: VerificationStatus) => (s === "verified" ? <span className="badge ok">✓ Verified</span> : s === "pending" ? <span className="badge warn">Pending review</span> : <span className="badge danger">Rejected</span>);

/* ----------------------------------------------------------------------------------------------- overview */

function Overview({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [ver, setVer] = useState<VerificationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, v] = await Promise.all([api<Dashboard>("GET", `/api/portal/${id}/dashboard`), api<VerificationView>("GET", `/api/portal/${id}/verification`)]);
      setDash(d.data);
      setVer(v.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  async function resubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return setMsg("Choose a license file first.");
    try {
      await api("POST", `/api/portal/${id}/verification/resubmit`, { body: { license: { fileName: file.name, mimeType: file.type, contentBase64: await fileToBase64(file) } } });
      setMsg("Sent. An administrator will review it.");
      await load();
      onChanged();
    } catch (err) {
      setMsg(errorMessage(err));
    }
  }

  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (!dash || !ver) return <div className="empty"><span className="spinner" /> Loading…</div>;

  return (
    <div className="stack">
      <section className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Last-sync dashboard</h2>
          <button className="btn small" onClick={() => void load()}>Refresh</button>
        </div>
        {dash.isStale ? (
          <div className="alert warn" role="alert" style={{ margin: "12px 0" }}>
            <strong>⚠ Your data is out of date.</strong> {dash.lastSyncAt ? `Your last successful sync was ${formatAge(dash.ageMinutes)}.` : "Your pharmacy has not synced yet."} Searchers currently see your listings labelled as “stale data”. Upload a CSV, edit stock, or check your automatic feed.
          </div>
        ) : (
          <div className="alert ok" style={{ margin: "12px 0" }}>✓ Status OK: synced within the last 24 hours.</div>
        )}
        <dl className="kv">
          <dt>Last successful sync</dt>
          <dd>{dash.lastSyncAt ? `${formatAge(dash.ageMinutes)} (${formatDateTime(dash.lastSyncAt)})` : "never"}</dd>
          <dt>Latest attempt</dt>
          <dd>{dash.latestSync ? `${dash.latestSync.success ? "✓" : "✗"} ${dash.latestSync.details}` : "none"}</dd>
          <dt>Listings</dt>
          <dd>{dash.listingCount} products</dd>
          <dt>Automatic feed</dt>
          <dd>{dash.feed ? (dash.feed.isEnabled ? `On, every ${dash.feed.intervalMinutes} min · last pulled ${dash.feed.lastPulledAt ? formatDateTime(dash.feed.lastPulledAt) : "never"}` : "Off") : "Not set up"}</dd>
        </dl>
      </section>

      <section className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Verification</h2>
          {statusBadge(ver.verificationStatus)}
        </div>
        {ver.verificationStatus === "pending" && <p className="alert warn" style={{ marginTop: 12 }}>Your registration is waiting for an administrator. Your listing is hidden from searchers until it is verified. You can already prepare your stock and prices.</p>}
        {ver.verificationStatus === "verified" && <p className="alert ok" style={{ marginTop: 12 }}>Verified and live: searchers see your pharmacy with a “verified pharmacy” badge.</p>}
        {ver.verificationStatus === "rejected" && (
          <div className="stack" style={{ marginTop: 12 }}>
            <p className="alert error">Your registration was rejected{ver.latestRequest?.rejectionReason ? `: ${ver.latestRequest.rejectionReason}` : "."}</p>
            <form className="stack" onSubmit={resubmit}>
              <label>
                Send a new license document
                <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              <div><button className="btn primary">Resubmit for review</button></div>
              {msg && <small role="status">{msg}</small>}
            </form>
          </div>
        )}
        {ver.latestRequest && <small className="muted">Request submitted {formatDateTime(ver.latestRequest.submittedAt)}{ver.latestRequest.reviewedAt ? ` · reviewed ${formatDateTime(ver.latestRequest.reviewedAt)}` : ""}</small>}
      </section>
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------- listings */

function ListingRow({ id, item, onSaved }: { id: string; item: ListingItem; onSaved: () => void }) {
  const [stock, setStock] = useState(String(item.stock));
  const [price, setPrice] = useState(item.price.toFixed(2));
  const [state, setState] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setState(null);
    // Strict, like the server: the editor sends exactly what was typed as numbers and the server validates (no guessing).
    const s = /^\d+$/.test(stock) ? Number(stock) : NaN;
    const p = /^\d+(\.\d{1,2})?$/.test(price) ? Number(price) : NaN;
    if (Number.isNaN(s) || Number.isNaN(p)) return setState({ kind: "error", text: "Stock must be a whole number and price a positive amount like 9.99." });
    try {
      await api("PUT", `/api/portal/${id}/listings/${item.listingId}`, { body: { stock: s, price: p } });
      setState({ kind: "ok", text: "Saved" });
      onSaved();
    } catch (err) {
      setState({ kind: "error", text: errorMessage(err) });
    }
  }

  return (
    <tr className={item.isStale ? "stale" : undefined}>
      <td data-label="Product"><strong>{item.brandName}</strong><div className="muted">{item.presentation}, {item.dosage}</div></td>
      <td data-label="Stock"><input aria-label={`Stock for ${item.brandName} ${item.dosage}`} inputMode="numeric" type="text" value={stock} onChange={(e) => setStock(e.target.value)} style={{ maxWidth: 110 }} /></td>
      <td data-label="Price ($)"><input aria-label={`Price for ${item.brandName} ${item.dosage}`} inputMode="decimal" type="text" value={price} onChange={(e) => setPrice(e.target.value)} style={{ maxWidth: 110 }} /></td>
      <td data-label="Updated"><span className={`age${item.isStale ? " stale" : ""}`}>{formatAge(item.ageMinutes)}{item.isStale ? " · stale" : ""}</span></td>
      <td>
        <form onSubmit={save} className="row">
          <button className="btn small primary">Save</button>
          {state && <small role="status" style={{ color: state.kind === "ok" ? "var(--ok)" : "var(--danger)" }}>{state.text}</small>}
        </form>
      </td>
    </tr>
  );
}

function Listings({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [items, setItems] = useState<ListingItem[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [add, setAdd] = useState({ catalogId: "", stock: "", price: "" });
  const [addMsg, setAddMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, c] = await Promise.all([api<{ listings: ListingItem[] }>("GET", `/api/portal/${id}/listings`), api<{ products: Product[] }>("GET", "/api/catalog")]);
      setItems(l.data.listings);
      setProducts(c.data.products);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  const listed = new Set((items ?? []).map((i) => i.catalogId));
  const available = products.filter((p) => !listed.has(p.catalogId));

  async function addListing(e: FormEvent) {
    e.preventDefault();
    setAddMsg(null);
    const s = /^\d+$/.test(add.stock) ? Number(add.stock) : NaN;
    const p = /^\d+(\.\d{1,2})?$/.test(add.price) ? Number(add.price) : NaN;
    if (!add.catalogId || Number.isNaN(s) || Number.isNaN(p)) return setAddMsg("Choose a product, a whole-number stock and a price like 9.99.");
    try {
      await api("POST", `/api/portal/${id}/listings`, { body: { catalogId: add.catalogId, stock: s, price: p } });
      setAdd({ catalogId: "", stock: "", price: "" });
      await load();
      onChanged();
    } catch (err) {
      setAddMsg(errorMessage(err));
    }
  }

  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (!items) return <div className="empty"><span className="spinner" /> Loading…</div>;

  return (
    <div className="stack">
      <section className="card">
        <h2>Stock and prices</h2>
        <p className="muted">Small pharmacy? Update products here. Each save counts as a sync. Stock is a whole number (0 = out of stock); the price must be above zero.</p>
        {items.length === 0 ? <p className="empty">No products listed yet. Add one below or upload a CSV.</p> : (
          <table className="items">
            <thead><tr><th>Product</th><th>Stock</th><th>Price ($)</th><th>Updated</th><th /></tr></thead>
            <tbody>{items.map((i) => <ListingRow key={`${i.listingId}-${i.lastUpdated}`} id={id} item={i} onSaved={() => { void load(); onChanged(); }} />)}</tbody>
          </table>
        )}
      </section>
      <section className="card">
        <h3>Add a product</h3>
        <form className="row" onSubmit={addListing}>
          <label className="grow">Product
            <select value={add.catalogId} onChange={(e) => setAdd((a) => ({ ...a, catalogId: e.target.value }))}>
              <option value="">Choose…</option>
              {available.map((p) => <option key={p.catalogId} value={p.catalogId}>{p.brandName} ({p.genericName}) · {p.presentation}, {p.dosage}</option>)}
            </select>
          </label>
          <label style={{ width: 110 }}>Stock<input type="text" inputMode="numeric" value={add.stock} onChange={(e) => setAdd((a) => ({ ...a, stock: e.target.value }))} /></label>
          <label style={{ width: 120 }}>Price ($)<input type="text" inputMode="decimal" value={add.price} onChange={(e) => setAdd((a) => ({ ...a, price: e.target.value }))} /></label>
          <button className="btn primary" style={{ alignSelf: "end" }}>Add</button>
        </form>
        {addMsg && <p className="alert error" role="alert" style={{ marginTop: 10 }}>{addMsg}</p>}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- CSV upload */

function CsvUpload({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [fileName, setFileName] = useState("stock.csv");
  const [content, setContent] = useState("");
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setContent(await file.text());
    setResult(null);
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const r = await api<ImportSummary>("POST", `/api/portal/${id}/csv`, { body: { fileName, content } });
      setResult(r.data);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const template = "catalogId,stock,price\nPF-10001,25,9.49\nPF-10004,40,7.49\n";
  return (
    <section className="card stack">
      <h2>Upload a CSV from your inventory system</h2>
      <p className="muted">Your file must already use Pharmafind&apos;s standard format. Rows that do not follow it are rejected (never auto-fixed) and listed below; valid rows are saved.</p>
      <div className="pre">{template}</div>
      <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
        <li>Header exactly <code>catalogId,stock,price</code>; one product per row; no quotes or spaces.</li>
        <li><code>catalogId</code>: a Pharmafind catalog ID such as <code>PF-10001</code>.</li>
        <li><code>stock</code>: whole number, 0 or more. <code>price</code>: above 0, dot decimal, at most 2 decimals.</li>
      </ul>
      <div><a className="btn small" download="pharmafind-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}>Download template</a></div>
      <form className="stack" onSubmit={upload}>
        <label>CSV file<input type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0])} /></label>
        <label>…or paste the contents<textarea value={content} onChange={(e) => { setContent(e.target.value); setResult(null); }} spellCheck={false} /></label>
        <div><button className="btn primary" disabled={busy || content === ""}>{busy ? "Importing…" : "Import"}</button></div>
      </form>
      {error && <div className="alert error" role="alert">{error}</div>}
      {result && (
        <div className="stack" aria-live="polite">
          <div className={`alert ${result.status === "accepted" ? "ok" : "error"}`}>
            <strong>{result.status === "accepted" ? "Import finished" : "Import rejected"}:</strong> {result.validRows} row(s) accepted, {result.rejectedRows} row(s) rejected (of {result.totalRows}).
          </div>
          {result.rejections.length > 0 && (
            <div className="scroll-x">
              <table className="compare">
                <thead><tr><th>Row</th><th>Why it was rejected</th></tr></thead>
                <tbody>{result.rejections.map((r, i) => <tr key={i}><td>{r.row === 0 ? "File" : r.row}</td><td>{r.reason}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------- automatic feed */

function FeedSetup({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [feed, setFeed] = useState<AutomaticFeed | null | undefined>(undefined);
  const [endpoint, setEndpoint] = useState("");
  const [interval, setIntervalMin] = useState("60");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ feed: AutomaticFeed | null }>("GET", `/api/portal/${id}/feed`);
      setFeed(r.data.feed);
      if (r.data.feed) {
        setEndpoint(r.data.feed.posEndpoint);
        setIntervalMin(String(r.data.feed.intervalMinutes));
      }
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const minutes = /^\d+$/.test(interval) ? Number(interval) : NaN;
    if (Number.isNaN(minutes)) return setMsg({ kind: "error", text: "The interval must be a whole number of minutes." });
    setBusy(true);
    try {
      await api("PUT", `/api/portal/${id}/feed`, { body: { posEndpoint: endpoint.trim(), intervalMinutes: minutes } });
      setMsg({ kind: "ok", text: "Connection works. The automatic feed is on and scheduled." });
      await load();
      onChanged();
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    try {
      await api("POST", `/api/portal/${id}/feed/disable`);
      setMsg({ kind: "ok", text: "The automatic feed is off." });
      await load();
      onChanged();
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    }
  }

  return (
    <section className="card stack">
      <h2>Automatic POS feed</h2>
      <p className="muted">Connect your point-of-sale system once; Pharmafind then pulls stock and prices on a schedule and validates them like a CSV upload. Your POS must already send Pharmafind&apos;s standard format and catalog IDs.</p>
      {feed !== undefined && (
        <div className="row">
          {feed ? (feed.isEnabled ? <span className="badge ok">On · every {feed.intervalMinutes} min</span> : <span className="badge neutral">Off</span>) : <span className="badge neutral">Not set up</span>}
          {feed?.lastPulledAt && <small className="muted">Last pulled {formatDateTime(feed.lastPulledAt)}</small>}
        </div>
      )}
      <form className="stack" onSubmit={connect}>
        <label>POS endpoint
          <input type="text" inputMode="url" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://yourpharmacy.demo-pos.example/feed" required />
          <span className="hint">Demo: any <code>https://…demo-pos.example/…</code> address connects; other addresses fail the connection test.</span>
        </label>
        <label>How often (minutes)
          <input type="text" inputMode="numeric" value={interval} onChange={(e) => setIntervalMin(e.target.value)} style={{ maxWidth: 160 }} />
          <span className="hint">Between 5 and 1440 (24 h).</span>
        </label>
        <div className="row">
          <button className="btn primary" disabled={busy}>{busy ? "Testing connection…" : feed ? "Save and test" : "Connect and enable"}</button>
          {feed?.isEnabled && <button type="button" className="btn" onClick={() => void disable()}>Turn off</button>}
        </div>
      </form>
      {msg && <div className={`alert ${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}>{msg.text}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------ public preview */

function Preview({ id }: { id: string }) {
  const [data, setData] = useState<{ isVerified: boolean; isVisibleInSearch: boolean; listings: ListingItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ isVerified: boolean; isVisibleInSearch: boolean; listings: ListingItem[] }>("GET", `/api/portal/${id}/preview`).then((r) => setData(r.data)).catch((e) => setError(errorMessage(e)));
  }, [id]);
  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (!data) return <div className="empty"><span className="spinner" /> Loading…</div>;
  return (
    <section className="card stack">
      <h2>How searchers see your listing</h2>
      {data.isVisibleInSearch ? <div className="alert ok">Live in search results {data.isVerified && "with the ✓ verified badge"}.</div> : <div className="alert warn">Not visible to searchers yet: it appears after an administrator verifies your pharmacy.</div>}
      {data.listings.length === 0 ? <p className="empty">No listings yet.</p> : (
        <table className="items">
          <thead><tr><th>Product</th><th>Presentation</th><th>Stock</th><th>Price</th><th>Freshness</th></tr></thead>
          <tbody>
            {data.listings.map((i) => (
              <tr key={i.listingId} className={i.isStale ? "stale" : undefined}>
                <td data-label="Product"><strong>{i.brandName}</strong><div className="muted">{i.genericName}</div></td>
                <td data-label="Presentation">{i.presentation}, {i.dosage}</td>
                <td data-label="Stock">{stockLabel(i.stockStatus, i.stock)}</td>
                <td data-label="Price" className="price">{formatPrice(i.price)}</td>
                <td data-label="Freshness"><span className={`age${i.isStale ? " stale" : ""}`}>Last updated {formatAge(i.ageMinutes)}</span>{i.isStale && <div><span className="badge warn">⚠ Stale data: likely out of date</span></div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------- the portal */

export default function PharmacyPortal() {
  const { account, loading, refresh, logout } = useSession();
  const [tab, setTab] = useState<Tab>("overview");
  const [version, setVersion] = useState(0);
  const [registering, setRegistering] = useState(false);
  const bump = () => setVersion((v) => v + 1);

  if (loading) return <div className="empty"><span className="spinner" /> Loading…</div>;

  if (!account) {
    return (
      <div className="stack">
        <h1>Pharmacy portal</h1>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <LoginCard title="Pharmacy manager login" demoHint="Demo: hubcity@pharmafind.demo (also plains, raider, depot, southside, westgate, newleaf) / Demo!Pass123" onLoggedIn={() => void refresh()} />
          <div className="card flat grow">
            <h3>New here?</h3>
            <p className="muted">Register your pharmacy to appear in search results after verification.</p>
            <button className="btn" onClick={() => setRegistering((r) => !r)}>{registering ? "Hide registration" : "Register a pharmacy"}</button>
          </div>
        </div>
        {registering && <RegisterPharmacy onRegistered={() => void refresh()} />}
      </div>
    );
  }

  if (account.role !== "pharmacy_staff" || !account.pharmacyId) {
    return (
      <div className="stack">
        <div className="alert warn">You are logged in as an administrator. The pharmacy portal is for pharmacy managers; use the Admin console.</div>
        <div><button className="btn" onClick={() => void logout()}>Log out</button></div>
      </div>
    );
  }

  const id = account.pharmacyId;
  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1 style={{ marginBottom: 2 }}>Pharmacy portal</h1>
          <small className="muted">Signed in as {account.fullName} ({account.email})</small>
        </div>
        <button className="btn" onClick={() => void logout()}>Log out</button>
      </div>
      <div className="tabs" role="tablist" aria-label="Portal sections">
        {TABS.map((t) => <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      <div role="tabpanel" key={`${tab}-${version}`}>
        {tab === "overview" && <Overview id={id} onChanged={bump} />}
        {tab === "listings" && <Listings id={id} onChanged={() => {}} />}
        {tab === "csv" && <CsvUpload id={id} onChanged={() => {}} />}
        {tab === "feed" && <FeedSetup id={id} onChanged={() => {}} />}
        {tab === "preview" && <Preview id={id} />}
      </div>
    </div>
  );
}
