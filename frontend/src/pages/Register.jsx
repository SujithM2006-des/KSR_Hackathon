import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import CertificateUploads, { FIELD, REQUIRED_DOCUMENTS } from "../components/CertificateUploads.jsx";
import { Logo } from "../components/Icons.jsx";

const EMPTY = {
  name: "",
  email: "",
  password: "",
  confirm: "",
  profession: "PHYSIOTHERAPIST",
  registration_number: "",
  issuing_body: "",
  workplace: "",
  phone: "",
};

const LABELS = { PHYSIOTHERAPIST: "Physiotherapist", DOCTOR: "Doctor" };

export default function Register() {
  const navigate = useNavigate();
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [files, setFiles] = useState({}); // { kind: File }
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .registrationConfig()
      .then((c) => {
        setCfg(c);
        setForm((f) => ({ ...f, issuing_body: c.issuing_bodies[0] || "" }));
      })
      .catch((e) => setError(e.message));
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const minPw = cfg ? cfg.min_password_length : 8;
  const maxMb = cfg ? cfg.max_document_mb : 5;

  const required = (cfg && cfg.required_documents && cfg.required_documents[form.profession]) || REQUIRED_DOCUMENTS[form.profession] || [];

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) return setError("Passwords do not match.");
    if (form.password.length < minPw) return setError(`Password must be at least ${minPw} characters.`);
    const missing = required.filter((r) => !files[r.kind]);
    if (missing.length) return setError(`Please attach: ${missing.map((r) => r.label).join("; ")}.`);
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => {
      if (k !== "confirm") fd.append(k, v.trim ? v.trim() : v);
    });
    required.forEach((r) => fd.append(FIELD[r.kind], files[r.kind]));
    setBusy(true);
    try {
      await api.registerTherapist(fd);
      navigate("/login", { state: { registered: true } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="register-page">
      <form className="card form-grid register-card" onSubmit={submit}>
        <div className="span-2">
          <div className="card-logo">
            <Logo />
          </div>
          <Link to="/login" className="back">
            ← Back to log in
          </Link>
          <h1>Register as a clinician</h1>
          <p className="muted">
            An admin checks your certificates and registration number before you can add patients. Doctors upload their
            NEET certificate and medical practice registration; physiotherapists upload their council registration.
          </p>
        </div>

        <h3 className="span-2">Your account</h3>
        <label>
          Full name
          <input value={form.name} onChange={set("name")} required minLength={2} />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={set("email")} required />
        </label>
        <label>
          Password (min {minPw})
          <input type="password" value={form.password} onChange={set("password")} required minLength={minPw} />
        </label>
        <label>
          Confirm password
          <input type="password" value={form.confirm} onChange={set("confirm")} required />
        </label>

        <h3 className="span-2">Professional details</h3>
        <label>
          Profession
          <select value={form.profession} onChange={set("profession")}>
            {(cfg ? cfg.professions : ["PHYSIOTHERAPIST", "DOCTOR"]).map((p) => (
              <option key={p} value={p}>
                {LABELS[p] || p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Registration / licence number
          <input value={form.registration_number} onChange={set("registration_number")} required />
        </label>
        <label>
          Issuing body
          <select value={form.issuing_body} onChange={set("issuing_body")} required>
            {(cfg ? cfg.issuing_bodies : []).map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label>
          Clinic / hospital (optional)
          <input value={form.workplace} onChange={set("workplace")} />
        </label>
        <label>
          Phone (optional)
          <input value={form.phone} onChange={set("phone")} />
        </label>

        <h3 className="span-2">Certificates for verification</h3>
        <div className="span-2">
          <CertificateUploads
            key={form.profession}
            required={required}
            files={files}
            maxMb={maxMb}
            onError={setError}
            onChange={(kind, f) => setFiles((old) => ({ ...old, [kind]: f }))}
          />
        </div>

        {error && <div className="alert alert-red span-2">{error}</div>}
        <div className="span-2 row-gap">
          <button className="btn btn-primary" disabled={busy || !cfg}>
            {busy ? "Submitting..." : "Submit for verification"}
          </button>
          <span className="muted small">You can log in straight away to track your status.</span>
        </div>
      </form>
    </div>
  );
}