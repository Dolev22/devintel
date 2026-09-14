import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import CodeViewer from "../components/CodeViewer";
import { EmptyState, ErrorState, Icon, LoadingState, SeverityBadge } from "../components/ui";
import { useApp } from "../context/AppContext";
import { api, ApiError, buildQuery } from "../lib/api";
import { fileName, severityColor } from "../lib/format";
import type {
  Finding,
  FindingStatus,
  Repository,
  RepositoryFileDetail,
  RepositoryFileSummary,
} from "../lib/types";

export default function CodeReview() {
  const { repositoryId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { notify } = useApp();

  const analysisId = searchParams.get("analysis");
  const requestedFileId = searchParams.get("file");
  const focusFindingId = searchParams.get("finding");

  const [repository, setRepository] = useState<Repository | null>(null);
  const [files, setFiles] = useState<RepositoryFileSummary[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(requestedFileId);
  const [detail, setDetail] = useState<RepositoryFileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(true);

  const loadShell = useCallback(async () => {
    if (!repositoryId) return;
    try {
      setError(null);
      const [repoData, fileList] = await Promise.all([
        api.get<{ repository: Repository }>(`/api/repositories/${repositoryId}`),
        api.get<RepositoryFileSummary[]>(
          `/api/repositories/${repositoryId}/files${buildQuery({ analysis_id: analysisId })}`
        ),
      ]);
      setRepository(repoData.repository);
      setFiles(fileList);

      setActiveFileId((current) => {
        if (current && fileList.some((f) => f.id === current)) return current;
        const withFindings = fileList
          .filter((f) => (f.finding_counts.total || 0) > 0)
          .sort(
            (a, b) =>
              (b.finding_counts.critical || 0) - (a.finding_counts.critical || 0) ||
              (b.finding_counts.total || 0) - (a.finding_counts.total || 0)
          );
        return withFindings[0]?.id || fileList[0]?.id || null;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the code review.");
    } finally {
      setLoading(false);
    }
  }, [repositoryId, analysisId]);

  useEffect(() => {
    loadShell();
  }, [loadShell]);

  const loadFile = useCallback(async () => {
    if (!repositoryId || !activeFileId) return;
    setFileLoading(true);
    try {
      const data = await api.get<RepositoryFileDetail>(
        `/api/repositories/${repositoryId}/files/${activeFileId}${buildQuery({
          analysis_id: analysisId,
        })}`
      );
      setDetail(data);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not load that file.", "error");
    } finally {
      setFileLoading(false);
    }
  }, [repositoryId, activeFileId, analysisId, notify]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  async function changeStatus(finding: Finding, status: FindingStatus) {
    try {
      const updated = await api.patch<Finding>(`/api/findings/${finding.id}/status`, { status });
      setDetail((current) =>
        current
          ? {
              ...current,
              findings: current.findings.map((f) => (f.id === updated.id ? updated : f)),
            }
          : current
      );
      setFiles((current) =>
        current.map((file) => {
          if (file.path !== finding.file_path) return file;
          const counts = { ...file.finding_counts };
          const wasOpen = finding.status === "open";
          const isOpen = status === "open";
          if (wasOpen && !isOpen) counts.open = Math.max(0, (counts.open || 0) - 1);
          if (!wasOpen && isOpen) counts.open = (counts.open || 0) + 1;
          return { ...file, finding_counts: counts };
        })
      );
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
    }
  }

  const visibleFiles = useMemo(
    () => (onlyFlagged ? files.filter((f) => (f.finding_counts.total || 0) > 0) : files),
    [files, onlyFlagged]
  );

  const flaggedCount = files.filter((f) => (f.finding_counts.total || 0) > 0).length;

  if (loading) return <LoadingState label="Loading code review…" />;
  if (error) return <ErrorState message={error} onRetry={loadShell} />;

  if (files.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<Icon.Code size={22} />}
          title="No code has been analyzed yet"
          message="Run an analysis on this repository to fetch its source and attach findings to it."
          action={
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/repositories/${repositoryId}`)}
            >
              Go to repository
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row row-wrap">
        <Link to={`/repositories/${repositoryId}`} className="back-link" style={{ margin: 0 }}>
          <Icon.Back /> {repository?.name}
        </Link>
        <span className="text-sm text-muted">
          {flaggedCount} of {files.length} files have findings
        </span>
        <button
          className={`chip spacer ${onlyFlagged ? "active" : ""}`}
          onClick={() => setOnlyFlagged((value) => !value)}
        >
          {onlyFlagged ? "Showing flagged files" : "Showing all files"}
        </button>
      </div>

      <div className="review-layout">
        <div className="card file-tree">
          <div
            className="card-header"
            style={{ padding: "11px 12px", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}
          >
            <h3 style={{ fontSize: 12.5 }}>Files</h3>
            <span className="text-xs text-subtle card-header-action">
              {visibleFiles.length}
            </span>
          </div>

          {visibleFiles.map((file) => {
            const total = file.finding_counts.total || 0;
            const critical = file.finding_counts.critical || 0;
            const high = file.finding_counts.high || 0;
            const worst = critical > 0 ? "critical" : high > 0 ? "high" : total > 0 ? "medium" : null;

            return (
              <button
                key={file.id}
                className={`file-tree-item ${activeFileId === file.id ? "active" : ""}`}
                onClick={() => {
                  setActiveFileId(file.id);
                  const next = new URLSearchParams(searchParams);
                  next.set("file", file.id);
                  next.delete("finding");
                  setSearchParams(next, { replace: true });
                }}
                title={file.path}
              >
                <Icon.File size={13} />
                <span className="file-tree-name">{file.path}</span>
                {total > 0 && worst && (
                  <span
                    className="file-count-pill"
                    style={{
                      background: `var(--${worst}-soft)`,
                      color: severityColor(worst),
                    }}
                  >
                    {total}
                  </span>
                )}
              </button>
            );
          })}

          {visibleFiles.length === 0 && (
            <div style={{ padding: 20, textAlign: "center" }}>
              <p className="text-sm text-muted" style={{ margin: 0 }}>
                No files with findings.
              </p>
            </div>
          )}
        </div>

        <div>
          {fileLoading && !detail ? (
            <LoadingState label="Loading file…" />
          ) : detail ? (
            <div className="stack">
              {detail.findings.length > 0 && (
                <div className="card card-pad">
                  <div className="row row-wrap" style={{ gap: 8 }}>
                    <strong className="text-sm">
                      {detail.findings.length} finding
                      {detail.findings.length === 1 ? "" : "s"} in {fileName(detail.path)}
                    </strong>
                    <div className="spacer row row-wrap" style={{ gap: 6 }}>
                      {detail.findings.map((finding) => (
                        <button
                          key={finding.id}
                          className="chip"
                          onClick={() => navigate(`/insights/${finding.id}`)}
                          title={finding.title}
                        >
                          <span
                            className="badge-dot"
                            style={{
                              background: severityColor(finding.severity),
                              display: "inline-block",
                              marginInlineEnd: 5,
                            }}
                          />
                          L{finding.line_number}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <CodeViewer
                code={detail.content}
                language={detail.language}
                path={detail.path}
                findings={detail.findings}
                activeFindingId={focusFindingId}
                onStatusChange={changeStatus}
                onOpenFinding={(finding) => navigate(`/insights/${finding.id}`)}
                headerRight={
                  <span className="text-xs text-subtle">
                    {detail.line_count} lines · {detail.language}
                  </span>
                }
              />

              {detail.findings.length === 0 && (
                <div className="card">
                  <EmptyState
                    icon={<Icon.Check size={22} />}
                    title="No findings in this file"
                    message="Both agents reviewed this file and raised nothing above the reporting threshold."
                  />
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
