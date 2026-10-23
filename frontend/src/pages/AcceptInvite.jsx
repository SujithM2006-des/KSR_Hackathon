import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fmtDate, homeFor, saveLogin } from "../api.js";
import { Logo } from "../components/Icons.jsx";

// Public page opened from the therapist's invitation link: the patient chooses their own password.
export default function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [problem, setProblem] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .invitation(token)
      .then(setInfo)
      .catch((e) => setProblem(e.message));
  }, [token]);

  const minPw = info ? info.min_password_length : 8;

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (password.length < minPw) return setError(`Password must be at least ${minPw} characters.`);
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const res = await api.acceptInvite(token, password);
      saveLogin(res.token, res.user);
      navigate(homeFor(res.user));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="register-page">
      <div className="card register-card narrow-card">
        <div className="card-logo">
          <Logo />
        </div>

        {problem ? (
          <>
            <h1>Invitation not available</h1>
            <div className="alert alert-red">{problem}</div>
            <Link to="/login" className="btn btn-outline">
              Go to log in
            </Link>
          </>
        ) : !info ? (
          <p className="muted">Checking your invitation...</p>
        ) : (
          <form onSubmit={submit} className="stack">
            <div>
              <h1>Welcome, {info.name}</h1>
              <p className="muted">
                {info.therapist ? `${info.therapist} has` : "Your therapist has"} set up your home exercise account.
                Choose a password to finish. Your login email is <b>{info.email}</b>.
              </p>
            </div>
            <label>
              New password (min {minPw})
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            </label>
            <label>
              Confirm password
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </label>
            {error && <div className="alert alert-red">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Saving..." : "Set password and continue"}
            </button>
            <p className="muted small">This link works once and expires on {fmtDate(info.expires_at)}.</p>
          </form>
        )}
      </div>
    </div>
  );
}