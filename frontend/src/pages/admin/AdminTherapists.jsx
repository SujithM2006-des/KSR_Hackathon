import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate } from "../../api.js";
import { AccountBadge, VerificationBadge } from "../../components/Badge.jsx";
import ReasonDialog from "../../components/ReasonDialog.jsx";

// Used for two routes:
//   /admin/verification  -> starts on the "Pending" tab (the verification queue)
//   /admin/therapists    -> starts on "All"
const TABS = [
  ["PENDING", "Pending"],
  ["APPROVED", "Verified"],
  ["REJECTED", "Rejected"],
  ["", "All"],
];

export default function AdminTherapists({ queue }) {
  const [tab, setTab] = useState(queue ? "PENDING" : "");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(null);

  async function load(status = tab) {
    setRows(null);
    try {
      setRows(await api.adminTherapists(status));
      setError("");
    } catch (e) {
      setError(e.message);
      setRows([]);
    }
  }

  useEffect(() => {
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{queue ? "Verification queue" : "Therapists"}</h1>
          <p className="muted">
            Pending first, oldest submission first. Open a therapist to view the document and decide.
          </p>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(([key, label]) => (
          <button key={label} className={`tab ${tab === key ? "tab-active" : ""}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-red">{error}</div>}

      <div className="card table-card">
        {rows === null ? (
          <p className="muted pad">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="muted pad">Nobody here.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Therapist</th>
                <th>Registration</th>
                <th>Submitted</th>
                <th>Verification</th>
                <th>Account</th>
                <th>Patients</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const v = t.verification || {};
                const suspended = t.account_status === "SUSPENDED";
                return (
                  <tr key={t.id}>
                    <td>
                      <div className="strong">{t.name}</div>
                      <div className="muted small">{t.email}</div>
                    </td>
                    <td>
                      <div>{v.registration_number}</div>
                      <div className="muted small">
                        {v.profession} · {v.issuing_body}
                      </div>
                    </td>
                    <td>{fmtDate(v.submitted_at)}</td>
                    <td>
                      <VerificationBadge status={v.status} />
                    </td>
                    <td>
                      <AccountBadge status={t.account_status} />
                    </td>
                    <td>{t.patient_count}</td>
                    <td className="right nowrap">
                      <Link className="btn btn-primary btn-sm" to={`/admin/therapists/${t.id}`}>
                        {v.status === "PENDING" ? "Review" : "Open"}
                      </Link>{" "}
                      <button
                        className={`btn btn-sm ${suspended ? "btn-outline" : "btn-ghost"}`}
                        onClick={() =>
                          setDialog({
                            suspend: !suspended,
                            user: t,
                          })
                        }
                      >
                        {suspended ? "Reactivate" : "Suspend"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {dialog && (
        <ReasonDialog
          title={`${dialog.suspend ? "Suspend" : "Reactivate"} ${dialog.user.name}?`}
          text={
            dialog.suspend
              ? "They will be logged out and cannot log in until reactivated. Their patients' data is kept."
              : "They will be able to log in again."
          }
          confirmLabel={dialog.suspend ? "Suspend account" : "Reactivate account"}
          danger={dialog.suspend}
          onConfirm={(reason) => api.adminSetStatus(dialog.user.id, dialog.suspend, reason).then(() => load())}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}