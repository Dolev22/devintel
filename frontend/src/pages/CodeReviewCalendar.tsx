import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import ScheduleMeetingModal from "../components/ScheduleMeetingModal";
import { EmptyState, ErrorState, Icon, LoadingState } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { dateKey, dateKeyInTimezone, formatTimeInTimezone } from "../lib/timezones";
import type { Meeting } from "../lib/types";

type ViewMode = "day" | "week" | "month";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function rangeLabel(view: ViewMode, anchor: Date): string {
  if (view === "day") {
    return anchor.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }
  if (view === "week") {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    const startMonth = start.toLocaleDateString(undefined, { month: "short" });
    const endMonth = end.toLocaleDateString(undefined, { month: "short" });
    return startMonth === endMonth
      ? `${startMonth} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`
      : `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function MeetingChip({ meeting, onClick }: { meeting: Meeting; onClick: () => void }) {
  const cancelled = meeting.status === "cancelled";
  return (
    <button
      onClick={onClick}
      className="text-xs"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        width: "100%",
        textAlign: "start",
        padding: "4px 7px",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${cancelled ? "var(--border)" : "var(--accent-border)"}`,
        background: cancelled ? "var(--surface-2)" : "var(--accent-soft)",
        color: cancelled ? "var(--text-subtle)" : "var(--text)",
        textDecoration: cancelled ? "line-through" : "none",
        cursor: "pointer",
        marginBlockEnd: 4,
      }}
      title={meeting.title}
    >
      <span style={{ fontWeight: 600, flexShrink: 0 }}>
        {formatTimeInTimezone(meeting.scheduled_at, meeting.timezone)}
      </span>
      <span className="truncate">{meeting.title}</span>
    </button>
  );
}

export default function CodeReviewCalendar() {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Meeting | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get<{ meetings: Meeting[] }>("/api/meetings");
      setMeetings(data.meetings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the calendar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const meeting of meetings) {
      const key = dateKeyInTimezone(meeting.scheduled_at, meeting.timezone);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(meeting);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    }
    return map;
  }, [meetings]);

  function step(direction: 1 | -1) {
    if (view === "day") setAnchor((d) => addDays(d, direction));
    else if (view === "week") setAnchor((d) => addDays(d, 7 * direction));
    else setAnchor((d) => new Date(d.getFullYear(), d.getMonth() + direction, 1));
  }

  if (loading) return <LoadingState label="Loading calendar…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-pad row row-wrap" style={{ gap: 14, justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={() => step(-1)} aria-label="Previous">
              <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
                <Icon.Chevron size={14} />
              </span>
            </button>
            <button className="btn btn-sm" onClick={() => setAnchor(new Date())}>
              Today
            </button>
            <button className="btn btn-sm" onClick={() => step(1)} aria-label="Next">
              <Icon.Chevron size={14} />
            </button>
            <strong style={{ fontSize: 14, marginInlineStart: 6 }}>{rangeLabel(view, anchor)}</strong>
          </div>

          <div className="tab-switch" style={{ maxWidth: 260 }}>
            <button className={view === "day" ? "active" : ""} onClick={() => setView("day")}>
              Day
            </button>
            <button className={view === "week" ? "active" : ""} onClick={() => setView("week")}>
              Week
            </button>
            <button className={view === "month" ? "active" : ""} onClick={() => setView("month")}>
              Month
            </button>
          </div>
        </div>
      </div>

      {meetings.length === 0 ? (
        <EmptyState
          icon={<Icon.Calendar size={22} />}
          title="No code reviews scheduled yet"
          message="Open a Developer Insight or Report and use “Schedule Code Review” to book one — it will show up here."
        />
      ) : view === "month" ? (
        <MonthGrid anchor={anchor} byDay={byDay} onSelect={setSelected} />
      ) : view === "week" ? (
        <WeekGrid anchor={anchor} byDay={byDay} onSelect={setSelected} />
      ) : (
        <DayList anchor={anchor} byDay={byDay} onSelect={setSelected} onOpenInsight={navigate} />
      )}

      {selected && (
        <ScheduleMeetingModal
          mode="edit"
          meeting={selected}
          onClose={() => setSelected(null)}
          onSaved={(meeting) => {
            setMeetings((current) => current.map((m) => (m.id === meeting.id ? meeting : m)));
            setSelected(null);
          }}
          onCancelled={(meeting) => {
            setMeetings((current) => current.map((m) => (m.id === meeting.id ? meeting : m)));
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

function MonthGrid({
  anchor,
  byDay,
  onSelect,
}: {
  anchor: Date;
  byDay: Map<string, Meeting[]>;
  onSelect: (m: Meeting) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(anchor));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const currentMonth = anchor.getMonth();
  const todayKey = dateKey(new Date());

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-xs text-subtle"
            style={{ padding: "10px 8px", borderBlockEnd: "1px solid var(--border)", fontWeight: 600 }}
          >
            {label}
          </div>
        ))}
        {days.map((day) => {
          const key = dateKey(day);
          const dayMeetings = byDay.get(key) || [];
          const inMonth = day.getMonth() === currentMonth;
          return (
            <div
              key={key}
              style={{
                minHeight: 96,
                padding: 6,
                borderInlineEnd: "1px solid var(--border)",
                borderBlockEnd: "1px solid var(--border)",
                background: key === todayKey ? "var(--accent-soft)" : undefined,
                opacity: inMonth ? 1 : 0.4,
              }}
            >
              <div className="text-xs" style={{ fontWeight: key === todayKey ? 700 : 500, marginBlockEnd: 4 }}>
                {day.getDate()}
              </div>
              {dayMeetings.slice(0, 3).map((meeting) => (
                <MeetingChip key={meeting.id} meeting={meeting} onClick={() => onSelect(meeting)} />
              ))}
              {dayMeetings.length > 3 && (
                <div className="text-xs text-subtle">+{dayMeetings.length - 3} more</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({
  anchor,
  byDay,
  onSelect,
}: {
  anchor: Date;
  byDay: Map<string, Meeting[]>;
  onSelect: (m: Meeting) => void;
}) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const todayKey = dateKey(new Date());

  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: 10 }}>
      {days.map((day) => {
        const key = dateKey(day);
        const dayMeetings = byDay.get(key) || [];
        return (
          <div
            key={key}
            className="card"
            style={{
              padding: 10,
              minHeight: 160,
              border: key === todayKey ? "1px solid var(--accent-border)" : undefined,
            }}
          >
            <div className="text-xs text-subtle" style={{ marginBlockEnd: 6 }}>
              {day.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
            </div>
            {dayMeetings.length === 0 ? (
              <div className="text-xs text-subtle">—</div>
            ) : (
              dayMeetings.map((meeting) => (
                <MeetingChip key={meeting.id} meeting={meeting} onClick={() => onSelect(meeting)} />
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

function DayList({
  anchor,
  byDay,
  onSelect,
  onOpenInsight,
}: {
  anchor: Date;
  byDay: Map<string, Meeting[]>;
  onSelect: (m: Meeting) => void;
  onOpenInsight: (path: string) => void;
}) {
  const dayMeetings = byDay.get(dateKey(anchor)) || [];

  return (
    <div className="card">
      {dayMeetings.length === 0 ? (
        <EmptyState
          icon={<Icon.Calendar size={20} />}
          title="Nothing scheduled for this day"
          message="Pick another day, or schedule a code review from an Insight or Report."
        />
      ) : (
        dayMeetings.map((meeting) => (
          <div
            key={meeting.id}
            className="row"
            style={{
              gap: 12,
              padding: "14px 18px",
              borderBlockEnd: "1px dashed var(--border)",
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: 13,
                minWidth: 70,
                color: meeting.status === "cancelled" ? "var(--text-subtle)" : "var(--accent)",
              }}
            >
              {formatTimeInTimezone(meeting.scheduled_at, meeting.timezone)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <button
                className="text-sm"
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  fontWeight: 600,
                  textAlign: "start",
                  cursor: "pointer",
                  textDecoration: meeting.status === "cancelled" ? "line-through" : "none",
                  color: "var(--text)",
                }}
                onClick={() => onSelect(meeting)}
              >
                {meeting.title}
              </button>
              <div className="text-xs text-subtle" style={{ marginBlockStart: 2 }}>
                {meeting.repository_name && <span>{meeting.repository_name}</span>}
                {meeting.repository_name && (meeting.finding_title || meeting.report_title) && " · "}
                {meeting.finding_title || meeting.report_title}
                {" · "}
                {meeting.timezone}
              </div>
              {meeting.finding_id && (
                <button
                  className="btn btn-sm"
                  style={{ marginBlockStart: 6 }}
                  onClick={() => onOpenInsight(`/insights/${meeting.finding_id}`)}
                >
                  Open insight
                </button>
              )}
              {meeting.report_id && (
                <button
                  className="btn btn-sm"
                  style={{ marginBlockStart: 6 }}
                  onClick={() => onOpenInsight(`/reports/${meeting.report_id}`)}
                >
                  Open report
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
