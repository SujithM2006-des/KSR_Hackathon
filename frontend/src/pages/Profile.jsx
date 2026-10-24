import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate, fmtNum, getUser } from "../api.js";
import { AccountBadge, SessionStatusBadge } from "../components/Badge.jsx";
import { Avatar, Icon } from "../components/Icons.jsx";

const roleName = (user) => {
  if (user.role === "ADMIN") return "Administrator";
  if (user.role === "PATIENT") return "Patient";
  return user.therapist?.profession === "DOCTOR" ? "Doctor" : "Physiotherapist";
};

export default function Profile() {
  const [user, setUser] = useState(getUser());
  const [patients, setPatients] = useState([]);
  const [selected, setSelected] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState("");
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [produced, setProduced] = useState(false);
  const isDoctor = user?.role === "THERAPIST" && user.therapist?.profession === "DOCTOR";
  const canManageSheets = isDoctor && user.therapist?.status === "APPROVED";

  useEffect(() => {
    api.me().then(setUser).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!canManageSheets) return;
    api.patients().then(setPatients).catch((e) => setError(e.message));
  }, [canManageSheets]);

  async function selectPatient(patient) {
    setSelected(patient);
    setSessions(null);
    setProduced(false);
    setError("");
    setLoadingSheet(true);
    try {
      setSessions(await api.patientSessions(patient.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingSheet(false);
    }
  }

  const totals = useMemo(() => {
    const rows = sessions || [];
    return {
      completed: rows.filter((s) => s.status === "COMPLETED").length,
      reps: rows.reduce((sum, s) => sum + (s.reps_done || 0), 0),
      measured: rows.filter((s) => s.measured).length,
      pain: rows.filter((s) => s.pain_score != null).length,
    };
  }, [sessions]);

  const stats = isDoctor
    ? [
        { icon: "users", label: "Patients", value: patients.length, tone: "blue" },
        { icon: "file", label: "Recorded sessions", value: patients.reduce((n, p) => n + (p.sessions_count || 0), 0), tone: "amber" },
        { icon: "badgeCheck", label: "Verification", value: user?.therapist?.status === "APPROVED" ? "Verified" : user?.therapist?.status || "-", tone: "green" },
      ]
    : user?.role === "PATIENT"
      ? [
          { icon: "user", label: "Patient ID", value: user.patient_id ?? "-", tone: "blue" },
          { icon: "heart", label: "Consent", value: user.consent?.needs_consent ? "Action needed" : user.consent?.given ? "Recorded" : "Not recorded", tone: "green" },
          { icon: "camera", label: "Camera", value: user.consent?.camera_allowed ? "Allowed" : "Off", tone: "amber" },
        ]
      : [
          { icon: "users", label: "Patients", value: "Care team", tone: "blue" },
          { icon: "shield", label: "Access", value: "Administrator", tone: "amber" },
          { icon: "badgeCheck", label: "Account", value: user?.status === "ACTIVE" ? "Active" : user?.status || "-", tone: "green" },
        ];

  const quickActions = canManageSheets
    ? [
        ["My patients", "/therapist/patients", "users"],
        ["Patient progress sheets", "#mark-sheets", "file"],
        ["Safety and help", "/safety", "heart"],
      ]
    : isDoctor
      ? [["Verification details", "/therapist/verification", "badgeCheck"], ["Safety and help", "/safety", "heart"]]
    : user?.role === "PATIENT"
      ? [
          ["My exercise plan", "/patient/plan", "clipboard"],
          ["Session history", "/patient/sessions", "history"],
          ["Consent and settings", "/patient/settings", "settings"],
        ]
      : [
          ["Admin dashboard", "/admin", "home"],
          ["Manage clinicians", "/admin/therapists", "stethoscope"],
          ["Manage administrators", "/admin/admins", "shield"],
        ];

  const details = user ? [
    ["Full name", user.name],
    ["Email address", user.email],
    ["Account type", roleName(user)],
    ["Account status", <AccountBadge status={user.status} />],
    ...(user.patient_id != null ? [["Patient ID", user.patient_id]] : []),
    ...(user.therapist ? [
      ["Verification", user.therapist.status],
      ["Registration number", user.therapist.registration_number],
      ["Issuing body", user.therapist.issuing_body],
      ["Workplace", user.therapist.workplace],
      ["Phone", user.therapist.phone],
    ] : []),
  ] : [];

  return (
    <div className="profile-page">
      <div className="page-head">
        <div>
          <h1>Profile</h1>
          <p className="muted">Your account and workspace information.</p>
        </div>
      </div>
      {error && <div className="alert alert-red">{error}</div>}
      <nav className="profile-tabs" aria-label="Profile sections">
        <a className="profile-tab active" href="#profile-details"><Icon name="user" size={17} /> Profile</a>
        {user?.role === "PATIENT" && <Link className="profile-tab" to="/patient/settings"><Icon name="settings" size={17} /> Privacy and settings</Link>}
        {user?.role === "THERAPIST" && <Link className="profile-tab" to="/therapist/verification"><Icon name="badgeCheck" size={17} /> Credentials</Link>}
        {canManageSheets && <a className="profile-tab" href="#mark-sheets"><Icon name="file" size={17} /> Mark sheets</a>}
        {user?.role === "ADMIN" && <Link className="profile-tab" to="/admin/admins"><Icon name="shield" size={17} /> Administration</Link>}
      </nav>

      <section className="profile-hero" id="profile-details">
        <div className="profile-cover" />
        {user ? <div className="profile-identity">
          <Avatar name={user.name} size={88} />
          <div className="profile-identity-copy">
            <h2>{user.name}</h2>
            <div className="profile-role"><Icon name={user.role === "PATIENT" ? "user" : user.role === "ADMIN" ? "shield" : "stethoscope"} size={16} /> {roleName(user)} <span>·</span> {user.therapist?.status === "APPROVED" ? "Verified clinician" : user.status === "ACTIVE" ? "Active account" : user.status}</div>
          </div>
          <Link className="btn btn-outline profile-settings-link" to={user.role === "PATIENT" ? "/patient/settings" : user.role === "THERAPIST" ? "/therapist/verification" : "/admin"}>
            <Icon name={user.role === "PATIENT" ? "settings" : "badgeCheck"} size={17} />
            {user.role === "PATIENT" ? "Privacy and settings" : user.role === "THERAPIST" ? "Credentials" : "Admin dashboard"}
          </Link>
        </div> : <div className="profile-identity"><span className="muted">Loading profile...</span></div>}
      </section>

      <section className="profile-stats" aria-label="Account summary">
        {stats.map((stat) => <article className="profile-stat card" key={stat.label}>
          <span className={`icon-tile tone-${stat.tone}`}><Icon name={stat.icon} size={20} /></span>
          <div><span>{stat.label}</span><b>{stat.value}</b></div>
        </article>)}
      </section>

      <section className="profile-columns">
        <article className="card profile-details-card">
          <h3>Account details</h3>
          {user ? <dl className="profile-details-list">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "-"}</dd></div>)}</dl> : <p className="muted">Loading profile...</p>}
        </article>
        <article className="card profile-quick-card">
          <h3>Quick actions</h3>
          <div className="profile-quick-actions">{quickActions.map(([label, to, icon]) => to.startsWith("#")
            ? <a key={label} href={to}><Icon name={icon} size={17} />{label}<Icon name="arrowRight" size={16} /></a>
            : <Link key={label} to={to}><Icon name={icon} size={17} />{label}<Icon name="arrowRight" size={16} /></Link>)}
          </div>
        </article>
      </section>

      {canManageSheets && <section className="card doctor-sheet" id="mark-sheets">
        <div className="card-head">
          <div><h2>Patient progress mark sheets</h2><p className="muted">Choose one of your patients to view or produce a printable summary.</p></div>
        </div>
        {patients.length === 0 ? <p className="muted">No patients found.</p> : (
          <label className="mark-patient-select">Patient
            <select value={selected?.id || ""} onChange={(e) => {
              const patient = patients.find((p) => String(p.id) === e.target.value);
              if (patient) selectPatient(patient);
              else { setSelected(null); setSessions(null); setProduced(false); }
            }}>
              <option value="">Select a patient</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.name} · #{p.id}</option>)}
            </select>
          </label>
        )}
        {selected && <>
          {loadingSheet && <p className="muted">Loading session history...</p>}
          {sessions && !produced && <div className="row-gap mark-actions">
            <span className="muted">{sessions.length ? `${sessions.length} session records available` : "No session records yet"}</span>
            <button className="btn btn-primary" onClick={() => setProduced(true)}>Produce mark sheet</button>
          </div>}
          {produced && sessions && <div className="mark-sheet print-area">
            <div className="mark-sheet-heading">
              <div><p className="muted small">ReHabRep · Rehabilitation progress</p><h2>Patient mark sheet</h2></div>
              <button className="btn btn-outline no-print" onClick={() => window.print()}>Print / Save as PDF</button>
            </div>
            <div className="mark-sheet-person">
              <b>{selected.name}</b><span>Patient ID: {selected.id}</span>
              <span>{selected.surgery_type || "Condition not recorded"}</span>
            </div>
            <div className="stats mark-sheet-stats">
              <div className="stat"><span className="stat-num">{sessions.length}</span><span className="stat-label">Sessions</span></div>
              <div className="stat"><span className="stat-num">{totals.completed}</span><span className="stat-label">Completed</span></div>
              <div className="stat"><span className="stat-num">{totals.reps}</span><span className="stat-label">Reps completed</span></div>
              <div className="stat"><span className="stat-num">{totals.measured}</span><span className="stat-label">Camera measured</span></div>
              <div className="stat"><span className="stat-num">{totals.pain}</span><span className="stat-label">Pain reports</span></div>
            </div>
            {sessions.length ? <div className="table-scroll"><table className="table">
              <thead><tr><th>Date</th><th>Exercise</th><th>Status</th><th>Reps</th><th>In range</th><th>Best angle</th><th>Pain</th></tr></thead>
              <tbody>{sessions.map((s) => <tr key={s.id}>
                <td>{fmtDate(s.ended_at)}</td><td>{s.exercise_name}</td>
                <td><SessionStatusBadge status={s.status} /></td>
                <td>{s.reps_done ?? 0}/{s.prescribed_reps ?? 0}</td>
                <td>{s.measured ? `${s.good_reps ?? 0} (${fmtNum(s.accuracy_pct)}%)` : "Not measured"}</td>
                <td>{s.max_angle_reached == null ? "-" : `${fmtNum(s.max_angle_reached, 1)}°`}</td>
                <td>{s.pain_score == null ? "-" : `${s.pain_score}/10`}</td>
              </tr>)}</tbody>
            </table></div> : <p className="muted">No sessions have been recorded for this patient yet.</p>}
            <p className="muted small mark-sheet-note">Camera angles are approximate exercise guidance, not clinical measurements.</p>
          </div>}
        </>}
      </section>}
    </div>
  );
}
