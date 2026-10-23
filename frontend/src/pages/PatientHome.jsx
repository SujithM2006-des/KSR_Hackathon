import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate, getUser } from "../api.js";
import { FollowedBadge, PainBadge } from "../components/Badge.jsx";

const POLL_MS = 3000;

export default function PatientHome() {
  const user = getUser();
  const [plans, setPlans] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState("");

  // session flow: idle -> running -> pain -> done
  const [stage, setStage] = useState("idle");
  const [source, setSource] = useState("");
  const [newSession, setNewSession] = useState(null);
  const [pain, setPain] = useState(3);
  const lastIdRef = useRef(0);
  const pollRef = useRef(null);

  async function load() {
    try {
      const [p, s] = await Promise.all([api.myPlans(), api.mySessions()]);
      setPlans(p);
      setSessions(s);
      return s;
    } catch (e) {
      setError(e.message);
      return [];
    }
  }

  useEffect(() => {
    load();
    return () => clearInterval(pollRef.current);
  }, []);

  async function start(plan) {
    setError("");
    try {
      const current = await api.mySessions();
      lastIdRef.current = current.length ? Math.max(...current.map((s) => s.id)) : 0;
      await api.startSession(plan.id, source.trim() || null);
      setStage("running");

      clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const list = await api.mySessions();
          const fresh = list.find((s) => s.id > lastIdRef.current);
          if (fresh) {
            clearInterval(pollRef.current);
            setNewSession(fresh);
            setSessions(list);
            setStage("pain");
          }
        } catch {
          /* keep polling */
        }
      }, POLL_MS);
    } catch (e) {
      setError(e.message);
    }
  }

  function cancelWaiting() {
    clearInterval(pollRef.current);
    setStage("idle");
  }

  async function submitPain(skip) {
    try {
      if (!skip) {
        const updated = await api.setPain(newSession.id, Number(pain));
        setNewSession(updated);
      }
      setStage("done");
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Hello, {user.name.split(" ")[0]}</h1>
          <p className="muted">Here is today's exercise plan from your physiotherapist.</p>
        </div>
      </div>

      {error && <div className="alert alert-red">{error}</div>}

      {/* ---------- running / pain / done panels ---------- */}
      {stage === "running" && (
        <div className="card highlight">
          <h3>Exercise window is open</h3>
          <p>
            Follow the voice and on-screen cues. When you finish, press <b>Q</b> in the exercise window (or let the
            video end). This page will update by itself.
          </p>
          <div className="waiting">
            <span className="spinner" /> Waiting for your session to finish...
          </div>
          <button className="btn btn-ghost" onClick={cancelWaiting}>
            Cancel
          </button>
        </div>
      )}

      {stage === "pain" && newSession && (
        <div className="card highlight">
          <h3>Well done! How much pain did you feel?</h3>
          <p className="muted">0 = no pain, 10 = worst pain. Your physiotherapist will see this.</p>
          <div className="pain-row">
            <input
              type="range"
              min="0"
              max="10"
              value={pain}
              onChange={(e) => setPain(e.target.value)}
              className="pain-slider"
            />
            <span className={`pain-value ${pain >= 7 ? "bad" : pain >= 4 ? "warn" : "ok"}`}>{pain}</span>
          </div>
          <div className="row-gap">
            <button className="btn btn-primary" onClick={() => submitPain(false)}>
              Submit
            </button>
            <button className="btn btn-ghost" onClick={() => submitPain(true)}>
              Skip
            </button>
          </div>
        </div>
      )}

      {stage === "done" && newSession && (
        <div className="card highlight">
          <h3>Session saved</h3>
          <p>
            {newSession.good_reps} of {newSession.prescribed_reps} reps were in your target range.{" "}
            <FollowedBadge value={newSession.plan_followed} />
          </p>
          {newSession.high_pain && (
            <div className="alert alert-red">
              You reported high pain. Your physiotherapist has been alerted. If pain is severe, stop exercising and
              contact them.
            </div>
          )}
          <div className="row-gap">
            <Link className="btn btn-outline" to={`/sessions/${newSession.id}`}>
              View report
            </Link>
            <button className="btn btn-ghost" onClick={() => setStage("idle")}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* ---------- plans ---------- */}
      {plans === null ? (
        <p className="muted">Loading...</p>
      ) : plans.length === 0 ? (
        <div className="card">
          <p className="muted">Your physiotherapist hasn't assigned a plan yet.</p>
        </div>
      ) : (
        <div className="plan-cards">
          {plans.map((p) => (
            <div className="card plan-card" key={p.id}>
              <div className="plan-card-top">
                <span className="joint-chip">{p.joint}</span>
                <span className="muted small">{p.view === "side" ? "Side-on to camera" : "Facing the camera"}</span>
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
                  <span className="muted small">target range</span>
                </div>
              </div>
              <p className="instructions">{p.instructions}</p>
              <button className="btn btn-primary btn-block" disabled={stage === "running"} onClick={() => start(p)}>
                Start session
              </button>
            </div>
          ))}
        </div>
      )}

      <details className="card source-box">
        <summary>Camera / video source (for demo)</summary>
        <p className="muted small">
          Leave empty to use the demo video <code>videos\squat_test.mp4</code>. Type <code>0</code> for the webcam, or a
          path like <code>videos\knee_ext_1.mp4</code>.
        </p>
        <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="videos\squat_test.mp4" />
      </details>

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
                <th>Correct reps</th>
                <th>Pain</th>
                <th>Plan followed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{fmtDate(s.ended_at)}</td>
                  <td>{s.exercise_name}</td>
                  <td>
                    {s.good_reps}/{s.prescribed_reps}
                  </td>
                  <td>
                    <PainBadge score={s.pain_score} />
                  </td>
                  <td>
                    <FollowedBadge value={s.plan_followed} />
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
    </div>
  );
}