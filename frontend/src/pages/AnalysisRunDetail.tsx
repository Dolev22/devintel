import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import InsightRow from "../components/InsightRow";
import Pipeline from "../components/Pipeline";
import {
  AnalysisStatusBadge,
  EmptyState,
  ErrorState,
  HealthRing,
  Icon,
  LoadingState,
} from "../components/ui";
import { api, ApiError } from "../lib/api";
import { AGENT_LABEL, formatDateTime, formatDuration, formatNumber } from "../lib/format";
import type { Analysis, Finding, Report } from "../lib/types";

export default function AnalysisRunDetail() {
  const { analysisId } = useParams();
  const navigate = useNavigate();

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!analysisId) return;
    try {
      setError(null);
      const data = await api.get<{
        analysis: Analysis;
        findings: Finding[];
        report: Report | null;
      }>(`/api/analyses/${analysisId}`);
      setAnalysis(data.analysis);
      setFindings(data.findings);
      setReport(data.report);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this analysis run.");
    } finally {
      setLoading(false);
    }
  }, [analysisId]);

  useEffect(() => {
    load();
  }, [load]);

  const active =
    analysis && ["pending", "running", "reviewing"].includes(analysis.status);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(load, 1200);
    return () => clearInterval(timer);
  }, [active, load]);

  if (loading) return <LoadingState label="Loading analysis run…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!analysis) return null;

  const stages = analysis.stages || [];

  return (
    <div className="stack">
      <Link to="/runs" className="back-link">
        <Icon.Back /> All analysis runs
      </Link>

      <div className="card">
        <div className="card-header">
          <h2>{analysis.repository_name}</h2>
          <AnalysisStatusBadge status={analysis.status} />
          <div className="card-header-action row" style={{ gap: 8 }}>
            <button
              className="btn btn-sm"
              onClick={() => navigate(`/repositories/${analysis.repository_id}`)}
            >
              Repository
            </button>
            {report && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => navigate(`/reports/${report.id}`)}
              >
                <Icon.Report size={13} /> View report
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: 18 }}>
          <h3 className="section-title">Multi-agent pipeline</h3>
          <Pipeline stages={stages} />

          {active && (
            <div className="row" style={{ gap: 10, marginBlockStart: 14 }}>
              <span className="spinner" />
              <span className="text-sm text-muted">
                {analysis.current_stage
                  ? `Running: ${AGENT_LABEL[analysis.current_stage] || analysis.current_stage}`
                  : "Starting…"}
              </span>
            </div>
          )}

          {analysis.status === "failed" && analysis.error_message && (
            <div
              className="toast error"
              style={{ boxShadow: "none", marginBlockStart: 14 }}
            >
              <Icon.Alert size={16} />
              <span>{analysis.error_message}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-4">
        <div className="stat-card">
          <span className="stat-label">Findings</span>
          <span className="stat-value">{analysis.findings_count}</span>
          <span className="stat-sub">After review consolidation</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Files analyzed</span>
          <span className="stat-value">{formatNumber(analysis.files_analyzed)}</span>
          <span className="stat-sub">{formatNumber(analysis.loc_analyzed)} lines</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Duration</span>
          <span className="stat-value" style={{ fontSize: 22 }}>
            {formatDuration(analysis.duration_ms)}
          </span>
          <span className="stat-sub">
            {analysis.engine === "llm" ? "Claude API" : "Local analyzers"}
          </span>
        </div>
        <div className="stat-card" style={{ alignItems: "center", flexDirection: "row", gap: 14 }}>
          <HealthRing score={report?.health_score ?? null} size={62} stroke={6} showLabel={false} />
          <div>
            <div className="stat-label">Health score</div>
            <div className="stat-sub">
              {report ? "Set by the Review Agent" : "Awaiting report"}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Agent output</h2>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Status</th>
                <th>Input</th>
                <th>Output</th>
                <th>Findings</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stage) => (
                <tr key={stage.id}>
                  <td style={{ fontWeight: 600, minWidth: 170 }}>{stage.label}</td>
                  <td>
                    <AnalysisStatusBadge status={stage.status} />
                  </td>
                  <td className="text-muted text-xs" style={{ maxWidth: 230 }}>
                    {stage.input_summary || "—"}
                  </td>
                  <td className="text-muted text-xs" style={{ maxWidth: 330 }}>
                    {stage.error_message ? (
                      <span style={{ color: "var(--critical)" }}>{stage.error_message}</span>
                    ) : (
                      stage.output_summary || "—"
                    )}
                  </td>
                  <td>{stage.findings_count || "—"}</td>
                  <td className="text-muted">{formatDuration(stage.duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Findings from this run</h2>
          <span className="text-xs text-subtle card-header-action">
            {findings.length} after consolidation
          </span>
        </div>

        {findings.length === 0 ? (
          <EmptyState
            icon={active ? <Icon.Runs size={22} /> : <Icon.Check size={22} />}
            title={active ? "Analysis in progress" : "No findings"}
            message={
              active
                ? "Findings appear here as soon as the Review Agent finishes consolidating them."
                : "The agents did not raise anything above the reporting threshold for this run."
            }
          />
        ) : (
          findings.map((finding) => (
            <InsightRow
              key={finding.id}
              finding={finding}
              showRepository={false}
              onClick={() => navigate(`/insights/${finding.id}`)}
            />
          ))
        )}
      </div>

      <div className="card card-pad">
        <h3 className="section-title">Run metadata</h3>
        <div className="grid grid-3" style={{ gap: 10 }}>
          <div className="meta-row">
            <span className="meta-key">Created</span>
            <span className="meta-val">{formatDateTime(analysis.created_at)}</span>
          </div>
          <div className="meta-row">
            <span className="meta-key">Started</span>
            <span className="meta-val">{formatDateTime(analysis.started_at)}</span>
          </div>
          <div className="meta-row">
            <span className="meta-key">Completed</span>
            <span className="meta-val">{formatDateTime(analysis.completed_at)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
