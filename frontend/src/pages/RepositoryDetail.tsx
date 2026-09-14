import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import Pipeline from "../components/Pipeline";
import {
  AnalysisStatusBadge,
  EmptyState,
  ErrorState,
  HealthRing,
  Icon,
  LoadingState,
  Modal,
} from "../components/ui";
import { useApp } from "../context/AppContext";
import { api, ApiError } from "../lib/api";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  healthLabel,
  relativeTime,
} from "../lib/format";
import type { Analysis, Repository } from "../lib/types";

export default function RepositoryDetail() {
  const { repositoryId } = useParams();
  const navigate = useNavigate();
  const { notify } = useApp();

  const [repository, setRepository] = useState<Repository | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [form, setForm] = useState({ name: "", description: "", branch: "", language: "" });

  const load = useCallback(async () => {
    if (!repositoryId) return;
    try {
      setError(null);
      const data = await api.get<{ repository: Repository; analyses: Analysis[] }>(
        `/api/repositories/${repositoryId}`
      );
      setRepository(data.repository);
      setAnalyses(data.analyses);
      setForm({
        name: data.repository.name,
        description: data.repository.description || "",
        branch: data.repository.branch || "",
        language: data.repository.language || "",
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this repository.");
    } finally {
      setLoading(false);
    }
  }, [repositoryId]);

  useEffect(() => {
    load();
  }, [load]);

  const running = analyses.some((a) =>
    ["pending", "running", "reviewing"].includes(a.status)
  );

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [running, load]);

  async function runAnalysis() {
    if (!repository) return;
    setStarting(true);
    try {
      const analysis = await api.post<Analysis>(`/api/repositories/${repository.id}/analyze`);
      notify("Analysis started", "success");
      navigate(`/runs/${analysis.id}`);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not start analysis.", "error");
    } finally {
      setStarting(false);
    }
  }

  async function saveEdits() {
    if (!repository) return;
    try {
      const updated = await api.patch<Repository>(`/api/repositories/${repository.id}`, {
        name: form.name,
        description: form.description,
        branch: form.branch,
        language: form.language,
      });
      setRepository(updated);
      setEditing(false);
      notify("Repository updated", "success");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not save changes.", "error");
    }
  }

  async function deleteRepository() {
    if (!repository) return;
    try {
      await api.del(`/api/repositories/${repository.id}`);
      notify(`${repository.name} removed`, "success");
      navigate("/repositories");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not delete.", "error");
    }
  }

  if (loading) return <LoadingState label="Loading repository…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!repository) return null;

  const latestCompleted = analyses.find((a) => a.status === "completed");

  return (
    <div className="stack">
      <Link to="/repositories" className="back-link">
        <Icon.Back /> All repositories
      </Link>

      <div className="card">
        <div className="report-hero">
          <HealthRing score={repository.health_score} size={92} stroke={8} />

          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="row row-wrap" style={{ gap: 9, marginBlockEnd: 6 }}>
              <h2 style={{ margin: 0, fontSize: 19, letterSpacing: "-0.02em" }}>
                {repository.name}
              </h2>
              {repository.is_demo && <span className="badge badge-neutral">Sample</span>}
              <span className="badge badge-accent">{healthLabel(repository.health_score)}</span>
            </div>

            <p className="text-sm text-muted" style={{ margin: "0 0 10px" }}>
              {repository.description || "No description provided."}
            </p>

            <div className="row row-wrap text-xs text-subtle" style={{ gap: 14 }}>
              <span className="mono" dir="ltr">
                {repository.github_url}
              </span>
              <span>Branch: {repository.branch || "default"}</span>
              <span>{repository.language || "Unknown language"}</span>
              <span>{formatNumber(repository.file_count)} files</span>
              <span>{formatNumber(repository.loc_count)} lines</span>
              <span>Last analyzed {relativeTime(repository.last_analyzed_at)}</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button className="btn btn-primary" onClick={runAnalysis} disabled={starting || running}>
              {starting || running ? (
                <>
                  <span className="spinner" /> Analysis running
                </>
              ) : (
                <>
                  <Icon.Play size={14} /> Run analysis
                </>
              )}
            </button>
            {repository.file_count > 0 && (
              <button
                className="btn"
                onClick={() => navigate(`/repositories/${repository.id}/review`)}
              >
                <Icon.Code size={14} /> Open code review
              </button>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => setEditing(true)}>
                <Icon.Edit size={13} /> Edit
              </button>
              <button
                className="btn btn-sm btn-danger"
                style={{ flex: 1 }}
                onClick={() => setDeleting(true)}
              >
                <Icon.Trash size={13} /> Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {latestCompleted && (
        <div className="card">
          <div className="card-header">
            <h2>Latest analysis</h2>
            <AnalysisStatusBadge status={latestCompleted.status} />
            <div className="card-header-action row" style={{ gap: 8 }}>
              {latestCompleted.has_report && (
                <button
                  className="btn btn-sm"
                  onClick={() => navigate(`/reports?repository=${repository.id}`)}
                >
                  <Icon.Report size={13} /> Report
                </button>
              )}
              <button
                className="btn btn-sm"
                onClick={() => navigate(`/runs/${latestCompleted.id}`)}
              >
                Run detail
              </button>
            </div>
          </div>
          <div style={{ padding: 16 }}>
            <Pipeline stages={latestCompleted.stages} compact />
            {latestCompleted.summary && (
              <p className="text-sm text-muted" style={{ marginBlockEnd: 0, marginBlockStart: 14 }}>
                {latestCompleted.summary.split("\n")[0]}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2>Analysis history</h2>
          <span className="text-xs text-subtle card-header-action">
            {analyses.length} run{analyses.length === 1 ? "" : "s"}
          </span>
        </div>

        {analyses.length === 0 ? (
          <EmptyState
            icon={<Icon.Runs size={22} />}
            title="No analyses yet"
            message="Run the agent pipeline to produce findings and a developer report."
            action={
              <button className="btn btn-primary" onClick={runAnalysis} disabled={starting}>
                <Icon.Play size={14} /> Run first analysis
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Findings</th>
                  <th>Files</th>
                  <th>Duration</th>
                  <th>Engine</th>
                </tr>
              </thead>
              <tbody>
                {analyses.map((analysis) => (
                  <tr
                    key={analysis.id}
                    className="clickable"
                    onClick={() => navigate(`/runs/${analysis.id}`)}
                  >
                    <td>
                      <div>{formatDateTime(analysis.created_at)}</div>
                      <div className="text-xs text-subtle">
                        {relativeTime(analysis.created_at)}
                      </div>
                    </td>
                    <td>
                      <AnalysisStatusBadge status={analysis.status} />
                    </td>
                    <td>{analysis.findings_count}</td>
                    <td>{analysis.files_analyzed}</td>
                    <td className="text-muted">{formatDuration(analysis.duration_ms)}</td>
                    <td>
                      <span className="badge badge-neutral">
                        {analysis.engine === "llm" ? "Claude API" : "Local analyzers"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <Modal
          title="Edit repository"
          onClose={() => setEditing(false)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveEdits}>
                Save changes
              </button>
            </>
          }
        >
          <div className="field">
            <label>Display name</label>
            <input
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea
              className="textarea"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="What is this repository for?"
            />
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Branch</label>
              <input
                className="input"
                value={form.branch}
                onChange={(event) => setForm({ ...form, branch: event.target.value })}
                dir="ltr"
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Language</label>
              <input
                className="input"
                value={form.language}
                onChange={(event) => setForm({ ...form, language: event.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Delete repository"
          onClose={() => setDeleting(false)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleting(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={deleteRepository}>
                Delete permanently
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            Delete <strong>{repository.name}</strong> and all of its analyses, findings and
            reports? This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}
