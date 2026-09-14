import { useState } from "react";

import { useApp } from "../context/AppContext";
import { api, ApiError } from "../lib/api";
import type { Analysis, Repository } from "../lib/types";
import { Icon, Modal } from "./ui";

interface Props {
  onClose: () => void;
  onCreated: (repositoryId: string, analysisId: string | null) => void;
}

export default function AddRepositoryModal({ onClose, onCreated }: Props) {
  const { notify } = useApp();
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [runNow, setRunNow] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const repository = await api.post<Repository>("/api/repositories", {
        github_url: url.trim(),
        branch: branch.trim() || null,
      });

      let analysisId: string | null = null;
      if (runNow) {
        const analysis = await api.post<Analysis>(
          `/api/repositories/${repository.id}/analyze`
        );
        analysisId = analysis.id;
        notify(`Analysis started for ${repository.name}`, "success");
      } else {
        notify(`${repository.name} added to your workspace`, "success");
      }

      onCreated(repository.id, analysisId);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Could not add this repository.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Analyze a GitHub repository"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !url.trim()}
          >
            {submitting ? (
              <>
                <span className="spinner" /> Working…
              </>
            ) : (
              <>
                <Icon.Play size={14} /> {runNow ? "Add and analyze" : "Add repository"}
              </>
            )}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "contents" }}>
        <div className="field">
          <label htmlFor="repo-url">GitHub repository URL</label>
          <input
            id="repo-url"
            className="input"
            placeholder="https://github.com/owner/repository"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            autoFocus
            dir="ltr"
          />
          <span className="field-hint">
            Public repositories only. The repository is cloned, analyzed, and the clone is
            deleted straight after.
          </span>
        </div>

        <div className="field">
          <label htmlFor="repo-branch">Branch (optional)</label>
          <input
            id="repo-branch"
            className="input"
            placeholder="Defaults to the repository's default branch"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            dir="ltr"
          />
        </div>

        <label className="row" style={{ cursor: "pointer", gap: 11 }}>
          <button
            type="button"
            className={`switch ${runNow ? "on" : ""}`}
            onClick={() => setRunNow((value) => !value)}
            aria-pressed={runNow}
            aria-label="Start analysis immediately"
          />
          <span>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Start analysis immediately</span>
            <span className="field-hint" style={{ display: "block" }}>
              Runs the full agent pipeline as soon as the repository is added.
            </span>
          </span>
        </label>

        {error && (
          <div className="toast error" style={{ boxShadow: "none" }}>
            <Icon.Alert size={16} />
            <span>{error}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}
