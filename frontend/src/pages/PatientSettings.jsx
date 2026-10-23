import { useEffect, useState } from "react";
import { api, fmtDate, updateUser } from "../api.js";

const ACTION_LABEL = {
  AGREED: "Agreed - camera allowed",
  AGREED_NO_CAMERA: "Agreed - no camera",
  CAMERA_ALLOWED: "Camera allowed",
  CAMERA_WITHDRAWN: "Camera withdrawn",
};

export default function PatientSettings() {
  const [c, setC] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setC(await api.myConsent());
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function setCamera(allow) {
    if (!allow && !window.confirm("Stop using the camera? You can still do your exercises in guided mode.")) return;
    setBusy(true);
    setError("");
    try {
      const u = await api.setCamera(allow);
      updateUser(u);
      setMsg(allow ? "Camera allowed." : "Camera use stopped. Your earlier results stay with your therapist.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Your consent choices. You cannot change your exercise plan here - only your therapist can.</p>
        </div>
      </div>
      {error && <div className="alert alert-red">{error}</div>}
      {msg && <div className="alert alert-green">{msg}</div>}
      {!c ? (
        !error && <p className="muted">Loading...</p>
      ) : (
        <>
          <div className="card">
            <div className="card-head">
              <h3>Camera</h3>
              <span className={`badge badge-${c.camera_allowed ? "green" : "grey"}`}>
                {c.camera_allowed ? "Allowed" : "Not allowed"}
              </span>
            </div>
            <p className="muted">
              {c.camera_allowed
                ? "The camera is used to count repetitions and estimate angles. Video is not saved."
                : "You do your exercises without the camera and confirm them yourself. Nothing is measured."}
            </p>
            <button className={`btn ${c.camera_allowed ? "btn-outline" : "btn-primary"}`} disabled={busy} onClick={() => setCamera(!c.camera_allowed)}>
              {c.camera_allowed ? "Stop using the camera" : "Allow the camera"}
            </button>
          </div>

          <div className="card">
            <h3>Your data</h3>
            <p className="muted">
              To get a copy of your data or ask for it to be deleted, contact your therapist or the administrator.
              Consent version: {c.version || "-"}.
            </p>
            <h3>Consent history</h3>
            <ul className="plain-list">
              {c.history.map((h, i) => (
                <li key={i}>
                  {fmtDate(h.created_at)} - {ACTION_LABEL[h.action] || h.action}{" "}
                  <span className="muted small">(v {h.version})</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}