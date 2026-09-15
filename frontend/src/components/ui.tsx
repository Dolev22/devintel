import type { ReactNode } from "react";

import {
  AGENT_SHORT,
  DOMAIN_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
  healthColor,
  healthLabel,
} from "../lib/format";
import type { Severity } from "../lib/types";

/* ------------------------------------------------------------------ icons */

type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const Icon = {
  Dashboard: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  Repo: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M6 17h13" />
    </svg>
  ),
  Insight: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2z" />
      <path d="M9.5 21h5" />
    </svg>
  ),
  Runs: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="12" r="2.2" />
      <circle cx="5" cy="18" r="2.2" />
      <path d="M7.2 6H13a3 3 0 0 1 3 3v.8M16.8 12H11a3 3 0 0 0-3 3v.8" />
    </svg>
  ),
  Report: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  ),
  Knowledge: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v14H6.5A2.5 2.5 0 0 0 4 19.5z" />
      <path d="M9 7.5h6M9 11h4" />
    </svg>
  ),
  Settings: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </svg>
  ),
  Play: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M6 4.5v15l12-7.5z" fill="currentColor" stroke="none" />
    </svg>
  ),
  Plus: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Search: ({ size = 16, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  Check: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="m4 12.5 5 5L20 6.5" />
    </svg>
  ),
  Close: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  Alert: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M12 3.5 2.5 20h19z" />
      <path d="M12 9.5v5M12 17.5h.01" />
    </svg>
  ),
  Shield: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M12 3 5 6v6c0 4.4 3 8.2 7 9 4-.8 7-4.6 7-9V6z" />
    </svg>
  ),
  Bug: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <rect x="8" y="7" width="8" height="12" rx="4" />
      <path d="M8 11H4M20 11h-4M8 16H4.5M20 16h-3.5M9.5 7 8 4.5M14.5 7 16 4.5" />
    </svg>
  ),
  Code: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="m9 8-5 4 5 4M15 8l5 4-5 4" />
    </svg>
  ),
  File: ({ size = 16, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  ),
  Back: ({ size = 15, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
  Chevron: ({ size = 15, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  ),
  Sun: ({ size = 17, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  Moon: ({ size = 17, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </svg>
  ),
  Menu: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  ),
  Refresh: ({ size = 16, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M20 11a8 8 0 1 0-.7 4.3" />
      <path d="M20 5v6h-6" />
    </svg>
  ),
  External: ({ size = 14, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M13 5h6v6M19 5l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>
  ),
  Inbox: ({ size = 22, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M3 13h5l1.5 3h5L16 13h5" />
      <path d="M5.5 5h13l2.5 8v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4z" />
    </svg>
  ),
  Trash: ({ size = 15, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </svg>
  ),
  Edit: ({ size = 15, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="m14 6 4 4" />
    </svg>
  ),
  Message: ({ size = 15, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  User: ({ size = 15, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
    </svg>
  ),
  Facebook: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path
        d="M13.5 21v-6.5H16l.5-3h-3V9.3c0-.9.3-1.5 1.6-1.5H16.6V5.2C16.2 5.1 15.3 5 14.3 5c-2.1 0-3.6 1.3-3.6 3.7v2.1H8.2v3h2.5V21"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  ),
  Instagram: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  Calendar: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9.5h18M8 3v4M16 3v4" />
      <circle cx="8" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  LinkedIn: ({ size = 18, className }: IconProps) => (
    <svg {...base(size)} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8" cy="8.2" r="1.3" fill="currentColor" stroke="none" />
      <path d="M8 11v6M12.2 17v-3.8a2.2 2.2 0 0 1 4.4 0V17M12.2 11.3V17" />
    </svg>
  ),
};

/* ----------------------------------------------------------------- badges */

export function SeverityBadge({ severity, showDot = true }: { severity: Severity; showDot?: boolean }) {
  return (
    <span className={`badge sev-${severity}`}>
      {showDot && <span className="badge-dot" />}
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "resolved"
      ? "badge-success"
      : status === "false_positive"
        ? "badge-neutral"
        : status === "review_later"
          ? "badge-warning"
          : "badge-accent";
  return <span className={`badge ${tone}`}>{STATUS_LABEL[status] || status}</span>;
}

export function AnalysisStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "badge-success",
    failed: "badge-danger",
    running: "badge-accent",
    reviewing: "badge-accent",
    pending: "badge-neutral",
    skipped: "badge-neutral",
  };
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const isActive = status === "running" || status === "reviewing" || status === "pending";
  return (
    <span className={`badge ${map[status] || "badge-neutral"}`}>
      {isActive && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.6 }} />}
      {label}
    </span>
  );
}

export function AgentBadge({ agentType }: { agentType: string }) {
  const icon =
    agentType === "security" ? (
      <Icon.Shield size={12} />
    ) : agentType === "code_analysis" ? (
      <Icon.Bug size={12} />
    ) : (
      <Icon.Insight size={12} />
    );
  return (
    <span className="badge badge-neutral">
      {icon}
      {AGENT_SHORT[agentType] || agentType}
    </span>
  );
}

export function DomainBadge({ domain }: { domain: string }) {
  return <span className="badge badge-neutral">{DOMAIN_LABEL[domain] || domain}</span>;
}

/* ------------------------------------------------------------- confidence */

export function ConfidenceMeter({ value, showLabel = true }: { value: number; showLabel?: boolean }) {
  const percent = Math.round(value * 100);
  const color =
    percent >= 80 ? "var(--success)" : percent >= 55 ? "var(--medium)" : "var(--high)";
  return (
    <span className="confidence" title={`Detection confidence: ${percent}%`}>
      <span className="confidence-track">
        <span className="confidence-fill" style={{ width: `${percent}%`, background: color }} />
      </span>
      {showLabel && <span className="confidence-value">{percent}%</span>}
    </span>
  );
}

/* ------------------------------------------------------------ health ring */

export function HealthRing({
  score,
  size = 72,
  stroke = 7,
  showLabel = true,
}: {
  score: number | null | undefined;
  size?: number;
  stroke?: number;
  showLabel?: boolean;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = score ?? 0;
  const offset = circumference - (value / 100) * circumference;
  const color = healthColor(score);

  return (
    <div className="health-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={stroke}
        />
        {score !== null && score !== undefined && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        )}
      </svg>
      <div className="health-ring-label" style={{ width: size, height: size }}>
        <div>
          <div
            className="health-ring-value"
            style={{ fontSize: size / 3.4, color }}
          >
            {score ?? "—"}
          </div>
          {showLabel && (
            <div style={{ fontSize: size / 8, color: "var(--text-subtle)" }}>/ 100</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function HealthPill({ score }: { score: number | null | undefined }) {
  const color = healthColor(score);
  return (
    <span
      className="badge"
      style={{
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      <span className="badge-dot" />
      {healthLabel(score)}
    </span>
  );
}

/* ----------------------------------------------------------------- states */

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state-box">
      <div className="spinner spinner-lg" />
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
  icon,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="state-box">
      <div className="state-icon">{icon || <Icon.Inbox />}</div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state-box">
      <div className="state-icon" style={{ color: "var(--critical)" }}>
        <Icon.Alert size={22} />
      </div>
      <h3>Something went wrong</h3>
      <p>{message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          <Icon.Refresh /> Try again
        </button>
      )}
    </div>
  );
}

export function SkeletonRows({ count = 4, height = 62 }: { count?: number; height?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ modal */

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal ${wide ? "modal-lg" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn spacer" onClick={onClose} aria-label="Close">
            <Icon.Close size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- bar row */

export function BarRow({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const percent = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="bar-row">
      <span className="bar-label" title={label}>
        {label}
      </span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${percent}%`, background: color }} />
      </span>
      <span className="bar-value">{value}</span>
    </div>
  );
}
