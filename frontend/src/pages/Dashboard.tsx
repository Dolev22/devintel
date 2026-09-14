import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import InsightRow from "../components/InsightRow";
import Pipeline from "../components/Pipeline";
import {
  AnalysisStatusBadge,
  BarRow,
  EmptyState,
  ErrorState,
  HealthRing,
  Icon,
  SkeletonRows,
} from "../components/ui";
import { api, ApiError } from "../lib/api";
import { DOMAIN_LABEL, healthColor, healthLabel, relativeTime, severityColor } from "../lib/format";
import type { DashboardData } from "../lib/types";

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`stat-card ${onClick ? "clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div className="stat-card-top">
        <span
          className="stat-icon"
          style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
        >
          {icon}
        </span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await api.get<DashboardData>("/api/dashboard");
      setData(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the dashboard live while an analysis is running.
  useEffect(() => {
    if (!data || data.stats.analyses_in_progress === 0) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [data, load]);

  if (loading) {
    return (
      <div className="stack">
        <div className="grid grid-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton" style={{ height: 106 }} />
          ))}
        </div>
        <div className="card">
          <SkeletonRows count={4} />
        </div>
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const { stats } = data;

  if (stats.repository_count === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<Icon.Repo size={22} />}
          title="No repositories yet"
          message="Add a GitHub repository to run the multi-agent analysis and get your first developer intelligence report."
          action={
            <button className="btn btn-primary" onClick={() => navigate("/repositories")}>
              <Icon.Plus size={15} /> Add a repository
            </button>
          }
        />
      </div>
    );
  }

  const severityMax = Math.max(1, ...Object.values(data.severity_breakdown));
  const analyzedRepos = data.repository_health.filter((r) => r.health_score !== null);

  return (
    <div className="stack">
      {stats.analyses_in_progress > 0 && (
        <div className="card card-pad row" style={{ gap: 12 }}>
          <span className="spinner" />
          <span style={{ fontWeight: 600 }}>
            {stats.analyses_in_progress} analysis{stats.analyses_in_progress === 1 ? "" : "es"} in
            progress
          </span>
          <span className="text-sm text-muted">
            The agent pipeline is running. This page updates automatically.
          </span>
          <button className="btn btn-sm spacer" onClick={() => navigate("/runs")}>
            View runs
          </button>
        </div>
      )}

      <div className="grid grid-4">
        <StatCard
          label="Repositories"
          value={stats.repository_count}
          sub={`${stats.analyses_completed} analyses completed`}
          icon={<Icon.Repo size={16} />}
          color="var(--accent)"
          onClick={() => navigate("/repositories")}
        />
        <StatCard
          label="Critical findings"
          value={stats.critical_findings}
          sub="Open, highest severity"
          icon={<Icon.Alert size={16} />}
          color="var(--critical)"
          onClick={() => navigate("/insights?severity=critical")}
        />
        <StatCard
          label="Open findings"
          value={stats.open_findings}
          sub={`${stats.review_later_findings} marked review later`}
          icon={<Icon.Insight size={16} />}
          color="var(--high)"
          onClick={() => navigate("/insights?status=open")}
        />
        <StatCard
          label="Resolved"
          value={stats.resolved_findings}
          sub={`${stats.false_positive_findings} marked false positive`}
          icon={<Icon.Check size={16} />}
          color="var(--success)"
          onClick={() => navigate("/insights?status=resolved")}
        />
      </div>

      <div className="grid grid-3">
        <div className="card" style={{ gridColumn: "span 1" }}>
          <div className="card-header">
            <h2>Repository health</h2>
          </div>
          <div
            style={{
              padding: 20,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <HealthRing score={stats.average_health} size={112} stroke={9} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 650 }}>{healthLabel(stats.average_health)}</div>
              <div className="text-xs text-subtle">
                Average across {analyzedRepos.length} analyzed repositor
                {analyzedRepos.length === 1 ? "y" : "ies"}
              </div>
            </div>
          </div>
          <div style={{ padding: "0 16px 16px" }}>
            {data.repository_health.map((repo) => (
              <div
                key={repo.id}
                className="row"
                style={{
                  padding: "8px 0",
                  borderBlockEnd: "1px dashed var(--border)",
                  cursor: "pointer",
                }}
                onClick={() => navigate(`/repositories/${repo.id}`)}
              >
                <span className="truncate text-sm" style={{ flex: 1 }}>
                  {repo.name}
                </span>
                {repo.health_score === null ? (
                  <span className="badge badge-neutral">Not analyzed</span>
                ) : (
                  <>
                    <span className="text-xs text-subtle">{repo.open_findings} open</span>
                    <span
                      style={{
                        fontWeight: 700,
                        color: healthColor(repo.health_score),
                        minWidth: 26,
                        textAlign: "end",
                      }}
                    >
                      {repo.health_score}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ gridColumn: "span 2" }}>
          <div className="card-header">
            <h2>Findings by severity</h2>
            <span className="text-xs text-subtle card-header-action">
              Open findings, latest analysis per repository
            </span>
          </div>
          <div style={{ padding: 18 }}>
            {stats.open_findings === 0 ? (
              <EmptyState
                icon={<Icon.Check size={22} />}
                title="No open findings"
                message="Every finding from the latest analyses has been resolved or dismissed."
              />
            ) : (
              <>
                {(["critical", "high", "medium", "low"] as const).map((severity) => (
                  <BarRow
                    key={severity}
                    label={severity.charAt(0).toUpperCase() + severity.slice(1)}
                    value={data.severity_breakdown[severity] || 0}
                    max={severityMax}
                    color={severityColor(severity)}
                  />
                ))}

                <div
                  style={{
                    marginBlockStart: 18,
                    paddingBlockStart: 14,
                    borderBlockStart: "1px solid var(--border)",
                  }}
                >
                  <h3 className="section-title">By domain</h3>
                  {Object.entries(data.domain_breakdown).map(([domain, count]) => (
                    <BarRow
                      key={domain}
                      label={DOMAIN_LABEL[domain] || domain}
                      value={count}
                      max={Math.max(1, ...Object.values(data.domain_breakdown))}
                      color="var(--accent)"
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Recent developer insights</h2>
          <button
            className="btn btn-sm card-header-action"
            onClick={() => navigate("/insights")}
          >
            View all <Icon.Chevron size={13} />
          </button>
        </div>
        {data.recent_insights.length === 0 ? (
          <EmptyState
            icon={<Icon.Insight size={22} />}
            title="No open insights"
            message="Run an analysis to generate developer insights."
          />
        ) : (
          data.recent_insights.map((finding) => (
            <InsightRow
              key={finding.id}
              finding={finding}
              onClick={() => navigate(`/insights/${finding.id}`)}
            />
          ))
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Recent analysis runs</h2>
          <button className="btn btn-sm card-header-action" onClick={() => navigate("/runs")}>
            View all <Icon.Chevron size={13} />
          </button>
        </div>

        {data.recent_runs.length === 0 ? (
          <EmptyState
            icon={<Icon.Runs size={22} />}
            title="No analysis runs yet"
            message="Start an analysis from any repository."
          />
        ) : (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            {data.recent_runs.map((run) => (
              <div
                key={run.id}
                className="card"
                style={{ boxShadow: "none", cursor: "pointer" }}
                onClick={() => navigate(`/runs/${run.id}`)}
              >
                <div className="card-header" style={{ padding: "12px 14px" }}>
                  <strong style={{ fontSize: 13.5 }}>{run.repository_name}</strong>
                  <AnalysisStatusBadge status={run.status} />
                  <span className="text-xs text-subtle card-header-action">
                    {relativeTime(run.created_at)} · {run.findings_count} findings
                  </span>
                </div>
                <div style={{ padding: 12 }}>
                  <Pipeline stages={run.stages} compact />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
