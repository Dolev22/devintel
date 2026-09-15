import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import CodeViewer from "../components/CodeViewer";
import FeedbackDialog from "../components/FeedbackDialog";
import LinkedInShareModal from "../components/LinkedInShareModal";
import {
  AgentBadge,
  ConfidenceMeter,
  DomainBadge,
  ErrorState,
  Icon,
  LoadingState,
  SeverityBadge,
  StatusBadge,
} from "../components/ui";
import { useApp } from "../context/AppContext";
import { api, ApiError } from "../lib/api";
import { AGENT_LABEL, formatDateTime, relativeTime, severityColor } from "../lib/format";
import type { Feedback, Finding, FindingDetailResponse, FindingStatus } from "../lib/types";

const STATUS_ACTIONS: { status: FindingStatus; label: string; tone?: string }[] = [
  { status: "resolved", label: "Mark as resolved" },
  { status: "false_positive", label: "False positive" },
  { status: "review_later", label: "Review later" },
];

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="meta-row">
      <span className="meta-key">{label}</span>
      <span className="meta-val">{children}</span>
    </div>
  );
}

export default function InsightDetail() {
  const { findingId } = useParams();
  const navigate = useNavigate();
  const { notify } = useApp();

  const [data, setData] = useState<FindingDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showLinkedIn, setShowLinkedIn] = useState(false);

  const load = useCallback(async () => {
    if (!findingId) return;
    setLoading(true);
    try {
      setError(null);
      const result = await api.get<FindingDetailResponse>(`/api/findings/${findingId}`);
      setData(result);
      setNote(result.finding.status_note || "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this insight.");
    } finally {
      setLoading(false);
    }
  }, [findingId]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(status: FindingStatus) {
    if (!data) return;
    setSaving(true);
    try {
      const updated = await api.patch<Finding>(`/api/findings/${data.finding.id}/status`, {
        status,
        note: note.trim() || null,
      });
      setData({ ...data, finding: updated });
      notify(
        status === "resolved"
          ? "Marked as resolved"
          : status === "false_positive"
            ? "Marked as false positive"
            : status === "review_later"
              ? "Saved for later review"
              : "Reopened",
        "success"
      );
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not update status.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading insight…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const { finding, code, related_code, related_findings, same_file_findings, analysis } = data;

  return (
    <div className="stack">
      <Link to="/insights" className="back-link">
        <Icon.Back /> All developer insights
      </Link>

      <div className="card">
        <div
          style={{
            padding: 20,
            borderInlineStart: `4px solid ${severityColor(finding.severity)}`,
            borderStartStartRadius: "var(--radius)",
            borderEndStartRadius: "var(--radius)",
          }}
        >
          <div className="row row-wrap" style={{ gap: 8, marginBlockEnd: 10 }}>
            <SeverityBadge severity={finding.severity} />
            <span className="badge badge-neutral">{finding.category}</span>
            <DomainBadge domain={finding.domain} />
            <AgentBadge agentType={finding.agent_type} />
            <StatusBadge status={finding.status} />
            {finding.corroborated_by && (
              <span className="badge badge-success">
                <Icon.Check size={11} /> Corroborated by both agents
              </span>
            )}
            {finding.review_priority && (
              <span className="badge badge-accent">Priority #{finding.review_priority}</span>
            )}
          </div>

          <h2 style={{ margin: "0 0 8px", fontSize: 20, letterSpacing: "-0.02em" }}>
            {finding.title}
          </h2>
          <p className="text-muted" style={{ margin: 0, fontSize: 14 }}>
            {finding.description}
          </p>

          <div className="row row-wrap" style={{ gap: 10, marginBlockStart: 14 }}>
            {finding.file_path && (
              <span className="insight-location">
                {finding.file_path}
                {finding.line_number ? `:${finding.line_number}` : ""}
              </span>
            )}
            {finding.file_path && (
              <button
                className="btn btn-sm"
                onClick={() =>
                  navigate(
                    `/repositories/${finding.repository_id}/review?file=${code?.file_id || ""}&finding=${finding.id}`
                  )
                }
              >
                <Icon.Code size={13} /> Open in code review
              </button>
            )}
            <button className="btn btn-sm" onClick={() => setShowLinkedIn(true)}>
              <Icon.External size={13} /> Share to LinkedIn
            </button>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack">
          {code && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <CodeViewer
                code={code.content}
                language={code.language}
                path={code.path}
                findings={[finding]}
                focusLine={finding.line_number}
                showAnnotations={false}
                maxHeight={430}
                headerRight={
                  <span className="text-xs text-subtle">
                    Line {finding.line_number} flagged
                  </span>
                }
              />
            </div>
          )}

          <div className="card">
            {finding.explanation && (
              <div className="detail-block">
                <h4>What the code is doing</h4>
                <p>{finding.explanation}</p>
              </div>
            )}

            {finding.why_it_matters && (
              <div className="detail-block">
                <h4>Why it matters</h4>
                <p>{finding.why_it_matters}</p>
              </div>
            )}

            <div className="detail-block">
              <h4>Recommendation</h4>
              <p>{finding.recommendation}</p>
            </div>

            {finding.suggested_fix && (
              <div className="detail-block">
                <h4>Suggested fix</h4>
                <div className="fix-block">
                  <pre>{finding.suggested_fix}</pre>
                </div>
              </div>
            )}

            {finding.review_verdict && (
              <div className="detail-block">
                <h4>Review / Developer Intelligence Agent</h4>
                <p>{finding.review_verdict}</p>
                {(finding.original_severity &&
                  finding.original_severity !== finding.severity) ||
                (finding.original_confidence &&
                  finding.original_confidence !== finding.confidence) ? (
                  <div className="row row-wrap text-xs text-subtle" style={{ gap: 14 }}>
                    {finding.original_severity !== finding.severity && (
                      <span>
                        Severity adjusted: {finding.original_severity} → {finding.severity}
                      </span>
                    )}
                    {finding.original_confidence !== finding.confidence && (
                      <span>
                        Confidence adjusted: {Math.round((finding.original_confidence || 0) * 100)}%
                        → {Math.round(finding.confidence * 100)}%
                      </span>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="row" style={{ gap: 6 }}>
                <Icon.Message size={14} />
                Developer feedback
              </h3>
              {finding.feedback_count > 0 && (
                <span className="badge badge-neutral card-header-action">
                  {finding.feedback_count} entr{finding.feedback_count === 1 ? "y" : "ies"}
                </span>
              )}
            </div>

            <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
              {(!finding.feedback || finding.feedback.length === 0) ? (
                <p className="text-sm text-muted" style={{ margin: 0 }}>
                  No feedback yet. If you know something about this code the agents
                  don't — like restricted access, or a mitigation elsewhere — tell the
                  Review Agent and it will re-evaluate this finding.
                </p>
              ) : (
                <>
                  <div className="detail-block" style={{ padding: 0, border: "none" }}>
                    <h4>AI finding (original assessment)</h4>
                    <div className="row row-wrap" style={{ gap: 8 }}>
                      <SeverityBadge severity={finding.pre_feedback_severity || finding.severity} />
                      <span className="text-xs text-subtle">
                        {finding.title} · confidence{" "}
                        {Math.round(
                          (finding.pre_feedback_confidence ?? finding.confidence) * 100
                        )}
                        %
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {finding.feedback.map((entry: Feedback) => (
                      <div
                        key={entry.id}
                        style={{
                          background: "var(--surface-2)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          padding: "11px 13px",
                        }}
                      >
                        <div className="row" style={{ gap: 7, marginBlockEnd: 6 }}>
                          <span className="badge badge-accent">
                            <Icon.User size={11} /> User feedback
                          </span>
                          <span className="text-xs text-subtle spacer">
                            {entry.author_name} · {relativeTime(entry.created_at)}
                          </span>
                        </div>
                        <p className="text-sm" style={{ margin: 0 }}>
                          {entry.text}
                        </p>
                      </div>
                    ))}
                  </div>

                  {finding.feedback_verdict && (
                    <div
                      style={{
                        background: "var(--accent-soft)",
                        border: "1px solid var(--accent-border)",
                        borderRadius: "var(--radius-sm)",
                        padding: "11px 13px",
                      }}
                    >
                      <div className="row" style={{ gap: 7, marginBlockEnd: 6 }}>
                        <span className="badge badge-accent">
                          <Icon.Insight size={11} /> Review / Developer Intelligence Agent
                        </span>
                        {finding.feedback_considered_at && (
                          <span className="text-xs text-subtle spacer">
                            {relativeTime(finding.feedback_considered_at)}
                          </span>
                        )}
                      </div>
                      <p className="text-sm" style={{ margin: 0 }}>
                        {finding.feedback_verdict}
                      </p>
                      {finding.pre_feedback_severity &&
                        finding.pre_feedback_severity !== finding.severity && (
                          <div
                            className="row text-xs"
                            style={{ gap: 6, marginBlockStart: 8, color: "var(--text-muted)" }}
                          >
                            <SeverityBadge severity={finding.pre_feedback_severity} />
                            <Icon.Chevron size={12} />
                            <SeverityBadge severity={finding.severity} />
                            <span className="text-subtle">severity updated from feedback</span>
                          </div>
                        )}
                    </div>
                  )}
                </>
              )}

              <div>
                <button className="btn btn-sm" onClick={() => setShowFeedback(true)}>
                  <Icon.Message size={13} /> Add feedback
                </button>
              </div>
            </div>
          </div>

          {related_code && finding.related_file_path && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="card-header">
                <h3>Duplicate location</h3>
                <span className="text-xs text-subtle card-header-action">
                  The second copy of this logic
                </span>
              </div>
              <CodeViewer
                code={related_code.content}
                language={related_code.language}
                path={related_code.path}
                findings={[]}
                focusLine={finding.related_line_number}
                showAnnotations={false}
                maxHeight={320}
              />
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card card-pad">
            <h3 className="section-title">Status</h3>
            <div className="status-actions" style={{ marginBlockEnd: 12 }}>
              {STATUS_ACTIONS.map((action) => (
                <button
                  key={action.status}
                  className={`btn btn-sm ${
                    finding.status === action.status ? "btn-primary" : ""
                  }`}
                  disabled={saving || finding.status === action.status}
                  onClick={() => changeStatus(action.status)}
                >
                  {action.label}
                </button>
              ))}
              {finding.status !== "open" && (
                <button
                  className="btn btn-sm"
                  disabled={saving}
                  onClick={() => changeStatus("open")}
                >
                  Reopen
                </button>
              )}
            </div>

            <div className="field">
              <label htmlFor="note">Note (optional)</label>
              <textarea
                id="note"
                className="textarea"
                style={{ minHeight: 62 }}
                placeholder="Why are you resolving or dismissing this?"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>

            {finding.status_changed_at && (
              <p className="text-xs text-subtle" style={{ marginBlockEnd: 0 }}>
                Status last changed {formatDateTime(finding.status_changed_at)}
                {finding.status_note ? ` — “${finding.status_note}”` : ""}
              </p>
            )}
          </div>

          <div className="card card-pad">
            <h3 className="section-title">Details</h3>
            <div className="meta-list">
              <MetaRow label="Repository">
                <Link to={`/repositories/${finding.repository_id}`}>
                  {finding.repository_name}
                </Link>
              </MetaRow>
              <MetaRow label="File">
                <span className="mono truncate" style={{ display: "inline-block", maxWidth: 170 }}>
                  {finding.file_path || "—"}
                </span>
              </MetaRow>
              <MetaRow label="Line">{finding.line_number ?? "—"}</MetaRow>
              <MetaRow label="Category">{finding.category}</MetaRow>
              <MetaRow label="Domain">{finding.domain}</MetaRow>
              <MetaRow label="Detected by">{AGENT_LABEL[finding.agent_type]}</MetaRow>
              <MetaRow label="Rule">
                <span className="mono">{finding.rule_id || "—"}</span>
              </MetaRow>
              <MetaRow label="Confidence">
                <ConfidenceMeter value={finding.confidence} />
              </MetaRow>
              {finding.merged_count > 1 && (
                <MetaRow label="Merged">{finding.merged_count} duplicate reports</MetaRow>
              )}
              <MetaRow label="Detected">{formatDateTime(finding.created_at)}</MetaRow>
              {analysis && (
                <MetaRow label="Analysis">
                  <Link to={`/runs/${analysis.id}`}>View run</Link>
                </MetaRow>
              )}
            </div>
          </div>

          {related_findings.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3>Related findings</h3>
                <span className="text-xs text-subtle card-header-action">
                  Same category
                </span>
              </div>
              {related_findings.map((item) => (
                <button
                  key={item.id}
                  className="file-tree-item"
                  onClick={() => navigate(`/insights/${item.id}`)}
                  style={{ alignItems: "flex-start", gap: 9, padding: "10px 14px" }}
                >
                  <span
                    className="badge-dot"
                    style={{
                      background: severityColor(item.severity),
                      marginBlockStart: 6,
                      display: "inline-block",
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0, textAlign: "start" }}>
                    <span
                      className="truncate"
                      style={{ display: "block", fontSize: 12.5, color: "var(--text)" }}
                    >
                      {item.title}
                    </span>
                    <span className="text-xs text-subtle mono truncate" style={{ display: "block" }}>
                      {item.file_path}:{item.line_number}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {same_file_findings.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3>Others in this file</h3>
              </div>
              {same_file_findings.map((item) => (
                <button
                  key={item.id}
                  className="file-tree-item"
                  onClick={() => navigate(`/insights/${item.id}`)}
                  style={{ gap: 9, padding: "10px 14px" }}
                >
                  <span
                    className="badge-dot"
                    style={{ background: severityColor(item.severity), display: "inline-block" }}
                  />
                  <span className="text-xs mono">L{item.line_number}</span>
                  <span className="truncate" style={{ flex: 1, fontSize: 12.5, textAlign: "start" }}>
                    {item.title}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {showFeedback && (
        <FeedbackDialog
          finding={finding}
          onClose={() => setShowFeedback(false)}
          onSubmitted={(updatedFinding) => {
            setData({ ...data, finding: updatedFinding });
            setShowFeedback(false);
          }}
        />
      )}

      {showLinkedIn && (
        <LinkedInShareModal
          sourceType="finding"
          source={finding}
          onClose={() => setShowLinkedIn(false)}
        />
      )}
    </div>
  );
}
