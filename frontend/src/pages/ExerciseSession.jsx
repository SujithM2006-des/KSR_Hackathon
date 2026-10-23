import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, getUser, newRequestId } from "../api.js";
import { FollowedBadge, ModeBadge, SessionStatusBadge } from "../components/Badge.jsx";
import SafetyNote from "../components/SafetyNote.jsx";

// One exercise, start to finish:
//   check   -> "Do you feel okay to exercise today?"
//   choose  -> with the camera (opens the ReHabRep window) or without (guided, patient-confirmed)
//   tracked -> waiting for the camera window to finish
//   guided  -> set-by-set: Set done, rest countdown, Pause, Stop, I feel pain
//   painstop-> stop guidance after "I feel pain"
//   after   -> pain score + note
//   done    -> summary
const POLL_MS = 3000;

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
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
  const [source, setSource] = useState("");

  // guided state
  const [setsDone, setSetsDone] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [rest, setRest] = useState(0);
  const [painStop, setPainStop] = useState(false);
  const requestId = useRef(newRequestId());

  // result
  const [session, setSession] = useState(null);
  const [pending, setPending] = useState(null); // guided result waiting to be (re)sent
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
    return () => clearInterval(pollRef.current);
  }, [planId]);

  // guided timer (paused time and rest countdown handled separately)
  useEffect(() => {
    if (stage !== "guided" || paused) return undefined;
    const t = setInterval(() => {
      setElapsed((e) => e + 1);
      setRest((r) => (r > 0 ? r - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [stage, paused]);

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

  // ---------- with the camera ----------
  async function startCamera() {
    setError("");
    try {
      const current = await api.mySessions();
      lastIdRef.current = current.length ? Math.max(...current.map((s) => s.id)) : 0;
      await api.startSession(item.id, source.trim() || null);
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
    }
  }

  // ---------- without the camera (guided) ----------
  function setDone() {
    const n = setsDone + 1;
    setSetsDone(n);
    if (n >= item.sets) finishGuided(n, false, false);
    else setRest(item.rest_s || 0);
  }

  async function finishGuided(sets, stopped, pained) {
    const body = {
      plan_id: item.id,
      sets_done: sets,
      stopped,
      pain_stop: pained,
      duration_s: elapsed,
      client_request_id: requestId.current,
    };
    setPending(body);
    await sendGuided(body);
  }

  async function sendGuided(body) {
    setSaving(true);
    setError("");
    try {
      const s = await api.guidedSession(body);
      setSession(s);
      setPending(null);
      setStage("after");
    } catch (e) {
      // keep the result and let the patient retry - never pretend it was saved
      setError(`Not saved yet: ${e.message}`);
      setStage("unsaved");
    } finally {
      setSaving(false);
    }
  }

  function stopGuided() {
    if (!window.confirm("Stop this exercise now? What you did so far is saved as 'stopped early'.")) return;
    finishGuided(setsDone, true, false);
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
      <div className="narrow">
        <Link to="/patient" className="back">
          ← Today
        </Link>
        {error ? <div className="alert alert-red">{error}</div> : <p className="muted">Loading...</p>}
      </div>
    );
  }

  const inSession = stage === "guided" || stage === "tracked";

  return (
    <div className="narrow session-page">
      {!inSession && (
        <Link to="/patient" className="back">
          ← Today
        </Link>
      )}
      <div className="page-head">
        <div>
          <h1>{item.exercise_name}</h1>
          <p className="muted">
            {item.sets} × {item.reps_per_set} reps · target {item.min_angle}°–{item.max_angle}° (approx.)
            {item.hold_s ? ` · hold ${item.hold_s}s` : ""} · {item.side === "BOTH" ? "both sides" : `${item.side.toLowerCase()} side`}
          </p>
        </div>
      </div>

      <SafetyNote onStop={stage === "guided" ? stopGuided : null} />
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
                If you have chest pain, fainting, sudden severe pain, new numbness or a fall, stop and call <b>112</b> or
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

      {/* ---------- choose mode ---------- */}
      {stage === "choose" && (
        <div className="grid-2">
          <div className="card">
            <h3>With the camera</h3>
            {cameraAllowed ? (
              <>
                <p className="muted">
                  A ReHabRep window opens on this computer, counts your reps and gives spoken cues. Stand{" "}
                  {item.view === "side" ? "side-on to" : "facing"} the camera with the{" "}
                  {item.joint ? item.joint.toLowerCase() : "body part"} clearly visible, in good light.
                </p>
                <details className="source-box">
                  <summary>Video source (for the demo)</summary>
                  <p className="muted small">
                    Empty = demo video <code>videos\squat_test.mp4</code>. Type <code>0</code> for the webcam.
                  </p>
                  <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="videos\squat_test.mp4" />
                </details>
                <button className="btn btn-primary btn-lg btn-block" onClick={startCamera}>
                  Start with camera
                </button>
              </>
            ) : (
              <p className="muted">
                Camera use is off in your consent choices. You can turn it on in <Link to="/patient/settings">Settings</Link>.
              </p>
            )}
          </div>
          <div className="card">
            <h3>Without the camera</h3>
            <p className="muted">
              Follow the instructions and tap <b>Set done</b> after each set. Nothing is measured - the report says you
              confirmed it yourself.
            </p>
            <button className="btn btn-outline btn-lg btn-block" onClick={() => setStage("guided")}>
              Do it without camera
            </button>
          </div>
        </div>
      )}

      {/* ---------- camera session running ---------- */}
      {stage === "tracked" && (
        <div className="card highlight">
          <h3>Exercise window is open</h3>
          <p>
            Follow the voice and on-screen cues. To stop at any time press <b>Q</b> in the exercise window. This page
            updates by itself when the session is saved.
          </p>
          <div className="waiting">
            <span className="spinner" /> Waiting for your session to finish...
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => {
              clearInterval(pollRef.current);
              setStage("choose");
            }}
          >
            Stop waiting
          </button>
        </div>
      )}

      {/* ---------- guided ---------- */}
      {stage === "guided" && (
        <div className="card guided">
          <div className="guided-top">
            <div>
              <div className="counter">
                Set {Math.min(setsDone + 1, item.sets)} <span>of {item.sets}</span>
              </div>
              <div className="muted">
                {item.reps_per_set} reps{item.hold_s ? `, hold ${item.hold_s}s each` : ""}
              </div>
            </div>
            <div className="timer" aria-label="Exercise time">
              {fmtTime(elapsed)}
              {paused && <span className="badge badge-amber">Paused</span>}
            </div>
          </div>
          <p className="instructions">{item.instructions}</p>
          {rest > 0 ? (
            <div className="rest-box">
              Rest <b>{rest}s</b> before the next set.
              <button className="btn btn-ghost btn-sm" onClick={() => setRest(0)}>
                Skip rest
              </button>
            </div>
          ) : (
            <button className="btn btn-primary btn-xl btn-block" disabled={paused || saving} onClick={setDone}>
              Set {setsDone + 1} done
            </button>
          )}
          <div className="row-gap">
            <button className="btn btn-outline" onClick={() => setPaused((p) => !p)}>
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              className="btn btn-outline danger-text"
              onClick={() => {
                setPaused(true);
                setPainStop(true);
                setStage("painstop");
              }}
            >
              I feel pain
            </button>
          </div>
        </div>
      )}

      {/* ---------- I feel pain ---------- */}
      {stage === "painstop" && (
        <div className="card">
          <h3>Stop the exercise</h3>
          <p>
            Stop if the pain is sharp, getting worse or unusual. Rest, and tell your therapist. If it is severe, or you
            have chest pain, fainting or numbness, call <b>112</b> or go to the nearest hospital.
          </p>
          <p className="muted small">The app does not judge what the pain means - your therapist will review it.</p>
          <div className="row-gap">
            <button className="btn btn-primary" disabled={saving} onClick={() => finishGuided(setsDone, true, painStop)}>
              End session and tell my therapist
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setPainStop(false);
                setStage("guided");
              }}
            >
              It has passed - continue
            </button>
          </div>
        </div>
      )}

      {/* ---------- save failed ---------- */}
      {stage === "unsaved" && pending && (
        <div className="card">
          <h3>Your session is not saved yet</h3>
          <p className="muted">Check your internet connection and try again. Your therapist has not received it yet.</p>
          <button className="btn btn-primary" disabled={saving} onClick={() => sendGuided(pending)}>
            {saving ? "Trying..." : "Retry upload"}
          </button>
        </div>
      )}

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
              You reported high pain. Please rest and contact your therapist. If it is severe, call 112.
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