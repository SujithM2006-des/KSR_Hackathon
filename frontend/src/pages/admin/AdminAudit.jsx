import { useEffect, useState } from "react";
import { api, fmtDate } from "../../api.js";

const ACTION_LABEL = {
  THERAPIST_REGISTERED: "Therapist registered",
  THERAPIST_RESUBMITTED: "Verification resubmitted",
  THERAPIST_APPROVED: "Therapist approved",
  THERAPIST_REJECTED: "Therapist rejected",
  CREDENTIAL_VIEWED: "Credential document viewed",
  USER_SUSPENDED: "Account suspended",
  USER_REACTIVATED: "Account reactivated",
  ADMIN_CREATED: "Admin created",
  PATIENT_CREATED: "Patient created",
  PLAN_ASSIGNED: "Plan assigned",
};

const ACTION_COLOR = {
  THERAPIST_APPROVED: "green",
  USER_REACTIVATED: "green",
  THERAPIST_REJECTED: "red",
  USER_SUSPENDED: "red",
  CREDENTIAL_VIEWED: "amber",
};

export default function AdminAudit() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api.adminAuditLog(500).then(setRows).catch((e) => setError(e.message));
  }, []);

  const list = (rows || []).filter((r) => !filter || r.action === filter);
  const actions = [...new Set((rows || []).map((r) => r.action))];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted">Every admin decision and sensitive action, newest first. Entries cannot be edited.</p>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a] || a}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="alert alert-red">{error}</div>}
      <div className="card table-card">
        {rows === null && !error ? (
          <p className="muted pad">Loading...</p>
        ) : list.length === 0 ? (
          <p className="muted pad">No entries.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Target</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDate(r.created_at)}</td>
                  <td>
                    <div>{r.actor_name}</div>
                    <div className="muted small">{r.actor_role || ""}</div>
                  </td>
                  <td>
                    <span className={`badge badge-${ACTION_COLOR[r.action] || "grey"}`}>
                      {ACTION_LABEL[r.action] || r.action}
                    </span>
                  </td>
                  <td>
                    {r.target_name || (r.target_type ? `${r.target_type.toLowerCase()} #${r.target_id}` : "-")}
                  </td>
                  <td>{r.reason || <span className="muted">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}