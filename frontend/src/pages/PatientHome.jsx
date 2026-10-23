import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtDate, getUser, newRequestId } from "../api.js";
import { FollowedBadge, ModeBadge, PainBadge, SessionStatusBadge } from "../components/Badge.jsx";

const SIDE = { LEFT: "Left side", RIGHT: "Right side", BOTH: "Both sides" };

function ExerciseCard({ p, onStart, onSkip, disabled }) {
  const done = p.today_status === "DONE";
  return (
    <div className={`card plan-card ${done ? "is-done" : ""}`}>
      <div className="plan-card-top">
        <span className="joint-chip">{p.joint}</span>
        {p.today_status ? <SessionStatusBadge status={p.today_status} /> : <span className="muted small">{p.days_label}</span>}
      </div>
      <h2>{p.exercise_name}</h2>
      <div className="plan-facts">
        <div>
          <span className="big">
            {p.sets} × {p.reps_per_set}
          </span>
          <span className="muted small">sets × reps</span>
        </div>
        <div>
          <span className="big">
            {p.min_angle}° – {p.max_angle}°
          </span>
          <span className="muted small">target range (approx.)</span>
        </div>
      </div>
      <p className="muted small">
        {SIDE[p.side] || p.side}
        {p.hold_s ? ` · hold ${p.hold_s}s` : ""}
        {p.rest_s ? ` · rest ${p.rest_s}s between sets` : ""}
        {p.time_of_day ? ` · best at ${p.time_of_day}` : ""} · {p.view === "side" ? "side-on to camera" : "facing the camera"}
      </p>
      <p className="instructions">{p.instructions}</p>
      {p.note && <div className="alert alert-grey small">From your therapist: {p.note}</div>}
      <p className="muted small">Instructions need clinician review before real use.</p>
      <div className="row-gap">
        <button className="btn btn-primary btn-lg grow" disabled={disabled} onClick={() => onStart(p)}>
          {done ? "Do it again" : "Start"}
        </button>
        {onSkip && !done && (
          <button className="btn btn-ghost" disabled={disabled} onClick={() => onSkip(p)}>
            Skip today
          </button>
        )}
      </div>
    </div>
  );
}

export default function PatientHome() {
  const user = getUser();
  const navigate = useNavigate();
  const [today, setToday] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState("");
  const [skip, setSkip] = useState(null); // { item | null(all), reason, notWell }
  const [busy, setBusy] = useState(false);

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

  async function submitSkip(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.skipToday({
        plan_id: skip.item ? skip.item.id : null,
        reason: skip.reason.trim() || null,
        not_well: skip.notWell,
        client_request_id: newRequestId(),
      });
      setSkip(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const start = (p) => navigate(`/patient/session/${p.id}`);
  const paused = today && today.plan_status === "PAUSED";
  const ended = today && (!today.plan_status || today.plan_status === "ENDED");
  const left = today ? today.items.filter((i) => i.today_status !== "DONE").length : 0;
  const adh = today && today.adherence_7d;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Hello, {user.name.split(" ")[0]}</h1>
          <p className="muted">
            {today ? `${today.weekday} - ` : ""}here is what your therapist planned for today.
          </p>
        </div>
        <Link to="/safety" className="btn btn-outline">
          Safety and help
        </Link>
      </div>

      {error && <div className="alert alert-red">{error}</div>}

      {today && (
        <div className="stats">
          <div className="stat">
            <span className="stat-num">{today.items.length ? `${today.items.length - left}/${today.items.length}` : "-"}</span>
            <span className="stat-label">Done today</span>
          </div>
          <div className="stat" title={today.streak.rule}>
            <span className="stat-num ok">{today.streak.days}</span>
            <span className="stat-label">Day streak</span>
          </div>
          <div className="stat" title={today.adherence_rule}>
            <span className="stat-num">{adh ? `${adh.pct}%` : "Unavailable"}</span>
            <span className="stat-label">Last 7 days {adh ? `(${adh.done}/${adh.scheduled})` : ""}</span>
          </div>
        </div>
      )}
      {today && <p className="muted small rule-note">How these are counted: {today.streak.rule}</p>}

      {paused && (
        <div className="alert alert-amber">
          <b>Your plan is paused by your therapist.</b> {today.plan_status_reason ? `Reason: ${today.plan_status_reason}. ` : ""}
          Please wait until they resume it, and contact them if you have questions.
        </div>
      )}
      {today && ended && !paused && (
        <div className="card">
          <p className="muted">You have no active exercise plan right now. Your therapist will add one.</p>
        </div>
      )}
      {today && today.plan_note && !paused && <div className="alert alert-grey">From your therapist: {today.plan_note}</div>}

      {today === null && !error && <p className="muted">Loading...</p>}

      {today && today.items.length > 0 && (
        <>
          <div className="section-head">
            <h2>Today</h2>
            {left > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setSkip({ item: null, reason: "", notWell: false })}>
                I can't exercise today
              </button>
            )}
          </div>
          {today.all_done_today && <div className="alert alert-green">All done for today. Well done!</div>}
          <div className="plan-cards">
            {today.items.map((p) => (
              <ExerciseCard key={p.id} p={p} onStart={start} onSkip={(item) => setSkip({ item, reason: "", notWell: false })} />
            ))}
          </div>
        </>
      )}
      {today && !paused && today.plan_status === "ACTIVE" && today.items.length === 0 && (
        <div className="card">
          <p className="muted">Nothing is scheduled for today. Rest well.</p>
        </div>
      )}

      {today && today.other_items.length > 0 && (
        <details className="card other-days">
          <summary>Also in your plan on other days ({today.other_items.length})</summary>
          <div className="plan-cards">
            {today.other_items.map((p) => (
              <ExerciseCard key={p.id} p={{ ...p, today_status: null }} onStart={start} />
            ))}
          </div>
        </details>
      )}

      {/* ---------- history ---------- */}
      <div className="card table-card">
        <h3 className="pad-x">My sessions</h3>
        {sessions.length === 0 ? (
          <p className="muted pad">No sessions yet.</p>
        ) : (
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
                  <td>{fmtDate(s.ended_at)}</td>
                  <td>
                    <div>{s.exercise_name}</div>
                    <ModeBadge mode={s.mode} />
                  </td>
                  <td>
                    <SessionStatusBadge status={s.status} />
                  </td>
                  <td>
                    {s.status === "SKIPPED" ? (
                      <span className="muted">-</span>
                    ) : s.measured ? (
                      <>
                        {s.good_reps}/{s.prescribed_reps} in range <FollowedBadge value={s.plan_followed} />
                      </>
                    ) : (
                      `${s.reps_done}/${s.prescribed_reps} (you confirmed)`
                    )}
                  </td>
                  <td>
                    <PainBadge score={s.pain_score} />
                  </td>
                  <td className="right">
                    <Link className="btn btn-outline btn-sm" to={`/sessions/${s.id}`}>
                      Report
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {skip && (
        <div className="modal-backdrop" onClick={() => setSkip(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submitSkip}>
            <h3>{skip.item ? `Skip ${skip.item.exercise_name} today?` : "Skip today's exercises?"}</h3>
            <p className="muted">Your therapist will see this. A short reason helps them.</p>
            <label className="check-row">
              <input type="checkbox" checked={skip.notWell} onChange={(e) => setSkip({ ...skip, notWell: e.target.checked })} />
              <span>I'm not feeling well today</span>
            </label>
            <label>
              Reason (optional)
              <textarea rows={2} maxLength={300} value={skip.reason} onChange={(e) => setSkip({ ...skip, reason: e.target.value })} />
            </label>
            {skip.notWell && (
              <div className="alert alert-amber small">
                If you have chest pain, fainting, sudden severe pain or a fall, stop and call 112 or see a doctor.
              </div>
            )}
            <div className="row-gap right">
              <button type="button" className="btn btn-ghost" onClick={() => setSkip(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? "Saving..." : "Skip and tell my therapist"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}