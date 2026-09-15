import { useMemo, useState } from "react";

import { useApp } from "../context/AppContext";
import {
  draftFromFinding,
  draftFromReport,
  isLinkedInConnected,
} from "../lib/linkedin";
import type { Finding, Report } from "../lib/types";
import { Icon, Modal } from "./ui";

type Props =
  | { sourceType: "finding"; source: Finding; onClose: () => void }
  | { sourceType: "report"; source: Report; onClose: () => void };

export default function LinkedInShareModal({ sourceType, source, onClose }: Props) {
  const { notify } = useApp();
  const connected = isLinkedInConnected();

  const initialDraft = useMemo(
    () =>
      sourceType === "finding"
        ? draftFromFinding(source as Finding)
        : draftFromReport(source as Report),
    [sourceType, source]
  );

  const [draft, setDraft] = useState(initialDraft);
  const [published, setPublished] = useState(false);

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draft);
      notify("Draft copied to clipboard", "success");
    } catch {
      notify("Could not copy — select and copy the text manually.", "error");
    }
  }

  function approve() {
    // No real LinkedIn API is connected in this environment — this is a
    // clearly-labeled demo action, never a real publish.
    setPublished(true);
    notify(
      connected
        ? "Marked as published (demo) — no real LinkedIn API is connected."
        : "Draft approved. Connect LinkedIn in Settings to simulate publishing.",
      "success"
    );
  }

  return (
    <Modal
      title="Share to LinkedIn"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn" onClick={copyDraft}>
            <Icon.External size={13} /> Copy draft
          </button>
          <button className="btn btn-primary" onClick={approve} disabled={published}>
            {published ? <Icon.Check size={14} /> : <Icon.Check size={14} />}
            {published ? "Approved" : "Approve & Publish"}
          </button>
        </>
      }
    >
      <div
        className="row"
        style={{
          gap: 10,
          padding: "10px 12px",
          background: "var(--surface-2)",
          borderRadius: "var(--radius-sm)",
          border: "1px dashed var(--border-strong)",
          marginBlockEnd: 14,
        }}
      >
        <Icon.Shield size={16} className="text-subtle" />
        <span className="text-xs text-muted">
          <strong>Demo mode</strong> — no real LinkedIn account is connected in this
          environment, so nothing is ever actually posted to LinkedIn. This generates a
          real, editable draft from this {sourceType}'s actual DevIntel data, which you can
          review, edit, and copy to post yourself.
          {!connected && " Connect LinkedIn (demo) in Settings to also simulate the publish step."}
        </span>
      </div>

      <div className="field">
        <label htmlFor="linkedin-draft">
          Generated post{" "}
          <span className="text-xs text-subtle">
            — from real {sourceType === "finding" ? "finding" : "report"} data, editable before sharing
          </span>
        </label>
        <textarea
          id="linkedin-draft"
          className="textarea"
          style={{ minHeight: 260, fontFamily: "inherit" }}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setPublished(false);
          }}
        />
        <span className="field-hint">{draft.length} characters</span>
      </div>

      {published && (
        <div
          className="row"
          style={{
            gap: 8,
            padding: "10px 12px",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent-border)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <Icon.Check size={15} />
          <span className="text-sm">
            {connected
              ? "Approved and marked as published (demo) — copy the text above to post it on the real LinkedIn."
              : "Approved as a draft — connect LinkedIn (demo) in Settings, or copy this text to post manually."}
          </span>
        </div>
      )}
    </Modal>
  );
}
