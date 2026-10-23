import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { SessionStatusBadge } from "../components/Badge.jsx";
import SkipDialog from "../components/SkipDialog.jsx";

const SIDE = { LEFT: "Left side", RIGHT: "Right side", BOTH: "Both sides" };

function ExerciseCard({ p, onStart, onSkip }) {
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
        {p.time_of_day ? ` · best at ${p.time_of_day}` : ""} · {p.days_label} ·{" "}
        {p.view === "side" ? "side-on to camera" : "facing the camera"}
      </p>
      <p className="instructions">{p.instructions}</p>
      {p.note && <div className="alert alert-grey small">From your therapist: {p.note}</div>}
      <p className="muted small">Instructions need clinician review before real use.</p>
      <div className="row-gap">
        <button className="btn btn-primary btn-lg grow" onClick={() => onStart(p)}>
          {done ? "Do it again" : "Start"}
        </button>
        {onSkip && !done && (
          <button className="btn btn-ghost" onClick={() => onSkip(p)}>
            Skip today
          </button>
        )}
      </div>
    </div>
  );
}

export default function PatientPlan() {
  const navigate = useNavigate();
  const [today, setToday] = useState(null);
  const [error, setError] = useState("");
  const [skip, setSkip] = useState(null); // { item }

  const load = () =>
    api
      .today()
      .then((t) => {
        setToday(t);
        setError("");
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const start = (p) => navigate(`/patient/session/${p.id}`);
  const paused = today && today.plan_status === "PAUSED";

  return (
    <div>
      <div className="dash-head">
        <div>
          <h1>My Exercise Plan</h1>
          <p>
            Prescribed by your therapist{today && today.plan_version ? ` · version ${today.plan_version}` : ""}. Exercises
            for today come first.
          </p>
        </div>
      </div>
      {error && <div className="alert alert-red">{error}</div>}
      {today === null && !error && <p className="muted">Loading...</p>}
      {paused && (
        <div className="alert alert-amber">
          <b>Your plan is paused by your therapist.</b> {today.plan_status_reason ? `Reason: ${today.plan_status_reason}.` : ""}
        </div>
      )}
      {today && today.plan_note && <div className="alert alert-grey">From your therapist: {today.plan_note}</div>}
      {today && today.items.length === 0 && today.other_items.length === 0 && (
        <div className="card">
          <p className="muted">You have no active exercise plan right now. Your therapist will add one.</p>
        </div>
      )}

      {today && today.items.length > 0 && (
        <>
          <div className="section-head">
            <h2>Today ({today.weekday})</h2>
          </div>
          <div className="plan-cards">
            {today.items.map((p) => (
              <ExerciseCard key={p.id} p={p} onStart={start} onSkip={paused ? null : (item) => setSkip({ item })} />
            ))}
          </div>
        </>
      )}
      {today && today.other_items.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 26 }}>
            <h2>Other days</h2>
          </div>
          <div className="plan-cards">
            {today.other_items.map((p) => (
              <ExerciseCard key={p.id} p={{ ...p, today_status: null }} onStart={start} />
            ))}
          </div>
        </>
      )}

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
