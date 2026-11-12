"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { demoOrigin, initialListings, initialPharmacies, products } from "@/lib/demo-data";
import { attemptEmailDelivery, authenticateDemoUser, authorizePharmacyScope, createSyncLog, geocodeDemoAddress, importFeedRows, isStale, parseStandardCsv, searchInventory, testPosConnection, updateListing, verificationDecision, type DemoSession, type EmailDelivery, type FeedRow, type Listing, type Pharmacy, type SearchResult, type SyncLog, type VerificationStatus } from "@/lib/domain";

type View = "search" | "pharmacy" | "admin";
const managerId = "farmacia-central";
const posDemoRows: FeedRow[] = [{ catalogId: "PF-1001", stock: 16, price: 18.5 }, { catalogId: "PF-1002", stock: 5, price: 32 }, { catalogId: "PF-2001", stock: 22, price: 24 }, { catalogId: "PF-3001", stock: 3, price: 36 }];
type VerificationRequest = { id: string; pharmacyId: string; pharmacy: string; license: string; submitted: string; status: VerificationStatus; reason?: string; documentName: string; documentUrl?: string; registryFound?: boolean; ownerEmail?: string };
const initialVerificationRequests: VerificationRequest[] = [{ id: "VR-2026-014", pharmacyId: "farmacia-pendiente", pharmacy: "Farmacia La Esperanza", license: "REG-44918-GT", submitted: "Hoy, 09:42", status: "pending", documentName: "licencia-la-esperanza.pdf", registryFound: true }];
const money = (amount: number) => new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ", maximumFractionDigits: 2 }).format(amount);
const displayTime = (value: string) => new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>, pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    pill: <><path d="m10.5 20.5 10-10a6.36 6.36 0 0 0-9-9l-10 10a6.36 6.36 0 0 0 9 9Z"/><path d="m8.5 8.5 7 7"/></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
    sliders: <><path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M2 14h4m4-6h4m4 8h4"/></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10"/></>, check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>, upload: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M20 16v4H4v-4"/></>,
    store: <><path d="M3 10v10h18V10M2 10l2-7h16l2 7"/><path d="M2 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 2 0M9 20v-6h6v6"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
  };
  return <svg {...common}>{paths[name] ?? paths.pill}</svg>;
}

export default function Home() {
  const [view, setView] = useState<View>("search");
  const [query, setQuery] = useState("Paracetamol");
  const [submittedQuery, setSubmittedQuery] = useState("Paracetamol");
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [origin, setOrigin] = useState(demoOrigin);
  const [locationLabel, setLocationLabel] = useState("Zona 10, Ciudad de Guatemala");
  const [listings, setListings] = useState<Listing[]>(initialListings);
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>(initialPharmacies);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedConnected, setFeedConnected] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [session, setSession] = useState<DemoSession | null>(null);
  const [loginTarget, setLoginTarget] = useState<"pharmacy" | "admin" | null>(null);
  const [loginEmail, setLoginEmail] = useState("patricia@farmacia.demo");
  const [loginPassword, setLoginPassword] = useState("farmacia123");
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);
  const [detailResult, setDetailResult] = useState<SearchResult | null>(null);
  const [locationValid, setLocationValid] = useState(true);
  const [feedSetupOpen, setFeedSetupOpen] = useState(false);
  const [feedEndpoint, setFeedEndpoint] = useState("https://pos.demo/pharmafind");
  const [feedInterval, setFeedInterval] = useState(60);
  const [feedIntervalMs, setFeedIntervalMs] = useState(60);
  const [feedFileCopies, setFeedFileCopies] = useState<{ name: string; savedAt: string; bytes: number; copy: Blob }[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [emailDeliveries, setEmailDeliveries] = useState<EmailDelivery[]>([]);
  const [failNextEmail, setFailNextEmail] = useState(false);
  const [staleAlerted, setStaleAlerted] = useState<string[]>([]);
  const [verificationRequests, setVerificationRequests] = useState<VerificationRequest[]>(initialVerificationRequests);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registrationName, setRegistrationName] = useState("");
  const [registrationLicense, setRegistrationLicense] = useState("");
  const [registrationAddress, setRegistrationAddress] = useState("");
  const [registrationFile, setRegistrationFile] = useState<File | null>(null);
  const [reviewRequest, setReviewRequest] = useState<VerificationRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [activePublicPreview, setActivePublicPreview] = useState(false);
  const csvInput = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchInventory(submittedQuery, origin, products, pharmacies, listings, accessibleOnly), [submittedQuery, origin, pharmacies, listings, accessibleOnly]);
  const manager = pharmacies.find((pharmacy) => pharmacy.id === managerId)!;
  const myListings = listings.filter((listing) => listing.pharmacyId === managerId);
  const searchCount = results.length;
  const selectedResults = results.filter((result) => compareSelection.includes(result.listing.id));

  function enterView(target: View) {
    if (target === "search") { setView("search"); setMessage(""); return; }
    if (!session || (target === "pharmacy" && session.role !== "pharmacy") || (target === "admin" && session.role !== "admin")) {
      setLoginEmail(target === "admin" ? "admin@pharmafind.demo" : "patricia@farmacia.demo");
      setLoginPassword(target === "admin" ? "admin123" : "farmacia123");
      setLoginTarget(target);
      return;
    }
    setView(target); setMessage("");
  }

  function submitLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const authenticated = authenticateDemoUser(loginEmail, loginPassword);
    if (!authenticated || authenticated.role !== loginTarget) { setMessage("Correo o contraseña incorrectos para este portal."); return; }
    setSession(authenticated); setView(loginTarget!); setLoginTarget(null); setMessage("Sesión iniciada. Las acciones del portal están autorizadas para esta cuenta.");
  }

  function logout() { setSession(null); setView("search"); setMessage("Sesión cerrada."); }

  function addSyncLog(source: SyncLog["source"], accepted: number, rejected: number, file?: File) {
    const log = createSyncLog(managerId, source, accepted, rejected);
    setSyncLogs((current) => [log, ...current]);
    if (file) setFeedFileCopies((current) => [{ name: file.name, savedAt: new Date().toISOString(), bytes: file.size, copy: file.slice(0, file.size, file.type) }, ...current]);
  }

  useEffect(() => {
    if (!feedConnected) return;
    const job = window.setInterval(() => {
      const now = new Date();
      setListings((current) => importFeedRows(managerId, posDemoRows, products, initialPharmacies, current, now).listings);
      setPharmacies((current) => current.map((pharmacy) => pharmacy.id === managerId ? { ...pharmacy, lastUpdated: now.toISOString() } : pharmacy));
      setStaleAlerted((current) => current.filter((id) => id !== managerId));
      addSyncLog("pos", posDemoRows.length, 0);
      setMessage("Sincronización POS automática completada.");
    }, feedIntervalMs * 60 * 1000);
    return () => window.clearInterval(job);
  }, [feedConnected, feedIntervalMs]);

  useEffect(() => {
    const job = window.setInterval(() => runStaleSyncJob(), 60 * 60 * 1000);
    return () => window.clearInterval(job);
  }, [pharmacies, staleAlerted, failNextEmail]);

  async function simulate<T>(operation: () => T, successMessage: string) {
    setBusy(true); setMessage("");
    await new Promise((resolve) => window.setTimeout(resolve, 480));
    try { operation(); if (successMessage) setMessage(successMessage); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo completar la acción."); }
    finally { setBusy(false); }
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) { setMessage("Escribe el nombre de un medicamento para buscar."); return; }
    if (locationLabel !== "Mi ubicación actual" && !geocodeEnteredLocation()) { setMessage("No encontramos esa ubicación. Escribe una zona válida o usa tu ubicación actual."); return; }
    void simulate(() => setSubmittedQuery(query.trim()), "Búsqueda actualizada");
  }

  function locateMe() {
    if (!navigator.geolocation) { setMessage("Este navegador no ofrece geolocalización. Puedes escribir una zona."); return; }
    navigator.geolocation.getCurrentPosition((position) => {
      setOrigin({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setLocationLabel("Mi ubicación actual"); setMessage("Ubicación actualizada.");
    }, () => setMessage("No se pudo acceder a tu ubicación. Puedes elegir una zona de referencia."), { timeout: 8000 });
  }

  function geocodeEnteredLocation(): boolean {
    const coordinates = geocodeDemoAddress(locationLabel);
    setLocationValid(Boolean(coordinates));
    if (coordinates) setOrigin(coordinates);
    return Boolean(coordinates);
  }

  function saveListing(listingId: string, stockValue: string, priceValue: string) {
    if (!session || !authorizePharmacyScope(session, managerId)) { setMessage("Acceso denegado: solo puedes cambiar el inventario de tu farmacia."); return; }
    void simulate(() => {
      setListings(updateListing(managerId, managerId, listingId, Number(stockValue), Number(priceValue), listings, pharmacies));
      const now = new Date().toISOString();
      setPharmacies((current) => current.map((pharmacy) => pharmacy.id === managerId ? { ...pharmacy, lastUpdated: now } : pharmacy));
      setStaleAlerted((current) => current.filter((id) => id !== managerId));
      addSyncLog("manual", 1, 0);
    }, "Existencia y precio guardados.");
  }

  async function handleCsv(file?: File) {
    if (!file) return;
    if (!session || !authorizePharmacyScope(session, managerId)) { setMessage("Inicia sesión como la farmacia autorizada para importar datos."); return; }
    const text = await file.text();
    let rows: FeedRow[];
    try { rows = parseStandardCsv(text); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Formato CSV no válido."); return; }
    await simulate(() => {
      const result = importFeedRows(managerId, rows, products, pharmacies, listings, new Date());
      setListings(result.listings); setPharmacies((current) => current.map((pharmacy) => pharmacy.id === managerId ? result.pharmacy : pharmacy));
      setStaleAlerted((current) => current.filter((id) => id !== managerId));
      addSyncLog("csv", result.accepted, result.rejected.length, file);
      setMessage(`Importación completada: ${result.accepted} filas aceptadas · ${result.rejected.length} rechazadas${result.rejected.length ? ` (${result.rejected.map((row) => `fila ${row.row}: ${row.reason}`).join("; ")})` : ""}.`);
    }, "");
    if (csvInput.current) csvInput.current.value = "";
  }

  function connectFeed() {
    if (!session || !authorizePharmacyScope(session, managerId)) { setMessage("Acceso denegado al configurar este feed."); return; }
    if (feedConnected) { syncPosNow(); return; }
    setFeedSetupOpen(true);
  }

  function configureFeed(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const connection = testPosConnection(feedEndpoint, feedInterval);
    if (!connection.connected) { setMessage(connection.error ?? "No se pudo conectar al POS."); return; }
    void simulate(() => {
      setFeedConnected(true); setFeedIntervalMs(feedInterval);
      const now = new Date();
      const result = importFeedRows(managerId, posDemoRows, products, pharmacies, listings, now);
      setListings(result.listings); setPharmacies((current) => current.map((pharmacy) => pharmacy.id === managerId ? result.pharmacy : pharmacy));
      setStaleAlerted((current) => current.filter((id) => id !== managerId));
      addSyncLog("pos", result.accepted, result.rejected.length);
      setFeedSetupOpen(false);
    }, `Conexión probada. Feed programado cada ${feedInterval} minutos.`);
  }

  function syncPosNow() {
    void simulate(() => {
      const now = new Date();
      const result = importFeedRows(managerId, posDemoRows, products, pharmacies, listings, now);
      setListings(result.listings); setPharmacies((current) => current.map((pharmacy) => pharmacy.id === managerId ? result.pharmacy : pharmacy));
      setStaleAlerted((current) => current.filter((id) => id !== managerId));
      addSyncLog("pos", result.accepted, result.rejected.length);
    }, "Feed POS sincronizado.");
  }

  function runStaleSyncJob() {
    const stalePharmacies = pharmacies.filter((pharmacy) => isStale(pharmacy.lastUpdated) && !staleAlerted.includes(pharmacy.id));
    if (!stalePharmacies.length) { setMessage("La revisión terminó. No hay nuevos avisos de sincronización pendientes."); return; }
    let shouldFail = failNextEmail;
    const deliveries = stalePharmacies.map((pharmacy) => {
      const id = `stale-${pharmacy.id}-${Date.now()}`;
      const delivery = attemptEmailDelivery(id, shouldFail);
      shouldFail = false;
      return { ...delivery, id: `${id}|${pharmacy.id}` };
    });
    setFailNextEmail(false);
    setEmailDeliveries((current) => [...deliveries, ...current]);
    setStaleAlerted((current) => [...current, ...stalePharmacies.map((pharmacy) => pharmacy.id)]);
    setMessage(`Revisión de sincronización: ${deliveries.filter((delivery) => delivery.status === "sent").length} correo(s) enviado(s), ${deliveries.filter((delivery) => delivery.status === "failed").length} pendiente(s) de reintento.`);
  }

  function retryFailedEmails() {
    const failed = emailDeliveries.filter((delivery) => delivery.status === "failed");
    if (!failed.length) { setMessage("No hay correos fallidos para reintentar."); return; }
    setEmailDeliveries((current) => current.map((delivery) => delivery.status === "failed" ? attemptEmailDelivery(delivery.id, false, new Date(), delivery.attempts) : delivery));
    setMessage(`${failed.length} correo(s) de aviso reenviado(s).`);
  }

  function submitRegistration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || session.role !== "pharmacy") { setMessage("Inicia sesión en el portal de farmacia para enviar una solicitud."); return; }
    if (!registrationFile) { setMessage("Adjunta una copia de la licencia para continuar."); return; }
    const id = `farmacia-${Date.now()}`;
    const requestId = `VR-${new Date().getFullYear()}-${String(verificationRequests.length + 15).padStart(3, "0")}`;
    const coordinates = geocodeDemoAddress(registrationAddress) ?? demoOrigin;
    const documentUrl = URL.createObjectURL(registrationFile);
    const pharmacy: Pharmacy = { id, name: registrationName.trim(), address: registrationAddress.trim(), latitude: coordinates.latitude, longitude: coordinates.longitude, verified: false, accessible: null, lastUpdated: new Date().toISOString() };
    setPharmacies((current) => [...current, pharmacy]);
    setVerificationRequests((current) => [{ id: requestId, pharmacyId: id, pharmacy: pharmacy.name, license: registrationLicense.trim(), submitted: "Ahora", status: "pending", documentName: registrationFile.name, documentUrl, ownerEmail: session.email }, ...current]);
    setRegistrationOpen(false); setRegistrationName(""); setRegistrationLicense(""); setRegistrationAddress(""); setRegistrationFile(null);
    setMessage("Solicitud enviada. Tu ficha permanecerá oculta hasta que se verifique la licencia.");
  }

  function openReview(request: VerificationRequest) {
    if (!session || session.role !== "admin") { setMessage("Inicia sesión con una cuenta administradora para revisar solicitudes."); return; }
    const registryFound = /^REG-[0-9]{5}-GT$/.test(request.license) && !request.license.includes("00000");
    setReviewRequest({ ...request, registryFound });
  }

  function decideRequest(decision: "approve" | "reject") {
    if (!session || session.role !== "admin" || !reviewRequest) { setMessage("No tienes permiso para decidir esta solicitud."); return; }
    if (decision === "approve" && !reviewRequest.registryFound) { setMessage("La licencia no coincide con el registro simulado. Corrige o rechaza la solicitud."); return; }
    let result;
    try { result = verificationDecision(decision, rejectionReason); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Debes indicar el motivo del rechazo."); return; }
    setVerificationRequests((current) => current.map((request) => request.id === reviewRequest.id ? { ...request, ...result } : request));
    setPharmacies((current) => current.map((pharmacy) => pharmacy.id === reviewRequest.pharmacyId ? { ...pharmacy, verified: result.status === "verified" } : pharmacy));
    setReviewRequest(null); setRejectionReason(""); setMessage(result.status === "verified" ? `${reviewRequest.pharmacy} fue verificada y ya aparece en búsquedas.` : `${reviewRequest.pharmacy} fue rechazada: ${result.reason}`);
  }

  function installPwa() {
    const deferred = (window as Window & { __installPrompt?: { prompt: () => Promise<void> } }).__installPrompt;
    if (deferred) void deferred.prompt(); else setShowInstall(true);
  }

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="#inicio" aria-label="Pharmafind inicio"><span className="brand-mark"><Icon name="pill" size={23}/></span><span>pharmafind<span className="brand-period">.</span></span></a>
      <nav className="main-nav" aria-label="Navegación principal">
        <button className={view === "search" ? "nav-link active" : "nav-link"} onClick={() => { setView("search"); setMessage(""); }}>Buscar medicamentos</button>
        <button className={view === "pharmacy" ? "nav-link active" : "nav-link"} onClick={() => enterView("pharmacy")}>Portal de farmacia</button>
        <button className={view === "admin" ? "nav-link active" : "nav-link"} onClick={() => enterView("admin")}>Administración</button>
      </nav>
      <div className="top-actions"><span className="city-tag"><span className="live-dot"/> Ciudad de Guatemala</span>{session && <button className="install-button" onClick={logout}>Cerrar sesión</button>}<button className="install-button" onClick={installPwa}><span className="install-icon">↧</span> Instalar app</button></div>
      <button className="mobile-menu" aria-label="Mostrar menú" onClick={() => enterView(view === "search" ? "pharmacy" : "search")}><Icon name="menu"/></button>
      {session && <button className="mobile-menu logout-mobile" onClick={logout}>Salir</button>}
    </header>

    {view === "search" && <>
      <section className="hero" id="inicio">
        <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> MEDICINAS CERCA DE TI</div><h1>Encuentra tu medicina.<br/><span>Sin dar vueltas.</span></h1><p>Compara disponibilidad, presentación y precio en farmacias verificadas cerca de ti.</p>
          <div className="search-card"><form className="search-form" onSubmit={submitSearch}><Icon name="search" size={21}/><input aria-label="Nombre del medicamento" placeholder="¿Qué medicamento buscas?" value={query} onChange={(event) => setQuery(event.target.value)}/><button type="submit" disabled={busy}>{busy ? "Buscando…" : "Buscar"}</button></form>
            <div className="search-bottom"><label className={locationValid ? "location-picker" : "location-picker invalid"}><Icon name="pin" size={16}/><span className="location-label">Cerca de</span><input aria-label="Dirección o zona de búsqueda" list="guatemala-zones" value={locationLabel} onChange={(event) => { setLocationLabel(event.target.value); setLocationValid(true); }} onBlur={() => { if (locationLabel !== "Mi ubicación actual") geocodeEnteredLocation(); }}/><datalist id="guatemala-zones"><option value="Zona 10, Ciudad de Guatemala"/><option value="Centro histórico, Zona 1"/><option value="Zona 4, Ciudad de Guatemala"/></datalist></label><button className="gps-button" onClick={locateMe}><span>◎</span> Usar mi ubicación</button></div>
          </div>
          <div className="trust-row"><span><Icon name="shield" size={16}/> Solo farmacias verificadas</span><span className="trust-separator"/><span><Icon name="clock" size={16}/> Inventario actualizado</span></div>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="art-halo halo-one"/><div className="art-halo halo-two"/><div className="art-cross">+</div><div className="pill-bottle"><div className="bottle-cap"/><div className="bottle-body"><span className="bottle-logo"><Icon name="pill" size={28}/></span><span className="bottle-name">pharma<span>find</span></span><span className="bottle-label">SALUD A TU ALCANCE</span><div className="bottle-stripe"/></div></div><div className="float-card float-stock"><span className="float-icon green"><Icon name="check" size={17}/></span><span><b>Stock confirmado</b><small>Última actualización · hace 12 min</small></span></div><div className="float-card float-price"><span className="float-icon yellow">Q</span><span><small>Desde</small><b>Q 16.00</b></span></div><div className="art-sparkle sparkle-a">✳</div><div className="art-sparkle sparkle-b">✳</div></div>
      </section>

      <section className="results-section">
        <div className="results-heading"><div><div className="eyebrow eyebrow-small">RESULTADOS PARA TI</div><h2>Opciones cerca de ti <span className="result-count">{searchCount}</span></h2><p className="results-subtitle">{searchCount ? `Mostrando ${searchCount} presentaciones reportadas cerca de ${locationLabel}` : `No encontramos disponibilidad para “${submittedQuery}”`}</p></div><button className={accessibleOnly ? "access-filter selected" : "access-filter"} onClick={() => setAccessibleOnly((value) => !value)}><span className="access-symbol">♿</span> Acceso universal <span className={accessibleOnly ? "toggle on" : "toggle"}><i/></span></button></div>
        <div className="compare-strip"><div className="compare-strip-copy"><b>Comparar presentaciones</b><span>Selecciona opciones para verlas lado a lado.</span></div><div className="compare-checks">{results.map((result) => <label key={result.listing.id}><input type="checkbox" checked={compareSelection.includes(result.listing.id)} onChange={() => setCompareSelection((current) => current.includes(result.listing.id) ? current.filter((id) => id !== result.listing.id) : [...current, result.listing.id])}/><span>{result.pharmacy.name} · {result.product.presentation} {result.product.strength}</span></label>)}</div><div className="compare-actions"><button className="text-button" disabled={selectedResults.length !== 1} onClick={() => setDetailResult(selectedResults[0] ?? null)}>Ver detalle</button><button className="primary-button" disabled={selectedResults.length < 2} onClick={() => setShowComparison(true)}>Comparar {selectedResults.length > 0 ? `(${selectedResults.length})` : ""}</button></div></div>
        <div className="results-layout"><div className="results-list">{results.map((result, index) => {
          const stale = isStale(result.listing.lastUpdated ?? result.pharmacy.lastUpdated);
          const productLabel = products.find((product) => product.catalogId === result.listing.catalogId)!;
          return <article className="result-card" key={result.listing.id}><div className="result-main"><div className={`pharmacy-avatar avatar-${index % 3}`}><Icon name="store" size={21}/></div><div className="result-copy"><div className="pharmacy-name-row"><h3>{result.pharmacy.name}</h3><span className="verified-badge"><Icon name="check" size={12}/> Verificada</span></div><div className="address-line"><Icon name="pin" size={14}/>{result.pharmacy.address}<span className="address-dot">·</span>{result.distanceKm.toFixed(1)} km</div><div className="product-presentation"><span className="product-pill"><Icon name="pill" size={13}/>{productLabel.presentation}</span><span>{productLabel.strength}</span><span className="presentation-divider"/><span>{productLabel.packSize}</span>{result.pharmacy.accessible === true && <span className="accessible-label" title="Acceso universal">♿ Accesible</span>}</div></div><div className="price-block"><strong>{money(result.listing.price)}</strong><span>Precio de lista</span></div></div><div className="result-footer"><span className={result.listing.stock === 0 ? "stock-status out" : result.listing.stock < 6 ? "stock-status low" : "stock-status"}><i/>{result.listing.stock === 0 ? "Agotado" : result.listing.stock < 6 ? `Pocas unidades · ${result.listing.stock}` : `En stock · ${result.listing.stock} unidades`}</span><span className={stale ? "updated stale" : "updated"}><Icon name="clock" size={13}/>{stale ? "Información posiblemente desactualizada" : `Actualizado ${displayTime(result.listing.lastUpdated ?? result.pharmacy.lastUpdated)}`}</span><button className="directions-button" onClick={() => setMessage(`Indicaciones para ${result.pharmacy.name}: ${result.pharmacy.address}`)}>Cómo llegar <Icon name="arrow" size={14}/></button></div></article>;
        })}{results.length === 0 && <div className="empty-state"><div className="empty-icon"><Icon name="search" size={28}/></div><h3>Sin resultados por ahora</h3><p>Prueba otra forma de escribir el medicamento o cambia tu zona de búsqueda.</p></div>}
          <p className="results-disclaimer">Los precios son de lista y pueden variar. La disponibilidad refleja el último reporte de cada farmacia.</p></div>
          <aside className="map-card"><div className="map-toolbar"><div><b>Farmacias en el mapa</b><span>{searchCount} ubicaciones disponibles</span></div><button aria-label="Ver mapa ampliado" onClick={() => setMessage("La vista de mapa está simulada para esta demostración.")}><span>⛶</span></button></div><div className="map-visual"><div className="map-grid"/><div className="map-road road-a"/><div className="map-road road-b"/><div className="map-road road-c"/><div className="map-block block-a"/><div className="map-block block-b"/><div className="map-block block-c"/><div className="map-block block-d"/><div className="map-block block-e"/><div className="map-park"><span>PARQUE<br/>CENTRAL</span></div><div className="map-river"/><div className="map-marker marker-home"><span>⌂</span></div>{results.slice(0, 4).map((result, index) => <div key={result.listing.id} className={`map-marker marker-${index}`} title={result.pharmacy.name}><Icon name="store" size={14}/></div>)}<span className="map-label label-a">ZONA 10</span><span className="map-label label-b">ZONA 4</span><span className="map-label label-c">ZONA 1</span></div><div className="map-legend"><span><i className="legend-pharmacy"/> Farmacia</span><span><i className="legend-you"/> Tu ubicación</span><button onClick={() => setMessage("Vista de mapa de la Ciudad de Guatemala.")}>Abrir mapa <Icon name="arrow" size={12}/></button></div></aside>
        </div>
      </section>
      <section className="how-section"><div className="how-heading"><div className="eyebrow eyebrow-small">SENCILLO Y CONFIABLE</div><h2>Más certeza. Menos vueltas.</h2></div><div className="how-steps"><div className="how-step"><span className="step-number">01</span><span className="step-icon"><Icon name="search"/></span><h3>Busca tu medicina</h3><p>Escribe el nombre y dinos dónde quieres buscar.</p></div><div className="step-connector"/><div className="how-step"><span className="step-number">02</span><span className="step-icon"><Icon name="sliders"/></span><h3>Compara tus opciones</h3><p>Revisa presentaciones, existencias y precios.</p></div><div className="step-connector"/><div className="how-step"><span className="step-number">03</span><span className="step-icon"><Icon name="pin"/></span><h3>Elige dónde ir</h3><p>Encuentra una farmacia verificada cerca de ti.</p></div></div></section>
    </>}

    {view === "pharmacy" && <section className="workspace-view"><div className="workspace-intro"><div><div className="eyebrow eyebrow-small">PORTAL DE FARMACIA</div><h1>Tu farmacia, <span>al día.</span></h1><p>Administra tu inventario y mantén tu ficha actualizada para quienes te buscan.</p></div><span className="portal-avatar"><Icon name="store" size={25}/></span></div><div className="portal-grid"><div className="portal-primary"><div className="portal-card pharmacy-profile"><div className="profile-icon"><Icon name="store"/></div><div className="profile-content"><div className="pharmacy-name-row"><h2>{manager.name}</h2><span className="verified-badge"><Icon name="check" size={12}/> Verificada</span></div><p><Icon name="pin" size={14}/>{manager.address}</p></div><span className="profile-live"><i/> Visible en búsquedas</span></div><div className="portal-card"><div className="card-heading"><div><h2>Inventario y precios</h2><p>Actualiza las existencias que ven tus clientes.</p></div><span className="item-count">{myListings.length} productos</span></div><div className="inventory-table"><div className="inventory-head"><span>Medicamento</span><span>Existencias</span><span>Precio (Q)</span><span/></div>{myListings.map((listing) => { const product = products.find((item) => item.catalogId === listing.catalogId)!; return <ManualListing key={listing.id} listing={listing} product={product} save={saveListing} busy={busy}/>; })}</div></div><div className="portal-card import-card"><div className="card-heading"><div><h2><Icon name="upload" size={18}/> Importar inventario</h2><p>Sube el CSV que exportas de tu sistema.</p></div><span className="format-chip">CSV</span></div><button className="upload-zone" onClick={() => csvInput.current?.click()}><span className="upload-circle"><Icon name="upload"/></span><b>Haz clic para elegir un archivo</b><span>Formato estándar · catalogId, stock, price</span></button><input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => void handleCsv(event.target.files?.[0])}/><div className="format-note"><Icon name="shield" size={15}/><span>Solo se aceptan IDs de catálogo Pharmafind y valores válidos. Las filas fuera del formato se rechazan sin cambios.</span></div></div></div><div className="portal-side"><div className="portal-card sync-card"><div className="card-heading"><div><div className="eyebrow eyebrow-small">ESTADO DE TUS DATOS</div><h2>Sincronización</h2></div><span className={isStale(manager.lastUpdated) ? "sync-indicator warning" : "sync-indicator"}><i/>{isStale(manager.lastUpdated) ? "Revisar" : "Al día"}</span></div><div className="last-sync"><span className="sync-clock"><Icon name="clock"/></span><div><small>Última actualización</small><b>{displayTime(manager.lastUpdated)}</b></div></div>{syncLogs[0] && <div className="sync-log-result">Último resultado: {syncLogs[0].status} · {syncLogs[0].acceptedRows} aceptadas · {syncLogs[0].rejectedRows} rechazadas</div>}{isStale(manager.lastUpdated) && <div className="stale-banner">Tus datos llevan más de 24 horas sin actualizarse. Sincroniza para avisar a tus clientes.</div>}<div className="sync-divider"/><div className="feed-status-row"><span><span className={feedConnected ? "feed-dot connected" : "feed-dot"}/>{feedConnected ? "Feed POS conectado" : "Feed POS no conectado"}</span><button className="text-button" onClick={connectFeed}>{feedConnected ? "Sincronizar ahora" : "Conectar"}</button></div>{feedConnected && <small className="feed-hint">Próxima sincronización automática en ${feedInterval} min</small>}</div><div className="portal-card preview-card"><div className="card-heading"><div><h2>Vista para clientes</h2><p>Así se ve tu farmacia en los resultados.</p></div><span className="preview-eye">◉</span></div><div className="mini-listing"><div className="mini-avatar"><Icon name="store" size={17}/></div><div><b>{manager.name}</b><span><Icon name="shield" size={12}/> Farmacia verificada</span></div></div><div className="preview-stats"><span><b>{myListings.filter((listing) => listing.stock > 0).length}</b><small>Productos disponibles</small></span><span><b>{myListings.filter((listing) => listing.stock === 0).length}</b><small>Sin existencias</small></span></div><button className="outline-button" onClick={() => setActivePublicPreview(true)}>Vista pública detallada <Icon name="arrow" size={14}/></button></div><div className="portal-help"><span className="help-icon">?</span><div><b>¿Necesitas ayuda?</b><p>Consulta cómo preparar tu archivo de inventario.</p><button onClick={() => setMessage("CSV: una fila por producto con catalogId, stock entero ≥ 0 y price > 0. No se convierten nombres a catalog IDs.")}>Ver guía de formato <Icon name="arrow" size={12}/></button></div></div></div></div></section>}

    {view === "pharmacy" && <section className="workspace-view portal-extra"><div className="portal-card"><div className="card-heading"><div><h2>Registro y verificación</h2><p>Las nuevas farmacias permanecen ocultas hasta que la licencia sea revisada.</p></div><button className="primary-button" onClick={() => setRegistrationOpen(true)}>Registrar farmacia</button></div>{verificationRequests.filter((request) => request.pharmacyId === session?.pharmacyId || request.ownerEmail === session?.email).length ? verificationRequests.filter((request) => request.pharmacyId === session?.pharmacyId || request.ownerEmail === session?.email).map((request) => <div className="sync-history-row" key={request.id}><span>{request.pharmacy}</span><span>{request.license}</span><span className={request.status === "verified" ? "verified-badge" : request.status === "rejected" ? "pending-badge rejected-badge" : "pending-badge"}>{request.status === "verified" ? "Verificada" : request.status === "rejected" ? "Rechazada" : "Pendiente"}</span>{request.reason && <small>{request.reason}</small>}</div>) : <p className="muted-note">Aún no tienes solicitudes de verificación pendientes.</p>}</div><div className="portal-card"><div className="card-heading"><div><h2>Avisos de sincronización</h2><p>El trabajo revisa farmacias con más de 24 horas sin reporte y usa el correo simulado.</p></div><button className="outline-button compact" onClick={() => setFailNextEmail(true)}>Simular fallo de correo</button></div><div className="job-actions"><button className="primary-button" onClick={runStaleSyncJob}>Ejecutar revisión de datos atrasados</button><button className="outline-button compact" onClick={retryFailedEmails}>Reintentar correos fallidos</button></div><div className="sync-history">{emailDeliveries.length ? emailDeliveries.map((delivery) => <div className="sync-history-row" key={delivery.id}><span>Aviso de stock atrasado · {delivery.id.split("|")[1]}</span><span>{delivery.status === "sent" ? "Correo enviado" : "Falló"}</span><span>{delivery.attempts} intento(s)</span></div>) : <p className="muted-note">No se han generado avisos todavía.</p>}</div></div><div className="portal-card"><div className="card-heading"><div><h2>Historial de sincronización</h2><p>Incluye el resumen de filas y copias de los archivos importados.</p></div></div>{syncLogs.length ? syncLogs.map((log) => <div className="sync-history-row" key={log.id}><span>{log.source.toUpperCase()} · {displayTime(log.syncedAt)}</span><span>{log.acceptedRows} aceptadas · {log.rejectedRows} rechazadas</span><span className="verified-badge">{log.status === "success" ? "Completado" : log.status === "partial" ? "Parcial" : "Fallido"}</span></div>) : <p className="muted-note">Todavía no hay sincronizaciones registradas.</p>}{feedFileCopies.map((file) => <div className="sync-history-row" key={`${file.name}-${file.savedAt}`}><span>Copia guardada · {file.name}</span><span>{Math.ceil(file.bytes / 1024)} KB</span><span>{displayTime(file.savedAt)}</span></div>)}</div><div className="portal-extra-actions"><span>Sesión: {session?.email}</span><button className="text-button" onClick={logout}>Cerrar sesión</button></div></section>}
    {view === "admin" && <AdminConsole requests={verificationRequests} pharmacies={pharmacies} onReview={openReview} emailDeliveries={emailDeliveries} onRunStaleJob={runStaleSyncJob} onFailNext={() => setFailNextEmail(true)} onRetryEmails={retryFailedEmails}/>}

    <footer className="site-footer"><a className="brand footer-brand" href="#inicio"><span className="brand-mark"><Icon name="pill" size={19}/></span><span>pharmafind<span className="brand-period">.</span></span></a><span>Salud accesible, cerca de ti.</span><span className="footer-links"><button onClick={() => setMessage("Pharmafind ayuda a comparar disponibilidad reportada por farmacias locales.")}>Acerca de</button><button onClick={() => setMessage("Demo educativa. No sustituye el consejo de un profesional de salud.")}>Aviso de uso</button></span><small>© 2026 Pharmafind · Demo</small></footer>
    {loginTarget && <div className="modal-backdrop" onClick={() => setLoginTarget(null)}><form className="install-modal flow-modal" role="dialog" aria-modal="true" onSubmit={submitLogin} onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setLoginTarget(null)} aria-label="Cerrar">×</button><span className="modal-app-icon"><Icon name={loginTarget === "admin" ? "shield" : "store"}/></span><div className="eyebrow eyebrow-small">ACCESO {loginTarget === "admin" ? "ADMINISTRADOR" : "FARMACIA"}</div><h2>Inicia sesión.</h2><p>Las acciones del portal quedan limitadas al rol de esta cuenta.</p><label className="modal-field">Correo<input type="email" required value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)}/></label><label className="modal-field">Contraseña<input type="password" required value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)}/></label><div className="demo-credentials">Demo: {loginTarget === "admin" ? "admin@pharmafind.demo / admin123" : "patricia@farmacia.demo / farmacia123"}</div><button className="primary-button modal-ok">Entrar al portal</button></form></div>}
    {feedSetupOpen && <div className="modal-backdrop" onClick={() => setFeedSetupOpen(false)}><form className="install-modal flow-modal" role="dialog" aria-modal="true" onSubmit={configureFeed} onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setFeedSetupOpen(false)} aria-label="Cerrar">×</button><span className="modal-app-icon"><Icon name="upload"/></span><div className="eyebrow eyebrow-small">CONECTOR DE INVENTARIO</div><h2>Conecta tu POS.</h2><p>Probamos el endpoint antes de activar la descarga programada.</p><label className="modal-field">Endpoint HTTPS<input type="url" required value={feedEndpoint} onChange={(event) => setFeedEndpoint(event.target.value)}/></label><label className="modal-field">Frecuencia de sincronización<select value={feedInterval} onChange={(event) => setFeedInterval(Number(event.target.value))}><option value={5}>Cada 5 minutos</option><option value={15}>Cada 15 minutos</option><option value={60}>Cada 60 minutos</option><option value={240}>Cada 4 horas</option></select></label><p className="demo-credentials">Prueba de fallo: usa https://offline.demo/feed. Los feeds solo aceptan IDs y columnas Pharmafind.</p><button className="primary-button modal-ok" disabled={busy}>Probar y activar feed</button></form></div>}
    {registrationOpen && <div className="modal-backdrop" onClick={() => setRegistrationOpen(false)}><form className="install-modal flow-modal" role="dialog" aria-modal="true" onSubmit={submitRegistration} onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setRegistrationOpen(false)} aria-label="Cerrar">×</button><span className="modal-app-icon"><Icon name="store"/></span><div className="eyebrow eyebrow-small">NUEVO REGISTRO</div><h2>Solicita verificación.</h2><p>Adjunta tu licencia. La nueva ficha estará oculta mientras se revisa.</p><label className="modal-field">Nombre de la farmacia<input required value={registrationName} onChange={(event) => setRegistrationName(event.target.value)}/></label><label className="modal-field">Número de licencia<input required value={registrationLicense} onChange={(event) => setRegistrationLicense(event.target.value)}/></label><label className="modal-field">Dirección<input required value={registrationAddress} onChange={(event) => setRegistrationAddress(event.target.value)}/></label><label className="modal-field">Documento de licencia<input required type="file" accept=".pdf,image/*" onChange={(event) => setRegistrationFile(event.target.files?.[0] ?? null)}/></label><button className="primary-button modal-ok">Enviar solicitud</button></form></div>}
    {reviewRequest && <div className="modal-backdrop" onClick={() => setReviewRequest(null)}><div className="install-modal flow-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setReviewRequest(null)} aria-label="Cerrar">×</button><span className="modal-app-icon"><Icon name="shield"/></span><div className="eyebrow eyebrow-small">REVISIÓN DE LICENCIA</div><h2>{reviewRequest.pharmacy}</h2><p>Solicitud {reviewRequest.id} · Licencia {reviewRequest.license}</p><div className={reviewRequest.registryFound ? "registry-result found" : "registry-result missing"}><Icon name={reviewRequest.registryFound ? "check" : "clock"}/>{reviewRequest.registryFound ? "Número encontrado en el registro simulado" : "No se encontró coincidencia en el registro simulado"}</div>{reviewRequest.documentUrl ? <a className="document-link" href={reviewRequest.documentUrl} target="_blank" rel="noreferrer">Abrir documento: {reviewRequest.documentName} <Icon name="arrow" size={13}/></a> : <div className="document-link">Documento de demostración: {reviewRequest.documentName}</div>}<label className="modal-field">Motivo de rechazo (obligatorio para rechazar)<textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} rows={2}/></label><div className="modal-button-row"><button className="outline-button" onClick={() => decideRequest("reject")}>Rechazar</button><button className="primary-button" onClick={() => decideRequest("approve")} disabled={!reviewRequest.registryFound}>Verificar</button></div></div></div>}
    {activePublicPreview && <div className="modal-backdrop" onClick={() => setActivePublicPreview(false)}><div className="install-modal flow-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setActivePublicPreview(false)} aria-label="Cerrar">×</button><div className="eyebrow eyebrow-small">VISTA PÚBLICA</div><h2>{manager.name}</h2><p>{manager.verified ? "Farmacia verificada y visible" : "Solicitud pendiente · ficha oculta"} · {manager.address}</p><div className="public-preview-list">{myListings.map((listing) => { const product = products.find((entry) => entry.catalogId === listing.catalogId)!; return <div className="public-preview-row" key={listing.id}><span><b>{product.brandName}</b><small>{product.presentation} · {product.strength} · {product.packSize}</small></span><span className={listing.stock ? "stock-in" : "stock-out"}>{listing.stock ? `${listing.stock} unidades` : "Agotado"}</span><b>{money(listing.price)}</b></div>; })}</div><button className="primary-button modal-ok" onClick={() => setActivePublicPreview(false)}>Cerrar vista previa</button></div></div>}
    {showComparison && <div className="modal-backdrop" onClick={() => setShowComparison(false)}><div className="install-modal comparison-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowComparison(false)} aria-label="Cerrar">×</button><div className="eyebrow eyebrow-small">COMPARACIÓN</div><h2>Opciones lado a lado.</h2><p>Datos de esta búsqueda, agrupados por presentación y farmacia.</p><div className="comparison-table"><div className="comparison-head"><span>Medicamento</span><span>Farmacia</span><span>Existencia</span><span>Precio</span><span>Distancia</span></div>{selectedResults.map((result) => <div className="comparison-row" key={result.listing.id}><span><b>{result.product.brandName}</b><small>{result.product.presentation} · {result.product.strength} · {result.product.packSize}</small></span><span>{result.pharmacy.name}<small>{result.pharmacy.verified ? "Verificada" : "No verificada"}</small></span><span className={result.listing.stock === 0 ? "stock-out" : "stock-in"}>{result.listing.stock === 0 ? "Agotado" : `${result.listing.stock} unidades`}</span><b>{money(result.listing.price)}</b><span>{result.distanceKm.toFixed(1)} km</span><button className="text-button" onClick={() => { setShowComparison(false); setDetailResult(result); }}>Detalle</button></div>)}</div></div></div>}
    {detailResult && <div className="modal-backdrop" onClick={() => setDetailResult(null)}><div className="install-modal flow-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setDetailResult(null)} aria-label="Cerrar">×</button><div className="eyebrow eyebrow-small">DETALLE DE FARMACIA</div><h2>{detailResult.pharmacy.name}</h2><div className="detail-property"><span>Medicamento</span><b>{detailResult.product.brandName} · {detailResult.product.presentation}</b></div><div className="detail-property"><span>Presentación y dosis</span><b>{detailResult.product.strength} · {detailResult.product.packSize}</b></div><div className="detail-property"><span>Existencia</span><b className={detailResult.listing.stock === 0 ? "stock-out" : "stock-in"}>{detailResult.listing.stock === 0 ? "Agotado" : `${detailResult.listing.stock} unidades`}</b></div><div className="detail-property"><span>Precio listado</span><b>{money(detailResult.listing.price)}</b></div><div className="detail-property"><span>Acceso universal</span><b>{detailResult.pharmacy.accessible === null ? "Sin información" : detailResult.pharmacy.accessible ? "Accesible" : "No reportado como accesible"}</b></div><div className="detail-property"><span>Última actualización</span><b>{displayTime(detailResult.listing.lastUpdated ?? detailResult.pharmacy.lastUpdated)}</b></div><div className="detail-property"><span>Dirección</span><b>{detailResult.pharmacy.address}</b></div><button className="primary-button modal-ok" onClick={() => { setMessage(`Indicaciones simuladas a ${detailResult.pharmacy.address}`); setDetailResult(null); }}>Cómo llegar</button></div></div>}
    {message && <div className="toast" role="status"><span className="toast-icon"><Icon name="check" size={16}/></span><span>{message}</span><button onClick={() => setMessage("")} aria-label="Cerrar mensaje">×</button></div>}
    {showInstall && <div className="modal-backdrop" onClick={() => setShowInstall(false)}><div className="install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowInstall(false)} aria-label="Cerrar">×</button><span className="modal-app-icon"><Icon name="pill" size={30}/></span><div className="eyebrow eyebrow-small">PHARMAFIND PARA TU MÓVIL</div><h2 id="install-title">Llévala contigo.</h2><p>Instala Pharmafind desde las opciones de tu navegador para acceder más rápido desde tu pantalla de inicio.</p><div className="install-steps"><span><b>iPhone / iPad</b><small>Toca Compartir y elige “Añadir a pantalla de inicio”.</small></span><span><b>Android</b><small>Abre el menú del navegador y toca “Instalar aplicación”.</small></span></div><button className="primary-button modal-ok" onClick={() => setShowInstall(false)}>Entendido</button></div></div>}
    <nav className="mobile-nav" aria-label="Navegación móvil"><button className={view === "search" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => enterView("search")}><Icon name="search" size={19}/>Buscar</button><button className={view === "pharmacy" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => enterView("pharmacy")}><Icon name="store" size={19}/>Farmacia</button><button className={view === "admin" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => enterView("admin")}><Icon name="shield" size={19}/>Admin</button></nav>
    <ServiceWorkerRegistration/>
  </main>;
}

function ManualListing({ listing, product, save, busy }: { listing: Listing; product: (typeof products)[number]; save: (id: string, stock: string, price: string) => void; busy: boolean }) {
  const [stock, setStock] = useState(String(listing.stock));
  const [price, setPrice] = useState(String(listing.price));
  useEffect(() => setStock(String(listing.stock)), [listing.stock]);
  useEffect(() => setPrice(String(listing.price)), [listing.price]);
  const changed = Number(stock) !== listing.stock || Number(price) !== listing.price;
  return <div className="inventory-row"><div className="inventory-product"><span className="inventory-pill"><Icon name="pill" size={15}/></span><span><b>{product.brandName}</b><small>{product.presentation} · {product.strength}</small></span></div><label className="field-wrap"><span className="sr-only">Existencias de {product.brandName}</span><input aria-label={`Existencias ${product.brandName} ${product.presentation}`} inputMode="numeric" value={stock} onChange={(event) => setStock(event.target.value)}/><small>uds.</small></label><label className="field-wrap price-field"><span className="sr-only">Precio de {product.brandName}</span><small>Q</small><input aria-label={`Precio ${product.brandName} ${product.presentation}`} inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)}/></label><button className={changed ? "save-row changed" : "save-row"} disabled={busy || !changed} onClick={() => save(listing.id, stock, price)} aria-label={`Guardar ${product.brandName}`}><Icon name="check" size={16}/></button></div>;
}

function AdminConsole({ requests, pharmacies, onReview, emailDeliveries, onRunStaleJob, onFailNext, onRetryEmails }: { requests: VerificationRequest[]; pharmacies: Pharmacy[]; onReview: (request: VerificationRequest) => void; emailDeliveries: EmailDelivery[]; onRunStaleJob: () => void; onFailNext: () => void; onRetryEmails: () => void }) {
  const pending = requests.filter((request) => request.status === "pending");
  return <section className="workspace-view admin-view"><div className="workspace-intro"><div><div className="eyebrow eyebrow-small">CONSOLA DE ADMINISTRACIÓN</div><h1>Revisión de <span>farmacias.</span></h1><p>Inicia sesión con una cuenta administradora para revisar licencias y registrar decisiones.</p></div><span className="portal-avatar admin-avatar"><Icon name="shield" size={25}/></span></div><div className="admin-summary"><div className="summary-card"><span className="summary-icon amber"><Icon name="clock"/></span><span><small>Requieren revisión</small><b>{pending.length}</b></span></div><div className="summary-card"><span className="summary-icon green"><Icon name="shield"/></span><span><small>Farmacias verificadas</small><b>{pharmacies.filter((pharmacy) => pharmacy.verified).length}</b></span></div><div className="summary-card"><span className="summary-icon blue"><Icon name="store"/></span><span><small>Farmacias registradas</small><b>{pharmacies.length}</b></span></div></div><div className="portal-card review-card"><div className="card-heading"><div><h2>Solicitudes de verificación</h2><p>El registro simulado y el documento se revisan antes de aprobar una ficha.</p></div><span className="item-count">{pending.length ? `${pending.length} pendiente(s)` : "Todo al día"}</span></div>{pending.length ? pending.map((request) => <div className="request-row" key={request.id}><div className="request-logo"><Icon name="store" size={22}/></div><div className="request-info"><div className="pharmacy-name-row"><h3>{request.pharmacy}</h3><span className="pending-badge">Pendiente</span></div><p>Solicitud {request.id} · Recibida {request.submitted}</p><div className="license-box"><span className="license-icon">▤</span><span><small>Número de licencia</small><b>{request.license}</b></span><span className="document-chip">{request.documentName} <Icon name="check" size={12}/></span></div></div><div className="request-actions"><button className="review-button" onClick={() => onReview(request)}>Revisar licencia</button><span className="admin-note">Registro de licencia simulado</span></div></div>) : <div className="approved-state"><span className="approval-check"><Icon name="check" size={22}/></span><div><b>Sin solicitudes pendientes</b><p>Las decisiones se reflejan en la visibilidad pública de las farmacias.</p></div></div>}</div><div className="admin-info"><Icon name="shield" size={17}/><span>Las farmacias pendientes o rechazadas permanecen ocultas en búsquedas hasta que una solicitud sea verificada.</span></div><div className="portal-card verified-list"><div className="card-heading"><div><h2>Farmacias en Pharmafind</h2><p>Estado de verificación y presencia pública.</p></div></div><div className="verified-table"><div className="verified-head"><span>Farmacia</span><span>Licencia / estado</span><span>Estado</span><span>Visibilidad</span></div>{pharmacies.map((pharmacy) => { const request = requests.find((entry) => entry.pharmacyId === pharmacy.id); return <div className="verified-row" key={pharmacy.id}><span className="table-pharmacy"><span className="table-store"><Icon name="store" size={15}/></span>{pharmacy.name}</span><span className="table-license">{request?.license ?? "Cuenta demo registrada"}</span><span>{pharmacy.verified ? <span className="verified-badge"><Icon name="check" size={11}/> Verificada</span> : <span className={request?.status === "rejected" ? "pending-badge rejected-badge" : "pending-badge"}>{request?.status === "rejected" ? "Rechazada" : "Pendiente"}</span>}</span><span className={pharmacy.verified ? "visibility-on" : "visibility-off"}><i/>{pharmacy.verified ? "Pública" : "Oculta"}</span></div>; })}</div></div><div className="portal-card"><div className="card-heading"><div><h2>Avisos por correo</h2><p>Ejecuta la revisión atrasada, observa el envío simulado y reintenta fallos.</p></div></div><div className="job-actions"><button className="outline-button compact" onClick={onFailNext}>Simular fallo del próximo correo</button><button className="primary-button" onClick={onRunStaleJob}>Ejecutar trabajo de sincronización atrasada</button><button className="outline-button compact" onClick={onRetryEmails}>Reintentar correos fallidos</button></div>{emailDeliveries.length ? emailDeliveries.map((delivery) => <div className="sync-history-row" key={delivery.id}><span>{delivery.id.split("|")[1]} · {displayTime(delivery.attemptedAt)}</span><span>{delivery.status === "sent" ? "Correo enviado" : "Falló"}</span><span>{delivery.attempts} intento(s)</span></div>) : <p className="muted-note">No hay entregas registradas.</p>}</div></section>;
}

function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      (window as Window & { __installPrompt?: Event & { prompt: () => Promise<void> } }).__installPrompt = event as Event & { prompt: () => Promise<void> };
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onInstallPrompt);
  }, []);
  return null;
}
