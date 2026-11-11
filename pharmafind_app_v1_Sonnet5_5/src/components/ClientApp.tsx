"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { formatAge, formatDateTime, formatPrice, stockLabel } from "@/lib/client/format";
import type { PharmacyResult, SearchResponse } from "@/lib/services/search";
import type { ListingItem, Product } from "@/lib/types";

type Coords = { lat: number; lng: number };

function StockBadge({ item }: { item: ListingItem }) {
  const cls = item.stockStatus === "in_stock" ? "ok" : item.stockStatus === "low_stock" ? "warn" : "danger";
  return <span className={`badge ${cls}`}>{stockLabel(item.stockStatus, item.stock)}</span>;
}

/** "Updated 3 h ago" + stale label. Age text and stale flag both come from the server. */
function Freshness({ item }: { item: Pick<ListingItem, "ageMinutes" | "isStale" | "lastUpdated"> }) {
  return (
    <div>
      <span className={`age${item.isStale ? " stale" : ""}`} title={formatDateTime(item.lastUpdated)}>
        Last updated {formatAge(item.ageMinutes)}
      </span>
      {item.isStale && (
        <div>
          <span className="badge warn">⚠ Stale data: likely out of date</span>
        </div>
      )}
    </div>
  );
}

function PharmacyCard({ group, showDetails, onToggle }: { group: PharmacyResult; showDetails: boolean; onToggle: () => void }) {
  const p = group.pharmacy;
  const anyStale = group.items.some((i) => i.isStale);
  return (
    <article className="card" aria-label={p.name}>
      <div className="result-head">
        <div>
          <h3 className="pharmacy-name">{p.name}</h3>
          <div className="row" style={{ marginTop: 4 }}>
            {p.isVerified && <span className="badge ok">✓ Verified pharmacy</span>}
            {p.isAccessible === true && <span className="badge info">♿ Wheelchair accessible</span>}
            {p.isAccessible === false && <span className="badge neutral">Not wheelchair accessible</span>}
            <span className="badge neutral">{p.distanceKm.toFixed(1)} km away</span>
          </div>
        </div>
        <div className="row">
          <a className="btn small primary" href={p.directionsUrl} target="_blank" rel="noopener noreferrer">
            Directions
          </a>
          <button className="btn small" type="button" onClick={onToggle} aria-expanded={showDetails}>
            {showDetails ? "Hide details" : "Details"}
          </button>
        </div>
      </div>

      {anyStale && <p className="alert warn" style={{ marginTop: 10 }}>Some of this pharmacy&apos;s data is more than 24 hours old, so stock and price may have changed. Consider calling before you go.</p>}

      <table className="items">
        <thead>
          <tr>
            <th>Product</th>
            <th>Presentation</th>
            <th>Stock</th>
            <th>Price</th>
            <th>Freshness</th>
          </tr>
        </thead>
        <tbody>
          {group.items.map((i) => (
            <tr key={i.listingId} className={i.isStale ? "stale" : undefined}>
              <td data-label="Product">
                <strong>{i.brandName}</strong>
                <div className="muted">{i.genericName}</div>
              </td>
              <td data-label="Presentation">
                {i.presentation}, {i.dosage}
              </td>
              <td data-label="Stock">
                <StockBadge item={i} />
              </td>
              <td data-label="Price" className="price">
                {formatPrice(i.price)}
              </td>
              <td data-label="Freshness">
                <Freshness item={i} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showDetails && (
        <div className="card flat" style={{ marginTop: 12 }}>
          <h4 style={{ margin: "0 0 8px" }}>Pharmacy details</h4>
          <dl className="kv">
            <dt>Address</dt>
            <dd>
              {p.address}, {p.city}
            </dd>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${p.phone.replace(/[^+\d]/g, "")}`}>{p.phone}</a>
            </dd>
            <dt>Accessibility</dt>
            <dd>{p.isAccessible === true ? "Wheelchair accessible" : p.isAccessible === false ? "Not wheelchair accessible" : "No accessibility information provided"}</dd>
            <dt>Verification</dt>
            <dd>{p.isVerified ? "License verified by Pharmafind" : "Not verified"}</dd>
          </dl>
          <h4 style={{ margin: "14px 0 6px" }}>Exact items in stock</h4>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {group.items.map((i) => (
              <li key={i.listingId}>
                <strong>
                  {i.brandName} ({i.genericName})
                </strong>{" "}
                · {i.presentation} · {i.dosage} · {stockLabel(i.stockStatus, i.stock)} · {formatPrice(i.price)} · updated {formatDateTime(i.lastUpdated)} ({formatAge(i.ageMinutes)}){i.isStale ? " · STALE" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function Comparison({ results }: { results: PharmacyResult[] }) {
  const rows = useMemo(() => {
    const map = new Map<string, ListingItem>();
    for (const g of results) for (const i of g.items) if (!map.has(i.catalogId)) map.set(i.catalogId, i);
    return [...map.values()].sort((a, b) => a.brandName.localeCompare(b.brandName) || a.dosage.localeCompare(b.dosage));
  }, [results]);
  return (
    <section className="card" aria-label="Side-by-side comparison">
      <h2>Compare presentations and prices</h2>
      <div className="scroll-x">
        <table className="compare">
          <thead>
            <tr>
              <th scope="col">Product</th>
              {results.map((g) => (
                <th scope="col" key={g.pharmacy.pharmacyId}>
                  {g.pharmacy.name}
                  <div className="muted" style={{ fontWeight: 500 }}>
                    {g.pharmacy.distanceKm.toFixed(1)} km{g.pharmacy.isAccessible === true ? " · ♿" : ""}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.catalogId}>
                <th scope="row">
                  {r.brandName}
                  <div className="muted" style={{ fontWeight: 500 }}>
                    {r.presentation}, {r.dosage}
                  </div>
                </th>
                {results.map((g) => {
                  const i = g.items.find((x) => x.catalogId === r.catalogId);
                  return (
                    <td key={g.pharmacy.pharmacyId}>
                      {i ? (
                        <>
                          <div className="price">{formatPrice(i.price)}</div>
                          <StockBadge item={i} />
                          <div className={`age${i.isStale ? " stale" : ""}`}>
                            {formatAge(i.ageMinutes)}
                            {i.isStale ? " · stale" : ""}
                          </div>
                        </>
                      ) : (
                        <span className="muted">Not available</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ClientApp() {
  const [query, setQuery] = useState("");
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locNote, setLocNote] = useState<string | null>(null);
  const [maxDistance, setMaxDistance] = useState("25");
  const [accessible, setAccessible] = useState(false);
  const [includeOut, setIncludeOut] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [compare, setCompare] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    api<{ products: Product[] }>("GET", "/api/catalog").then((r) => setProducts(r.data.products)).catch(() => {});
  }, []);

  const suggestions = useMemo(() => [...new Set(products.flatMap((p) => [p.brandName, p.genericName]))].sort(), [products]);

  function useMyLocation() {
    setLocNote(null);
    if (!("geolocation" in navigator)) return setLocNote("Your device cannot share its location. Type an address instead.");
    setLocNote("Asking for your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocNote("Using your current location.");
      },
      () => {
        setCoords(null);
        setLocNote("Location permission was not granted. Type an address instead (for the demo try “Texas Tech University”).");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (query.trim().length < 2) return setError("Type at least 2 characters of the medicine name.");
    if (!coords && !address.trim()) return setError("Tell us where you are: share your location or type an address.");
    setLoading(true);
    try {
      const r = await api<SearchResponse>("GET", "/api/search", {
        query: {
          q: query.trim(),
          lat: coords && !address.trim() ? String(coords.lat) : undefined,
          lng: coords && !address.trim() ? String(coords.lng) : undefined,
          address: address.trim() || undefined,
          maxDistanceKm: maxDistance,
          needsAccessibleAccess: accessible ? "true" : undefined,
          includeOutOfStock: includeOut ? "true" : undefined,
        },
      });
      setResponse(r.data);
      setOpen({});
    } catch (err) {
      setResponse(null);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h1>Find your medicine nearby</h1>
        <p className="muted">See which verified pharmacies near you have it in stock, with the exact presentation and price, before you leave home.</p>
        <form className="stack" onSubmit={onSearch} noValidate>
          <label>
            Medicine name (brand or generic)
            <input type="search" list="medicine-suggestions" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. ibuprofen, Tylenol, amoxicillin" autoComplete="off" required />
            <datalist id="medicine-suggestions">
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack">
            <legend style={{ fontWeight: 700, fontSize: "0.92rem", padding: 0 }}>Where are you?</legend>
            <div className="row">
              <button type="button" className="btn" onClick={useMyLocation}>
                📍 Use my location
              </button>
              <span className="muted">or</span>
              <label className="grow" style={{ flexBasis: 240 }}>
                <span className="sr-only">Typed address</span>
                <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Type an address or place (try “Texas Tech University”)" autoComplete="street-address" />
              </label>
            </div>
            {locNote && <small role="status">{locNote}</small>}
          </fieldset>

          <div className="row">
            <label style={{ minWidth: 150 }}>
              Within
              <select value={maxDistance} onChange={(e) => setMaxDistance(e.target.value)}>
                {[2, 5, 10, 25, 50].map((km) => (
                  <option key={km} value={km}>
                    {km} km
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={accessible} onChange={(e) => setAccessible(e.target.checked)} /> ♿ Wheelchair-accessible pharmacies only
            </label>
            <label className="check">
              <input type="checkbox" checked={includeOut} onChange={(e) => setIncludeOut(e.target.checked)} /> Also show out-of-stock items
            </label>
          </div>

          <div className="row">
            <button className="btn primary" type="submit" disabled={loading}>
              {loading ? <span className="spinner" aria-hidden="true" /> : null} Search
            </button>
          </div>
        </form>
      </section>

      <div aria-live="polite" className="stack">
        {error && <div className="alert error" role="alert">{error}</div>}

        {response && response.results.length === 0 && (
          <div className="card empty">
            <h2>No nearby pharmacy has it right now</h2>
            <p>Try a larger distance, another spelling, or remove the accessibility filter.</p>
          </div>
        )}

        {response && response.results.length > 0 && (
          <>
            <div className="row between">
              <h2 style={{ margin: 0 }}>
                {response.totalPharmacies} pharmac{response.totalPharmacies === 1 ? "y" : "ies"} for “{response.query}”, nearest first
              </h2>
              <button className="btn small" type="button" onClick={() => setCompare((c) => !c)} aria-pressed={compare}>
                {compare ? "Back to list" : "Compare side by side"}
              </button>
            </div>
            {compare ? (
              <Comparison results={response.results} />
            ) : (
              response.results.map((g) => (
                <PharmacyCard key={g.pharmacy.pharmacyId} group={g} showDetails={!!open[g.pharmacy.pharmacyId]} onToggle={() => setOpen((o) => ({ ...o, [g.pharmacy.pharmacyId]: !o[g.pharmacy.pharmacyId] }))} />
              ))
            )}
            <small className="muted">
              Availability reflects each pharmacy&apos;s last reported update, not live inventory. Data older than 24 hours is labelled as stale. Prices are listed retail prices and may not include insurance or discounts. Buying happens in person.
            </small>
          </>
        )}
      </div>
    </div>
  );
}
