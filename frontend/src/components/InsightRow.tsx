import { useEffect, useState } from "react";

import { relativeTime } from "../lib/format";
import type { Feedback, Finding } from "../lib/types";
import FeedbackDialog from "./FeedbackDialog";
import { AgentBadge, ConfidenceMeter, Icon, SeverityBadge, StatusBadge } from "./ui";

export default function InsightRow({
  finding,
  onClick,
  showRepository = true,
  onFeedbackSubmitted,
}: {
  finding: Finding;
  onClick: () => void;
  showRepository?: boolean;
  onFeedbackSubmitted?: (finding: Finding, feedback: Feedback) => void;
}) {
  const [current, setCurrent] = useState(finding);
  const [showFeedback, setShowFeedback] = useState(false);

  useEffect(() => {
    setCurrent(finding);
  }, [finding]);

  return (
    <div className="insight-row" style={{ cursor: "default" }}>
      <button
        className="insight-sev-bar"
        style={{ background: `var(--${current.severity})`, border: "none", padding: 0, cursor: "pointer" }}
        onClick={onClick}
        aria-label="Open insight"
      />

      <button
        className="insight-main"
        onClick={onClick}
        style={{ background: "none", border: "none", padding: 0, textAlign: "start", cursor: "pointer" }}
      >
        <span className="insight-title">{current.title}</span>
        <span className="insight-desc">{current.description}</span>

        <span className="insight-meta">
          <SeverityBadge severity={current.severity} />
          <span className="badge badge-neutral">{current.category}</span>
          <AgentBadge agentType={current.agent_type} />
          <StatusBadge status={current.status} />
          {current.feedback_count > 0 && (
            <span className="badge badge-accent" title="Has developer feedback">
              <Icon.Message size={11} /> {current.feedback_count}
            </span>
          )}
          {current.file_path && (
            <span className="insight-location">
              {current.file_path}
              {current.line_number ? `:${current.line_number}` : ""}
            </span>
          )}
          {showRepository && current.repository_name && (
            <span className="text-subtle">· {current.repository_name}</span>
          )}
          <span className="text-subtle">· {relativeTime(current.created_at)}</span>
        </span>
      </button>

      <span
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <ConfidenceMeter value={current.confidence} />
        {current.corroborated_by && (
          <span className="badge badge-success" title="Both agents reported this">
            Corroborated
          </span>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={(event) => {
            event.stopPropagation();
            setShowFeedback(true);
          }}
        >
          <Icon.Message size={12} /> Add feedback
        </button>
      </span>

      {showFeedback && (
        <FeedbackDialog
          finding={current}
          onClose={() => setShowFeedback(false)}
          onSubmitted={(updatedFinding, feedback) => {
            setCurrent(updatedFinding);
            setShowFeedback(false);
            onFeedbackSubmitted?.(updatedFinding, feedback);
          }}
        />
      )}
    </div>
  );
}
