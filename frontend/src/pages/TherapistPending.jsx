import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtDate, getUser, homeFor, updateUser } from "../api.js";
import { VerificationBadge } from "../components/Badge.jsx";
import CertificateUploads, { FIELD, REQUIRED_DOCUMENTS } from "../components/CertificateUploads.jsx";

export default function TherapistPending() {
  const navigate = useNavigate();
  const [v, setV] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ registration_number: "", issuing_body: "", workplace: "", phone: "" });
  const [files, setFiles] = useState({}); // { kind: File } - new uploads

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
    Object.entries(files).forEach(([kind, f]) => f && fd.append(FIELD[kind], f));
    setBusy(true);
    try {
      const data = await api.resubmitVerification(fd);
      setV(data);
      setFiles({});
      const u = getUser();
      updateUser({ ...u, therapist: data });
      setMsg("Sent again. An admin will review your details.");
    } catch (err) {
      setError(err.message);
      load(); // files that were valid are saved even if others are still missing
      setFiles({});
    } finally {
      setBusy(false);
    }
  }

  const required = v ? v.required_documents || REQUIRED_DOCUMENTS[v.profession] || [] : [];
  const missing = v ? v.missing_documents || [] : [];

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="narrow">
      <div className="page-head">
        <div>
          <h1>Professional verification</h1>
          <p className="muted">
            You can't take patients until an admin has checked your certificates and registration and approved you.
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
            {missing.length > 0 && (
              <div className="alert alert-amber">
                <b>Certificates still needed:</b> {required.filter((r) => missing.includes(r.kind)).map((r) => r.label).join("; ")}.
                Upload them below - an admin can only approve you when every certificate is on file.
              </div>
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
            </dl>
            <h3 style={{ marginTop: 16 }}>Certificates</h3>
            <ul className="cert-status">
              {required.map((r) => {
                const d = (v.documents || []).find((x) => x.kind === r.kind);
                return (
                  <li key={r.kind} className={d ? "ok" : "missing"}>
                    <span>{d ? "✓" : "!"}</span>
                    <div>
                      <b>{r.label}</b>
                      <div className="muted small">
                        {d ? `${d.name || "Uploaded"} · ${fmtDate(d.uploaded_at)}${d.uploaded_by_admin ? " · added by admin" : ""}` : "Not uploaded yet"}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <form className="card form-grid" onSubmit={resubmit}>
            <h3 className="span-2">{missing.length ? "Upload certificates and send for review" : "Update and send again"}</h3>
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
            <div className="span-2">
              <CertificateUploads
                required={required}
                files={files}
                existing={v.documents || []}
                onError={setError}
                onChange={(kind, f) => setFiles((old) => ({ ...old, [kind]: f }))}
              />
            </div>
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