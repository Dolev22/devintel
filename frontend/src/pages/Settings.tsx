import { useCallback, useEffect, useState } from "react";

import { ErrorState, Icon, LoadingState } from "../components/ui";
import { useApp } from "../context/AppContext";
import { api, ApiError } from "../lib/api";
import { SEVERITY_LABEL, SEVERITY_ORDER } from "../lib/format";
import {
  LINKEDIN_VS_INSTAGRAM_TONE,
  SOCIAL_PLATFORMS,
  isLinkedInConnected,
  setLinkedInConnected,
} from "../lib/linkedin";
import type { Preferences, SystemInfo } from "../lib/types";

function PlatformSupportBadge({ support }: { support: "primary" | "available" | "unsupported" }) {
  if (support === "primary") return <span className="badge badge-success">Supported</span>;
  if (support === "available") return <span className="badge badge-neutral">Not integrated</span>;
  return <span className="badge badge-danger">Not supported</span>;
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div
      className="row"
      style={{ gap: 12, padding: "11px 0", borderBlockEnd: "1px dashed var(--border)" }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
        {hint && <div className="field-hint">{hint}</div>}
      </div>
      <button
        className={`switch ${value ? "on" : ""}`}
        onClick={() => onChange(!value)}
        aria-pressed={value}
        aria-label={label}
      />
    </div>
  );
}

export default function Settings() {
  const { user, preferences, theme, setTheme, direction, setDirection, updatePreferences, updateProfile, notify } =
    useApp();

  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [local, setLocal] = useState<Preferences | null>(preferences);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState({ name: user?.name || "", email: user?.email || "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [linkedinConnected, setLinkedinConnectedState] = useState(isLinkedInConnected());

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get<{ preferences: Preferences; system: SystemInfo }>(
        "/api/settings"
      );
      setLocal(data.preferences);
      setSystem(data.system);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setProfile({ name: user?.name || "", email: user?.email || "" });
  }, [user]);

  async function patch(next: Partial<Preferences>) {
    setLocal((current) => (current ? { ...current, ...next } : current));
    try {
      await updatePreferences(next);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not save preference.", "error");
      load();
    }
  }

  function toggleLinkedIn() {
    const next = !linkedinConnected;
    setLinkedInConnected(next);
    setLinkedinConnectedState(next);
    notify(
      next
        ? "LinkedIn connected (demo) — no real account is linked."
        : "LinkedIn disconnected (demo).",
      next ? "success" : "info"
    );
  }

  async function saveProfile() {
    setSavingProfile(true);
    try {
      await updateProfile({ name: profile.name, email: profile.email });
      notify("Profile updated", "success");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not save profile.", "error");
    } finally {
      setSavingProfile(false);
    }
  }

  if (loading) return <LoadingState label="Loading settings…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!local) return null;

  return (
    <div className="stack page-narrow">
      <div className="card">
        <div className="card-header">
          <h2>Profile</h2>
        </div>
        <div className="card-pad stack" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="profile-name">Name</label>
              <input
                id="profile-name"
                className="input"
                value={profile.name}
                onChange={(event) => setProfile({ ...profile, name: event.target.value })}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="profile-email">Email</label>
              <input
                id="profile-email"
                className="input"
                type="email"
                value={profile.email}
                onChange={(event) => setProfile({ ...profile, email: event.target.value })}
                dir="ltr"
              />
            </div>
          </div>
          <div>
            <button className="btn btn-primary" onClick={saveProfile} disabled={savingProfile}>
              {savingProfile ? <span className="spinner" /> : null} Save profile
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Appearance</h2>
        </div>
        <div className="card-pad stack" style={{ gap: 16 }}>
          <div className="field">
            <label>Theme</label>
            <div className="tab-switch" style={{ maxWidth: 260 }}>
              <button
                className={theme === "dark" ? "active" : ""}
                onClick={() => setTheme("dark")}
              >
                <Icon.Moon size={14} /> Dark
              </button>
              <button
                className={theme === "light" ? "active" : ""}
                onClick={() => setTheme("light")}
              >
                <Icon.Sun size={14} /> Light
              </button>
            </div>
          </div>

          <div className="field">
            <label>Text direction</label>
            <div className="tab-switch" style={{ maxWidth: 260 }}>
              <button
                className={direction === "ltr" ? "active" : ""}
                onClick={() => setDirection("ltr")}
              >
                LTR
              </button>
              <button
                className={direction === "rtl" ? "active" : ""}
                onClick={() => setDirection("rtl")}
              >
                RTL
              </button>
            </div>
            <span className="field-hint">
              Right-to-left mirrors the full interface. Code blocks stay left-to-right, since
              source code is direction-independent.
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Analysis preferences</h2>
        </div>
        <div className="card-pad">
          <Toggle
            label="Run the Code Analysis Agent"
            hint="Detects probable bugs, complexity, duplication and maintainability issues."
            value={local.run_code_analysis}
            onChange={(value) => patch({ run_code_analysis: value })}
          />
          <Toggle
            label="Run the Security Agent"
            hint="Detects injection, hardcoded secrets, auth flaws and insecure patterns."
            value={local.run_security}
            onChange={(value) => patch({ run_security: value })}
          />

          <div
            className="row"
            style={{ gap: 12, padding: "13px 0", borderBlockEnd: "1px dashed var(--border)" }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Minimum severity to report</div>
              <div className="field-hint">Findings below this level are hidden from reports.</div>
            </div>
            <select
              className="select"
              style={{ width: 140 }}
              value={local.min_severity}
              onChange={(event) => patch({ min_severity: event.target.value as any })}
            >
              {SEVERITY_ORDER.map((severity) => (
                <option key={severity} value={severity}>
                  {SEVERITY_LABEL[severity]}
                </option>
              ))}
            </select>
          </div>

          <div
            className="row"
            style={{ gap: 12, padding: "13px 0", borderBlockEnd: "1px dashed var(--border)" }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                Maximum files per analysis
              </div>
              <div className="field-hint">
                Caps how much source the agents read, which bounds cost and run time.
              </div>
            </div>
            <input
              className="input"
              type="number"
              min={5}
              max={200}
              style={{ width: 100 }}
              value={local.max_files_per_analysis}
              onChange={(event) =>
                setLocal({ ...local, max_files_per_analysis: Number(event.target.value) })
              }
              onBlur={(event) =>
                patch({ max_files_per_analysis: Number(event.target.value) || 40 })
              }
            />
          </div>

          <div className="row" style={{ gap: 12, padding: "13px 0" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Minimum confidence</div>
              <div className="field-hint">
                Currently {Math.round(local.min_confidence * 100)}% — lower values surface more
                speculative findings.
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              style={{ width: 140 }}
              value={local.min_confidence}
              onChange={(event) =>
                setLocal({ ...local, min_confidence: Number(event.target.value) })
              }
              onMouseUp={(event) =>
                patch({ min_confidence: Number((event.target as HTMLInputElement).value) })
              }
              onTouchEnd={(event) =>
                patch({ min_confidence: Number((event.target as HTMLInputElement).value) })
              }
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Notifications</h2>
        </div>
        <div className="card-pad">
          <Toggle
            label="When an analysis completes"
            value={local.notify_on_complete}
            onChange={(value) => patch({ notify_on_complete: value })}
          />
          <Toggle
            label="When a critical finding is detected"
            value={local.notify_on_critical}
            onChange={(value) => patch({ notify_on_critical: value })}
          />
          <Toggle
            label="Weekly digest"
            hint="A summary of new findings across all repositories."
            value={local.notify_weekly_digest}
            onChange={(value) => patch({ notify_weekly_digest: value })}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Social Platforms</h2>
          <span className="badge badge-neutral card-header-action">LinkedIn is primary</span>
        </div>
        <div className="card-pad stack" style={{ gap: 0 }}>
          <p className="text-sm text-muted" style={{ marginBlockStart: 0 }}>
            DevIntel can turn a real Developer Insight or Report into a professional
            LinkedIn post draft. Other platforms are shown for context only.
          </p>

          {SOCIAL_PLATFORMS.map((platform) => (
            <div
              key={platform.id}
              className="row"
              style={{
                gap: 12,
                padding: "13px 0",
                borderBlockEnd: "1px dashed var(--border)",
                alignItems: "flex-start",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{platform.name}</span>
                  <PlatformSupportBadge support={platform.support} />
                  {platform.id === "linkedin" && (
                    <span className={`badge ${linkedinConnected ? "badge-success" : "badge-neutral"}`}>
                      {linkedinConnected ? "Connected (demo)" : "Not connected"}
                    </span>
                  )}
                  <span className="badge badge-neutral mono">{platform.ratio}</span>
                </div>
                <div className="field-hint" style={{ marginBlockStart: 4 }}>
                  {platform.note}
                </div>
              </div>

              {platform.id === "linkedin" && (
                <button
                  className={`btn btn-sm ${linkedinConnected ? "" : "btn-primary"}`}
                  onClick={toggleLinkedIn}
                  style={{ flexShrink: 0 }}
                >
                  {linkedinConnected ? "Disconnect" : "Connect LinkedIn"}
                </button>
              )}
            </div>
          ))}

          <div
            className="row"
            style={{
              gap: 10,
              marginBlockStart: 14,
              padding: 12,
              background: "var(--surface-2)",
              borderRadius: "var(--radius-sm)",
              border: "1px dashed var(--border-strong)",
            }}
          >
            <Icon.Shield size={16} className="text-subtle" />
            <span className="text-xs text-muted">
              <strong>This is a demo connection, not a real LinkedIn account link.</strong> No
              LinkedIn Developer App is configured in this environment. A real connection
              would require: a registered LinkedIn app, its Client ID and Client Secret,
              an approved OAuth 2.0 redirect URI, and the <code>w_member_social</code> (and{" "}
              <code>openid profile email</code>) scopes granted by LinkedIn — none of which
              are invented or faked here.
            </span>
          </div>

          <p className="text-xs text-subtle" style={{ marginBlockEnd: 0, marginBlockStart: 10 }}>
            {LINKEDIN_VS_INSTAGRAM_TONE}
          </p>
        </div>
      </div>

      {system && (
        <div className="card">
          <div className="card-header">
            <h2>System</h2>
            <span className="badge badge-neutral card-header-action">Read-only</span>
          </div>
          <div className="card-pad">
            <div className="meta-row">
              <span className="meta-key">Analysis engine</span>
              <span className="meta-val">{system.analysis_engine}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Model</span>
              <span className="meta-val mono">{system.llm_model || "—"}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Database</span>
              <span className="meta-val">{system.database}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Credentials</span>
              <span className="meta-val">{system.secrets_source}</span>
            </div>

            <div
              className="row"
              style={{
                gap: 10,
                marginBlockStart: 14,
                padding: 12,
                background: "var(--surface-2)",
                borderRadius: "var(--radius-sm)",
                border: "1px dashed var(--border-strong)",
              }}
            >
              <Icon.Shield size={16} className="text-subtle" />
              <span className="text-xs text-muted">
                API keys and credentials are read from the server's <code>.env</code> file and
                are never sent to this interface. There is no field here to enter them by
                design.
              </span>
            </div>

            {!system.llm_enabled && (
              <p className="text-xs text-subtle" style={{ marginBlockEnd: 0 }}>
                No <code>ANTHROPIC_API_KEY</code> is configured, so the agents are running
                their local deterministic analyzers. Findings, consolidation and reports are
                produced by the same pipeline either way.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
