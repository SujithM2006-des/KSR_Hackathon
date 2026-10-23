import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fmtDate } from "../../api.js";
import { AccountBadge, VerificationBadge } from "../../components/Badge.jsx";
import ReasonDialog from "../../components/ReasonDialog.jsx";

export default function TherapistReview() {
  const { id } = useParams();
  const [t, setT] = useState(null);
  const [error, setError] = useState("");
  const [doc, setDoc] = useState(null); // { url, type }
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

  async function openDocument() {
    setDocError("");
    try {
      const blob = await api.adminTherapistDocument(id);
      setDoc({ url: URL.createObjectURL(blob), type: blob.type });
    } catch (e) {
      setDocError(e.message);
    }
  }

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!t) return <p className="muted">Loading...</p>;
  const v = t.verification || {};
  const suspended = t.account_status === "SUSPENDED";

  const dialogs = {
    APPROVE: {
      title: `Approve ${t.name}?`,
      text: "Only approve after checking the registration number with the issuing body.",
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

          <div className="row-gap">
            {v.status !== "APPROVED" && (
              <button className="btn btn-primary" onClick={() => setDialog("APPROVE")}>
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
            <h3>Credential document</h3>
            {doc && (
              <a className="btn btn-outline btn-sm" href={doc.url} target="_blank" rel="noreferrer">
                Open in new tab
              </a>
            )}
          </div>
          {!v.has_document ? (
            <p className="muted">No document uploaded.</p>
          ) : !doc ? (
            <>
              <p className="muted">
                {v.document_name} · stored encrypted. Opening it is recorded in the audit log.
              </p>
              <button className="btn btn-outline" onClick={openDocument}>
                View document
              </button>
            </>
          ) : doc.type.startsWith("image/") ? (
            <img className="doc-view" src={doc.url} alt="Credential document" />
          ) : (
            <iframe className="doc-view" src={doc.url} title="Credential document" />
          )}
          {docError && <div className="alert alert-red">{docError}</div>}
        </div>
      </div>

      {dialog && <ReasonDialog {...dialogs[dialog]} onClose={() => setDialog(null)} />}
    </div>
  );
}