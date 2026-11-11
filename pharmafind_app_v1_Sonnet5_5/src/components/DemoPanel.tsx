"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { formatAge, formatDateTime } from "@/lib/client/format";
import type { JobType, ScheduledJob, VerificationStatus } from "@/lib/types";

interface DemoState {
  now: string;
  realNow: string;
  offsetMs: number;
  autoTick: boolean;
  jobs: ScheduledJob[];
  pharmacies: { pharmacyId: string; name: string; verificationStatus: VerificationStatus; lastSyncAt: string | null; ageMinutes: number | null; isStale: boolean }[];
  outboxCount: number;
  adapters: { emailFailing: boolean; licenseRegistryAvailable: boolean; drugReferenceAvailable: boolean; posModes: Record<string, string>; posEndpoints: string[] };
}
interface Mail { to: string; subject: string; body: string; sentAt: string }

const JOB_LABEL: Record<JobType, string> = {
  pull_pos_feeds: "Pull POS feeds",
  check_stale_sync: "Check stale syncs (alert e-mails)",
  refresh_drug_reference: "Refresh drug reference data",
  retry_failed_emails: "Retry failed e-mails",
};
const POS_MODES = ["valid", "invalid", "malformed", "down"] as const;

/** Demo controls: server clock fast-forward, background-worker triggers, external-system switches, simulated mailbox. */
export default function DemoPanel() {
  const [state, setState] = useState<DemoState | null>(null);
  const [mails, setMails] = useState<Mail[]>([]);
  const [log, setLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([api<DemoState>("GET", "/api/demo/state"), api<{ emails: Mail[] }>("GET", "/api/demo/outbox")]);
      setState(s.data);
      setMails(m.data.emails);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function act(method: string, path: string, body?: unknown, note?: (d: never) => string) {
    setBusy(true);
    try {
      const r = await api<unknown>(method, path, { body });
      if (note) setLog(note(r.data as never));
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const advance = (hours: number) => act("POST", "/api/demo/advance", { hours }, () => `Server time moved forward ${hours} h.`);
  const run = (job?: JobType) =>
    act("POST", "/api/demo/run-scheduler", job ? { job } : {}, ((d: { results: { type: string; summary: string }[] }) => (d.results.length ? d.results.map((r) => `${r.type}: ${r.summary}`).join(" · ") : "No job was due.")) as never);

  if (error && !state) return <div className="alert error" role="alert">{error}</div>;
  if (!state) return <div className="empty"><span className="spinner" /> Loading…</div>;

  return (
    <div className="stack">
      <h1>Demo controls</h1>
      <p className="muted">This build simulates everything outside the app (pharmacy POS systems, drug database, licensing registry, maps, e-mail). Use this page to show what happens over time.</p>
      {error && <div className="alert error" role="alert">{error}</div>}
      {log && <div className="alert info" role="status">{log}</div>}

      <section className="card stack">
        <h2>Time</h2>
        <dl className="kv">
          <dt>Server time (demo)</dt><dd><strong>{formatDateTime(state.now)}</strong>{state.offsetMs > 0 && <> <span className="badge warn">+{(state.offsetMs / 3_600_000).toFixed(1)} h fast-forward</span></>}</dd>
          <dt>Real time</dt><dd>{formatDateTime(state.realNow)}</dd>
        </dl>
        <p className="muted" style={{ margin: 0 }}>Everything time-based (24 h “stale” label, “last updated” ages, sync alerts, token expiry) follows the <em>server time</em>, so fast-forwarding keeps labels and ages consistent.</p>
        <div className="row">
          {[1, 6, 12, 25, 72].map((h) => <button key={h} className="btn" disabled={busy} onClick={() => void advance(h)}>+{h} h</button>)}
          <button className="btn" disabled={busy || state.offsetMs === 0} onClick={() => void act("POST", "/api/demo/reset-clock", {}, () => "Clock reset to real time.")}>Reset clock</button>
        </div>
      </section>

      <section className="card stack">
        <h2>Pharmacy data freshness (as the server sees it)</h2>
        <div className="scroll-x">
          <table className="compare">
            <thead><tr><th>Pharmacy</th><th>Verification</th><th>Last successful sync</th><th>Status</th></tr></thead>
            <tbody>
              {state.pharmacies.map((p) => (
                <tr key={p.pharmacyId}>
                  <td>{p.name}</td>
                  <td>{p.verificationStatus}</td>
                  <td>{formatAge(p.ageMinutes)}</td>
                  <td>{p.isStale ? <span className="badge warn">⚠ stale (&gt; 24 h)</span> : <span className="badge ok">fresh</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack">
        <h2>Background worker (job scheduler)</h2>
        <p className="muted" style={{ margin: 0 }}>Serverless hosting has no always-on worker, so due jobs also run on incoming requests{state.autoTick ? " (on)" : ""}, daily via Vercel Cron, or right here.</p>
        <div className="row"><button className="btn primary" disabled={busy} onClick={() => void run()}>Run all due jobs now</button></div>
        <div className="scroll-x">
          <table className="compare">
            <thead><tr><th>Job</th><th>Every</th><th>Next run</th><th>Last run</th><th /></tr></thead>
            <tbody>
              {state.jobs.map((j) => (
                <tr key={j.jobId}>
                  <td>{JOB_LABEL[j.type]}</td>
                  <td>{j.intervalMinutes} min</td>
                  <td>{formatDateTime(j.nextRunAt)}</td>
                  <td>{j.lastRunAt ? formatDateTime(j.lastRunAt) : "-"}</td>
                  <td><button className="btn small" disabled={busy} onClick={() => void run(j.type)}>Run now</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack">
        <h2>Simulated external systems</h2>
        <label className="check"><input type="checkbox" checked={state.adapters.emailFailing} onChange={(e) => void act("POST", "/api/demo/adapters", { emailFailing: e.target.checked })} /> E-mail service is down (alerts fail, then get retried)</label>
        <label className="check"><input type="checkbox" checked={!state.adapters.licenseRegistryAvailable} onChange={(e) => void act("POST", "/api/demo/adapters", { licenseRegistryAvailable: !e.target.checked })} /> Licensing registry is down (admin sees “unavailable”)</label>
        <label className="check"><input type="checkbox" checked={!state.adapters.drugReferenceAvailable} onChange={(e) => void act("POST", "/api/demo/adapters", { drugReferenceAvailable: !e.target.checked })} /> Drug reference database is down</label>
        {state.adapters.posEndpoints.map((ep) => (
          <label key={ep}>POS system <span className="mono">{ep}</span>
            <select value={state.adapters.posModes[ep] ?? "valid"} onChange={(e) => void act("POST", "/api/demo/adapters", { posMode: { endpoint: ep, mode: e.target.value } })}>
              {POS_MODES.map((m) => <option key={m} value={m}>{m === "valid" ? "sends valid standard rows" : m === "invalid" ? "sends some non-compliant rows (rejected)" : m === "malformed" ? "sends a malformed feed (rejected)" : "is down"}</option>)}
            </select>
          </label>
        ))}
      </section>

      <section className="card stack">
        <div className="row between"><h2 style={{ margin: 0 }}>Simulated mailbox ({state.outboxCount})</h2><button className="btn small" onClick={() => void load()}>Refresh</button></div>
        <p className="muted" style={{ margin: 0 }}>Security codes and stale-sync alerts that Pharmafind e-mails appear here instead of being sent.</p>
        {mails.length === 0 ? <p className="empty">No e-mails yet.</p> : mails.slice(0, 20).map((m, i) => (
          <article key={i} className="card flat">
            <div className="row between"><strong>{m.subject}</strong><small className="muted">{formatDateTime(m.sentAt)}</small></div>
            <small className="muted">To: {m.to}</small>
            <div className="pre" style={{ marginTop: 8 }}>{m.body}</div>
          </article>
        ))}
      </section>

      <section className="card stack">
        <h2>Demo accounts (password <code>Demo!Pass123</code>)</h2>
        <div className="scroll-x">
          <table className="compare">
            <thead><tr><th>E-mail</th><th>Role</th></tr></thead>
            <tbody>
              <tr><td className="mono">admin@pharmafind.demo</td><td>Administrator</td></tr>
              {["hubcity", "plains", "raider", "depot", "southside", "westgate"].map((s) => <tr key={s}><td className="mono">{s}@pharmafind.demo</td><td>Pharmacy manager (verified)</td></tr>)}
              <tr><td className="mono">newleaf@pharmafind.demo</td><td>Pharmacy manager (pending verification; in the admin queue)</td></tr>
            </tbody>
          </table>
        </div>
        <small className="muted">The mock database lives in server memory: it resets on a cold start and each serverless instance has its own copy.</small>
      </section>
    </div>
  );
}
