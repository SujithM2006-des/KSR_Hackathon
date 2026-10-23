import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, homeFor, saveLogin } from "../api.js";
import { Icon, IconTile, Logo } from "../components/Icons.jsx";

const DEMO = {
  admin: { label: "Admin", icon: "settings", email: "admin@rehabrep.demo", password: "admin12345" },
  clinician: { label: "Clinician", icon: "stethoscope", email: "therapist@rehabrep.demo", password: "therapist123" },
  patient: { label: "Patient", icon: "user", email: "patient@rehabrep.demo", password: "patient123" },
  pending: { label: "Pending clinician", email: "pending.therapist@rehabrep.demo", password: "pending123" },
};

const FEATURES = [
  ["camera", "violet", "Pose Tracking", "YOLO11 Pose follows your movement with an ordinary webcam. No wearables."],
  ["target", "teal", "Range of Motion", "Measures the joint angle and marks every repetition GOOD, UNDER or OVER."],
  ["mic", "red", "Real-Time Voice Coaching", "Spoken cues like \"Bend a little more\" while you exercise."],
  ["chart", "amber", "Progress Tracking", "Adherence, pain check-ins and reports your clinician can review."],
];

const STEPS = [
  ["Clinician prescribes", "A verified clinician sets sets, reps, days and the safe angle range for each exercise."],
  ["Patient exercises at home", "Side-on to the camera, or without the camera if the patient prefers."],
  ["Live cues, rep by rep", "Each rep is counted and judged against the prescribed range, with spoken feedback."],
  ["Clinician reviews", "Adherence, pain scores and review flags show who needs a call."],
];

// Decorative scene: a seated patient doing a knee extension, with the tracked skeleton.
function Scene() {
  return (
    <svg className="scene" viewBox="0 0 400 500" role="img" aria-label="Illustration of a seated knee extension being tracked">
      <defs>
        <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ece8fb" />
          <stop offset="1" stopColor="#ddd5f7" />
        </linearGradient>
        <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b6cf6" />
          <stop offset="1" stopColor="#5b34ea" />
        </linearGradient>
      </defs>
      <rect x="0" y="380" width="400" height="120" fill="url(#floor)" />
      <rect x="250" y="70" width="110" height="140" rx="10" fill="#fff" stroke="#e1dcf7" />
      <rect x="262" y="82" width="86" height="116" rx="6" fill="#f1edff" />
      {/* chair */}
      <rect x="205" y="300" width="110" height="14" rx="6" fill="#9a6b4a" />
      <rect x="296" y="170" width="14" height="140" rx="6" fill="#9a6b4a" />
      <rect x="212" y="312" width="10" height="90" rx="4" fill="#87593b" />
      <rect x="298" y="312" width="10" height="90" rx="4" fill="#87593b" />
      {/* person */}
      <circle cx="272" cy="150" r="24" fill="#2b2140" />
      <path d="M248 182 q24 -10 48 0 l6 120 h-66z" fill="url(#body)" />
      <path d="M236 296 h70 v22 h-70z" fill="#1d1830" />
      <path d="M236 300 L140 318 L130 296 L232 280z" fill="#1d1830" />
      <path d="M140 318 L60 300 L62 282 L134 296z" fill="#1d1830" />
      <ellipse cx="54" cy="290" rx="16" ry="10" fill="#f2c7a5" />
      {/* skeleton overlay */}
      <g stroke="#2dd4bf" strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M272 176 L276 296" />
        <path d="M276 296 L140 306" />
        <path d="M140 306 L62 292" />
        <path d="M272 190 L250 250 L262 296" />
      </g>
      <g fill="#fff" stroke="#14b8a6" strokeWidth="4">
        <circle cx="272" cy="176" r="6" />
        <circle cx="276" cy="296" r="7" />
        <circle cx="140" cy="306" r="8" />
        <circle cx="62" cy="292" r="7" />
        <circle cx="250" cy="250" r="5" />
      </g>
      <path d="M150 306 A 22 22 0 0 0 132 290" stroke="#f59e0b" strokeWidth="4" fill="none" />
    </svg>
  );
}

function Gauge({ value = 92, min = 90, max = 135 }) {
  const pct = Math.min(1, value / 180);
  const r = 30;
  const c = Math.PI * r;
  const ok = value >= min && value <= max;
  return (
    <svg width="76" height="46" viewBox="0 0 76 46" aria-hidden="true">
      <path d="M8 40 A30 30 0 0 1 68 40" stroke="#e6e8f3" strokeWidth="8" fill="none" strokeLinecap="round" />
      <path
        d="M8 40 A30 30 0 0 1 68 40"
        stroke={ok ? "#22c55e" : "#f59e0b"}
        strokeWidth="8"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
      />
    </svg>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const emailRef = useRef(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exerciseCount, setExerciseCount] = useState(null);
  const registered = location.state && location.state.registered;

  useEffect(() => {
    api
      .exercises()
      .then((list) => setExerciseCount(list.length))
      .catch(() => {});
  }, []);

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

  function focusSignIn() {
    document.getElementById("signin").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => emailRef.current && emailRef.current.focus(), 300);
  }

  return (
    <div className="landing">
      <nav className="land-nav">
        <Logo />
        <div className="land-links">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#why">Why ReHabRep</a>
          <Link to="/safety">Safety</Link>
        </div>
        <button className="btn btn-primary" onClick={focusSignIn}>
          Sign In <Icon name="arrowRight" size={18} />
        </button>
      </nav>

      <div className="land-wrap">
        <section className="hero">
          <div>
            <span className="eyebrow">AI-ASSISTED HOME PHYSIOTHERAPY</span>
            <h1>
              Your Recovery.
              <span>Guided Rep by Rep.</span>
            </h1>
            <p className="hero-lead">
              Camera-based home physiotherapy with clinician-prescribed exercise plans, real-time feedback and progress
              tracking.
            </p>
            <div className="hero-ctas">
              <button className="btn btn-primary" onClick={focusSignIn}>
                Get Started <Icon name="arrowRight" size={18} />
              </button>
              <a className="btn btn-outline" href="#features">
                Learn More
              </a>
            </div>
            <div className="trust">
              <span>
                <Icon name="shield" /> Encrypted patient data
              </span>
              <span>
                <Icon name="userCheck" /> Clinicians verified by an admin
              </span>
              <span>
                <Icon name="home" /> Easy to use at home
              </span>
            </div>
          </div>

          <div className="hero-art">
            <Scene />
            <div className="preview-card">
              <h5>Seated knee extension</h5>
              <div className="preview-angle">
                <Gauge />
                <span>
                  <b>92°</b>
                  <br />
                  <span className="badge badge-green">Good</span>
                </span>
              </div>
              <div className="preview-rows">
                <span>Target</span>
                <b>90° – 135°</b>
                <span>Reps</span>
                <b>5 / 10</b>
                <span>Set</span>
                <b>1 / 3</b>
              </div>
            </div>
            <span className="cue-bubble">
              <Icon name="mic" size={18} /> Bend a little more
            </span>
            <span className="art-caption">Illustration</span>
          </div>

          <div className="signin" id="signin">
            <h2>Welcome to</h2>
            <p className="big-name">
              ReHab<b>Rep</b>
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Sign in to continue your journey
            </p>
            {registered && (
              <div className="alert alert-green" style={{ marginTop: 14 }}>
                Registration received. Sign in to see your verification status. Patient features unlock after an admin
                approves you.
              </div>
            )}
            <form onSubmit={doLogin}>
              <label className="field">
                <Icon name="mail" size={18} />
                <input
                  ref={emailRef}
                  type="email"
                  placeholder="Email"
                  aria-label="Email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                <Icon name="lock" size={18} />
                <input
                  type={showPw ? "text" : "password"}
                  placeholder="Password"
                  aria-label="Password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="eye"
                  onClick={() => setShowPw(!showPw)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  <Icon name={showPw ? "eyeOff" : "eye"} size={18} />
                </button>
              </label>
              {error && <div className="alert alert-red">{error}</div>}
              <button className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Signing in..." : "Sign In"}
              </button>
            </form>

            <div className="or">Or continue as (demo accounts)</div>
            <div className="role-tiles">
              {["admin", "clinician", "patient"].map((k) => (
                <button key={k} type="button" className="role-tile" disabled={busy} onClick={() => doLogin(null, DEMO[k])}>
                  <Icon name={DEMO[k].icon} size={22} />
                  {DEMO[k].label}
                </button>
              ))}
            </div>
            <p className="signin-foot">
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => doLogin(null, DEMO.pending)}>
                Demo: clinician waiting for verification
              </button>
            </p>

            <div className="signin-foot">
              New clinician on ReHabRep?
              <Link className="btn btn-outline" to="/register">
                Register as a clinician <Icon name="arrowRight" size={16} />
              </Link>
              <div style={{ marginTop: 10 }}>Patients receive their login link from their clinician.</div>
            </div>
          </div>
        </section>

        <section className="feature-row" id="features">
          {FEATURES.map(([icon, tone, title, text]) => (
            <div className="feature" key={title}>
              <IconTile name={icon} tone={tone} size={26} />
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="why" id="why">
          <div>
            <div className="why-title">
              <IconTile name="users" tone="violet" size={24} />
              <div>
                <h2>
                  Why ReHab<b>Rep</b>?
                </h2>
                <span className="muted">Smarter rehabilitation between clinic visits</span>
              </div>
            </div>
            <p>
              ReHabRep bridges the gap between clinic and home: camera-guided exercise tracking, real-time feedback and
              secure clinician oversight. It is an exercise aid, not a diagnosis.
            </p>
            <button className="btn btn-primary" onClick={focusSignIn}>
              Sign in to start <Icon name="arrowRight" size={18} />
            </button>
          </div>
          <div className="facts-row">
            <div className="fact fact-violet">
              <Icon name="library" size={28} />
              <div>
                <b>{exerciseCount ?? "-"}</b>
                <span>Exercises in the library</span>
              </div>
            </div>
            <div className="fact fact-teal">
              <Icon name="checkCircle" size={28} />
              <div>
                <b>18/18</b>
                <span>Reps judged correctly in our test videos</span>
              </div>
            </div>
            <div className="fact fact-blue">
              <Icon name="users" size={28} />
              <div>
                <b>3</b>
                <span>Roles: admin, clinician, patient</span>
              </div>
            </div>
            <div className="fact fact-red">
              <Icon name="phone" size={28} />
              <div>
                <b>108</b>
                <span>Emergency help on every screen</span>
              </div>
            </div>
          </div>
        </section>

        <h2 className="section-title" id="how">
          How it works
        </h2>
        <section className="steps">
          {STEPS.map(([title, text], i) => (
            <div className="step" key={title}>
              <span className="step-num">{i + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </section>

        <p className="land-foot">
          Exercise aid only. Not a diagnosis. Follow your clinician's advice. <Link to="/safety">Safety and help</Link> ·
          Emergency: 108
        </p>
      </div>
    </div>
  );
}
