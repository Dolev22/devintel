import { useEffect, useState } from "react";

import { useApp } from "../context/AppContext";
import { api, ApiError } from "../lib/api";
import { Icon } from "../components/ui";

export default function Login() {
  const { login, register, notify } = useApp();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [demo, setDemo] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    api
      .get<{ email: string; password: string }>("/api/auth/demo-credentials")
      .then((data) => {
        setDemo(data);
        setEmail((current) => current || data.email);
        setPassword((current) => current || data.password);
      })
      .catch(() => setDemo(null));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (mode === "login") {
        await login(email.trim(), password);
        notify("Welcome back", "success");
      } else {
        await register(name.trim(), email.trim(), password);
        notify("Account created", "success");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 16 }}>
            DI
          </div>
          <div className="brand-text">
            <strong style={{ fontSize: 17 }}>DevIntel</strong>
            <span>AI Developer Intelligence</span>
          </div>
        </div>

        <div className="tab-switch">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setError(null);
            }}
          >
            Sign in
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => {
              setMode("register");
              setError(null);
            }}
          >
            Create account
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          {mode === "register" && (
            <div className="field">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                required
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              dir="ltr"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
              required
              minLength={8}
              dir="ltr"
            />
          </div>

          {error && <div className="error-text">{error}</div>}

          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? <span className="spinner" /> : null}
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        {demo && mode === "login" && (
          <div className="auth-hint">
            <strong style={{ color: "var(--text)" }}>Demo account</strong> — the fields are
            prefilled with <span className="mono">{demo.email}</span>. It comes with three
            sample repositories and real analysis results.
          </div>
        )}

        <div className="text-xs text-subtle" style={{ textAlign: "center" }}>
          <Icon.Shield size={12} /> API keys are read from the server's .env and are never
          exposed to this interface.
        </div>
      </div>
    </div>
  );
}
