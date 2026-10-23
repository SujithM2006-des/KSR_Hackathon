import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fmtDate } from "../../api.js";
import { AccountBadge, VerificationBadge } from "../../components/Badge.jsx";
import ReasonDialog from "../../components/ReasonDialog.jsx";
import { ACCEPT, REQUIRED_DOCUMENTS } from "../../components/CertificateUploads.jsx";

export default function TherapistReview() {
  const { id } = useParams();
  const [t, setT] = useState(null);
  const [error, setError] = useState("");
  const [doc, setDoc] = useState(null); // { url, type, label } - the certificate being viewed
  const [uploading, setUploading] = useState(""); // kind being uploaded by the admin
  const [notice, setNotice] = useState("");
  const [docError, setDocError] = useState("");
  const [dialog, setDialog] = useState(null);

  async function load() {
    try {
      setT(await api.adminTherapist(id));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // free the decrypted document from memory when leaving the page
  useEffect(() => () => doc && URL.revokeObjectURL(doc.url), [doc]);

  async function openDocument(d) {
    setDocError("");
    try {
      const blob = await api.adminDocument(id, d.id);
      setDoc({ url: URL.createObjectURL(blob), type: blob.type, label: d.label });
    } catch (e) {
      setDocError(e.message);
    }
  }

  // the admin adds a certificate the clinician sent another way (email, in person)
  async function uploadFor(kind, label, e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setDocError("The file is larger than 5 MB.");
    setDocError("");
    setNotice("");
    setUploading(kind);
    try {
      setT(await api.adminUploadDocument(id, kind, file));
      setNotice(`${label} uploaded. It is recorded in the audit log as added by you.`);
    } catch (err) {
      setDocError(err.message);
    } finally {
      setUploading("");
    }
  }

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!t) return <p className="muted">Loading...</p>;
  const v = t.verification || {};
  const suspended = t.account_status === "SUSPENDED";
  const required = v.required_documents || REQUIRED_DOCUMENTS[v.profession] || [];
  const missing = v.missing_documents || [];

  const dialogs = {
    APPROVE: {
      title: `Approve ${t.name}?`,
      text: "Only approve after checking every certificate and the registration number with the issuing body.",
      confirmLabel: "Approve",
      withNote: true,
      onConfirm: (reason, note) => api.adminDecide(id, "APPROVE", reason, note).then(setT),
    },
    REJECT: {
      title: `Reject ${t.name}?`,
      text: "The therapist sees your reason and can correct their details and send them again.",
      confirmLabel: "Reject",
      danger: true,
      withNote: true,
      onConfirm: (reason, note) => api.adminDecide(id, "REJECT", reason, note).then(setT),
    },
    STATUS: {
      title: `${suspended ? "Reactivate" : "Suspend"} ${t.name}?`,
      confirmLabel: suspended ? "Reactivate account" : "Suspend account",
      danger: !suspended,
      onConfirm: (reason) => api.adminSetStatus(t.id, !suspended, reason).then(load),
    },
  };

  return (
    <div>
      <Link to="/admin/verification" className="back">
        ← Verification queue
      </Link>
      <div className="page-head">
        <div>
          <h1>{t.name}</h1>
          <p className="muted">
            {t.email} · registered {fmtDate(t.created_at)} · {t.patient_count} patient{t.patient_count === 1 ? "" : "s"}
          </p>
        </div>
        <div className="row-gap">
          <VerificationBadge status={v.status} />
          <AccountBadge status={t.account_status} />
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Professional details</h3>
          <dl className="facts">
            <dt>Profession</dt>
            <dd>{v.profession}</dd>
            <dt>Registration number</dt>
            <dd className="strong">{v.registration_number}</dd>
            <dt>Issuing body</dt>
            <dd>{v.issuing_body}</dd>
            <dt>Clinic / hospital</dt>
            <dd>{v.workplace || "-"}</dd>
            <dt>Phone</dt>
            <dd>{v.phone || "-"}</dd>
            <dt>Submitted</dt>
            <dd>{fmtDate(v.submitted_at)}</dd>
            <dt>Last decision</dt>
            <dd>
              {v.reviewed_at ? `${fmtDate(v.reviewed_at)}${t.reviewed_by ? ` by ${t.reviewed_by}` : ""}` : "-"}
            </dd>
            <dt>Reason</dt>
            <dd>{v.decision_reason || "-"}</dd>
            <dt>Register check note</dt>
            <dd>{t.register_check_note || "-"}</dd>
            {suspended && (
              <>
                <dt>Suspended because</dt>
                <dd>{t.account_status_reason || "-"}</dd>
              </>
            )}
          </dl>

          <div className="alert alert-grey small">
            Check the number on the issuing body's official register (for example the state council website)
            before approving. Write what you checked in the register check note.
          </div>

          {v.status !== "APPROVED" && missing.length > 0 && (
            <div className="alert alert-amber small">
              Approval is locked until every certificate is on file. Missing:{" "}
              {required.filter((r) => missing.includes(r.kind)).map((r) => r.label).join("; ")}.
            </div>
          )}
          <div className="row-gap">
            {v.status !== "APPROVED" && (
              <button className="btn btn-primary" disabled={missing.length > 0} onClick={() => setDialog("APPROVE")}>
                Approve
              </button>
            )}
            {v.status !== "REJECTED" && (
              <button className="btn btn-danger" onClick={() => setDialog("REJECT")}>
                {v.status === "APPROVED" ? "Revoke (reject)" : "Reject"}
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => setDialog("STATUS")}>
              {suspended ? "Reactivate account" : "Suspend account"}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Certificates</h3>
            <span className={`badge ${missing.length ? "badge-amber" : "badge-green"}`}>
              {required.length - missing.length} of {required.length} on file
            </span>
          </div>
          <p className="muted small">Stored encrypted. Opening or uploading a certificate is recorded in the audit log.</p>
          <ul className="cert-status">
            {required.map((r) => {
              const d = (v.documents || []).find((x) => x.kind === r.kind);
              return (
                <li key={r.kind} className={d ? "ok" : "missing"}>
                  <span>{d ? "✓" : "!"}</span>
                  <div className="grow">
                    <b>{r.label}</b>
                    <div className="muted small">
                      {d
                        ? `${d.name || "Uploaded"} · ${fmtDate(d.uploaded_at)} · ${d.uploaded_by_admin ? `added by admin (${d.uploaded_by})` : "uploaded by the clinician"}`
                        : "Not uploaded yet"}
                    </div>
                    <div className="row-gap" style={{ marginTop: 8 }}>
                      {d && (
                        <button className="btn btn-outline btn-sm" onClick={() => openDocument({ ...d, label: r.label })}>
                          View
                        </button>
                      )}
                      <label className={`btn btn-sm ${d ? "btn-ghost" : "btn-primary"} file-btn`}>
                        {uploading === r.kind ? "Uploading..." : d ? "Replace" : "Upload for clinician"}
                        <input type="file" accept={ACCEPT} disabled={Boolean(uploading)} onChange={(e) => uploadFor(r.kind, r.label, e)} />
                      </label>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {notice && <div className="alert alert-green small">{notice}</div>}
          {docError && <div className="alert alert-red">{docError}</div>}
          {doc && (
            <>
              <div className="card-head" style={{ marginTop: 14 }}>
                <b>{doc.label}</b>
                <a className="btn btn-outline btn-sm" href={doc.url} target="_blank" rel="noreferrer">
                  Open in new tab
                </a>
              </div>
              {doc.type.startsWith("image/") ? (
                <img className="doc-view" src={doc.url} alt={doc.label} />
              ) : (
                <iframe className="doc-view" src={doc.url} title={doc.label} />
              )}
            </>
          )}
        </div>
      </div>

      {dialog && <ReasonDialog {...dialogs[dialog]} onClose={() => setDialog(null)} />}
    </div>
  );
}