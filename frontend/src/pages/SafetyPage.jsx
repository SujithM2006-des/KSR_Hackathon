import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getUser, homeFor } from "../api.js";
import { Panel } from "../components/Dash.jsx";
import { Icon, Logo } from "../components/Icons.jsx";
import EmergencyCall from "../components/EmergencyCall.jsx";

// Public "Safety and help" page - reachable from every patient screen and the footer.
// embedded = shown inside the app shell for a logged-in user (no page frame, no back link)
export default function SafetyPage({ embedded = false }) {
  const user = getUser();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.safety().then(setInfo).catch((e) => setError(e.message));
  }, []);

  const number = info ? info.emergency_number : "108";

  const body = (
    <>
      <div className="dash-head">
        <div>
          <h1>Safety and help</h1>
          <p>Read this before you exercise. Stop and get help if anything below happens.</p>
        </div>
      </div>

      <div className="emergency emergency-lg">
        <span className="emergency-text">
          <Icon name="phone" size={26} />
          <span>
            <b>Emergency</b>
            <span>Chest pain, fainting, a fall or severe pain? Call now.</span>
          </span>
        </span>
        <EmergencyCall number={number} />
      </div>

      {error && <div className="alert alert-red">{error}</div>}

      <div className="dash-grid">
        <Panel className="span-6" title="Stop exercising and get help if you notice" icon="alert">
          <ul className="flag-list">
            {(info ? info.red_flags : []).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p className="safety-rule">
            <b>{info ? info.stop_rule : "Stop if you feel sharp, worsening or unusual pain."}</b> Then tell your
            therapist. If it is severe, call the emergency number or go to the nearest hospital.
          </p>
        </Panel>

        <Panel className="span-6" title="What ReHabRep does - and does not do" icon="shield">
          <ul className="check-list">
            <li>It counts repetitions and estimates joint angles from the camera. Angles are approximate.</li>
            <li>It shares your results and pain scores with your own therapist.</li>
            <li>It does not diagnose anything and does not replace your therapist's advice.</li>
            <li>{info ? info.not_emergency : "It is not an emergency service."}</li>
          </ul>
        </Panel>
      </div>

      {info && info.review_note && <p className="muted small">{info.review_note}</p>}
    </>
  );

  if (embedded) return body;
  return (
    <div className="landing">
      <nav className="land-nav">
        <Link to={user ? homeFor(user) : "/login"}>
          <Logo />
        </Link>
        <Link to={user ? homeFor(user) : "/login"} className="btn btn-outline">
          ← Back
        </Link>
      </nav>
      <div className="land-wrap public-page">{body}</div>
    </div>
  );
}
