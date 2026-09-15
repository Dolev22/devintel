export type Severity = "critical" | "high" | "medium" | "low";
export type FindingStatus = "open" | "resolved" | "false_positive" | "review_later";
export type AnalysisStatus = "pending" | "running" | "reviewing" | "completed" | "failed";
export type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type AgentType = "preparation" | "code_analysis" | "security" | "review" | "report";

export interface User {
  id: string;
  name: string;
  email: string;
  created_at: string | null;
}

export interface Preferences {
  theme: "dark" | "light";
  direction: "ltr" | "rtl";
  language: string;
  run_code_analysis: boolean;
  run_security: boolean;
  min_severity: Severity;
  min_confidence: number;
  max_files_per_analysis: number;
  notify_on_complete: boolean;
  notify_on_critical: boolean;
  notify_weekly_digest: boolean;
  updated_at: string | null;
}

export interface Repository {
  id: string;
  name: string;
  owner: string | null;
  github_url: string;
  description: string | null;
  language: string | null;
  branch: string | null;
  is_demo: boolean;
  health_score: number | null;
  file_count: number;
  loc_count: number;
  created_at: string | null;
  last_analyzed_at: string | null;
  open_findings?: number;
  critical_findings?: number;
  resolved_findings?: number;
  total_findings?: number;
  analysis_count?: number;
  latest_analysis_id?: string | null;
  latest_analysis_status?: AnalysisStatus | null;
}

export interface AgentRun {
  id: string;
  analysis_id: string;
  agent_type: AgentType;
  label: string;
  order_index: number;
  status: StageStatus;
  input_summary: string | null;
  output_summary: string | null;
  error_message: string | null;
  findings_count: number;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface Analysis {
  id: string;
  repository_id: string;
  repository_name: string | null;
  repository_language: string | null;
  status: AnalysisStatus;
  current_stage: string | null;
  summary: string | null;
  error_message: string | null;
  files_analyzed: number;
  loc_analyzed: number;
  duration_ms: number | null;
  engine: string;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  findings_count: number;
  has_report: boolean;
  stages?: AgentRun[];
  severity_counts?: Record<Severity, number>;
}

export interface Finding {
  id: string;
  analysis_id: string;
  repository_id: string;
  repository_name: string | null;
  agent_type: "code_analysis" | "security" | "review";
  rule_id: string | null;
  title: string;
  description: string;
  explanation: string | null;
  why_it_matters: string | null;
  recommendation: string;
  suggested_fix: string | null;
  severity: Severity;
  category: string;
  domain: "bug" | "quality" | "security";
  confidence: number;
  file_path: string | null;
  line_number: number | null;
  code_start_line: number | null;
  code_end_line: number | null;
  related_file_path: string | null;
  related_line_number: number | null;
  status: FindingStatus;
  status_note: string | null;
  status_changed_at: string | null;
  reviewed: boolean;
  review_verdict: string | null;
  review_priority: number | null;
  original_severity: Severity | null;
  original_confidence: number | null;
  merged_count: number;
  corroborated_by: string | null;
  group_key: string | null;
  created_at: string | null;
  feedback_count: number;
  feedback_verdict: string | null;
  feedback_considered_at: string | null;
  pre_feedback_severity: Severity | null;
  pre_feedback_confidence: number | null;
  feedback?: Feedback[];
}

export interface Feedback {
  id: string;
  finding_id: string;
  text: string;
  author_name: string | null;
  considered: boolean;
  considered_at: string | null;
  created_at: string | null;
}

export interface Report {
  id: string;
  analysis_id: string;
  repository_id: string;
  repository_name: string | null;
  title: string;
  summary: string;
  recommendations: string[];
  top_issues: string[];
  category_breakdown: Record<string, number>;
  severity_breakdown: Record<string, number>;
  metadata: Record<string, any>;
  health_score: number | null;
  total_findings: number;
  created_at: string | null;
  analysis_status: AnalysisStatus | null;
  analysis_completed_at: string | null;
  engine: string | null;
}

export interface RepositoryFileSummary {
  id: string;
  path: string;
  language: string | null;
  line_count: number;
  size_bytes: number;
  is_test: boolean;
  priority_score: number;
  finding_counts: Record<string, number>;
}

export interface RepositoryFileDetail extends RepositoryFileSummary {
  content: string;
  findings: Finding[];
}

export interface KnowledgeSource {
  id: string;
  name: string;
  type: string;
  url: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
  body: string | null;
  order_index: number;
}

export interface DashboardData {
  stats: {
    repository_count: number;
    analyses_in_progress: number;
    critical_findings: number;
    open_findings: number;
    resolved_findings: number;
    false_positive_findings: number;
    review_later_findings: number;
    total_findings: number;
    average_health: number | null;
    analyses_completed: number;
  };
  repository_health: {
    id: string;
    name: string;
    language: string | null;
    health_score: number | null;
    last_analyzed_at: string | null;
    open_findings: number;
    critical_findings: number;
  }[];
  recent_insights: Finding[];
  recent_runs: Analysis[];
  severity_breakdown: Record<Severity, number>;
  domain_breakdown: Record<string, number>;
}

export interface FindingsResponse {
  findings: Finding[];
  facets: {
    severity?: Record<string, number>;
    category?: Record<string, number>;
    domain?: Record<string, number>;
    agent_type?: Record<string, number>;
    status?: Record<string, number>;
  };
  total: number;
}

export interface FindingDetailResponse {
  finding: Finding;
  related_findings: Finding[];
  same_file_findings: Finding[];
  code: {
    file_id: string;
    path: string;
    language: string | null;
    content: string;
    line_count: number;
  } | null;
  related_code: {
    file_id: string;
    path: string;
    language: string | null;
    content: string;
    line_count: number;
  } | null;
  analysis: Analysis | null;
}

export type MeetingStatus = "scheduled" | "cancelled";

export interface Meeting {
  id: string;
  title: string;
  repository_id: string | null;
  repository_name: string | null;
  finding_id: string | null;
  finding_title: string | null;
  report_id: string | null;
  report_title: string | null;
  scheduled_at: string;
  timezone: string;
  participants: string | null;
  notes: string | null;
  status: MeetingStatus;
  created_at: string | null;
  updated_at: string | null;
}

export interface SystemInfo {
  llm_enabled: boolean;
  llm_model: string | null;
  analysis_engine: string;
  database: string;
  max_files_per_analysis: number;
  secrets_source: string;
}
