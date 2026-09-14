import { useState } from "react";

import { useApp } from "../context/AppContext";
import { api, ApiError } from "../lib/api";
import type { Feedback, Finding } from "../lib/types";
import { Icon, Modal } from "./ui";

interface Props {
  finding: Finding;
  onClose: () => void;
  onSubmitted: (finding: Finding, feedback: Feedback) => void;
}

const EXAMPLE =
  "This is a real issue, but I think the severity is too high because this endpoint is only accessible internally.";

export default function FeedbackDialog({ finding, onClose, onSubmitted }: Props) {
  const { notify } = useApp();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      setError("Add a little more detail so the Review Agent has something to work with.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<{ feedback: Feedback; finding: Finding }>(
        `/api/findings/${finding.id}/feedback`,
        { text: trimmed }
      );
      onSubmitted(result.finding, result.feedback);
      notify("Feedback sent to the Review Agent", "success");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save feedback.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Add feedback"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={submitting || text.trim().length < 3}
          >
            {submitting ? <span className="spinner" /> : <Icon.Message size={14} />}
            Send to Review Agent
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "contents" }}>
        <div
          className="row"
          style={{
            gap: 10,
            padding: "10px 12px",
            background: "var(--surface-2)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
          }}
        >
          <span
            className="badge-dot"
            style={{ background: `var(--${finding.severity})`, flexShrink: 0, marginBlockStart: 5 }}
          />
          <div style={{ minWidth: 0 }}>
            <div className="truncate" style={{ fontWeight: 600, fontSize: 13 }}>
              {finding.title}
            </div>
            <div className="text-xs text-subtle truncate">
              {finding.file_path}
              {finding.line_number ? `:${finding.line_number}` : ""}
            </div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="feedback-text">Your feedback</label>
          <textarea
            id="feedback-text"
            className="textarea"
            style={{ minHeight: 110 }}
            placeholder={EXAMPLE}
            value={text}
            onChange={(event) => setText(event.target.value)}
            autoFocus
          />
          <span className="field-hint">
            This is sent to the Review / Developer Intelligence Agent as high-priority
            context. It can validate, adjust the severity, or leave the finding unchanged —
            you'll see its reasoning right after you submit.
          </span>
        </div>

        {error && <div className="error-text">{error}</div>}
      </form>
    </Modal>
  );
}
