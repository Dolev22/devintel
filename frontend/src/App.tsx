import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import { Icon, LoadingState } from "./components/ui";
import { useApp } from "./context/AppContext";
import AnalysisRunDetail from "./pages/AnalysisRunDetail";
import AnalysisRuns from "./pages/AnalysisRuns";
import CodeReview from "./pages/CodeReview";
import CodeReviewCalendar from "./pages/CodeReviewCalendar";
import Dashboard from "./pages/Dashboard";
import InsightDetail from "./pages/InsightDetail";
import Insights from "./pages/Insights";
import Knowledge from "./pages/Knowledge";
import Login from "./pages/Login";
import Reports from "./pages/Reports";
import ReportDetail from "./pages/ReportDetail";
import Repositories from "./pages/Repositories";
import RepositoryDetail from "./pages/RepositoryDetail";
import Settings from "./pages/Settings";

function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone}`}>
          {toast.tone === "success" ? (
            <Icon.Check size={15} />
          ) : toast.tone === "error" ? (
            <Icon.Alert size={15} />
          ) : (
            <Icon.Insight size={15} />
          )}
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button
            className="btn-ghost"
            style={{ border: "none", background: "none", padding: 0, color: "var(--text-subtle)" }}
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss"
          >
            <Icon.Close size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const { user, loading } = useApp();

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <LoadingState label="Starting DevIntel…" />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Login />
        <Toasts />
      </>
    );
  }

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="repositories" element={<Repositories />} />
          <Route path="repositories/:repositoryId" element={<RepositoryDetail />} />
          <Route path="repositories/:repositoryId/review" element={<CodeReview />} />
          <Route path="insights" element={<Insights />} />
          <Route path="insights/:findingId" element={<InsightDetail />} />
          <Route path="runs" element={<AnalysisRuns />} />
          <Route path="runs/:analysisId" element={<AnalysisRunDetail />} />
          <Route path="reports" element={<Reports />} />
          <Route path="reports/:reportId" element={<ReportDetail />} />
          <Route path="calendar" element={<CodeReviewCalendar />} />
          <Route path="knowledge" element={<Knowledge />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toasts />
    </>
  );
}
