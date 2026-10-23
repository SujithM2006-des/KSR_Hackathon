import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate } from "../api.js";
import { FollowedBadge, ModeBadge, PainBadge, SessionStatusBadge } from "../components/Badge.jsx";

// Reps column shared with the dashboard's recent sessions
export function RepsCell({ s }) {
  if (s.status === "SKIPPED") return <span className="muted">-</span>;
  if (s.measured)
    return (
      <>
        {s.good_reps}/{s.prescribed_reps} in range <FollowedBadge value={s.plan_followed} />
      </>
    );
  return `${s.reps_done}/${s.prescribed_reps} (you confirmed)`;
}

export function SessionsTable({ sessions }) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Exercise</th>
            <th>Status</th>
            <th>Reps</th>
            <th>Pain</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td className="nowrap">{fmtDate(s.ended_at)}</td>
              <td>
                <div>{s.exercise_name}</div>
                <ModeBadge mode={s.mode} />
              </td>
              <td>
                <SessionStatusBadge status={s.status} />
              </td>
              <td>
                <RepsCell s={s} />
              </td>
              <td>
                <PainBadge score={s.pain_score} />
              </td>
              <td className="right">
                <Link className="btn btn-outline btn-sm" to={`/sessions/${s.id}`}>
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PatientSessions() {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.mySessions().then(setSessions).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="dash-head">
        <div>
          <h1>Session History</h1>
          <p>Every session you did, skipped or stopped, newest first. Your therapist sees the same list.</p>
        </div>
      </div>
      {error && <div className="alert alert-red">{error}</div>}
      <section className="panel panel-flush">
        {sessions === null && !error ? (
          <p className="empty">Loading...</p>
        ) : sessions && sessions.length === 0 ? (
          <p className="empty">No sessions yet. Start one from your dashboard.</p>
        ) : (
          sessions && <SessionsTable sessions={sessions} />
        )}
      </section>
    </div>
  );
}
