import { useEffect, useState } from "react";
import { api, fmtDate } from "../../api.js";
import { AccountBadge, AdherenceBadge, VerificationBadge } from "../../components/Badge.jsx";
import ReasonDialog from "../../components/ReasonDialog.jsx";

export default function AdminPatients() {
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(null);

  async function load() {
    try {
      setGroups(await api.adminPatients());
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Patients by therapist</h1>
          <p className="muted">Accounts only. Session details stay with each patient's therapist.</p>
        </div>
      </div>
      {error && <div className="alert alert-red">{error}</div>}
      {groups === null && !error && <p className="muted">Loading...</p>}

      {(groups || []).map((g) => (
        <div className="card table-card" key={g.therapist.id}>
          <div className="card-head pad-x">
            <h3>
              {g.therapist.name} <span className="muted small">{g.therapist.email}</span>
            </h3>
            <div className="row-gap">
              <VerificationBadge status={g.therapist.verification_status} />
              <AccountBadge status={g.therapist.account_status} />
            </div>
          </div>
          {g.patients.length === 0 ? (
            <p className="muted pad">No patients.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Condition</th>
                  <th>Sessions</th>
                  <th>Last session</th>
                  <th>Adherence</th>
                  <th>Account</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {g.patients.map((p) => {
                  const suspended = p.account_status === "SUSPENDED";
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="strong">{p.name}</div>
                        <div className="muted small">{p.email}</div>
                      </td>
                      <td>{p.surgery_type || "-"}</td>
                      <td>{p.sessions_count}</td>
                      <td>{fmtDate(p.last_session_at)}</td>
                      <td>
                        <AdherenceBadge badge={p.badge} />
                      </td>
                      <td>
                        <AccountBadge status={p.account_status} />
                      </td>
                      <td className="right">
                        <div className="row-gap right">
                          {p.sessions_count > 0 && (
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => setDialog({ clear: true, id: p.id, name: p.name, count: p.sessions_count })}
                            >
                              Clear sessions
                            </button>
                          )}
                          <button
                            className={`btn btn-sm ${suspended ? "btn-outline" : "btn-ghost"}`}
                            onClick={() => setDialog({ suspend: !suspended, id: p.user_id, name: p.name })}
                          >
                            {suspended ? "Reactivate" : "Suspend"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {dialog && dialog.clear && (
        <ReasonDialog
          title={`Clear session history of ${dialog.name}?`}
          text={`This permanently deletes all ${dialog.count} session(s), their reps, pain scores and review flags. The account, plan and consent stay. This cannot be undone.`}
          confirmLabel="Delete sessions"
          danger
          onConfirm={(reason) => api.adminClearSessions(dialog.id, reason).then(load)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog && !dialog.clear && (
        <ReasonDialog
          title={`${dialog.suspend ? "Suspend" : "Reactivate"} ${dialog.name}?`}
          confirmLabel={dialog.suspend ? "Suspend account" : "Reactivate account"}
          danger={dialog.suspend}
          onConfirm={(reason) => api.adminSetStatus(dialog.id, dialog.suspend, reason).then(load)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}