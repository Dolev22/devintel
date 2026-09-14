import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import AddRepositoryModal from "../components/AddRepositoryModal";
import {
  AnalysisStatusBadge,
  EmptyState,
  ErrorState,
  HealthPill,
  Icon,
  SkeletonRows,
} from "../components/ui";
import { useApp } from "../context/AppContext";
import { api, ApiError } from "../lib/api";
import { formatNumber, healthColor, relativeTime } from "../lib/format";
import type { Analysis, Repository } from "../lib/types";

export default function Repositories() {
  const navigate = useNavigate();
  const { notify } = useApp();

  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [showAdd, setShowAdd] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setRepositories(await api.get<Repository[]>("/api/repositories"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load repositories.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const anyRunning = repositories.some((repo) =>
    ["pending", "running", "reviewing"].includes(repo.latest_analysis_status || "")
  );

  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [anyRunning, load]);

  async function runAnalysis(repository: Repository) {
    setStartingId(repository.id);
    try {
      const analysis = await api.post<Analysis>(`/api/repositories/${repository.id}/analyze`);
      notify(`Analysis started for ${repository.name}`, "success");
      navigate(`/runs/${analysis.id}`);
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Could not start the analysis.",
        "error"
      );
    } finally {
      setStartingId(null);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <SkeletonRows count={4} height={120} />
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="stack">
      <div className="row row-wrap">
        <div className="tab-switch" style={{ width: 180 }}>
          <button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}>
            Cards
          </button>
          <button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>
            Table
          </button>
        </div>
        <span className="text-sm text-muted">
          {repositories.length} repositor{repositories.length === 1 ? "y" : "ies"}
        </span>
        <button className="btn btn-primary spacer" onClick={() => setShowAdd(true)}>
          <Icon.Plus size={15} /> Add repository
        </button>
      </div>

      {repositories.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon.Repo size={22} />}
            title="No repositories yet"
            message="Connect a public GitHub repository to run the multi-agent analysis."
            action={
              <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                <Icon.Plus size={15} /> Add repository
              </button>
            }
          />
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-auto">
          {repositories.map((repo) => {
            const running = ["pending", "running", "reviewing"].includes(
              repo.latest_analysis_status || ""
            );
            return (
              <div key={repo.id} className="repo-card">
                <div
                  className="repo-card-head"
                  onClick={() => navigate(`/repositories/${repo.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  <span className="repo-icon">
                    <Icon.Repo size={18} />
                  </span>
                  <span className="repo-card-title">
                    <strong>{repo.name}</strong>
                    <span>
                      {repo.owner ? `${repo.owner} · ` : ""}
                      {repo.language || "Unknown"} · {repo.branch || "default branch"}
                    </span>
                  </span>
                  {repo.health_score !== null && (
                    <span
                      style={{
                        fontSize: 19,
                        fontWeight: 700,
                        color: healthColor(repo.health_score),
                      }}
                    >
                      {repo.health_score}
                    </span>
                  )}
                </div>

                <p className="repo-card-desc">
                  {repo.description || "No description provided for this repository."}
                </p>

                <div className="row row-wrap" style={{ gap: 6 }}>
                  <HealthPill score={repo.health_score} />
                  {repo.is_demo && <span className="badge badge-neutral">Sample</span>}
                  {running && <AnalysisStatusBadge status={repo.latest_analysis_status!} />}
                </div>

                <div className="repo-stats">
                  <span className="repo-stat">
                    <span className="repo-stat-value">{repo.open_findings ?? 0}</span>
                    <span className="repo-stat-label">Open</span>
                  </span>
                  <span className="repo-stat">
                    <span
                      className="repo-stat-value"
                      style={{
                        color: repo.critical_findings ? "var(--critical)" : undefined,
                      }}
                    >
                      {repo.critical_findings ?? 0}
                    </span>
                    <span className="repo-stat-label">Critical</span>
                  </span>
                  <span className="repo-stat">
                    <span className="repo-stat-value">{repo.analysis_count ?? 0}</span>
                    <span className="repo-stat-label">Runs</span>
                  </span>
                  <span className="repo-stat" style={{ marginInlineStart: "auto" }}>
                    <span className="repo-stat-label">Last analysis</span>
                    <span className="text-xs text-muted">
                      {relativeTime(repo.last_analyzed_at)}
                    </span>
                  </span>
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={running || startingId === repo.id}
                    onClick={() => runAnalysis(repo)}
                  >
                    {startingId === repo.id || running ? (
                      <>
                        <span className="spinner" /> Running
                      </>
                    ) : (
                      <>
                        <Icon.Play size={13} /> Run analysis
                      </>
                    )}
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => navigate(`/repositories/${repo.id}`)}
                  >
                    Details
                  </button>
                  {(repo.total_findings ?? 0) > 0 && (
                    <button
                      className="btn btn-sm"
                      onClick={() => navigate(`/repositories/${repo.id}/review`)}
                    >
                      <Icon.Code size={13} /> Code review
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Language</th>
                <th>Health</th>
                <th>Open</th>
                <th>Critical</th>
                <th>Last analysis</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {repositories.map((repo) => (
                <tr
                  key={repo.id}
                  className="clickable"
                  onClick={() => navigate(`/repositories/${repo.id}`)}
                >
                  <td>
                    <div style={{ fontWeight: 600 }}>{repo.name}</div>
                    <div className="text-xs text-subtle mono">{repo.github_url}</div>
                  </td>
                  <td>{repo.language || "—"}</td>
                  <td>
                    {repo.health_score === null ? (
                      <span className="text-subtle">—</span>
                    ) : (
                      <strong style={{ color: healthColor(repo.health_score) }}>
                        {repo.health_score}
                      </strong>
                    )}
                  </td>
                  <td>{formatNumber(repo.open_findings ?? 0)}</td>
                  <td
                    style={{
                      color: repo.critical_findings ? "var(--critical)" : undefined,
                      fontWeight: repo.critical_findings ? 700 : 400,
                    }}
                  >
                    {repo.critical_findings ?? 0}
                  </td>
                  <td className="text-muted">{relativeTime(repo.last_analyzed_at)}</td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <button
                      className="btn btn-sm"
                      disabled={
                        startingId === repo.id ||
                        ["pending", "running", "reviewing"].includes(
                          repo.latest_analysis_status || ""
                        )
                      }
                      onClick={() => runAnalysis(repo)}
                    >
                      <Icon.Play size={12} /> Run
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddRepositoryModal
          onClose={() => setShowAdd(false)}
          onCreated={(repositoryId, analysisId) => {
            setShowAdd(false);
            load();
            if (analysisId) navigate(`/runs/${analysisId}`);
            else navigate(`/repositories/${repositoryId}`);
          }}
        />
      )}
    </div>
  );
}
