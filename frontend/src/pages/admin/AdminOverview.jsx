import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";

export default function AdminOverview() {
  const [o, setO] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.adminOverview().then(setO).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!o) return <p className="muted">Loading...</p>;
  const pending = o.therapists_by_status.PENDING || 0;
  const pf = o.plan_followed_last_7_days;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Admin overview</h1>
          <p className="muted">Verify therapists, manage accounts and review every admin action.</p>
        </div>
      </div>

      {pending > 0 && (
        <div className="alert alert-amber">
          <b>{pending}</b> therapist{pending > 1 ? "s are" : " is"} waiting for verification.{" "}
          <Link to="/admin/verification">Review now →</Link>
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <span className={`stat-num ${pending ? "warn" : ""}`}>{pending}</span>
          <span className="stat-label">Pending verification</span>
        </div>
        <div className="stat">
          <span className="stat-num ok">{o.therapists_by_status.APPROVED || 0}</span>
          <span className="stat-label">Verified therapists</span>
        </div>
        <div className="stat">
          <span className="stat-num">{o.therapists_by_status.REJECTED || 0}</span>
          <span className="stat-label">Rejected</span>
        </div>
        <div className="stat">
          <span className="stat-num">{o.patients_total}</span>
          <span className="stat-label">Patients</span>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat-num">{o.sessions_last_7_days}</span>
          <span className="stat-label">Sessions, last 7 days</span>
        </div>
        <div className="stat">
          <span className={`stat-num ${o.high_pain_last_7_days ? "bad" : ""}`}>{o.high_pain_last_7_days}</span>
          <span className="stat-label">High pain (7+), last 7 days</span>
        </div>
        <div className="stat">
          <span className="stat-num">
            <span className="ok">{pf.YES}</span> / <span className="warn">{pf.PARTLY}</span> /{" "}
            <span className="bad">{pf.NO}</span>
          </span>
          <span className="stat-label">Plan followed: yes / partly / no</span>
        </div>
        <div className="stat">
          <span className={`stat-num ${o.suspended_accounts ? "bad" : ""}`}>{o.suspended_accounts}</span>
          <span className="stat-label">Suspended accounts</span>
        </div>
      </div>

      <p className="muted small">
        {o.admins_total} admin account{o.admins_total === 1 ? "" : "s"} · {o.sessions_total} sessions in total. Admins
        see counts and accounts here; session details stay with the patient's own therapist.
      </p>
    </div>
  );
}