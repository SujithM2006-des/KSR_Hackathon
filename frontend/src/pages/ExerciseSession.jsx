import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, getUser, newRequestId } from "../api.js";
import { FollowedBadge, ModeBadge, SessionStatusBadge } from "../components/Badge.jsx";
import SafetyNote from "../components/SafetyNote.jsx";
import { Icon } from "../components/Icons.jsx";

// One exercise, start to finish:
//   check   -> "Do you feel okay to exercise today?"
//   choose  -> start with the live camera or the recorded test video
//   tracked -> the session runs on this computer; its video and live numbers are shown on this page
//   after   -> pain score + note
//   done    -> summary
const POLL_MS = 2000; // looking for the saved session
const STATUS_MS = 500; // live numbers from the running session
const ZONE_CLASS = { GOOD: "ok", UNDER: "warn", OVER: "bad" };

// Live video + numbers from the session runner (session_runner.py --stream-port)
function LiveSession({ stream, item, onStop }) {
  const base = `${window.location.protocol}//${window.location.hostname}:${stream.port}`;
  const q = `t=${encodeURIComponent(stream.token)}`;
  const [st, setSt] = useState({ phase: "loading" });
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${base}/status?${q}`, { cache: "no-store" });
        if (r.ok && alive) setSt(await r.json());
      } catch {
        /* not started yet, or already finished */
      }
    };
    tick();
    const t = setInterval(tick, STATUS_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [base, q]);

  async function stop(pain) {
    setStopping(true);
    try {
      await fetch(`${base}/stop?${q}`, { cache: "no-store" });
    } catch {
      /* already stopped */
    }
    onStop(pain);
  }

  const running = st.phase === "running";
  return (
    <section className="panel live-panel">
      <div className="live-video">
        {st.phase === "error" ? (
          <div className="live-wait">
            <Icon name="alert" size={30} />
            <b>{st.message || "The camera could not start."}</b>
          </div>
        ) : running || st.phase === "saving" || st.phase === "finished" ? (
          <img src={`${base}/stream?${q}`} alt="Live exercise tracking" />
        ) : (
          <div className="live-wait">
            <span className="spinner" />
            <b>Starting the camera and the pose model...</b>
            <span className="muted small">This takes a few seconds the first time.</span>
          </div>
        )}
      </div>

      <aside className="live-side">
        <h3>Live session</h3>
        {st.phase === "saving" || st.phase === "finished" ? (
          <div className="alert alert-green small">Session finished - saving your result...</div>
        ) : st.cue ? (
          <div className="live-cue">{st.cue}</div>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            Stand {item.view === "side" ? "side-on to" : "facing"} the camera with your {item.joint ? item.joint.toLowerCase() : "body"} in view.
          </p>
        )}
        <div className="live-stats">
          <div>
            <span>Set</span>
            <b>
              {st.set_no || 1}/{st.sets || item.sets}
            </b>
          </div>
          <div>
            <span>Rep</span>
            <b>
              {st.rep_in_set || 0}/{st.reps || item.reps_per_set}
            </b>
          </div>
          <div className="wide">
            <span>Angle now</span>
            <b className={ZONE_CLASS[st.zone] || ""}>{st.angle != null ? `${st.angle}°` : "-"}</b>
            <small>
              target {item.min_angle}° – {item.max_angle}°
            </small>
          </div>
        </div>
        <div className="live-results">
          <span className="badge badge-green">Good {st.good || 0}</span>
          <span className="badge badge-amber">Under {st.under || 0}</span>
          <span className="badge badge-red">Over {st.over || 0}</span>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Total {st.done || 0} of {st.prescribed || item.sets * item.reps_per_set} reps
        </p>
        <div className="live-actions">
          <button className="btn btn-primary" disabled={stopping} onClick={() => stop(false)}>
            {stopping ? "Stopping..." : "Finish session"}
          </button>
          <button className="btn btn-outline danger-text" disabled={stopping} onClick={() => stop(true)}>
            I feel pain - stop
          </button>
        </div>
      </aside>
    </section>
  );
}

export default function ExerciseSession() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const user = getUser();
  const cameraAllowed = Boolean(user && user.consent && user.consent.camera_allowed);

  const [item, setItem] = useState(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("check");
  const [notWell, setNotWell] = useState(null); // reason text while the "not well" form is open
  const [input, setInput] = useState(null); // { mode: "video" | "camera", video, available }
  const [stream, setStream] = useState(null); // { port, token } of the running session
  const [starting, setStarting] = useState(false);

  // result
  const [session, setSession] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pain, setPain] = useState(2);
  const [note, setNote] = useState("");

  const pollRef = useRef(null);
  const lastIdRef = useRef(0);

  useEffect(() => {
    api
      .today()
      .then((t) => {
        const found = [...t.items, ...t.other_items].find((i) => String(i.id) === String(planId));
        if (!found) setError("This exercise is not in your active plan (it may be paused or changed by your therapist).");
        setItem(found || null);
      })
      .catch((e) => setError(e.message));
    api
      .sessionInput(planId)
      .then(setInput)
      .catch(() => setInput(null));
    return () => clearInterval(pollRef.current);
  }, [planId]);

  // ---------- not well today ----------
  async function sendNotWell(e) {
    e.preventDefault();
    try {
      await api.skipToday({ plan_id: item.id, reason: notWell.trim() || null, not_well: true, client_request_id: newRequestId() });
      navigate("/patient");
    } catch (err) {
      setError(err.message);
    }
  }

  // ---------- start tracking ----------
  // useCamera: live webcam even when test videos are the default input
  async function startTracking(useCamera) {
    setError("");
    setStarting(true);
    try {
      const current = await api.mySessions();
      lastIdRef.current = current.length ? Math.max(...current.map((s) => s.id)) : 0;
      const res = await api.startSession(item.id, useCamera);
      setStream(res.stream);
      setStage("tracked");
      clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const list = await api.mySessions();
          const fresh = list.find((s) => s.id > lastIdRef.current && s.plan_id === item.id);
          if (fresh) {
            clearInterval(pollRef.current);
            setSession(fresh);
            setStage("after");
          }
        } catch {
          /* keep polling */
        }
      }, POLL_MS);
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  }

  // the runner saves what was done; "I feel pain" pre-sets a higher pain score for the question that follows
  function onStopped(painStop) {
    if (painStop) setPain(6);
  }

  // ---------- after ----------
  async function submitAfter(skipPain) {
    setSaving(true);
    setError("");
    try {
      const s = await api.setPain(session.id, skipPain ? null : Number(pain), note.trim() || null);
      setSession(s);
      setStage("done");
    } catch (e) {
      setError(`Not saved yet: ${e.message}. Please try again.`);
    } finally {
      setSaving(false);
    }
  }

  if (!item) {
    return (
      <div className="session-page">
        <Link to="/patient" className="back">
          ← Today
        </Link>
        {error ? <div className="alert alert-red">{error}</div> : <p className="muted">Loading...</p>}
      </div>
    );
  }

  return (
    <div className="session-page">
      {stage !== "tracked" && (
        <Link to="/patient" className="back">
          ← Today
        </Link>
      )}
      <div className="dash-head">
        <div>
          <h1>{item.exercise_name}</h1>
          <p>
            {item.sets} × {item.reps_per_set} reps · target {item.min_angle}°–{item.max_angle}° (approx.)
            {item.hold_s ? ` · hold ${item.hold_s}s` : ""} · {item.side === "BOTH" ? "both sides" : `${item.side.toLowerCase()} side`}
          </p>
        </div>
      </div>

      <SafetyNote />
      {error && <div className="alert alert-red">{error}</div>}

      {/* ---------- check ---------- */}
      {stage === "check" && (
        <div className="card">
          <h3>Do you feel okay to exercise today?</h3>
          <p className="muted">This short check does not replace medical advice.</p>
          <p className="instructions">{item.instructions}</p>
          {item.note && <div className="alert alert-grey small">From your therapist: {item.note}</div>}
          {notWell === null ? (
            <div className="big-actions">
              <button className="btn btn-primary btn-lg" onClick={() => setStage("choose")}>
                I feel okay to exercise
              </button>
              <button className="btn btn-outline btn-lg" onClick={() => setNotWell("")}>
                I'm not well today
              </button>
            </div>
          ) : (
            <form className="stack" onSubmit={sendNotWell}>
              <div className="alert alert-amber">
                If you have chest pain, fainting, sudden severe pain, new numbness or a fall, stop and call <b>108</b> or
                see a doctor now.
              </div>
              <label>
                Tell your therapist how you feel (optional)
                <textarea rows={2} maxLength={300} value={notWell} onChange={(e) => setNotWell(e.target.value)} />
              </label>
              <div className="row-gap">
                <button className="btn btn-primary">Skip today and tell my therapist</button>
                <button type="button" className="btn btn-ghost" onClick={() => setNotWell(null)}>
                  Back
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ---------- choose the camera / test video ---------- */}
      {stage === "choose" && (
        <div className="card">
          <h3>Start your session</h3>
          {cameraAllowed ? (
            <>
              <p className="muted">
                Your live video appears below on this page. ReHabRep counts your reps and gives spoken cues. Stand{" "}
                {item.view === "side" ? "side-on to" : "facing"} the camera with your{" "}
                {item.joint ? item.joint.toLowerCase() : "body part"} clearly visible, in good light.
              </p>
              <div className="start-actions">
                <button className="btn btn-primary btn-lg" disabled={starting} onClick={() => startTracking(true)}>
                  <Icon name="camera" size={20} /> {starting ? "Starting..." : "Start with my camera"}
                </button>
                {input && input.mode === "video" && input.available && (
                  <button className="btn btn-outline btn-lg" disabled={starting} onClick={() => startTracking(false)}>
                    <Icon name="play" size={18} /> Start with test video
                  </button>
                )}
              </div>
              {input && input.mode === "video" && input.available && (
                <p className="muted small" style={{ margin: "10px 0 0" }}>
                  The test video plays the recording <code>{input.video}</code> instead of your camera.
                </p>
              )}
            </>
          ) : (
            <p className="muted">
              Camera use is off in your consent choices. Turn it on in <Link to="/patient/settings">Settings</Link> to
              exercise with ReHabRep.
            </p>
          )}
        </div>
      )}

      {/* ---------- live session ---------- */}
      {stage === "tracked" && stream && <LiveSession stream={stream} item={item} onStop={onStopped} />}

      {/* ---------- after: pain + note ---------- */}
      {stage === "after" && session && (
        <div className="card highlight">
          <h3>How much pain did you feel?</h3>
          <p className="muted">0 = no pain, 10 = worst pain. Your therapist will see this.</p>
          <div className="pain-row">
            <input type="range" min="0" max="10" value={pain} onChange={(e) => setPain(e.target.value)} className="pain-slider" aria-label="Pain score" />
            <span className={`pain-value ${pain >= 7 ? "bad" : pain >= 4 ? "warn" : "ok"}`}>{pain}</span>
          </div>
          <label>
            Anything to tell your therapist? (optional)
            <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="row-gap">
            <button className="btn btn-primary" disabled={saving} onClick={() => submitAfter(false)}>
              {saving ? "Saving..." : "Submit"}
            </button>
            <button className="btn btn-ghost" disabled={saving} onClick={() => submitAfter(true)}>
              Skip pain question
            </button>
          </div>
        </div>
      )}

      {/* ---------- done ---------- */}
      {stage === "done" && session && (
        <div className="card highlight">
          <h3>Saved - your therapist can see it</h3>
          <p>
            <SessionStatusBadge status={session.status} /> <ModeBadge mode={session.mode} />
          </p>
          {session.measured ? (
            <p>
              {session.good_reps} of {session.prescribed_reps} reps were in your target range.{" "}
              <FollowedBadge value={session.plan_followed} />
            </p>
          ) : (
            <p>
              You confirmed {session.reps_done} of {session.prescribed_reps} reps. Angles were not measured.
            </p>
          )}
          {session.high_pain && (
            <div className="alert alert-red">
              You reported high pain. Please rest and contact your therapist. If it is severe, call 108.
            </div>
          )}
          <div className="row-gap">
            <Link className="btn btn-primary" to="/patient">
              Done
            </Link>
            <Link className="btn btn-outline" to={`/sessions/${session.id}`}>
              View report
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
