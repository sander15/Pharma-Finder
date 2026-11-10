"use client";

import { useEffect, useMemo, useState } from "react";
import type { ListingResult, ProductGroup, SearchResponse } from "@/lib/services/search";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime, km, money, timeAgo } from "@/lib/client/format";

type Origin = { kind: "address"; address: string } | { kind: "coords"; latitude: number; longitude: number };
interface Picked {
  product: ProductGroup["product"];
  listing: ListingResult;
}

const DEFAULT_ADDRESS = "Texas Tech University";
const PREF_KEY = "pharmafind.prefs.v1";

/** Layer 1 «boundary» Client App: showSearchForm, requestLocationPermission, showResults, showComparison, showPharmacyDetails, openDirections. */
export default function ClientApp() {
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<Origin>({ kind: "address", address: DEFAULT_ADDRESS });
  const [addressInput, setAddressInput] = useState(DEFAULT_ADDRESS);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [needsAccessible, setNeedsAccessible] = useState(false);
  const [maxKm, setMaxKm] = useState("25");
  const [includeOut, setIncludeOut] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [online, setOnline] = useState(true);
  const [installEvent, setInstallEvent] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);

  // restore preferences (accessibility need is remembered between visits)
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}");
      if (typeof p.needsAccessible === "boolean") setNeedsAccessible(p.needsAccessible);
      if (typeof p.addressInput === "string" && p.addressInput) {
        setAddressInput(p.addressInput);
        setOrigin({ kind: "address", address: p.addressInput });
      }
    } catch {
      /* ignore */
    }
    void api<string[]>("GET", "/api/geocode/suggestions").then(setSuggestions).catch(() => undefined);
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const install = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as Event & { prompt: () => Promise<void> });
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("beforeinstallprompt", install);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeinstallprompt", install);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ needsAccessible, addressInput }));
    } catch {
      /* ignore */
    }
  }, [needsAccessible, addressInput]);

  function useMyLocation() {
    setLocMsg(null);
    if (!("geolocation" in navigator)) {
      setLocMsg("This device can't share its location. Type an address instead.");
      return;
    }
    setLocMsg("Asking for your location...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ kind: "coords", latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocMsg("Using your current location. (Demo data covers Lubbock, TX; use an address if you're elsewhere.)");
      },
      () => setLocMsg("Location permission was denied. Type an address instead."),
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  function useAddress() {
    setOrigin({ kind: "address", address: addressInput });
    setLocMsg(null);
  }

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setPicked([]);
    setShowCompare(false);
    const effective: Origin = origin.kind === "coords" ? origin : { kind: "address", address: addressInput };
    const params = new URLSearchParams({ q: query.trim() });
    if (effective.kind === "coords") {
      params.set("lat", String(effective.latitude));
      params.set("lng", String(effective.longitude));
    } else params.set("address", effective.address);
    params.set("maxDistanceKm", maxKm);
    if (needsAccessible) params.set("accessible", "true");
    if (includeOut) params.set("inStockOnly", "false");
    setLoading(true);
    try {
      setResult(await api<SearchResponse>("GET", `/api/search?${params}`));
    } catch (err) {
      setResult(null);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const pickedIds = useMemo(() => new Set(picked.map((p) => p.listing.listingId)), [picked]);
  function togglePick(product: ProductGroup["product"], listing: ListingResult) {
    setPicked((cur) => (cur.some((p) => p.listing.listingId === listing.listingId) ? cur.filter((p) => p.listing.listingId !== listing.listingId) : cur.length >= 4 ? cur : [...cur, { product, listing }]));
  }

  return (
    <div>
      {!online && <div className="alert warn" role="status">You're offline. Showing the last results available; reconnect to refresh.</div>}

      <section className="card" aria-labelledby="search-h">
        <h1 id="search-h">Find your medicine nearby</h1>
        <p className="muted">Search by brand or generic name. Only verified pharmacies are shown, nearest first. Prices are the pharmacy&apos;s listed retail price.</p>

        <form onSubmit={runSearch} className="stack">
          <label className="field">
            <span className="label">Medicine name</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Advil, ibuprofen, amoxicillin" required minLength={2} autoComplete="off" />
          </label>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: 4 }}>Your location</legend>
            <div className="row">
              <div style={{ flex: "1 1 240px" }}>
                <input type="text" list="address-list" value={addressInput} onChange={(e) => setAddressInput(e.target.value)} onBlur={useAddress} aria-label="Address or landmark" placeholder="Address or landmark" />
                <datalist id="address-list">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
              </div>
              <button type="button" className="btn secondary" onClick={useMyLocation}>Use my location</button>
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>
              {origin.kind === "coords" ? `Searching near your device location (${origin.latitude.toFixed(3)}, ${origin.longitude.toFixed(3)}).` : `Searching near: ${addressInput || "(enter an address)"}`}
              {locMsg ? ` ${locMsg}` : ""}
            </p>
          </fieldset>

          <div className="grid-2">
            <label className="check">
              <input type="checkbox" checked={needsAccessible} onChange={(e) => setNeedsAccessible(e.target.checked)} />
              <span>Only wheelchair-accessible pharmacies</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={includeOut} onChange={(e) => setIncludeOut(e.target.checked)} />
              <span>Also show out-of-stock listings</span>
            </label>
          </div>
          <label className="field" style={{ maxWidth: 240 }}>
            <span className="label">Within</span>
            <select value={maxKm} onChange={(e) => setMaxKm(e.target.value)}>
              {["3", "5", "10", "25", "50"].map((v) => <option key={v} value={v}>{v} km</option>)}
            </select>
          </label>

          <div className="row">
            <button className="btn" type="submit" disabled={loading}>{loading ? "Searching..." : "Search"}</button>
            {installEvent && <button type="button" className="btn secondary" onClick={() => void installEvent.prompt().then(() => setInstallEvent(null))}>Install app</button>}
          </div>
        </form>
      </section>

      {error && <div className="alert err" role="alert">{error}</div>}

      {result && (
        <section aria-live="polite" aria-labelledby="results-h">
          <h2 id="results-h">
            {result.groups.length === 0 ? "No pharmacies found" : `Results for “${result.queryText}”`}
          </h2>
          {result.groups.length === 0 && (
            <div className="alert info">
              No verified pharmacy within range has this medicine in stock{needsAccessible ? " (with wheelchair access)" : ""}. Try a wider distance{needsAccessible ? ", turn off the accessibility filter" : ""}, show out-of-stock listings, or check the spelling.
            </div>
          )}
          {result.groups.map((g) => (
            <article key={g.product.catalogId} className="card" aria-label={`${g.product.brandName} ${g.product.dosage} ${g.product.presentation}`}>
              <div className="product-head">
                <div>
                  <div className="product-title">{g.product.brandName === "Generic" ? `${g.product.genericName} (generic)` : g.product.brandName}</div>
                  <div className="muted">{g.product.genericName} · <strong>{g.product.dosage}</strong> · {g.product.presentation}</div>
                </div>
                <span className="badge neutral">{g.product.catalogId}</span>
              </div>
              {g.alternatives.length > 0 && <p className="small muted" style={{ marginTop: 6 }}>Same active ingredient also sold as: {g.alternatives.join(", ")}</p>}

              <div>
                {g.listings.map((l) => (
                  <ListingRow key={l.listingId} l={l} checked={pickedIds.has(l.listingId)} disabled={!pickedIds.has(l.listingId) && picked.length >= 4} onToggle={() => togglePick(g.product, l)} />
                ))}
              </div>
            </article>
          ))}
          {result.groups.length > 0 && <p className="small muted">Availability reflects each pharmacy&apos;s last reported update, not live inventory. Price may not reflect insurance or discounts. You still buy in person.</p>}
        </section>
      )}

      {picked.length > 0 && !showCompare && (
        <div className="compare-bar">
          <div className="inner">
            <span>{picked.length} selected to compare{picked.length >= 4 ? " (max 4)" : ""}</span>
            <span className="row">
              <button className="btn secondary small" onClick={() => setPicked([])}>Clear</button>
              <button className="btn small" disabled={picked.length < 2} onClick={() => setShowCompare(true)}>{picked.length < 2 ? "Pick one more" : "Compare"}</button>
            </span>
          </div>
        </div>
      )}

      {showCompare && <ComparePanel picked={picked} onClose={() => setShowCompare(false)} />}
    </div>
  );
}

function ListingRow({ l, checked, disabled, onToggle }: { l: ListingResult; checked: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <div className="listing" style={{ opacity: l.inStock ? 1 : 0.7 }}>
      <div className="top">
        <div>
          <strong>{l.pharmacyName}</strong>
          <div className="badges" style={{ marginTop: 4 }}>
            <span className="badge ok" title="Pharmacy license verified by Pharmafind">✓ Verified pharmacy</span>
            {l.isAccessible ? <span className="badge info">♿ Wheelchair accessible</span> : <span className="badge neutral">Accessibility not confirmed</span>}
            {l.inStock ? <span className="badge ok">In stock: {l.stock}</span> : <span className="badge err">Out of stock</span>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="price">{money(l.price)}</div>
          <div className="small muted">{km(l.distanceKm)} away</div>
        </div>
      </div>
      <div className="small">
        <span className={l.isStale ? "badge warn" : "muted"} title={dateTime(l.lastUpdated)}>
          {l.isStale ? "⚠ May be out of date · " : ""}Updated {timeAgo(l.lastUpdated)}
        </span>
      </div>
      <details>
        <summary className="small">Pharmacy details</summary>
        <p className="small" style={{ margin: "0.4rem 0 0" }}>
          {l.address}<br />
          Phone: <a href={`tel:${l.phone.replace(/[^0-9+]/g, "")}`}>{l.phone}</a>
        </p>
      </details>
      <div className="row">
        <a className="btn small" href={l.directionsUrl} target="_blank" rel="noopener noreferrer">Get directions</a>
        <label className="check" style={{ minHeight: 36 }}>
          <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
          <span className="small">Compare</span>
        </label>
      </div>
    </div>
  );
}

function ComparePanel({ picked, onClose }: { picked: Picked[]; onClose: () => void }) {
  const cheapest = Math.min(...picked.map((p) => p.listing.price));
  const nearest = Math.min(...picked.map((p) => p.listing.distanceKm));
  return (
    <section className="card" aria-labelledby="cmp-h" style={{ borderColor: "var(--brand)" }}>
      <div className="row spread">
        <h2 id="cmp-h">Compare pharmacies</h2>
        <button className="btn secondary small" onClick={onClose}>Close</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">&nbsp;</th>
              {picked.map((p) => <th scope="col" key={p.listing.listingId}>{p.listing.pharmacyName}</th>)}
            </tr>
          </thead>
          <tbody>
            <Row label="Product" cells={picked.map((p) => `${p.product.brandName === "Generic" ? p.product.genericName + " (generic)" : p.product.brandName}`)} />
            <Row label="Presentation" cells={picked.map((p) => p.product.presentation)} />
            <Row label="Dosage" cells={picked.map((p) => p.product.dosage)} />
            <Row label="Price" cells={picked.map((p) => <span key={p.listing.listingId}>{money(p.listing.price)} {p.listing.price === cheapest && picked.length > 1 ? <span className="badge ok">lowest</span> : null}</span>)} />
            <Row label="Stock" cells={picked.map((p) => (p.listing.inStock ? `${p.listing.stock} in stock` : "Out of stock"))} />
            <Row label="Distance" cells={picked.map((p) => <span key={p.listing.listingId}>{km(p.listing.distanceKm)} {p.listing.distanceKm === nearest && picked.length > 1 ? <span className="badge ok">nearest</span> : null}</span>)} />
            <Row label="Wheelchair access" cells={picked.map((p) => (p.listing.isAccessible ? "Yes" : "Not confirmed"))} />
            <Row label="Last updated" cells={picked.map((p) => timeAgo(p.listing.lastUpdated) + (p.listing.isStale ? " ⚠" : ""))} />
            <Row label="Verified" cells={picked.map(() => "✓ Verified")} />
            <Row label="Directions" cells={picked.map((p) => <a key={p.listing.listingId} href={p.listing.directionsUrl} target="_blank" rel="noopener noreferrer">Open map</a>)} />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ label, cells }: { label: string; cells: React.ReactNode[] }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {cells.map((c, i) => <td key={i}>{c}</td>)}
    </tr>
  );
}
