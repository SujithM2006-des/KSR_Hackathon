import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate } from "../api.js";
import { AccountBadge, AdherenceBadge, FollowedBadge, PlanStatusBadge } from "../components/Badge.jsx";
import InviteLinkBox from "../components/InviteLinkBox.jsx";

const EMPTY = { name: "", email: "", surgery_type: "", notes: "" };

export default function TherapistDashboard() {
  const [patients, setPatients] = useState(null);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [invite, setInvite] = useState(null); // { name, invitation }
  const [query, setQuery] = useState("");

  async function load() {
    try {
      setPatients(await api.patients());
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const dirty = Object.values(form).some((v) => v.trim() !== "");

  function cancelForm() {
    if (dirty && !window.confirm("Discard this new patient?")) return;
    setForm(EMPTY);
    setFormError("");
    setShowForm(false);
  }

  async function addPatient(sendInvite) {
    setFormError("");
    if (form.name.trim().length < 2) return setFormError("Please enter the patient's full name.");
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return setFormError("Please enter a valid email.");
    setSaving(true);
    try {
      const res = await api.addPatient({
        name: form.name.trim(),
        email: form.email.trim(),
        surgery_type: form.surgery_type.trim() || null,
        notes: form.notes.trim() || null,
        send_invite: sendInvite,
      });
      setInvite(res.invitation ? { name: res.name, invitation: res.invitation } : null);
      setForm(EMPTY);
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const list = patients || [];
  const q = query.trim().toLowerCase();
  const shown = q
    ? list.filter((p) => [p.name, p.email, p.surgery_type].some((v) => (v || "").toLowerCase().includes(q)))
    : list;
  const alerts = list.filter((p) => p.pain_alert || p.badge.color === "red");
  const onTrack = list.filter((p) => p.badge.color === "green").length;
  const waiting = list.filter((p) => p.account_status === "INVITED" || p.account_status === "DRAFT").length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>My patients</h1>
          <p className="muted">Adherence is the average of each patient's last 5 sessions.</p>
        </div>
        <button className="btn btn-primary" onClick={() => (showForm ? cancelForm() : setShowForm(true))}>
          {showForm ? "Cancel" : "+ Add patient"}
        </button>
      </div>

      {error && <div className="alert alert-red">{error}</div>}

      {invite && <InviteLinkBox name={invite.name} invitation={invite.invitation} onClose={() => setInvite(null)} />}

      {showForm && (
        <form
          className="card form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            addPatient(true);
          }}
        >
          <h3 className="span-2">New patient</h3>
          <p className="muted small span-2">
            The patient gets an invitation link and chooses their own password. You never see or set it.
          </p>
          <label>
            Full name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            Email (patient's login)
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </label>
          <label>
            Assessed condition
            <input
              value={form.surgery_type}
              placeholder="e.g. Knee replacement (right)"
              onChange={(e) => setForm({ ...form, surgery_type: e.target.value })}
            />
          </label>
          <label>
            Clinical notes (only you see these)
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          {formError && <div className="alert alert-red span-2">{formError}</div>}
          <div className="span-2 row-gap">
            <button className="btn btn-primary" disabled={saving}>
              {saving ? "Saving..." : "Save and send invitation"}
            </button>
            <button type="button" className="btn btn-outline" disabled={saving} onClick={() => addPatient(false)}>
              Save as draft
            </button>
            <button type="button" className="btn btn-ghost" onClick={cancelForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="stats">
        <div className="stat">
          <span className="stat-num">{list.length}</span>
          <span className="stat-label">Patients</span>
        </div>
        <div className="stat">
          <span className="stat-num ok">{onTrack}</span>
          <span className="stat-label">On track</span>
        </div>
        <div className="stat">
          <span className={`stat-num ${alerts.length ? "bad" : ""}`}>{alerts.length}</span>
          <span className="stat-label">Need a call</span>
        </div>
        <div className="stat">
          <span className={`stat-num ${waiting ? "warn" : ""}`}>{waiting}</span>
          <span className="stat-label">Not yet activated</span>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="alert alert-red">
          <b>Check today:</b>{" "}
          {alerts.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <Link to={`/therapist/patients/${p.id}`}>{p.name}</Link>
              {p.pain_alert ? " (high pain reported)" : " (not following plan)"}
            </span>
          ))}
        </div>
      )}

      {list.length > 0 && (
        <div className="toolbar">
          <input
            className="search"
            placeholder="Search by name, email or condition"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      <div className="card table-card">
        {patients === null && !error ? (
          <p className="muted pad">Loading...</p>
        ) : list.length === 0 ? (
          <p className="muted pad">No patients yet. Add your first patient above.</p>
        ) : shown.length === 0 ? (
          <p className="muted pad">No patient matches "{query}".</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Current plan</th>
                <th>Last session</th>
                <th>Last result</th>
                <th>Adherence</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const plan = p.active_plans[0];
                const last = p.last_session;
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="strong">
                        {p.name} {p.pain_alert && <span className="badge badge-red">Pain</span>}
                      </div>
                      <div className="muted small">{p.surgery_type || "-"}</div>
                      {p.account_status !== "ACTIVE" && <AccountBadge status={p.account_status} />}
                    </td>
                    <td>
                      {p.plan_status === "PAUSED" ? (
                        <PlanStatusBadge status="PAUSED" />
                      ) : plan ? (
                        <>
                          <div>{plan.exercise_name}</div>
                          <div className="muted small">
                            {plan.sets}×{plan.reps_per_set} · {plan.min_angle}°–{plan.max_angle}°
                            {p.active_plans.length > 1 ? ` · +${p.active_plans.length - 1} more` : ""}
                          </div>
                        </>
                      ) : (
                        <span className="muted">{p.has_draft_plan ? "Draft plan only" : "No plan yet"}</span>
                      )}
                    </td>
                    <td>{fmtDate(p.last_session_at)}</td>
                    <td>
                      {last ? (
                        <>
                          {last.good_reps}/{last.prescribed_reps} correct <FollowedBadge value={last.plan_followed} />
                        </>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>
                      <AdherenceBadge badge={p.badge} />
                    </td>
                    <td className="right">
                      <Link className="btn btn-outline btn-sm" to={`/therapist/patients/${p.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}