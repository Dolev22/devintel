import { Highlight, themes } from "prism-react-renderer";
import { useEffect, useMemo, useRef, useState } from "react";

import { useApp } from "../context/AppContext";
import { languageForPrism } from "../lib/format";
import type { Feedback, Finding, FindingStatus } from "../lib/types";
import FeedbackDialog from "./FeedbackDialog";
import { AgentBadge, ConfidenceMeter, Icon, SeverityBadge, StatusBadge } from "./ui";

interface CodeViewerProps {
  code: string;
  language: string | null;
  path: string;
  findings?: Finding[];
  activeFindingId?: string | null;
  onStatusChange?: (finding: Finding, status: FindingStatus) => void;
  onOpenFinding?: (finding: Finding) => void;
  focusLine?: number | null;
  startCollapsed?: boolean;
  maxHeight?: number;
  showAnnotations?: boolean;
  headerRight?: React.ReactNode;
}

const STATUS_ACTIONS: { status: FindingStatus; label: string }[] = [
  { status: "resolved", label: "Mark as resolved" },
  { status: "false_positive", label: "False positive" },
  { status: "review_later", label: "Review later" },
];

export default function CodeViewer({
  code,
  language,
  path,
  findings = [],
  activeFindingId = null,
  onStatusChange,
  onOpenFinding,
  focusLine = null,
  startCollapsed = false,
  maxHeight,
  showAnnotations = true,
  headerRight,
}: CodeViewerProps) {
  const { theme } = useApp();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [localFindings, setLocalFindings] = useState(findings);
  const [feedbackTarget, setFeedbackTarget] = useState<Finding | null>(null);

  useEffect(() => {
    setLocalFindings(findings);
  }, [findings]);
  const focusRef = useRef<HTMLDivElement>(null);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (startCollapsed) return new Set();
    return new Set(activeFindingId ? [activeFindingId] : localFindings.map((f) => f.id));
  });

  useEffect(() => {
    if (activeFindingId) setExpanded(new Set([activeFindingId]));
  }, [activeFindingId]);

  // Index findings by the line they are anchored to.
  const findingsByLine = useMemo(() => {
    const map = new Map<number, Finding[]>();
    localFindings.forEach((finding) => {
      const line = finding.line_number ?? 1;
      const list = map.get(line) || [];
      list.push(finding);
      map.set(line, list);
    });
    return map;
  }, [localFindings]);

  // Lines inside a finding's context range get a softer highlight.
  const contextLines = useMemo(() => {
    const set = new Set<number>();
    localFindings.forEach((finding) => {
      const start = finding.code_start_line;
      const end = finding.code_end_line;
      if (!start || !end || end <= start) return;
      for (let line = start; line <= Math.min(end, start + 60); line += 1) set.add(line);
    });
    return set;
  }, [localFindings]);

  const targetLine = focusLine ?? (activeFindingId
    ? localFindings.find((f) => f.id === activeFindingId)?.line_number ?? null
    : null);

  // Annotations sit inside a `min-width: max-content` <pre>, so they need the
  // visible width of the scroll container rather than the code's full width.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const apply = () => {
      container.style.setProperty("--code-width", `${container.clientWidth}px`);
    };
    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (targetLine && focusRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const element = focusRef.current;
      const offset = element.offsetTop - container.clientHeight / 3;
      container.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
    }
  }, [targetLine, code]);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const prismLanguage = languageForPrism(language);
  const prismTheme = theme === "dark" ? themes.vsDark : themes.github;
  const trimmed = code.replace(/\n$/, "");

  return (
    <div className="code-viewer">
      <div className="code-viewer-head">
        <Icon.File size={14} className="text-subtle" />
        <span className="code-viewer-path" title={path}>
          {path}
        </span>
        {localFindings.length > 0 && (
          <span className="badge badge-neutral">
            {localFindings.length} finding{localFindings.length === 1 ? "" : "s"}
          </span>
        )}
        <div className="spacer" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {headerRight}
        </div>
      </div>

      <div className="code-scroll" ref={scrollRef} style={maxHeight ? { maxHeight } : undefined}>
        <Highlight theme={prismTheme} code={trimmed} language={prismLanguage as any}>
          {({ className, tokens, getLineProps, getTokenProps }) => (
            <pre className={`code-block ${className}`} style={{ background: "transparent" }}>
              {tokens.map((line, index) => {
                const lineNumber = index + 1;
                const lineFindings = findingsByLine.get(lineNumber) || [];
                const primary = lineFindings[0];
                const isFlagged = lineFindings.length > 0;
                const isContext = !isFlagged && contextLines.has(lineNumber);
                const isTarget = targetLine === lineNumber;

                const lineProps = getLineProps({ line });

                return (
                  <div key={lineNumber} ref={isTarget ? focusRef : undefined}>
                    <div
                      {...lineProps}
                      className={`code-line ${isFlagged ? "flagged" : ""} ${
                        isContext ? "context-highlight" : ""
                      } ${lineProps.className || ""}`}
                      style={
                        {
                          ...lineProps.style,
                          ...(isFlagged
                            ? {
                                ["--flag-color" as any]: `var(--${primary.severity})`,
                                ["--flag-soft" as any]: `var(--${primary.severity}-soft)`,
                              }
                            : {}),
                        } as React.CSSProperties
                      }
                    >
                      {isFlagged && <span className="code-marker" />}
                      <span className="code-line-number">{lineNumber}</span>
                      <span className="code-line-content">
                        {line.map((token, key) => (
                          <span key={key} {...getTokenProps({ token })} />
                        ))}
                      </span>
                    </div>

                    {showAnnotations &&
                      lineFindings.map((finding) => {
                        const isOpen = expanded.has(finding.id);
                        return (
                          <div
                            key={finding.id}
                            className="code-annotation"
                            style={{
                              borderInlineStart: `3px solid var(--${finding.severity})`,
                            }}
                          >
                            <div className="code-annotation-head">
                              <SeverityBadge severity={finding.severity} />
                              <span className="code-annotation-title">{finding.title}</span>
                              <AgentBadge agentType={finding.agent_type} />
                              <StatusBadge status={finding.status} />
                              <button
                                className="btn btn-ghost btn-sm spacer"
                                onClick={() => toggle(finding.id)}
                              >
                                {isOpen ? "Hide detail" : "Show detail"}
                                <Icon.Chevron
                                  size={13}
                                  className={isOpen ? "flip-rtl" : ""}
                                />
                              </button>
                            </div>

                            <div className="text-sm text-muted">{finding.description}</div>

                            {isOpen && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                {finding.explanation && (
                                  <div>
                                    <h4 className="section-title" style={{ marginBottom: 5 }}>
                                      What the code does
                                    </h4>
                                    <div style={{ whiteSpace: "pre-line" }}>
                                      {finding.explanation}
                                    </div>
                                  </div>
                                )}

                                {finding.why_it_matters && (
                                  <div>
                                    <h4 className="section-title" style={{ marginBottom: 5 }}>
                                      Why it matters
                                    </h4>
                                    <div>{finding.why_it_matters}</div>
                                  </div>
                                )}

                                <div>
                                  <h4 className="section-title" style={{ marginBottom: 5 }}>
                                    Recommendation
                                  </h4>
                                  <div>{finding.recommendation}</div>
                                </div>

                                {finding.suggested_fix && (
                                  <div>
                                    <h4 className="section-title" style={{ marginBottom: 5 }}>
                                      Suggested fix
                                    </h4>
                                    <div className="fix-block">
                                      <pre>{finding.suggested_fix}</pre>
                                    </div>
                                  </div>
                                )}

                                <div className="row row-wrap" style={{ gap: 14 }}>
                                  <span className="text-xs text-subtle">Confidence</span>
                                  <ConfidenceMeter value={finding.confidence} />
                                  {finding.review_verdict && (
                                    <span className="text-xs text-subtle" style={{ flex: 1 }}>
                                      {finding.review_verdict}
                                    </span>
                                  )}
                                </div>

                                {finding.feedback_count > 0 && finding.feedback_verdict && (
                                  <div
                                    style={{
                                      background: "var(--accent-soft)",
                                      border: "1px solid var(--accent-border)",
                                      borderRadius: "var(--radius-sm)",
                                      padding: "9px 11px",
                                    }}
                                  >
                                    <div className="row" style={{ gap: 6, marginBlockEnd: 4 }}>
                                      <span className="badge badge-accent">
                                        <Icon.Message size={11} /> {finding.feedback_count} feedback
                                      </span>
                                    </div>
                                    <span className="text-xs">{finding.feedback_verdict}</span>
                                  </div>
                                )}

                                <div className="status-actions">
                                  {onStatusChange &&
                                    STATUS_ACTIONS.map((action) => (
                                      <button
                                        key={action.status}
                                        className="btn btn-sm"
                                        disabled={finding.status === action.status}
                                        onClick={() => onStatusChange(finding, action.status)}
                                      >
                                        {action.label}
                                      </button>
                                    ))}
                                  {onStatusChange && finding.status !== "open" && (
                                    <button
                                      className="btn btn-sm"
                                      onClick={() => onStatusChange(finding, "open")}
                                    >
                                      Reopen
                                    </button>
                                  )}
                                  <button
                                    className="btn btn-sm"
                                    onClick={() => setFeedbackTarget(finding)}
                                  >
                                    <Icon.Message size={12} /> Add feedback
                                  </button>
                                  {onOpenFinding && (
                                    <button
                                      className="btn btn-sm btn-primary"
                                      onClick={() => onOpenFinding(finding)}
                                    >
                                      Open insight
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </pre>
          )}
        </Highlight>
      </div>

      {feedbackTarget && (
        <FeedbackDialog
          finding={feedbackTarget}
          onClose={() => setFeedbackTarget(null)}
          onSubmitted={(updatedFinding: Finding, _feedback: Feedback) => {
            setLocalFindings((current) =>
              current.map((f) => (f.id === updatedFinding.id ? updatedFinding : f))
            );
            setFeedbackTarget(null);
          }}
        />
      )}
    </div>
  );
}
