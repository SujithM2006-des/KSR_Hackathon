import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate } from "../../api.js";
import { AccountBadge, AdherenceBadge, VerificationBadge } from "../../components/Badge.jsx";
import { Donut, Kpi, Panel, PanelLink, PctBar, PIE } from "../../components/Dash.jsx";
import { Avatar, Icon } from "../../components/Icons.jsx";
import { ACTION_COLOR, ACTION_LABEL } from "./AdminAudit.jsx";

const PROFESSION = { PHYSIOTHERAPIST: "Physiotherapist", DOCTOR: "Doctor" };

export default function AdminOverview() {
  const [o, setO] = useState(null);
  const [therapists, setTherapists] = useState([]);
  const [groups, setGroups] = useState([]);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.adminOverview(), api.adminTherapists(), api.adminPatients(), api.adminAuditLog(6)])
      .then(([ov, th, gr, au]) => {
        setO(ov);
        setTherapists(th);
        setGroups(gr);
        setAudit(au);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!o) return <p className="muted">Loading...</p>;

  const pending = o.therapists_by_status.PENDING || 0;
  const pf = o.plan_followed_last_7_days;
  const measured = pf.YES + pf.PARTLY + pf.NO;
  const followedPct = measured ? Math.round((100 * pf.YES) / measured) : null;
  const patients = groups.flatMap((g) => g.patients.map((p) => ({ ...p, therapist: g.therapist.name })));
  const attention = patients.filter((p) => p.pain_alert || p.badge.color === "red" || (p.review_flags || []).length);

  return (
    <div>
      <div className="dash-head">
        <div>
          <h1>Admin Overview</h1>
          <p>Verify clinicians, manage accounts and keep an eye on how the platform is used.</p>
        </div>
        <div className="dash-actions">
          <Link className="btn btn-outline" to="/admin/audit">
            <Icon name="file" size={18} /> Audit log
          </Link>
          <Link className="btn btn-primary" to="/admin/verification">
            <Icon name="badgeCheck" size={18} /> Verification queue{pending ? ` (${pending})` : ""}
          </Link>
        </div>
      </div>

      {pending > 0 && (
        <div className="alert alert-amber">
          <b>{pending}</b> clinician{pending > 1 ? "s are" : " is"} waiting for verification.{" "}
          <Link to="/admin/verification">Review now →</Link>
        </div>
      )}

      <div className="kpis">
        <Kpi icon="users" label="Patients" value={o.patients_total} sub={`${attention.length} need attention`} to="/admin/patients" />
        <Kpi
          icon="stethoscope"
          tone="teal"
          label="Clinicians"
          value={o.therapists_by_status.APPROVED || 0}
          sub={`verified · ${pending} pending`}
          to="/admin/therapists"
        />
        <Kpi icon="activity" tone="blue" label="Sessions" value={o.sessions_last_7_days} sub={`last 7 days · ${o.sessions_total} in total`} />
        <Kpi
          icon="target"
          tone="green"
          label="Plan Followed"
          value={followedPct === null ? "-" : `${followedPct}%`}
          sub="of camera sessions, last 7 days"
        />
        <Kpi
          icon="alert"
          tone="red"
          label="High Pain"
          value={o.high_pain_last_7_days}
          sub="pain ≥ 7/10, last 7 days"
          valueClass={o.high_pain_last_7_days ? "bad" : ""}
        />
      </div>

      <div className="dash-grid">
        <Panel className="span-4" title="Plan Followed, Last 7 Days" icon="target">
          <Donut
            parts={[
              { label: "Followed", value: pf.YES, color: PIE.green },
              { label: "Partly", value: pf.PARTLY, color: PIE.amber },
              { label: "Not followed", value: pf.NO, color: PIE.red },
            ]}
            center={followedPct === null ? "-" : `${followedPct}%`}
            centerLabel="followed"
          />
          <p className="muted small" style={{ margin: "12px 0 0" }}>
            Camera-measured sessions only. Admins see totals; session details stay with each patient's clinician.
          </p>
        </Panel>

        <Panel className="span-8" title="Recent Activity" icon="file" action={<PanelLink to="/admin/audit">Full audit log</PanelLink>}>
          {audit.length === 0 ? (
            <p className="empty">No activity yet.</p>
          ) : (
            <div className="list">
              {audit.map((r) => (
                <div className="list-row" key={r.id}>
                  <Avatar name={r.actor_name || "System"} size={32} />
                  <span className="list-main">
                    <span className="list-title">
                      <span className={`badge badge-${ACTION_COLOR[r.action] || "grey"}`}>{ACTION_LABEL[r.action] || r.action}</span>
                    </span>
                    <span className="list-sub">
                      {r.actor_name || "System"}
                      {r.target_name ? ` → ${r.target_name}` : ""}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </span>
                  </span>
                  <span className="list-side">{fmtDate(r.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="span-12" flush title="Clinician Management" icon="stethoscope" action={<PanelLink to="/admin/therapists" />}>
          {therapists.length === 0 ? (
            <p className="empty">No clinicians registered yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Profession</th>
                    <th>Patients</th>
                    <th>Account</th>
                    <th>Verification</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {therapists.slice(0, 6).map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="person">
                          <Avatar name={t.name} />
                          <div>
                            <div className="strong">{t.name}</div>
                            <div className="muted">{t.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>{PROFESSION[t.verification.profession] || t.verification.profession || "-"}</td>
                      <td>{t.patient_count}</td>
                      <td>
                        <AccountBadge status={t.account_status} />
                      </td>
                      <td>
                        <VerificationBadge status={t.verification.status} />
                      </td>
                      <td className="right">
                        <Link className="btn btn-outline btn-sm" to={`/admin/therapists/${t.id}`}>
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel className="span-12" flush title="Patients Needing Attention" icon="alert" action={<PanelLink to="/admin/patients" />}>
          {attention.length === 0 ? (
            <p className="empty">No patient is flagged for low adherence, high pain or a review.</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Clinician</th>
                    <th>Adherence</th>
                    <th>Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.slice(0, 6).map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="person">
                          <Avatar name={p.name} />
                          <div>
                            <div className="strong">
                              {p.name} {p.pain_alert && <span className="badge badge-red">Pain</span>}
                            </div>
                            <div className="muted">{p.surgery_type || "-"}</div>
                          </div>
                        </div>
                      </td>
                      <td>{p.therapist}</td>
                      <td>
                        <PctBar pct={p.badge.avg_adherence_pct} color={p.badge.color} />
                        <AdherenceBadge badge={p.badge} />
                      </td>
                      <td className="nowrap">{fmtDate(p.last_session_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

      </div>

      <p className="muted small">
        {o.admins_total} admin account{o.admins_total === 1 ? "" : "s"} · {o.suspended_accounts} suspended account
        {o.suspended_accounts === 1 ? "" : "s"}.
      </p>
    </div>
  );
}
