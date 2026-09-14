import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import Pipeline from "../components/Pipeline";
import {
  AnalysisStatusBadge,
  EmptyState,
  ErrorState,
  Icon,
  SkeletonRows,
} from "../components/ui";
import { api, ApiError } from "../lib/api";
import { formatDuration, relativeTime, severityColor } from "../lib/format";
import type { Analysis } from "../lib/types";

const STATUS_FILTERS = ["all", "completed", "running", "failed"];

export default function AnalysisRuns() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    try {
      setError(null);
      setRuns(await api.get<Analysis[]>("/api/analyses"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load analysis runs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const anyActive = runs.some((run) =>
    ["pending", "running", "reviewing"].includes(run.status)
  );

  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(load, 1500);
    return () => clearInterval(timer);
  }, [anyActive, load]);

  const visible = runs.filter((run) => {
    if (filter === "all") return true;
    if (filter === "running")
      return ["pending", "running", "reviewing"].includes(run.status);
    return run.status === filter;
  });

  if (loading) {
    return (
      <div className="card">
        <SkeletonRows count={3} height={140} />
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="stack">
      <div className="row row-wrap">
        {STATUS_FILTERS.map((option) => (
          <button
            key={option}
            className={`chip ${filter === option ? "active" : ""}`}
            onClick={() => setFilter(option)}
          >
            {option === "all" ? "All runs" : option.charAt(0).toUpperCase() + option.slice(1)}
            <span className="chip-count">
              {option === "all"
                ? runs.length
                : option === "running"
                  ? runs.filter((r) =>
                      ["pending", "running", "reviewing"].includes(r.status)
                    ).length
                  : runs.filter((r) => r.status === option).length}
            </span>
          </button>
        ))}
        <button className="btn btn-sm btn-ghost spacer" onClick={load}>
          <Icon.Refresh size={14} /> Refresh
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon.Runs size={22} />}
            title={runs.length === 0 ? "No analysis runs yet" : "No runs match this filter"}
            message={
              runs.length === 0
                ? "Start an analysis from a repository to see the multi-agent pipeline in action."
                : "Try a different status filter."
            }
            action={
              runs.length === 0 ? (
                <button className="btn btn-primary" onClick={() => navigate("/repositories")}>
                  Go to repositories
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        visible.map((run) => (
          <div
            key={run.id}
            className="card"
            style={{ cursor: "pointer" }}
            onClick={() => navigate(`/runs/${run.id}`)}
          >
            <div className="card-header">
              <strong>{run.repository_name}</strong>
              <AnalysisStatusBadge status={run.status} />
              {run.severity_counts && (
                <div className="row" style={{ gap: 5 }}>
                  {(["critical", "high", "medium", "low"] as const).map((severity) =>
                    run.severity_counts![severity] > 0 ? (
                      <span
                        key={severity}
                        className={`badge sev-${severity}`}
                        title={`${run.severity_counts![severity]} ${severity}`}
                      >
                        {run.severity_counts![severity]}
                      </span>
                    ) : null
                  )}
                </div>
              )}
              <div className="card-header-action text-xs text-subtle row" style={{ gap: 12 }}>
                <span>{relativeTime(run.created_at)}</span>
                <span>{formatDuration(run.duration_ms)}</span>
                <span className="badge badge-neutral">
                  {run.engine === "llm" ? "Claude API" : "Local analyzers"}
                </span>
                <Icon.Chevron size={14} />
              </div>
            </div>

            <div style={{ padding: 16 }}>
              <Pipeline stages={run.stages} />

              {run.status === "failed" && run.error_message && (
                <p
                  className="text-sm"
                  style={{ color: "var(--critical)", marginBlockEnd: 0, marginBlockStart: 14 }}
                >
                  {run.error_message}
                </p>
              )}

              {run.status === "completed" && (
                <div
                  className="row row-wrap text-xs text-subtle"
                  style={{ gap: 16, marginBlockStart: 14 }}
                >
                  <span>{run.findings_count} findings</span>
                  <span>{run.files_analyzed} files analyzed</span>
                  <span>{run.loc_analyzed} lines reviewed</span>
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
