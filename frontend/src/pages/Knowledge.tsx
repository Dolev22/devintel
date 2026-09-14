import { useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, Icon, SkeletonRows } from "../components/ui";
import { api, ApiError } from "../lib/api";
import type { KnowledgeSource } from "../lib/types";

const TYPE_ICON: Record<string, React.ReactNode> = {
  security_guideline: <Icon.Shield size={16} />,
  docs: <Icon.Knowledge size={16} />,
  guide: <Icon.Code size={16} />,
};

export default function Knowledge() {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get<{ sources: KnowledgeSource[]; categories: string[] }>(
        "/api/knowledge"
      );
      setSources(data.sources);
      setCategories(data.categories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the knowledge base.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = category ? sources.filter((s) => s.category === category) : sources;

  if (loading) {
    return (
      <div className="card">
        <SkeletonRows count={4} height={110} />
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="stack">
      <div className="card card-pad">
        <p className="text-sm text-muted" style={{ margin: "0 0 12px" }}>
          These are the references the agents reason against. The Security Agent carries a
          condensed OWASP Top 10 in its system prompt; the guidance below explains the
          reasoning behind the findings you see in reports.
        </p>
        <div className="row row-wrap" style={{ gap: 6 }}>
          <button
            className={`chip ${category === null ? "active" : ""}`}
            onClick={() => setCategory(null)}
          >
            All
            <span className="chip-count">{sources.length}</span>
          </button>
          {categories.map((name) => (
            <button
              key={name}
              className={`chip ${category === name ? "active" : ""}`}
              onClick={() => setCategory(name)}
            >
              {name}
              <span className="chip-count">
                {sources.filter((s) => s.category === name).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon.Knowledge size={22} />}
            title="Nothing in this category"
            message="Pick a different category to see more guidance."
          />
        </div>
      ) : (
        <div className="grid grid-2">
          {visible.map((source) => {
            const isOpen = expanded === source.id;
            return (
              <div key={source.id} className="knowledge-card">
                <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                  <span
                    className="stat-icon"
                    style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                  >
                    {TYPE_ICON[source.type] || <Icon.Knowledge size={16} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: "block", fontSize: 14 }}>{source.name}</strong>
                    <span className="text-xs text-subtle">{source.category}</span>
                  </div>
                </div>

                <p className="text-sm text-muted" style={{ margin: 0 }}>
                  {source.description}
                </p>

                {isOpen && source.body && (
                  <div className="knowledge-body">{source.body}</div>
                )}

                <div className="row row-wrap" style={{ gap: 6 }}>
                  {source.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="badge badge-neutral">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="row" style={{ gap: 8 }}>
                  {source.body && (
                    <button
                      className="btn btn-sm"
                      onClick={() => setExpanded(isOpen ? null : source.id)}
                    >
                      {isOpen ? "Hide guidance" : "Read guidance"}
                      <Icon.Chevron size={13} />
                    </button>
                  )}
                  {source.url && (
                    <a
                      className="btn btn-sm btn-ghost"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Official source <Icon.External size={13} />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
