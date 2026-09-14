import type { Severity } from "./types";

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  resolved: "Resolved",
  false_positive: "False positive",
  review_later: "Review later",
};

export const AGENT_LABEL: Record<string, string> = {
  preparation: "Repository Preparation",
  code_analysis: "Code Analysis Agent",
  security: "Security Agent",
  review: "Review Agent",
  report: "Final Report",
};

export const AGENT_SHORT: Record<string, string> = {
  preparation: "Preparation",
  code_analysis: "Code Analysis",
  security: "Security",
  review: "Review",
  report: "Report",
};

export const DOMAIN_LABEL: Record<string, string> = {
  bug: "Bug Detection",
  quality: "Code Quality",
  security: "Security",
};

export function severityColor(severity: string): string {
  return `var(--${severity})`;
}

export function severitySoft(severity: string): string {
  return `var(--${severity}-soft)`;
}

export function healthColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return "var(--text-subtle)";
  if (score >= 80) return "var(--success)";
  if (score >= 60) return "var(--medium)";
  if (score >= 40) return "var(--high)";
  return "var(--critical)";
}

export function healthLabel(score: number | null | undefined): string {
  if (score === null || score === undefined) return "Not analyzed";
  if (score >= 85) return "Healthy";
  if (score >= 70) return "Mostly healthy";
  if (score >= 45) return "Needs attention";
  return "At risk";
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return "Just now";
  if (seconds < 90) return "1 minute ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

export function fileName(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.split("/");
  return parts[parts.length - 1];
}

export function languageForPrism(language: string | null | undefined): string {
  switch ((language || "").toLowerCase()) {
    case "python":
      return "python";
    case "javascript":
    case "jsx":
      return "jsx";
    case "typescript":
    case "tsx":
      return "tsx";
    case "json":
      return "json";
    case "markdown":
      return "markdown";
    case "bash":
      return "bash";
    case "sql":
      return "sql";
    case "java":
      return "java";
    case "go":
      return "go";
    case "ruby":
      return "ruby";
    default:
      return "javascript";
  }
}
