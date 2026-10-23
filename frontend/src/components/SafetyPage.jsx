import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getUser, homeFor } from "../api.js";

// Public "Safety and help" page - reachable from every patient screen and the footer.
export default function SafetyPage() {
  const user = getUser();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.safety().then(setInfo).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="register-page">
      <div className="card register-card safety-page">
        <Link to={user ? homeFor(user) : "/login"} className="back">
          ← Back
        </Link>
        <h1>Safety and help</h1>

        <div className="emergency">
          <span>Emergency</span>
          <a href={`tel:${info ? info.emergency_number : "112"}`}>Call {info ? info.emergency_number : "112"}</a>
        </div>

        {error && <div className="alert alert-red">{error}</div>}

        <h3>Stop exercising and get help if you notice</h3>
        <ul className="flag-list">
          {(info ? info.red_flags : []).map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p>
          <b>{info ? info.stop_rule : "Stop if you feel sharp, worsening or unusual pain."}</b> Then tell your therapist.
          If it is severe, call the emergency number or go to the nearest hospital.
        </p>

        <h3>What ReHabRep does - and does not do</h3>
        <ul>
          <li>It counts repetitions and estimates joint angles from the camera. Angles are approximate.</li>
          <li>It shares your results and pain scores with your own therapist.</li>
          <li>It does not diagnose anything and does not replace your therapist's advice.</li>
          <li>{info ? info.not_emergency : "It is not an emergency service."}</li>
        </ul>

        <p className="muted small">{info ? info.review_note : ""}</p>
      </div>
    </div>
  );
}