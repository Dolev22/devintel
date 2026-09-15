import { useState } from "react";

import { useApp } from "../context/AppContext";
import { api, ApiError } from "../lib/api";
import { COMMON_TIMEZONES, browserTimezone, dateKeyInTimezone } from "../lib/timezones";
import type { Finding, Meeting, Report } from "../lib/types";
import { Icon, Modal } from "./ui";

function timeKeyInTimezone(iso: string, timezone: string): string {
  const date = new Date(iso);
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const h = parts.find((p) => p.type === "hour")?.value ?? "00";
    const m = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${h}:${m}`;
  } catch {
    return "09:00";
  }
}

function defaultDate(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Props =
  | {
      mode: "create";
      sourceType: "finding" | "report";
      source: Finding | Report;
      onClose: () => void;
      onSaved: (meeting: Meeting) => void;
    }
  | {
      mode: "edit";
      meeting: Meeting;
      onClose: () => void;
      onSaved: (meeting: Meeting) => void;
      onCancelled: (meeting: Meeting) => void;
    };

export default function ScheduleMeetingModal(props: Props) {
  const { notify } = useApp();
  const isEdit = props.mode === "edit";

  const initial = isEdit
    ? props.meeting
    : null;

  const [title, setTitle] = useState(
    initial
      ? initial.title
      : props.mode === "create" && props.sourceType === "finding"
        ? `Code Review: ${(props.source as Finding).title}`
        : props.mode === "create"
          ? `Code Review: ${(props.source as Report).title}`
          : ""
  );
  const [date, setDate] = useState(initial ? dateKeyInTimezone(initial.scheduled_at, initial.timezone) : defaultDate());
  const [time, setTime] = useState(initial ? timeKeyInTimezone(initial.scheduled_at, initial.timezone) : "10:00");
  const [timezone, setTimezone] = useState(initial ? initial.timezone : browserTimezone());
  const [participants, setParticipants] = useState(initial?.participants || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repositoryName =
    props.mode === "create"
      ? props.sourceType === "finding"
        ? (props.source as Finding).repository_name
        : (props.source as Report).repository_name
      : props.meeting.repository_name;

  const sourceLabel =
    props.mode === "create"
      ? props.sourceType === "finding"
        ? (props.source as Finding).title
        : (props.source as Report).title
      : props.meeting.finding_title || props.meeting.report_title;

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (title.trim().length < 1) {
      setError("Give the meeting a title.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (props.mode === "create") {
        const body: Record<string, unknown> = {
          title: title.trim(),
          date,
          time,
          timezone,
          participants: participants.trim() || null,
          notes: notes.trim() || null,
        };
        if (props.sourceType === "finding") {
          const finding = props.source as Finding;
          body.finding_id = finding.id;
          body.repository_id = finding.repository_id;
        } else {
          const report = props.source as Report;
          body.report_id = report.id;
          body.repository_id = report.repository_id;
        }
        const meeting = await api.post<Meeting>("/api/meetings", body);
        notify("Code review scheduled", "success");
        props.onSaved(meeting);
      } else {
        const meeting = await api.patch<Meeting>(`/api/meetings/${props.meeting.id}`, {
          title: title.trim(),
          date,
          time,
          timezone,
          participants: participants.trim() || null,
          notes: notes.trim() || null,
        });
        notify("Meeting updated", "success");
        props.onSaved(meeting);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the meeting.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelMeeting() {
    if (props.mode !== "edit") return;
    setCancelling(true);
    try {
      const meeting = await api.patch<Meeting>(`/api/meetings/${props.meeting.id}/cancel`);
      notify("Meeting cancelled", "info");
      props.onCancelled(meeting);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not cancel the meeting.", "error");
    } finally {
      setCancelling(false);
    }
  }

  const alreadyCancelled = isEdit && props.meeting.status === "cancelled";

  return (
    <Modal
      title={isEdit ? "Meeting details" : "Schedule Code Review"}
      onClose={props.onClose}
      footer={
        <>
          {isEdit && !alreadyCancelled && (
            <button className="btn" onClick={handleCancelMeeting} disabled={cancelling || saving}>
              {cancelling ? <span className="spinner" /> : <Icon.Close size={13} />}
              Cancel meeting
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={props.onClose} disabled={saving || cancelling}>
            Close
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || cancelling || alreadyCancelled}
          >
            {saving ? <span className="spinner" /> : <Icon.Check size={14} />}
            {isEdit ? "Save changes" : "Schedule"}
          </button>
        </>
      }
    >
      <form onSubmit={handleSave} style={{ display: "contents" }}>
        {alreadyCancelled && (
          <div
            className="row"
            style={{
              gap: 8,
              padding: "10px 12px",
              background: "var(--surface-2)",
              border: "1px dashed var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              marginBlockEnd: 4,
            }}
          >
            <Icon.Alert size={15} className="text-subtle" />
            <span className="text-sm text-muted">This meeting was cancelled.</span>
          </div>
        )}

        {(repositoryName || sourceLabel) && (
          <div
            className="row"
            style={{
              gap: 10,
              padding: "10px 12px",
              background: "var(--surface-2)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
            }}
          >
            <span style={{ flexShrink: 0, marginBlockStart: 2 }}>
              <Icon.Insight size={15} className="text-subtle" />
            </span>
            <div style={{ minWidth: 0 }}>
              {repositoryName && (
                <div className="text-xs text-subtle">Repository: {repositoryName}</div>
              )}
              {sourceLabel && (
                <div className="text-sm truncate" style={{ fontWeight: 600 }}>
                  {sourceLabel}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="meeting-title">Meeting title</label>
          <input
            id="meeting-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={alreadyCancelled}
            autoFocus
          />
        </div>

        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="meeting-date">Date</label>
            <input
              id="meeting-date"
              type="date"
              className="input"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={alreadyCancelled}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="meeting-time">Time</label>
            <input
              id="meeting-time"
              type="time"
              className="input"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              disabled={alreadyCancelled}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="meeting-tz">Time zone</label>
          <select
            id="meeting-tz"
            className="select"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            disabled={alreadyCancelled}
          >
            {!COMMON_TIMEZONES.some((tz) => tz.value === timezone) && (
              <option value={timezone}>{timezone}</option>
            )}
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label} ({tz.value})
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="meeting-participants">Participants (optional)</label>
          <input
            id="meeting-participants"
            className="input"
            placeholder="e.g. dana@team.dev, or Q from the mobile team"
            value={participants}
            onChange={(event) => setParticipants(event.target.value)}
            disabled={alreadyCancelled}
          />
          <span className="field-hint">Names or emails, comma separated. Not sent anywhere.</span>
        </div>

        <div className="field">
          <label htmlFor="meeting-notes">Notes (optional)</label>
          <textarea
            id="meeting-notes"
            className="textarea"
            style={{ minHeight: 80 }}
            placeholder="Agenda, context, or what to focus the discussion on…"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={alreadyCancelled}
          />
        </div>

        {error && <div className="error-text">{error}</div>}
      </form>
    </Modal>
  );
}
