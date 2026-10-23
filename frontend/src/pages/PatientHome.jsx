import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, fmtDate, getUser } from "../api.js";
import { SessionStatusBadge } from "../components/Badge.jsx";
import { Donut, JOINT_TONE, Kpi, Panel, PanelLink, PIE } from "../components/Dash.jsx";
import { Icon, IconTile } from "../components/Icons.jsx";
import SkipDialog from "../components/SkipDialog.jsx";
import { SessionsTable } from "./PatientSessions.jsx";
import EmergencyCall from "../components/EmergencyCall.jsx";

const DAY = 24 * 3600 * 1000;
const PAIN_WORD = (p) => (p >= 7 ? "Severe" : p >= 4 ? "Moderate" : p >= 1 ? "Mild" : "No pain");

function ExerciseRow({ p, onStart, onSkip, disabled }) {
  const done = p.today_status === "DONE";
  return (
    <div className="ex-row">
      <span className={`ex-thumb tone-${JOINT_TONE[p.joint] || "violet"}`}>
        <Icon name="activity" size={28} />
      </span>
      <div>
        <h4>{p.exercise_name}</h4>
        <div className="ex-meta">
          <span className="badge badge-violet">{p.joint}</span>
          <span>
            <b>
              {p.sets} × {p.reps_per_set}
            </b>{" "}
            reps
          </span>
          <span>
            Target {p.min_angle}° – {p.max_angle}°
          </span>
          {p.rest_s ? (
            <span>
              <Icon name="history" size={15} /> Rest {p.rest_s}s
            </span>
          ) : null}
        </div>
      </div>
      <div className="ex-actions">
        <SessionStatusBadge status={p.today_status} />
        <button className="btn btn-primary" disabled={disabled} onClick={() => onStart(p)}>
          <Icon name="play" size={16} /> {done ? "Do it again" : "Start session"}
        </button>
        {!done && onSkip && (
          <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => onSkip(p)}>
            Skip today
          </button>
        )}
      </div>
    </div>
  );
}

// Best angle of each camera-measured session for one exercise, with the prescribed band
function ProgressChart({ sessions }) {
  const measured = sessions.filter((s) => s.measured && s.max_angle_reached != null);
  const exercises = useMemo(() => {
    const m = new Map();
    measured.forEach((s) => m.set(s.exercise_type, s.exercise_name));
    return [...m.entries()];
  }, [sessions]);
  const [key, setKey] = useState(exercises[0] ? exercises[0][0] : "");
  const active = exercises.some(([k]) => k === key) ? key : exercises[0] ? exercises[0][0] : "";
  const rows = measured
    .filter((s) => s.exercise_type === active)
    .slice()
    .reverse()
    .map((s) => ({
      date: new Date(s.ended_at).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      angle: Math.round(s.max_angle_reached),
      min: s.min_angle,
      max: s.max_angle,
    }));
  const last = rows[rows.length - 1];

  return (
    <Panel
      title="Recovery Progress"
      icon="trend"
      action={
        exercises.length > 0 && (
          <select value={active} onChange={(e) => setKey(e.target.value)} aria-label="Exercise">
            {exercises.map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </select>
        )
      }
    >
      {rows.length === 0 ? (
        <p className="empty">Your progress chart appears after your first session with the camera.</p>
      ) : (
        <>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="#eef0f7" vertical={false} />
                <ReferenceArea y1={last.min} y2={last.max} fill="#5b34ea" fillOpacity={0.08} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#5d6585" }} />
                <YAxis domain={[0, 180]} tick={{ fontSize: 11, fill: "#5d6585" }} unit="°" />
                <Tooltip formatter={(v) => [`${v}°`, "Best angle"]} />
                <Line type="monotone" dataKey="angle" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="muted small" style={{ margin: "8px 0 0" }}>
            Latest: <b>{last.angle}°</b> · target {last.min}° – {last.max}° (shaded). Angles are camera estimates.
          </p>
        </>
      )}
    </Panel>
  );
}

export default function PatientHome() {
  const user = getUser();
  const navigate = useNavigate();
  const [today, setToday] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState("");
  const [skip, setSkip] = useState(null); // { item } - item null = all of today

  async function load() {
    try {
      const [t, s] = await Promise.all([api.today(), api.mySessions()]);
      setToday(t);
      setSessions(s);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error && !today) return <div className="alert alert-red">{error}</div>;
  if (!today) return <p className="muted">Loading...</p>;

  const start = (p) => navigate(`/patient/session/${p.id}`);
  const paused = today.plan_status === "PAUSED";
  const ended = !today.plan_status || today.plan_status === "ENDED";
  const left = today.items.filter((i) => i.today_status !== "DONE").length;
  const adh = today.adherence_7d;
  const lastPain = sessions.find((s) => s.pain_score != null);
  const now = new Date();
  const monthDone = sessions.filter((s) => {
    const d = new Date(s.ended_at);
    return s.status === "COMPLETED" && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const week = sessions.filter((s) => Date.now() - new Date(s.ended_at).getTime() < 7 * DAY);
  const wk = {
    done: week.filter((s) => s.status === "COMPLETED").length,
    partly: week.filter((s) => s.status === "PARTIAL" || s.status === "INTERRUPTED").length,
    skipped: week.filter((s) => s.status === "SKIPPED").length,
  };
  const notes = [
    ...(today.plan_note ? [{ key: "plan", title: "About your plan", text: today.plan_note }] : []),
    ...[...today.items, ...today.other_items]
      .filter((i) => i.note)
      .map((i) => ({ key: i.id, title: i.exercise_name, text: i.note })),
  ];

  return (
    <div>
      <div className="dash-head">
        <div>
          <h1>Hello, {user.name.split(" ")[0]}</h1>
          <p>Your recovery dashboard. Follow your clinician-prescribed plan, one rep at a time.</p>
        </div>
        <Link to="/safety" className="btn btn-outline">
          <Icon name="heart" size={18} /> Safety and help
        </Link>
      </div>

      {error && <div className="alert alert-red">{error}</div>}

      <div className="kpis">
        <Kpi
          icon="clipboard"
          label="Today's Plan"
          value={today.items.length ? `${today.items.length - left}/${today.items.length}` : "-"}
          sub={today.items.length ? "exercises done today" : "nothing scheduled today"}
          to="/patient/plan"
        />
        <Kpi
          icon="target"
          tone="teal"
          label="Weekly Adherence"
          value={adh ? `${adh.pct}%` : "-"}
          sub={adh ? `${adh.done}/${adh.scheduled} done · streak ${today.streak.days} day${today.streak.days === 1 ? "" : "s"}` : "shows after your first full day"}
        />
        <Kpi
          icon="heart"
          tone="red"
          label="Last Pain Check-in"
          value={lastPain ? `${lastPain.pain_score}/10` : "-"}
          sub={lastPain ? PAIN_WORD(lastPain.pain_score) : "no check-in yet"}
          valueClass={lastPain && lastPain.pain_score >= 7 ? "bad" : ""}
        />
        <Kpi icon="activity" tone="blue" label="Sessions Completed" value={monthDone} sub="this month" to="/patient/sessions" />
      </div>

      {paused && (
        <div className="alert alert-amber">
          <b>Your plan is paused by your therapist.</b> {today.plan_status_reason ? `Reason: ${today.plan_status_reason}. ` : ""}
          Please wait until they resume it, and contact them if you have questions.
        </div>
      )}
      {today.all_done_today && <div className="alert alert-green">All done for today. Well done!</div>}

      <div className="dash-grid">
        <Panel
          className="span-7"
          title="Today's Prescribed Exercises"
          icon="calendar"
          action={
            <span className="dash-actions">
              {left > 0 && !paused && (
                <button className="btn btn-ghost btn-sm" onClick={() => setSkip({ item: null })}>
                  I can't exercise today
                </button>
              )}
              <PanelLink to="/patient/plan">View full plan</PanelLink>
            </span>
          }
        >
          {ended && !paused ? (
            <p className="empty">You have no active exercise plan right now. Your therapist will add one.</p>
          ) : today.items.length === 0 ? (
            <p className="empty">Nothing is scheduled for today. Rest well.</p>
          ) : (
            today.items.map((p) => (
              <ExerciseRow key={p.id} p={p} onStart={start} disabled={paused} onSkip={(item) => setSkip({ item })} />
            ))
          )}
        </Panel>

        <div className="span-5">
          <ProgressChart sessions={sessions} />
        </div>

        <Panel className="span-4" title="Last 7 Days" icon="target">
          <Donut
            parts={[
              { label: "Completed", value: wk.done, color: PIE.green },
              { label: "Partly done", value: wk.partly, color: PIE.amber },
              { label: "Skipped", value: wk.skipped, color: PIE.grey },
            ]}
            center={adh ? `${adh.pct}%` : week.length}
            centerLabel={adh ? "adherence" : "sessions"}
          />
        </Panel>

        <Panel className="span-4" title="Your Clinician's Notes" icon="note">
          {notes.length === 0 ? (
            <p className="empty">No notes from your clinician right now.</p>
          ) : (
            notes.map((n) => (
              <div className="note-card" key={n.key}>
                <IconTile name="stethoscope" tone="violet" size={18} />
                <div>
                  <b>{n.title}</b>
                  <p>{n.text}</p>
                </div>
              </div>
            ))
          )}
        </Panel>

        <Panel className="span-4" title="Safety First" icon="shield">
          <p style={{ marginTop: 0 }}>
            <b>Stop if you feel sharp, worsening or unusual pain</b>, then tell your clinician. After each session you can
            record your pain from 0 to 10.
          </p>
          <div className="emergency">
            <span>Emergency</span>
            <EmergencyCall />
          </div>
        </Panel>

        <Panel className="span-12" flush title="Recent Sessions" icon="history" action={<PanelLink to="/patient/sessions" />}>
          {sessions.length === 0 ? (
            <p className="empty">No sessions yet. Press "Start session" above to begin.</p>
          ) : (
            <SessionsTable sessions={sessions.slice(0, 5)} />
          )}
        </Panel>
      </div>

      {skip && (
        <SkipDialog
          item={skip.item}
          onClose={() => setSkip(null)}
          onDone={() => {
            setSkip(null);
            load();
          }}
        />
      )}
    </div>
  );
}
