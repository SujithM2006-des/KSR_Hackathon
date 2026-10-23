import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, homeFor, saveLogin } from "../api.js";

const DEMO = [
  { label: "Admin demo", email: "admin@rehabrep.demo", password: "admin12345" },
  { label: "Therapist demo", email: "therapist@rehabrep.demo", password: "therapist123" },
  { label: "Pending therapist", email: "pending.therapist@rehabrep.demo", password: "pending123" },
  { label: "Patient demo", email: "patient@rehabrep.demo", password: "patient123" },
];

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const registered = location.state && location.state.registered;

  async function doLogin(e, creds) {
    if (e) e.preventDefault();
    const em = creds ? creds.email : email;
    const pw = creds ? creds.password : password;
    setError("");
    setBusy(true);
    try {
      const res = await api.login(em, pw);
      saveLogin(res.token, res.user);
      navigate(homeFor(res.user));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-side">
        <div className="brand brand-lg">
          <span className="brand-mark">R</span>
          <span>
            ReHab<b>Rep</b>
          </span>
        </div>
        <h1>Home physio, checked rep by rep.</h1>
        <p>
          The camera counts every repetition, measures the joint angle against the range the
          therapist prescribed, and coaches the patient live. The therapist sees how the
          plan was followed between visits.
        </p>
        <ul className="login-points">
          <li>Counts reps and measures joint angles from any camera</li>
          <li>Live spoken cues: "Bend a little more", "Don't go that far"</li>
          <li>Adherence report and pain check-in for the therapist</li>
          <li>Every therapist is verified by an admin before seeing patients</li>
        </ul>
      </div>

      <div className="login-card">
        <h2>Log in</h2>
        {registered && (
          <div className="alert alert-green">
            Registration received. Log in to see your verification status. Patient features unlock
            after an admin approves you.
          </div>
        )}
        <form onSubmit={doLogin}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <div className="alert alert-red">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Logging in..." : "Log in"}
          </button>
        </form>

        <p className="muted small center">
          Physiotherapist or doctor? <Link to="/register">Register as a therapist</Link>
          <br />
          Patients get their login from their therapist.
        </p>

        <div className="demo-box">
          <span className="muted">Quick demo login (demo accounts only)</span>
          <div className="demo-buttons">
            {DEMO.map((d) => (
              <button key={d.email} className="btn btn-outline" disabled={busy} onClick={() => doLogin(null, d)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}