import { formatDuration } from "../lib/format";
import type { AgentRun } from "../lib/types";
import { Icon } from "./ui";

const FALLBACK_STAGES = [
  { agent_type: "preparation", label: "Repository Preparation" },
  { agent_type: "code_analysis", label: "Code Analysis Agent" },
  { agent_type: "security", label: "Security Agent" },
  { agent_type: "review", label: "Review / Developer Intelligence Agent" },
  { agent_type: "report", label: "Final Report" },
];

function StageDot({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span className="stage-dot completed">
        <Icon.Check size={10} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="stage-dot failed">
        <Icon.Close size={10} />
      </span>
    );
  }
  if (status === "running") return <span className="stage-dot running" />;
  return <span className="stage-dot" />;
}

export default function Pipeline({
  stages,
  compact = false,
}: {
  stages?: AgentRun[];
  compact?: boolean;
}) {
  const rows =
    stages && stages.length > 0
      ? stages
      : (FALLBACK_STAGES.map((stage, index) => ({
          ...stage,
          id: stage.agent_type,
          order_index: index,
          status: "pending",
          input_summary: null,
          output_summary: null,
          error_message: null,
          findings_count: 0,
          duration_ms: null,
          started_at: null,
          completed_at: null,
          analysis_id: "",
        })) as unknown as AgentRun[]);

  return (
    <div className="pipeline">
      {rows.map((stage) => (
        <div key={stage.id || stage.agent_type} className={`pipeline-stage ${stage.status}`}>
          <div className="pipeline-stage-head">
            <StageDot status={stage.status} />
            <span className="pipeline-stage-name">{stage.label}</span>
          </div>

          {!compact && (
            <>
              {stage.status === "completed" && stage.output_summary && (
                <span className="pipeline-stage-meta">{stage.output_summary}</span>
              )}
              {stage.status === "running" && (
                <span className="pipeline-stage-meta">
                  {stage.input_summary || "Working…"}
                </span>
              )}
              {stage.status === "failed" && (
                <span className="pipeline-stage-meta" style={{ color: "var(--critical)" }}>
                  {stage.error_message || "Failed"}
                </span>
              )}
              {stage.status === "skipped" && (
                <span className="pipeline-stage-meta">{stage.output_summary || "Skipped"}</span>
              )}
              {stage.status === "pending" && (
                <span className="pipeline-stage-meta">Waiting…</span>
              )}
            </>
          )}

          {compact && stage.duration_ms !== null && stage.duration_ms !== undefined && (
            <span className="pipeline-stage-meta">{formatDuration(stage.duration_ms)}</span>
          )}
        </div>
      ))}
    </div>
  );
}
