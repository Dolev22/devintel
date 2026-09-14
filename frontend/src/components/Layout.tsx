import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import type { DashboardData } from "../lib/types";
import AddRepositoryModal from "./AddRepositoryModal";
import { Icon } from "./ui";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: Icon.Dashboard, end: true },
  { to: "/repositories", label: "Repositories", icon: Icon.Repo },
  { to: "/insights", label: "Developer Insights", icon: Icon.Insight, badge: true },
  { to: "/runs", label: "Analysis Runs", icon: Icon.Runs },
  { to: "/reports", label: "Reports", icon: Icon.Report },
];

const SECONDARY_ITEMS = [
  { to: "/knowledge", label: "Knowledge", icon: Icon.Knowledge },
  { to: "/settings", label: "Settings", icon: Icon.Settings },
];

const PAGE_META: { match: RegExp; title: string; subtitle: string }[] = [
  { match: /^\/$/, title: "Dashboard", subtitle: "Repository health and the latest agent output" },
  {
    match: /^\/repositories\/[^/]+\/review/,
    title: "Code Review",
    subtitle: "Source code with the findings the agents anchored to it",
  },
  {
    match: /^\/repositories\/[^/]+/,
    title: "Repository",
    subtitle: "Analysis history and repository details",
  },
  { match: /^\/repositories/, title: "Repositories", subtitle: "Connected GitHub repositories" },
  {
    match: /^\/insights\/[^/]+/,
    title: "Insight Detail",
    subtitle: "Full explanation, code context and remediation",
  },
  {
    match: /^\/insights/,
    title: "Developer Insights",
    subtitle: "Findings produced and validated by the agent team",
  },
  {
    match: /^\/runs\/[^/]+/,
    title: "Analysis Run",
    subtitle: "Multi-agent pipeline progress and per-agent output",
  },
  { match: /^\/runs/, title: "Analysis Runs", subtitle: "Every execution of the agent pipeline" },
  {
    match: /^\/reports\/[^/]+/,
    title: "Developer Report",
    subtitle: "Consolidated intelligence for one analysis",
  },
  { match: /^\/reports/, title: "Reports", subtitle: "Developer-facing intelligence reports" },
  {
    match: /^\/knowledge/,
    title: "Knowledge",
    subtitle: "The references the agents reason against",
  },
  { match: /^\/settings/, title: "Settings", subtitle: "Profile, appearance and analysis preferences" },
];

export default function Layout() {
  const { user, logout, theme, setTheme, direction, setDirection, notify } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [criticalCount, setCriticalCount] = useState(0);

  const loadBadge = useCallback(async () => {
    try {
      const data = await api.get<DashboardData>("/api/dashboard");
      setCriticalCount(data.stats.critical_findings);
    } catch {
      /* badge is non-essential */
    }
  }, []);

  useEffect(() => {
    loadBadge();
  }, [loadBadge, location.pathname]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const meta =
    PAGE_META.find((entry) => entry.match.test(location.pathname)) || PAGE_META[0];

  const initials = (user?.name || "D")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="app-shell">
      <div
        className={`sidebar-scrim ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">DI</div>
          <div className="brand-text">
            <strong>DevIntel</strong>
            <span>Developer Intelligence</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">Workspace</div>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <item.icon className="nav-icon" />
              {item.label}
              {item.badge && criticalCount > 0 && (
                <span className="nav-badge">{criticalCount}</span>
              )}
            </NavLink>
          ))}

          <div className="nav-section-label">Resources</div>
          {SECONDARY_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <item.icon className="nav-icon" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="user-chip" onClick={() => navigate("/settings")}>
            <span className="avatar">{initials}</span>
            <span className="user-chip-text">
              <strong>{user?.name}</strong>
              <span>{user?.email}</span>
            </span>
          </button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ width: "100%", marginBlockStart: 8 }}
            onClick={() => {
              logout();
              notify("Signed out", "info");
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button
            className="icon-btn mobile-only"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="Toggle navigation"
          >
            <Icon.Menu size={17} />
          </button>

          <div className="topbar-title">
            <h1>{meta.title}</h1>
            <p>{meta.subtitle}</p>
          </div>

          <div className="topbar-actions">
            <button
              className="icon-btn"
              onClick={() => setDirection(direction === "ltr" ? "rtl" : "ltr")}
              title={direction === "ltr" ? "Switch to RTL layout" : "Switch to LTR layout"}
              aria-label="Toggle text direction"
            >
              <span style={{ fontSize: 11, fontWeight: 700 }}>
                {direction === "ltr" ? "RTL" : "LTR"}
              </span>
            </button>

            <button
              className="icon-btn"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Icon.Sun /> : <Icon.Moon />}
            </button>

            <button className="btn btn-primary" onClick={() => setShowAddRepo(true)}>
              <Icon.Plus size={16} />
              Analyze Repository
            </button>
          </div>
        </header>

        <main className="page">
          <Outlet />
        </main>
      </div>

      {showAddRepo && (
        <AddRepositoryModal
          onClose={() => setShowAddRepo(false)}
          onCreated={(repositoryId, analysisId) => {
            setShowAddRepo(false);
            loadBadge();
            if (analysisId) navigate(`/runs/${analysisId}`);
            else navigate(`/repositories/${repositoryId}`);
          }}
        />
      )}
    </div>
  );
}
