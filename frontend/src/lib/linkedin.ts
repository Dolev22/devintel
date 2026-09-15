/**
 * Social sharing helpers — LinkedIn is the one supported publishing target.
 *
 * No real LinkedIn OAuth app is configured in this environment (no client
 * ID/secret, no redirect URI, no approved API access), so "connection" here
 * is a local, clearly-labeled demo toggle, not a real account link. Post
 * drafts are generated entirely client-side from real Finding/Report data
 * already loaded by the app — nothing is invented, and nothing is ever sent
 * anywhere until the user explicitly copies/publishes it themselves.
 */

import type { Finding, Report } from "./types";

export const LINKEDIN_VS_INSTAGRAM_TONE =
  "LinkedIn favors a professional, text-first, educational tone aimed at other developers and engineering peers, while Instagram favors a casual, highly visual, entertainment-oriented tone aimed at broad consumer audiences.";

function cta(): string {
  return "Curious how automated multi-agent code review works? Follow along as DevIntel analyzes more repositories.";
}

/** Builds a LinkedIn-ready draft from a real Finding — no invented content. */
export function draftFromFinding(finding: Finding): string {
  const lines: string[] = [];
  lines.push("🔍 Code Intelligence Insight");
  lines.push("");
  lines.push(
    `While analyzing ${finding.repository_name || "a repository"}, DevIntel's ${
      finding.agent_type === "security" ? "Security Agent" : "Code Analysis Agent"
    } flagged a ${finding.severity} ${finding.category.toLowerCase()} issue: "${finding.title}".`
  );
  lines.push("");
  lines.push(finding.why_it_matters || finding.description);
  if (finding.recommendation) {
    lines.push("");
    lines.push(`💡 Recommendation: ${finding.recommendation}`);
  }
  lines.push("");
  lines.push(
    "This is the kind of issue a multi-agent code review pipeline catches automatically, before it reaches production."
  );
  lines.push("");
  lines.push(cta());
  lines.push("");
  lines.push("#CodeQuality #SoftwareEngineering #DevTools #CodeReview");
  return lines.join("\n");
}

/** Builds a LinkedIn-ready draft from a real Report — no invented content. */
export function draftFromReport(report: Report): string {
  const lines: string[] = [];
  lines.push(`📈 Code Health Report — ${report.repository_name || "Repository"}`);
  lines.push("");
  lines.push(
    "DevIntel's multi-agent pipeline (Code Analysis + Security + Review) just completed a full analysis:"
  );
  lines.push("");
  if (report.health_score !== null) lines.push(`• Health score: ${report.health_score}/100`);
  lines.push(`• ${report.total_findings} finding${report.total_findings === 1 ? "" : "s"} identified`);
  lines.push("");
  lines.push(report.summary);
  if (report.recommendations.length > 0) {
    lines.push("");
    lines.push(`Top recommendation: ${report.recommendations[0]}`);
  }
  lines.push("");
  lines.push(cta());
  lines.push("");
  lines.push("#DeveloperTools #AIinSoftwareEngineering #CodeQuality");
  return lines.join("\n");
}
