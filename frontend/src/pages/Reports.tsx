import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  EmptyState,
  ErrorState,
  HealthRing,
  Icon,
  SkeletonRows,
} from "../components/ui";
import { api, ApiError, buildQuery } from "../lib/api";
import { relativeTime, severityColor } from "../lib/format";
import type { Report } from "../lib/types";

export default function Reports() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const repositoryId = searchParams.get("repository");

  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setReports(
        await api.get<Report[]>(`/api/reports${buildQuery({ repository_id: repositoryId })}`)
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load reports.");
    } finally {
      setLoading(false);
    }
  }, [repositoryId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="card">
        <SkeletonRows count={3} height={120} />
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={load} />;

  if (reports.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<Icon.Report size={22} />}
          title="No reports yet"
          message="A report is produced at the end of every successful analysis run."
          action={
            <button className="btn btn-primary" onClick={() => navigate("/repositories")}>
              Run an analysis
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="stack">
      {reports.map((report) => {
        const severities = report.severity_breakdown || {};
        return (
          <div
            key={report.id}
            className="card"
            style={{ cursor: "pointer" }}
            onClick={() => navigate(`/reports/${report.id}`)}
          >
            <div className="report-hero" style={{ padding: 20, gap: 20 }}>
              <HealthRing score={report.health_score} size={78} stroke={7} />

              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="row row-wrap" style={{ gap: 8, marginBlockEnd: 6 }}>
                  <strong style={{ fontSize: 15 }}>{report.repository_name}</strong>
                  <span className="badge badge-neutral">
                    {report.total_findings} finding{report.total_findings === 1 ? "" : "s"}
                  </span>
                  {(["critical", "high", "medium", "low"] as const).map((severity) =>
                    severities[severity] ? (
                      <span key={severity} className={`badge sev-${severity}`}>
                        {severities[severity]} {severity}
                      </span>
                    ) : null
                  )}
                </div>

                <p
                  className="text-sm text-muted"
                  style={{
                    margin: 0,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {report.summary}
                </p>

                <div
                  className="row row-wrap text-xs text-subtle"
                  style={{ gap: 14, marginBlockStart: 10 }}
                >
                  <span>{relativeTime(report.created_at)}</span>
                  <span>{report.recommendations.length} recommendations</span>
                  <span className="badge badge-neutral">
                    {report.engine === "llm" ? "Claude API" : "Local analyzers"}
                  </span>
                </div>
              </div>

              <Icon.Chevron size={16} className="text-subtle" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
