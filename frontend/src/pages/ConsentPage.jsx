import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, getUser, updateUser } from "../api.js";

// First-login consent for patients. Saying no to the camera still lets them exercise (guided mode).
export default function ConsentPage() {
  const navigate = useNavigate();
  const user = getUser();
  const [text, setText] = useState(null);
  const [read, setRead] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const again = user && user.consent && user.consent.given && user.consent.needs_consent;

  useEffect(() => {
    api.consentText().then(setText).catch((e) => setError(e.message));
  }, []);

  async function agree(camera) {
    setBusy(true);
    setError("");
    try {
      const u = await api.giveConsent(text.version, camera);
      updateUser(u);
      navigate("/patient");
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <div className="page-head">
        <div>
          <h1>{again ? "Our consent text has changed" : "Before you start"}</h1>
          <p className="muted">Please read this. It takes about a minute.</p>
        </div>
      </div>
      {error && <div className="alert alert-red">{error}</div>}
      {!text ? (
        !error && <p className="muted">Loading...</p>
      ) : (
        <div className="card consent-card">
          {text.sections.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </section>
          ))}
          <p className="small">
            Safety: stop if you feel sharp, worsening or unusual pain. In an emergency call 108.{" "}
            <Link to="/safety">Read the safety page</Link>
          </p>
          <p className="muted small">
            Consent text version {text.version}. {text.review_note}
          </p>

          <label className="check-row">
            <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
            <span>I have read and understood this.</span>
          </label>

          <div className="consent-actions">
            <button className="btn btn-primary btn-lg" disabled={!read || busy} onClick={() => agree(true)}>
              I agree - allow the camera
            </button>
            <button className="btn btn-outline btn-lg" disabled={!read || busy} onClick={() => agree(false)}>
              I agree, but no camera
            </button>
          </div>
          <p className="muted small">
            Without the camera you still do your exercises and confirm them yourself; nothing is measured. You can
            change this any time in Settings.
          </p>
        </div>
      )}
    </div>
  );
}