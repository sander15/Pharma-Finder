"use client";

import { useState, type ReactNode } from "react";
import { api, errorMessage } from "@/lib/client/api";

/** Shared sign-in form with optional password reset (security code) flow. */
export default function LoginCard({ title, onLogin, hint, allowReset = true, extra }: { title: string; onLogin: (email: string, password: string) => Promise<unknown>; hint?: ReactNode; allowReset?: boolean; extra?: ReactNode }) {
  const [mode, setMode] = useState<"login" | "reset-request" | "reset-confirm">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (mode === "reset-request") {
    return (
      <section className="card">
        <h2>Reset your password</h2>
        <p className="muted">We&apos;ll e-mail you a 6-digit security code. (In this demo, read it in the <a href="/demo">Demo panel mailbox</a>.)</p>
        {error && <div className="alert err" role="alert">{error}</div>}
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("POST", "/api/auth/password-reset/request", { email }); setInfo("If that e-mail has an account, a security code was sent."); setMode("reset-confirm"); }); }}>
          <label className="field"><span className="label">E-mail</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          <div className="row"><button className="btn" disabled={busy}>Send security code</button><button type="button" className="btn secondary" onClick={() => setMode("login")}>Back</button></div>
        </form>
      </section>
    );
  }

  if (mode === "reset-confirm") {
    return (
      <section className="card">
        <h2>Enter your security code</h2>
        {info && <div className="alert info">{info}</div>}
        {error && <div className="alert err" role="alert">{error}</div>}
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("POST", "/api/auth/password-reset/confirm", { email, code, newPassword }); setInfo("Password updated. You can sign in now."); setMode("login"); setPassword(""); }); }}>
          <label className="field"><span className="label">Security code</span><input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" /></label>
          <label className="field"><span className="label">New password (8+ characters)</span><input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" /></label>
          <div className="row"><button className="btn" disabled={busy}>Set new password</button><button type="button" className="btn secondary" onClick={() => setMode("login")}>Cancel</button></div>
        </form>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>{title}</h2>
      {info && <div className="alert ok">{info}</div>}
      {error && <div className="alert err" role="alert">{error}</div>}
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { setInfo(null); await onLogin(email, password); }); }}>
        <label className="field"><span className="label">E-mail</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
        <label className="field"><span className="label">Password</span><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        <div className="row">
          <button className="btn" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
          {allowReset && <button type="button" className="btn secondary" onClick={() => { setMode("reset-request"); setError(null); }}>Forgot password?</button>}
        </div>
      </form>
      {hint && <div className="small muted" style={{ marginTop: 12 }}>{hint}</div>}
      {extra}
    </section>
  );
}
