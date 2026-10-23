import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, fmtDate } from "../api.js";
import { AccountBadge, AdherenceBadge, PainBadge } from "../components/Badge.jsx";
import { Kpi, Panel, PanelLink, PctBar, SessionChip } from "../components/Dash.jsx";
import { Avatar, Icon, IconTile } from "../components/Icons.jsx";

const DAY = 24 * 3600 * 1000;
const FLAG_LABEL = { NOT_WELL: "Not well - skipped", PAIN_STOP: "Stopped because of pain" };

function daysAgo(iso) {
  return iso ? (Date.now() - new Date(iso).getTime()) / DAY : Infinity;
}

// Trend of the best angle per camera-measured session for one patient + exercise
function RecoveryTrend({ patients }) {
  const withSessions = patients.filter((p) => p.sessions_count > 0);
  const [pid, setPid] = useState(withSessions[0] ? withSessions[0].id : null);
  const [trend, setTrend] = useState(null);
  const [exKey, setExKey] = useState("");

  useEffect(() => {
    if (!pid) return;
    setTrend(null);
    api
      .trend(pid)
      .then((t) => {
        setTrend(t);
        // default to the exercise with the most measured sessions
        const counts = {};
        t.forEach((r) => (counts[r.exercise_type] = (counts[r.exercise_type] || 0) + 1));
        const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
        setExKey((k) => (keys.includes(k) ? k : keys[0] || ""));
      })
      .catch(() => setTrend([]));
  }, [pid]);

  const exercises = useMemo(() => {
    const m = new Map();
    (trend || []).forEach((r) => m.set(r.exercise_type, r.exercise_name));
    return [...m.entries()];
  }, [trend]);
  const rows = (trend || []).filter((r) => r.exercise_type === exKey);
  const last = rows[rows.length - 1];
  const first = rows[0];
  const inRange = last && last.max_angle >= last.target_min && last.max_angle <= last.target_max;
  const change = last && first && rows.length > 1 ? last.max_angle - first.max_angle : null;

  return (
    <Panel
      title="Patient Recovery Trend"
      icon="trend"
      action={
        withSessions.length > 0 && (
          <span className="dash-actions">
            <select value={pid || ""} onChange={(e) => setPid(Number(e.target.value))} aria-label="Patient">
              {withSessions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {exercises.length > 0 && (
              <select value={exKey} onChange={(e) => setExKey(e.target.value)} aria-label="Exercise">
                {exercises.map(([k, n]) => (
                  <option key={k} value={k}>
                    {n}
                  </option>
                ))}
              </select>
            )}
          </span>
        )
      }
    >
      {!pid ? (
        <p className="empty">Trends appear after a patient's first camera-measured session.</p>
      ) : trend === null ? (
        <p className="empty">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="empty">No camera-measured sessions yet for this patient.</p>
      ) : (
        <div className="chart-row">
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="#eef0f7" vertical={false} />
                <ReferenceArea y1={last.target_min} y2={last.target_max} fill="#5b34ea" fillOpacity={0.08} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#5d6585" }} />
                <YAxis domain={[0, 180]} tick={{ fontSize: 11, fill: "#5d6585" }} unit="°" />
                <Tooltip formatter={(v) => [`${v}°`, "Best angle"]} />
                <Line type="monotone" dataKey="max_angle" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="latest-box">
            <span>Latest session</span>
            <span className="latest-num">{Math.round(last.max_angle)}°</span>
            <span className={`badge ${inRange ? "badge-green" : "badge-amber"}`} style={{ alignSelf: "flex-start" }}>
              {inRange ? "Within range" : "Outside range"}
            </span>
            <hr />
            <span>Target range</span>
            <span className="latest-val">
              {last.target_min}° – {last.target_max}°
            </span>
            {change !== null && (
              <>
                <hr />
                <span>Change since first session</span>
                <span className={`latest-val ${change >= 0 ? "ok" : "warn"}`}>
                  {change >= 0 ? "+" : ""}
                  {Math.round(change)}°
                </span>
              </>
            )}
          </div>
        </div>
      )}
      <p className="muted small" style={{ margin: "10px 0 0" }}>
        Shaded band = prescribed range. Angles are 2-D camera estimates.
      </p>
    </Panel>
  );
}

export default function TherapistDashboard() {
  const navigate = useNavigate();
  const [patients, setPatients] = useState(null);
  const [sessions, setSessions] = useState(null); // all sessions of my patients, newest first
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [planFor, setPlanFor] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const list = await api.patients();
        setPatients(list);
        setPlanFor(list[0] ? String(list[0].id) : "");
        const lists = await Promise.all(
          list.filter((p) => p.sessions_count > 0).map((p) => api.patientSessions(p.id).then((ss) => ss.map((s) => ({ ...s, patient: p }))))
        );
        setSessions(lists.flat().sort((a, b) => new Date(b.ended_at) - new Date(a.ended_at)));
      } catch (e) {
        setError(e.message);
      }
    })();
  }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!patients) return <p className="muted">Loading...</p>;

  const all = sessions || [];
  const thisWeek = all.filter((s) => daysAgo(s.ended_at) < 7 && s.status !== "SKIPPED").length;
  const lastWeek = all.filter((s) => daysAgo(s.ended_at) >= 7 && daysAgo(s.ended_at) < 14 && s.status !== "SKIPPED").length;
  const reviews = patients.flatMap((p) => (p.review_flags || []).map((f) => ({ ...f, patient: p })));
  const painSessions = all.filter((s) => s.high_pain && daysAgo(s.ended_at) < 7);
  const painPatients = new Set(painSessions.map((s) => s.patient.id));
  patients.filter((p) => p.pain_alert).forEach((p) => painPatients.add(p.id));
  const active = patients.filter((p) => p.account_status === "ACTIVE").length;

  const q = query.trim().toLowerCase();
  const shown = q
    ? patients.filter((p) => [p.name, p.email, p.surgery_type].some((v) => (v || "").toLowerCase().includes(q)))
    : patients;

  // review list: flags + high-pain sessions, newest first
  const needsReview = [
    ...reviews.map((f) => ({
      key: `f${f.session_id}`,
      patient: f.patient,
      what: f.exercise_name,
      tag: FLAG_LABEL[f.flag] || f.flag,
      tone: f.flag === "PAIN_STOP" ? "red" : "amber",
      date: f.date,
      to: `/sessions/${f.session_id}`,
    })),
    ...painSessions.map((s) => ({
      key: `p${s.id}`,
      patient: s.patient,
      what: s.exercise_name,
      tag: `Pain ${s.pain_score}/10`,
      tone: "red",
      date: s.ended_at,
      to: `/sessions/${s.id}`,
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div>
      <div className="dash-head">
        <div>
          <h1>Clinician Dashboard</h1>
          <p>Monitor your patients, review session performance and manage rehabilitation plans.</p>
        </div>
        <div className="dash-actions">
          <Link className="btn btn-outline" to="/therapist/patients?add=1">
            <Icon name="plus" size={18} /> Add patient
          </Link>
          {planFor && (
            <Link className="btn btn-primary" to={`/therapist/patients/${planFor}/plan/new`}>
              <Icon name="clipboard" size={18} /> Create prescription
            </Link>
          )}
        </div>
      </div>

      <div className="kpis">
        <Kpi icon="users" label="My Patients" value={patients.length} sub={`${active} active`} to="/therapist/patients" />
        <Kpi
          icon="chart"
          tone="teal"
          label="Sessions This Week"
          value={sessions ? thisWeek : "…"}
          sub={sessions ? `${lastWeek} the week before` : ""}
        />
        <Kpi
          icon="file"
          tone="violet"
          label="Pending Reviews"
          value={needsReview.length}
          sub="Flags and high pain, last 7 days"
          valueClass={needsReview.length ? "warn" : ""}
        />
        <Kpi
          icon="alert"
          tone="red"
          label="Pain Alerts"
          value={painPatients.size}
          sub="Patients reporting pain ≥ 7/10"
          valueClass={painPatients.size ? "bad" : ""}
        />
      </div>

      <div className="dash-grid">
        <Panel
          className="span-7"
          flush
          title="My Patients"
          icon="users"
          action={
            <input
              className="search"
              style={{ width: 220 }}
              placeholder="Search patients..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          }
        >
          {patients.length === 0 ? (
            <p className="empty">
              No patients yet. <Link to="/therapist/patients?add=1">Add your first patient</Link>.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Last session</th>
                    <th>Adherence</th>
                    <th>Pain</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 8).map((p) => {
                    const lastPain = all.find((s) => s.patient.id === p.id && s.pain_score != null);
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="person">
                            <Avatar name={p.name} />
                            <div>
                              <div className="strong">{p.name}</div>
                              <div className="muted">{p.surgery_type || "-"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="nowrap">{fmtDate(p.last_session_at)}</td>
                        <td>
                          {p.account_status === "ACTIVE" ? (
                            <>
                              <PctBar pct={p.badge.avg_adherence_pct} color={p.badge.color} />
                              <AdherenceBadge badge={p.badge} />
                            </>
                          ) : (
                            <AccountBadge status={p.account_status} />
                          )}
                        </td>
                        <td>{lastPain ? <PainBadge score={lastPain.pain_score} /> : <span className="muted">-</span>}</td>
                        <td className="right">
                          <Link className="btn btn-outline btn-sm" to={`/therapist/patients/${p.id}`}>
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {shown.length === 0 && <p className="empty">No patient matches "{query}".</p>}
              {shown.length > 8 && (
                <p className="empty">
                  <PanelLink to="/therapist/patients">See all {shown.length} patients</PanelLink>
                </p>
              )}
            </div>
          )}
        </Panel>

        <div className="span-5">
          <RecoveryTrend patients={patients} />
        </div>

        <Panel className="span-4" title="Recent Sessions" icon="activity">
          {sessions === null ? (
            <p className="empty">Loading...</p>
          ) : all.length === 0 ? (
            <p className="empty">No sessions yet.</p>
          ) : (
            <div className="list">
              {all.slice(0, 5).map((s) => (
                <Link key={s.id} to={`/sessions/${s.id}`} className="list-row">
                  <Avatar name={s.patient.name} />
                  <span className="list-main">
                    <span className="list-title">{s.patient.name}</span>
                    <span className="list-sub">{s.exercise_name}</span>
                    <span className="list-sub">{fmtDate(s.ended_at)}</span>
                  </span>
                  <SessionChip s={s} />
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="span-4" title="Sessions Needing Review" icon="alert">
          {needsReview.length === 0 ? (
            <p className="empty">Nothing to review. No patient skipped because they were unwell, stopped for pain or reported pain ≥ 7.</p>
          ) : (
            <div className="list">
              {needsReview.slice(0, 5).map((r) => (
                <Link key={r.key} to={r.to} className="list-row">
                  <Avatar name={r.patient.name} />
                  <span className="list-main">
                    <span className="list-title">{r.patient.name}</span>
                    <span className="list-sub">{r.what}</span>
                    <span className="list-sub">{fmtDate(r.date)}</span>
                  </span>
                  <span className={`badge badge-${r.tone}`}>{r.tag}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="span-4" title="Quick Actions" icon="list">
          <div className="quick-grid">
            <button className="quick" onClick={() => navigate("/therapist/patients?add=1")}>
              <IconTile name="plus" tone="violet" /> Add patient
            </button>
            <button className="quick" onClick={() => navigate("/therapist/exercises")}>
              <IconTile name="library" tone="teal" /> Exercise library
            </button>
            <button className="quick" onClick={() => navigate("/therapist/patients")}>
              <IconTile name="users" tone="blue" /> All patients
            </button>
            <button className="quick" onClick={() => navigate("/safety")}>
              <IconTile name="heart" tone="red" /> Safety info
            </button>
          </div>
          {patients.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <label>
                Create a prescription for
                <span className="dash-actions" style={{ flexWrap: "nowrap" }}>
                  <select value={planFor} onChange={(e) => setPlanFor(e.target.value)}>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-primary" onClick={() => navigate(`/therapist/patients/${planFor}/plan/new`)}>
                    Go
                  </button>
                </span>
              </label>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
