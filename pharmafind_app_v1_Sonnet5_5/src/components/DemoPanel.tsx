"use client";

import { useCallback, useEffect, useState } from "react";
import type { ScheduledJob } from "@/lib/types";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";

interface DemoState {
  now: string;
  clockOffsetHours: number;
  emailFailing: boolean;
  outbox: Array<{ to: string; subject: string; body: string; sentAt: string }>;
  jobs: ScheduledJob[];
  posEndpoints: string[];
  accounts: { password: string; admin: string; pharmacies: Array<{ pharmacyId: string; email: string; license: string }> };
}

/** Demo-only control panel for the mocked outside world: clock, scheduler, e-mail outage, mailbox, reset. */
export default function DemoPanel() {
  const [s, setS] = useState<DemoState | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setS(await api<DemoState>("GET", "/api/demo/state")); } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(fn: () => Promise<unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      const summary = (r as { results?: Array<{ type: string; summary: string }> } | undefined)?.results;
      setMsg({ ok: true, text: summary?.length ? `${okText}: ${summary.map((x) => `${x.type} → ${x.summary}`).join("; ")}` : summary ? `${okText}: no job was due.` : okText });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <p className="muted">{msg?.text ?? "Loading..."}</p>;

  return (
    <div>
      <section className="card">
        <h1>Demo control panel</h1>
        <p className="muted">Pharmafind is a demo: every outside system (POS feeds, licensing registry, drug database, e-mail, maps, geocoding) and database is a mock. Use these switches to see the background behaviour from the sequence diagrams. Data lives in server memory and resets on cold start.</p>
        {msg && <div className={`alert ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</div>}
      </section>

      <section className="card">
        <h2>Clock</h2>
        <p>Server time: <strong>{dateTime(s.now)}</strong> {s.clockOffsetHours > 0 && <span className="badge warn">+{s.clockOffsetHours} h fast-forwarded</span>}</p>
        <div className="row">
          {[1, 12, 25].map((h) => <button key={h} className="btn secondary" disabled={busy} onClick={() => void act(() => api("POST", "/api/demo/advance-time", { hours: h }), `Advanced ${h} h`)}>+{h} h</button>)}
        </div>
        <p className="small muted">Advance 25 h to make every pharmacy&apos;s data stale, then run the scheduler to send stale-sync alerts.</p>
      </section>

      <section className="card">
        <h2>Background worker</h2>
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => void act(() => api("POST", "/api/demo/run-jobs"), "Scheduler tick")}>Run scheduler now (due jobs)</button>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Job</th><th>Every</th><th>Last run</th><th>Next run</th><th /></tr></thead>
            <tbody>
              {s.jobs.map((j) => (
                <tr key={j.jobId}>
                  <td className="mono">{j.type}</td><td>{j.intervalMinutes} min</td>
                  <td className="small">{j.lastRunAt ? dateTime(j.lastRunAt) : "never"}</td><td className="small">{dateTime(j.nextRunAt)}</td>
                  <td><button className="btn secondary small" disabled={busy} onClick={() => void act(() => api("POST", `/api/demo/run-jobs?force=${j.type}`), `Ran ${j.type}`)}>Run</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>E-mail service</h2>
        <p>Status: {s.emailFailing ? <span className="badge err">Simulated outage</span> : <span className="badge ok">Working</span>}</p>
        <button className="btn secondary" disabled={busy} onClick={() => void act(() => api("POST", "/api/demo/email-failure", { failing: !s.emailFailing }), s.emailFailing ? "E-mail restored" : "E-mail outage on")}>{s.emailFailing ? "Restore e-mail" : "Simulate outage"}</button>
        <p className="small muted">With the outage on, stale-sync alerts are marked failed; restore e-mail and run the &quot;retry_failed_emails&quot; job.</p>
      </section>

      <section className="card">
        <h2>Mailbox (mock e-mail service, newest first)</h2>
        {s.outbox.length === 0 ? <p className="muted">No e-mails sent yet. Try “Forgot password” in the portal, or run the stale-sync check.</p> : s.outbox.map((m, i) => (
          <details key={i} style={{ borderTop: "1px solid var(--border)", padding: "6px 0" }} open={i === 0}>
            <summary><span className="mono">{m.to}</span> · {m.subject}</summary>
            <pre className="small" style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>{m.body}</pre>
            <div className="small muted">{dateTime(m.sentAt)}</div>
          </details>
        ))}
      </section>

      <section className="card">
        <h2>Demo accounts</h2>
        <p>Every account uses the password <span className="mono">{s.accounts.password}</span>.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Account</th><th>Story</th></tr></thead>
            <tbody>
              <tr><td className="mono">{s.accounts.admin}</td><td>Administrator (<a href="/admin">Admin console</a>)</td></tr>
              {s.accounts.pharmacies.map((p) => (
                <tr key={p.pharmacyId}><td className="mono">{p.email}</td><td className="small">{story(p.pharmacyId)} · license <span className="mono">{p.license}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Reset</h2>
        <button className="btn danger" disabled={busy} onClick={() => { if (confirm("Reset all demo data?")) void act(() => api("POST", "/api/demo/reset"), "Demo data reset"); }}>Reset all demo data</button>
      </section>
    </div>
  );
}

function story(id: string): string {
  switch (id) {
    case "ph-hub-city": return "Verified, accessible, fresh data (Patricia's pharmacy)";
    case "ph-tech-terrace": return "Verified, NOT wheelchair accessible, next to campus";
    case "ph-slide-road": return "Verified, automatic POS feed enabled (out of Advil until the feed is pulled)";
    case "ph-canyon-lakes": return "Verified, accessible";
    case "ph-southwest": return "Verified but data is 30 h old (stale-sync alert)";
    case "ph-quaker": return "Registration pending (hidden from search)";
    case "ph-indiana": return "Registration rejected (can resubmit)";
    default: return "";
  }
}
