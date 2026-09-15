import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import InsightRow from "../components/InsightRow";
import LinkedInShareModal from "../components/LinkedInShareModal";
import Pipeline from "../components/Pipeline";
import {
  BarRow,
  EmptyState,
  ErrorState,
  HealthRing,
  Icon,
  LoadingState,
  SeverityBadge,
} from "../components/ui";
import { api, ApiError } from "../lib/api";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  healthLabel,
  severityColor,
} from "../lib/format";
import type { Analysis, Finding, Report } from "../lib/types";

export default function ReportDetail() {
  const { reportId } = useParams();
  const navigate = useNavigate();

  const [report, setReport] = useState<Report | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLinkedIn, setShowLinkedIn] = useState(false);

  const load = useCallback(async () => {
    if (!reportId) return;
    try {
      setError(null);
      const data = await api.get<{
        report: Report;
        findings: Finding[];
        analysis: Analysis | null;
      }>(`/api/reports/${reportId}`);
      setReport(data.report);
      setFindings(data.findings);
      setAnalysis(data.analysis);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this report.");
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingState label="Loading report…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!report) return null;

  const severities = report.severity_breakdown || {};
  const categories = Object.entries(report.category_breakdown || {});
  const categoryMax = Math.max(1, ...categories.map(([, value]) => value));
  const metadata = report.metadata || {};

  const topFindings = findings.slice(0, 5);

  return (
    <div className="stack">
      <Link to="/reports" className="back-link">
        <Icon.Back /> All reports
      </Link>

      <div className="card">
        <div className="report-hero">
          <HealthRing score={report.health_score} size={104} stroke={9} />

          <div style={{ flex: 1, minWidth: 240 }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 19, letterSpacing: "-0.02em" }}>
              {report.title}
            </h2>
            <div className="row row-wrap" style={{ gap: 8, marginBlockEnd: 10 }}>
              <span className="badge badge-accent">{healthLabel(report.health_score)}</span>
              <span className="badge badge-neutral">
                {report.total_findings} finding{report.total_findings === 1 ? "" : "s"}
              </span>
              <span className="badge badge-neutral">
                {report.engine === "llm" ? "Claude API" : "Local analyzers"}
              </span>
            </div>
            <div className="row row-wrap text-xs text-subtle" style={{ gap: 14 }}>
              <span>Generated {formatDateTime(report.created_at)}</span>
              {analysis && <span>Run duration {formatDuration(analysis.duration_ms)}</span>}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {analysis && (
              <button className="btn btn-sm" onClick={() => navigate(`/runs/${analysis.id}`)}>
                <Icon.Runs size={13} /> Analysis run
              </button>
            )}
            <button
              className="btn btn-sm"
              onClick={() => navigate(`/repositories/${report.repository_id}/review`)}
            >
              <Icon.Code size={13} /> Code review
            </button>
            <button className="btn btn-sm" onClick={() => setShowLinkedIn(true)}>
              <Icon.External size={13} /> Share to LinkedIn
            </button>
          </div>
        </div>
      </div>

      {showLinkedIn && (
        <LinkedInShareModal
          sourceType="report"
          source={report}
          onClose={() => setShowLinkedIn(false)}
        />
      )}

      <div className="card">
        <div className="card-header">
          <h2>Overall summary</h2>
        </div>
        <div style={{ padding: 20 }}>
          <p className="report-summary" style={{ margin: 0 }}>
            {report.summary}
          </p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-header">
            <h2>Findings by severity</h2>
          </div>
          <div style={{ padding: 18 }}>
            {(["critical", "high", "medium", "low"] as const).map((severity) => (
              <BarRow
                key={severity}
                label={severity.charAt(0).toUpperCase() + severity.slice(1)}
                value={severities[severity] || 0}
                max={Math.max(1, ...Object.values(severities))}
                color={severityColor(severity)}
              />
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Findings by category</h2>
          </div>
          <div style={{ padding: 18 }}>
            {categories.length === 0 ? (
              <p className="text-sm text-muted" style={{ margin: 0 }}>
                No categories recorded.
              </p>
            ) : (
              categories.map(([name, count]) => (
                <BarRow
                  key={name}
                  label={name}
                  value={count}
                  max={categoryMax}
                  color="var(--accent)"
                />
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Prioritised recommendations</h2>
          <span className="text-xs text-subtle card-header-action">
            From the Review / Developer Intelligence Agent
          </span>
        </div>
        <div style={{ padding: "6px 20px 18px" }}>
          {report.recommendations.length === 0 ? (
            <p className="text-sm text-muted">No recommendations were produced.</p>
          ) : (
            report.recommendations.map((recommendation, index) => (
              <div key={index} className="recommendation-item">
                <span className="rec-number">{index + 1}</span>
                <span>{recommendation}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Most important problems</h2>
          <span className="text-xs text-subtle card-header-action">
            Ranked by severity and confidence
          </span>
        </div>
        {topFindings.length === 0 ? (
          <EmptyState
            icon={<Icon.Check size={22} />}
            title="No issues found"
            message="This analysis produced no findings above the reporting threshold."
          />
        ) : (
          topFindings.map((finding) => (
            <InsightRow
              key={finding.id}
              finding={finding}
              showRepository={false}
              onClick={() => navigate(`/insights/${finding.id}`)}
            />
          ))
        )}
        {findings.length > topFindings.length && (
          <div style={{ padding: 14, textAlign: "center" }}>
            <button
              className="btn btn-sm"
              onClick={() => navigate(`/insights?repository=${report.repository_id}`)}
            >
              View all {findings.length} findings
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Analysis metadata</h2>
        </div>
        <div style={{ padding: 18 }}>
          {analysis?.stages && (
            <div style={{ marginBlockEnd: 18 }}>
              <Pipeline stages={analysis.stages} compact />
            </div>
          )}

          <div className="grid grid-3" style={{ gap: "2px 24px" }}>
            <div className="meta-row">
              <span className="meta-key">Files analyzed</span>
              <span className="meta-val">{formatNumber(metadata.files_analyzed)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Lines reviewed</span>
              <span className="meta-val">{formatNumber(metadata.loc_analyzed)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Files skipped</span>
              <span className="meta-val">{formatNumber(metadata.files_skipped)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Raw findings</span>
              <span className="meta-val">{formatNumber(metadata.raw_findings)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Merged duplicates</span>
              <span className="meta-val">{formatNumber(metadata.merged_findings)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Severity adjustments</span>
              <span className="meta-val">{formatNumber(metadata.adjusted_findings)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Test files found</span>
              <span className="meta-val">{formatNumber(metadata.test_files_found)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Pre-scan secret hits</span>
              <span className="meta-val">{formatNumber(metadata.prescan_secret_hits)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">README found</span>
              <span className="meta-val">{metadata.has_readme ? "Yes" : "No"}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Dependency manifest</span>
              <span className="meta-val">
                {metadata.has_dependency_manifest ? "Yes" : "No"}
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Agents succeeded</span>
              <span className="meta-val">
                {(metadata.agents_succeeded || []).length || 0} of 2
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-key">Engine</span>
              <span className="meta-val">
                {metadata.engine === "llm" ? "Claude API" : "Local analyzers"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
