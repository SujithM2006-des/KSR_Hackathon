import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtDate, getUser, homeFor, updateUser } from "../api.js";
import { VerificationBadge } from "../components/Badge.jsx";

export default function TherapistPending() {
  const navigate = useNavigate();
  const [v, setV] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ registration_number: "", issuing_body: "", workplace: "", phone: "" });
  const [file, setFile] = useState(null);

  async function load() {
    try {
      const data = await api.myVerification();
      setV(data);
      setForm({
        registration_number: data.registration_number || "",
        issuing_body: data.issuing_body || "",
        workplace: data.workplace || "",
        phone: data.phone || "",
      });
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function checkAgain() {
    setMsg("");
    setError("");
    try {
      const me = await api.me();
      updateUser(me);
      if (homeFor(me) !== "/therapist/verification") return navigate(homeFor(me));
      await load();
      setMsg("Still waiting for an admin decision.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function resubmit(e) {
    e.preventDefault();
    setError("");
    setMsg("");
    const fd = new FormData();
    Object.entries(form).forEach(([k, val]) => fd.append(k, val));
    if (file) fd.append("document", file);
    setBusy(true);
    try {
      const data = await api.resubmitVerification(fd);
      setV(data);
      setFile(null);
      const u = getUser();
      updateUser({ ...u, therapist: data });
      setMsg("Sent again. An admin will review your details.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="narrow">
      <div className="page-head">
        <div>
          <h1>Professional verification</h1>
          <p className="muted">
            Patient features unlock once an admin has checked your registration with the issuing body.
          </p>
        </div>
        <button className="btn btn-outline" onClick={checkAgain}>
          Check again
        </button>
      </div>

      {error && <div className="alert alert-red">{error}</div>}
      {msg && <div className="alert alert-green">{msg}</div>}

      {v === null && !error ? (
        <p className="muted">Loading...</p>
      ) : v ? (
        <>
          <div className="card">
            <div className="card-head">
              <h3>Status</h3>
              <VerificationBadge status={v.status} />
            </div>
            {v.status === "PENDING" && (
              <p>Your details were submitted on {fmtDate(v.submitted_at)}. An admin will review them.</p>
            )}
            {v.status === "REJECTED" && (
              <p>
                Your verification was not approved on {fmtDate(v.reviewed_at)}. Please correct your details or
                upload a clearer document below and send it again.
              </p>
            )}
            {v.decision_reason && (
              <div className={`alert ${v.status === "REJECTED" ? "alert-red" : "alert-grey"}`}>
                <b>Admin's reason{v.status === "PENDING" ? " (previous decision)" : ""}:</b> {v.decision_reason}
              </div>
            )}
            <dl className="facts">
              <dt>Profession</dt>
              <dd>{v.profession}</dd>
              <dt>Registration number</dt>
              <dd>{v.registration_number}</dd>
              <dt>Issuing body</dt>
              <dd>{v.issuing_body}</dd>
              <dt>Document</dt>
              <dd>{v.has_document ? v.document_name || "Uploaded" : "None"}</dd>
            </dl>
          </div>

          <form className="card form-grid" onSubmit={resubmit}>
            <h3 className="span-2">Update and send again</h3>
            <label>
              Registration / licence number
              <input value={form.registration_number} onChange={set("registration_number")} required />
            </label>
            <label>
              Issuing body
              <input value={form.issuing_body} onChange={set("issuing_body")} required />
            </label>
            <label>
              Clinic / hospital
              <input value={form.workplace} onChange={set("workplace")} />
            </label>
            <label>
              Phone
              <input value={form.phone} onChange={set("phone")} />
            </label>
            <label className="span-2">
              New document (optional while pending; PDF, JPG or PNG, max 5 MB)
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                onChange={(e) => setFile(e.target.files[0] || null)}
              />
            </label>
            <div className="span-2">
              <button className="btn btn-primary" disabled={busy}>
                {busy ? "Sending..." : "Send for review"}
              </button>
            </div>
          </form>
        </>
      ) : null}
    </div>
  );
}