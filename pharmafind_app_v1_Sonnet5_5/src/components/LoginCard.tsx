"use client";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/client/api";

type Mode = "login" | "request" | "confirm";

/** Login + password reset with security codes (shared by the pharmacy portal and the admin console). */
export default function LoginCard({ title, demoHint, onLoggedIn }: { title: string; demoHint: string; onLoggedIn: () => void }) {
  const [mode, setMode] = useState<Mode>("login");
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

  const submitLogin = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api("POST", "/api/auth/login", { body: { email, password } });
      setPassword("");
      onLoggedIn();
    });
  };

  const submitRequest = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api<{ message: string }>("POST", "/api/auth/password-reset/request", { body: { email } });
      setInfo(`${r.data.message} (Demo: the e-mail appears in the Demo tab → Simulated mailbox.)`);
      setMode("confirm");
    });
  };

  const submitConfirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api<{ message: string }>("POST", "/api/auth/password-reset/confirm", { body: { email, code, newPassword } });
      setInfo(r.data.message);
      setCode("");
      setNewPassword("");
      setMode("login");
    });
  };

  return (
    <section className="card" style={{ maxWidth: 460 }}>
      <h2>{mode === "login" ? title : mode === "request" ? "Reset your password" : "Enter your security code"}</h2>
      {info && <div className="alert info" role="status" style={{ marginBottom: 10 }}>{info}</div>}
      {error && <div className="alert error" role="alert" style={{ marginBottom: 10 }}>{error}</div>}

      {mode === "login" && (
        <form className="stack" onSubmit={submitLogin}>
          <label>
            E-mail
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          <button className="btn primary" disabled={busy}>Log in</button>
          <button type="button" className="btn small" onClick={() => { setMode("request"); setInfo(null); setError(null); }}>Forgot password?</button>
          <small className="muted">{demoHint}</small>
        </form>
      )}

      {mode === "request" && (
        <form className="stack" onSubmit={submitRequest}>
          <p className="muted">We will e-mail you a 6-digit security code that works for 15 minutes.</p>
          <label>
            E-mail
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </label>
          <div className="row">
            <button className="btn primary" disabled={busy}>Send security code</button>
            <button type="button" className="btn" onClick={() => setMode("login")}>Back</button>
          </div>
        </form>
      )}

      {mode === "confirm" && (
        <form className="stack" onSubmit={submitConfirm}>
          <label>
            E-mail
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            6-digit security code
            <input type="text" inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required />
          </label>
          <label>
            New password
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required />
            <span className="hint">At least 8 characters, with a letter and a digit.</span>
          </label>
          <div className="row">
            <button className="btn primary" disabled={busy}>Change password</button>
            <button type="button" className="btn" onClick={() => setMode("login")}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
