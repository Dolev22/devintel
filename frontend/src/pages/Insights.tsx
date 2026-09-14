import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import InsightRow from "../components/InsightRow";
import { EmptyState, ErrorState, Icon, SkeletonRows } from "../components/ui";
import { api, ApiError, buildQuery } from "../lib/api";
import { DOMAIN_LABEL, SEVERITY_LABEL, SEVERITY_ORDER, STATUS_LABEL } from "../lib/format";
import type { FindingsResponse, Repository } from "../lib/types";

const STATUS_OPTIONS = ["open", "resolved", "false_positive", "review_later"];
const DOMAIN_OPTIONS = ["security", "bug", "quality"];

export default function Insights() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [data, setData] = useState<FindingsResponse | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get("search") || "");

  const severity = searchParams.get("severity");
  const status = searchParams.get("status");
  const domain = searchParams.get("domain");
  const category = searchParams.get("category");
  const repositoryId = searchParams.get("repository");

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (value === null || next.get(key) === value) next.delete(key);
      else next.set(key, value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const query = buildQuery({
        severity,
        status,
        domain,
        category,
        repository_id: repositoryId,
        search: searchParams.get("search"),
      });
      const [findings, repos] = await Promise.all([
        api.get<FindingsResponse>(`/api/findings${query}`),
        repositories.length ? Promise.resolve(repositories) : api.get<Repository[]>("/api/repositories"),
      ]);
      setData(findings);
      setRepositories(repos as Repository[]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load insights.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severity, status, domain, category, repositoryId, searchParams]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if ((searchParams.get("search") || "") !== search) {
        updateParam("search", search.trim() || null);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [search, searchParams, updateParam]);

  const facets = data?.facets || {};
  const activeFilters = [severity, status, domain, category, repositoryId].filter(Boolean).length;

  const categories = useMemo(
    () => Object.entries(facets.category || {}).slice(0, 10),
    [facets.category]
  );

  return (
    <div className="stack">
      <div className="card">
        <div className="filter-bar">
          <div className="search-box">
            <Icon.Search />
            <input
              className="input"
              placeholder="Search title, description or file…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <select
            className="select"
            style={{ width: "auto", minWidth: 170 }}
            value={repositoryId || ""}
            onChange={(event) => updateParam("repository", event.target.value || null)}
          >
            <option value="">All repositories</option>
            {repositories.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.name}
              </option>
            ))}
          </select>

          {activeFilters > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
            >
              <Icon.Close size={13} /> Clear filters
            </button>
          )}

          <span className="text-sm text-muted spacer">
            {data ? `${data.total} finding${data.total === 1 ? "" : "s"}` : ""}
          </span>
        </div>

        <div className="filter-bar" style={{ gap: 14 }}>
          <div className="row row-wrap" style={{ gap: 6 }}>
            <span className="text-xs text-subtle" style={{ marginInlineEnd: 2 }}>
              Severity
            </span>
            {SEVERITY_ORDER.map((option) => (
              <button
                key={option}
                className={`chip ${severity === option ? "active" : ""}`}
                onClick={() => updateParam("severity", option)}
              >
                {SEVERITY_LABEL[option]}
                {facets.severity?.[option] !== undefined && (
                  <span className="chip-count">{facets.severity[option]}</span>
                )}
              </button>
            ))}
          </div>

          <div className="row row-wrap" style={{ gap: 6 }}>
            <span className="text-xs text-subtle" style={{ marginInlineEnd: 2 }}>
              Status
            </span>
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option}
                className={`chip ${status === option ? "active" : ""}`}
                onClick={() => updateParam("status", option)}
              >
                {STATUS_LABEL[option]}
                {facets.status?.[option] !== undefined && (
                  <span className="chip-count">{facets.status[option]}</span>
                )}
              </button>
            ))}
          </div>

          <div className="row row-wrap" style={{ gap: 6 }}>
            <span className="text-xs text-subtle" style={{ marginInlineEnd: 2 }}>
              Domain
            </span>
            {DOMAIN_OPTIONS.map((option) => (
              <button
                key={option}
                className={`chip ${domain === option ? "active" : ""}`}
                onClick={() => updateParam("domain", option)}
              >
                {DOMAIN_LABEL[option]}
                {facets.domain?.[option] !== undefined && (
                  <span className="chip-count">{facets.domain[option]}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {categories.length > 0 && (
          <div className="filter-bar">
            <span className="text-xs text-subtle">Category</span>
            {categories.map(([name, count]) => (
              <button
                key={name}
                className={`chip ${category === name ? "active" : ""}`}
                onClick={() => updateParam("category", name)}
              >
                {name}
                <span className="chip-count">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        {loading ? (
          <SkeletonRows count={6} height={72} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !data || data.findings.length === 0 ? (
          <EmptyState
            icon={<Icon.Insight size={22} />}
            title={activeFilters > 0 ? "No findings match these filters" : "No insights yet"}
            message={
              activeFilters > 0
                ? "Try removing a filter to widen the search."
                : "Run an analysis on a repository to generate developer insights."
            }
            action={
              activeFilters > 0 ? (
                <button
                  className="btn"
                  onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
                >
                  Clear filters
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => navigate("/repositories")}>
                  Go to repositories
                </button>
              )
            }
          />
        ) : (
          data.findings.map((finding) => (
            <InsightRow
              key={finding.id}
              finding={finding}
              onClick={() => navigate(`/insights/${finding.id}`)}
            />
          ))
        )}
      </div>
    </div>
  );
}
