import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, fmtDate, fmtNum } from "../api.js";
import {
  AccountBadge,
  AdherenceBadge,
  FollowedBadge,
  PainBadge,
  PlanStatusBadge,
} from "../components/Badge.jsx";
import InviteLinkBox from "../components/InviteLinkBox.jsx";
import ReasonDialog from "../components/ReasonDialog.jsx";

const TABS = [
  ["overview", "Overview"],
  ["plan", "Plan"],
  ["sessions", "Sessions"],
  ["progress", "Progress"],
];
const SIDE_LABEL = { LEFT: "Left", RIGHT: "Right", BOTH: "Both sides" };

function PlanItems({ items }) {
  return items.map((p) => (
    <div key={p.id} className="plan-row">
      <div>
        <div className="strong">
          {p.exercise_name} <span className="muted small">· {SIDE_LABEL[p.side] || p.side}</span>
        </div>
        <div className="muted small">
          {p.sets} {p.sets === 1 ? "set" : "sets"} × {p.reps_per_set} reps
          {p.hold_s ? ` · hold ${p.hold_s}s` : ""}
          {p.rest_s ? ` · rest ${p.rest_s}s` : ""} · {p.days_label}
          {p.time_of_day ? ` at ${p.time_of_day}` : ""}
          {p.condition ? ` · for: ${p.condition}` : ""}
        </div>
        {p.note && <div className="small">Note: {p.note}</div>}
      </div>
      <div className="range-pill">
        {p.min_angle}° – {p.max_angle}°
      </div>
    </div>
  ));
}

export default function PatientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "overview";

  const [patient, setPatient] = useState(null);
  const [plans, setPlans] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [trend, setTrend] = useState([]);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState(null);
  const [inviteError, setInviteError] = useState("");
  const [editing, setEditing] = useState(false);
  const [clinical, setClinical] = useState({ name: "", surgery_type: "", notes: "" });
  const [clinicalMsg, setClinicalMsg] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [chartExercise, setChartExercise] = useState("");

  async function load() {
    try {
      const [p, pl, s, t] = await Promise.all([
        api.patient(id),
        api.plans(id),
        api.patientSessions(id),
        api.trend(id),
      ]);
      setPatient(p);
      setPlans(pl);
      setSessions(s);
      setTrend(t);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const live = plans.find((p) => p.status === "ACTIVE" || p.status === "PAUSED");
  const draft = plans.find((p) => p.status === "DRAFT");
  const history = plans.filter((p) => p !== live && p !== draft && p.status !== "DISCARDED");

  async function sendInvite() {
    setInviteError("");
    try {
      setInvite(await api.sendInvite(id));
      load();
    } catch (e) {
      setInviteError(e.message);
    }
  }

  function startEdit() {
    setClinical({ name: patient.name, surgery_type: patient.surgery_type || "", notes: patient.notes || "" });
    setClinicalMsg(null);
    setEditing(true);
  }

  async function saveClinical(e) {
    e.preventDefault();
    try {
      const p = await api.updatePatient(id, clinical);
      setPatient(p);
      setEditing(false);
      setClinicalMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setClinicalMsg({ ok: false, text: err.message });
    }
  }

  const planDialogs = {
    PAUSE: {
      title: "Pause this plan?",
      text: "The patient will not see these exercises until you resume. Nothing is deleted.",
      confirmLabel: "Pause plan",
    },
    RESUME: { title: "Resume this plan?", text: "The exercises appear on the patient's home again.", confirmLabel: "Resume plan" },
    END: {
      title: "End this plan permanently?",
      text: "No new sessions can start against it. Its history and reports stay.",
      confirmLabel: "End plan",
      danger: true,
    },
    DISCARD: { title: "Discard this draft?", text: "The patient never saw it.", confirmLabel: "Discard draft", danger: true },
  };

  function planAction(action, plan) {
    setDialog({
      ...planDialogs[action],
      onConfirm: (reason) => api.planAction(plan.id, action, reason).then(load),
    });
  }

  // ---- progress chart: one exercise at a time ----
  const trendExercises = useMemo(() => {
    const seen = new Map();
    trend.forEach((t) => seen.set(t.exercise_type, t.exercise_name));
    return [...seen.entries()];
  }, [trend]);

  const activeChartEx = chartExercise || (trendExercises.length ? trendExercises[trendExercises.length - 1][0] : "");
  const chartData = trend.filter((t) => t.exercise_type === activeChartEx);
  const lastTarget = chartData.length ? chartData[chartData.length - 1] : null;

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!patient) return <p className="muted">Loading...</p>;
  const notActivated = patient.account_status === "INVITED" || patient.account_status === "DRAFT";
  const planUrl = (from) => `/therapist/patients/${id}/plan/new${from ? `?from=${from}` : ""}`;

  return (
    <div>
      <Link to="/therapist" className="back">
        ← All patients
      </Link>

      <div className="page-head">
        <div>
          <h1>
            {patient.name} {patient.pain_alert && <span className="badge badge-red">High pain reported</span>}
          </h1>
          <p className="muted">
            {patient.surgery_type || "No condition recorded"} · {patient.email} · {patient.sessions_count} sessions
          </p>
        </div>
        <div className="row-gap">
          {patient.account_status !== "ACTIVE" && <AccountBadge status={patient.account_status} />}
          <AdherenceBadge badge={patient.badge} />
        </div>
      </div>

      <div className="tabs">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            className={`tab ${tab === key ? "tab-active" : ""}`}
            onClick={() => setParams(key === "overview" ? {} : { tab: key }, { replace: true })}
          >
            {label}
            {key === "plan" && draft ? " · draft" : ""}
          </button>
        ))}
      </div>

      {/* ================= OVERVIEW ================= */}
      {tab === "overview" && (
        <>
          {notActivated && (
            <div className="alert alert-amber">
              <b>{patient.account_status === "DRAFT" ? "Not invited yet." : "Invitation sent - not accepted yet."}</b>{" "}
              {patient.invitation_expires_at
                ? `The current link expires ${fmtDate(patient.invitation_expires_at)}. `
                : ""}
              The patient cannot log in until they open the link and choose a password.{" "}
              <button className="btn btn-sm btn-outline" onClick={sendInvite}>
                {patient.account_status === "DRAFT" ? "Send invitation" : "Send a new link"}
              </button>
              {inviteError && <div className="small">{inviteError}</div>}
            </div>
          )}
          {invite && <InviteLinkBox name={patient.name} invitation={invite} onClose={() => setInvite(null)} />}

          <div className="grid-2">
            <div className="card">
              <div className="card-head">
                <h3>Current plan {live && <PlanStatusBadge status={live.status} />}</h3>
                {live && <span className="muted small">Version {live.version}</span>}
              </div>
              {live && live.status === "PAUSED" && (
                <div className="alert alert-amber small">Paused: {live.status_reason || "-"}</div>
              )}
              {!live ? (
                <p className="muted">
                  No active plan.{" "}
                  {draft ? "A draft is waiting in the Plan tab." : "Create one to show exercises to the patient."}
                </p>
              ) : (
                <PlanItems items={live.items} />
              )}
              <div className="row-gap" style={{ marginTop: 12 }}>
                <button className="btn btn-primary" onClick={() => navigate(planUrl(live ? live.id : draft ? draft.id : null))}>
                  {live ? "Edit plan (new version)" : draft ? "Continue draft" : "Create plan"}
                </button>
                <button className="btn btn-ghost" onClick={() => setParams({ tab: "plan" }, { replace: true })}>
                  Plan history
                </button>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Clinical info</h3>
                {!editing && (
                  <button className="btn btn-outline btn-sm" onClick={startEdit}>
                    Edit
                  </button>
                )}
              </div>
              {editing ? (
                <form className="stack" onSubmit={saveClinical}>
                  <label>
                    Full name
                    <input value={clinical.name} onChange={(e) => setClinical({ ...clinical, name: e.target.value })} required />
                  </label>
                  <label>
                    Assessed condition (your assessment)
                    <input
                      value={clinical.surgery_type}
                      onChange={(e) => setClinical({ ...clinical, surgery_type: e.target.value })}
                    />
                  </label>
                  <label>
                    Clinical notes (only you see these)
                    <textarea rows={3} value={clinical.notes} onChange={(e) => setClinical({ ...clinical, notes: e.target.value })} />
                  </label>
                  {clinicalMsg && !clinicalMsg.ok && <div className="alert alert-red">{clinicalMsg.text}</div>}
                  <div className="row-gap">
                    <button className="btn btn-primary">Save</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <dl className="facts">
                    <dt>Assessed condition</dt>
                    <dd>{patient.surgery_type || "-"}</dd>
                    <dt>Clinical notes</dt>
                    <dd>{patient.notes || "-"}</dd>
                    <dt>Account</dt>
                    <dd>
                      <AccountBadge status={patient.account_status} />
                    </dd>
                  </dl>
                  {clinicalMsg && clinicalMsg.ok && <div className="alert alert-green small">{clinicalMsg.text}</div>}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ================= PLAN ================= */}
      {tab === "plan" && (
        <>
          <div className="page-head">
            <p className="muted">
              Saving changes always creates a new version. Old versions and their session reports are never changed.
            </p>
            <button className="btn btn-primary" onClick={() => navigate(planUrl(live ? live.id : null))}>
              {live ? "Edit plan (new version)" : "Create plan"}
            </button>
          </div>

          {draft && (
            <div className="card plan-version draft">
              <div className="card-head">
                <h3>
                  Draft (version {draft.version}) <PlanStatusBadge status="DRAFT" />
                </h3>
                <div className="row-gap">
                  <button className="btn btn-primary btn-sm" onClick={() => navigate(planUrl(draft.id))}>
                    Continue editing
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => planAction("DISCARD", draft)}>
                    Discard
                  </button>
                </div>
              </div>
              <p className="muted small">Hidden from the patient. Saved {fmtDate(draft.created_at)}.</p>
              <PlanItems items={draft.items} />
            </div>
          )}

          {live ? (
            <div className="card plan-version">
              <div className="card-head">
                <h3>
                  Version {live.version} <PlanStatusBadge status={live.status} />
                </h3>
                <div className="row-gap">
                  {live.status === "ACTIVE" ? (
                    <button className="btn btn-outline btn-sm" onClick={() => planAction("PAUSE", live)}>
                      Pause
                    </button>
                  ) : (
                    <button className="btn btn-outline btn-sm" onClick={() => planAction("RESUME", live)}>
                      Resume
                    </button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => planAction("END", live)}>
                    End plan
                  </button>
                </div>
              </div>
              <p className="muted small">
                Started {fmtDate(live.activated_at)} by {live.created_by} · {live.sessions_count} session
                {live.sessions_count === 1 ? "" : "s"}
                {live.status_reason ? ` · ${live.status === "PAUSED" ? "Paused" : "Note"}: ${live.status_reason}` : ""}
              </p>
              {live.note && <div className="alert alert-grey small">Note to patient: {live.note}</div>}
              <PlanItems items={live.items} />
            </div>
          ) : (
            !draft && <p className="muted">No plan yet.</p>
          )}

          {history.length > 0 && (
            <div className="card">
              <h3>Earlier versions</h3>
              {history.map((h) => (
                <details key={h.id} className="history-item">
                  <summary>
                    Version {h.version} <PlanStatusBadge status={h.status} />{" "}
                    <span className="muted small">
                      {fmtDate(h.activated_at || h.created_at)} – {fmtDate(h.ended_at)} · {h.sessions_count} session
                      {h.sessions_count === 1 ? "" : "s"}
                      {h.status_reason ? ` · ${h.status_reason}` : ""}
                    </span>
                  </summary>
                  <PlanItems items={h.items} />
                </details>
              ))}
            </div>
          )}
        </>
      )}

      {/* ================= PROGRESS ================= */}
      {tab === "progress" && (
        <div className="card">
          <div className="card-head">
            <h3>Progress - best angle per session</h3>
            {trendExercises.length > 1 && (
              <select value={activeChartEx} onChange={(e) => setChartExercise(e.target.value)}>
                {trendExercises.map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {chartData.length === 0 ? (
            <p className="muted">No sessions yet.</p>
          ) : (
            <>
              <p className="muted small">
                {chartData[0].exercise_name}. Green band = range prescribed in the latest session ({lastTarget.target_min}° –{" "}
                {lastTarget.target_max}°).
              </p>
              <div className="chart">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#e8edf0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#5b6b75" }} />
                    <YAxis domain={[0, 180]} tick={{ fontSize: 12, fill: "#5b6b75" }} unit="°" />
                    <ReferenceArea
                      y1={lastTarget.target_min}
                      y2={lastTarget.target_max}
                      fill="#16a34a"
                      fillOpacity={0.1}
                      stroke="#16a34a"
                      strokeOpacity={0.3}
                    />
                    <Tooltip
                      formatter={(v, name) => [`${fmtNum(v, 1)}°`, name]}
                      contentStyle={{ borderRadius: 8, fontSize: 13 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="max_angle"
                      name="Best angle"
                      stroke="#0f766e"
                      strokeWidth={2.5}
                      dot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="avg_peak_angle"
                      name="Average per rep"
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================= SESSIONS ================= */}
      {tab === "sessions" && (
        <div className="card table-card">
          <h3 className="pad-x">Session history (adherence reports)</h3>
          {sessions.length === 0 ? (
            <p className="muted pad">No sessions yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Exercise</th>
                  <th>Reps done</th>
                  <th>Correct</th>
                  <th>Under / Over</th>
                  <th>Best angle</th>
                  <th>Pain</th>
                  <th>Plan followed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className={s.high_pain ? "row-alert" : ""}>
                    <td>{fmtDate(s.ended_at)}</td>
                    <td>
                      <div>{s.exercise_name}</div>
                      <div className="muted small">
                        {s.min_angle}° – {s.max_angle}°
                      </div>
                    </td>
                    <td>
                      {s.reps_done}/{s.prescribed_reps}
                    </td>
                    <td>
                      {s.good_reps} <span className="muted small">({fmtNum(s.accuracy_pct)}%)</span>
                    </td>
                    <td>
                      {s.under_reps} / {s.over_reps}
                    </td>
                    <td>{fmtNum(s.max_angle_reached, 1)}°</td>
                    <td>
                      <PainBadge score={s.pain_score} />
                    </td>
                    <td>
                      <FollowedBadge value={s.plan_followed} />
                    </td>
                    <td className="right">
                      <Link className="btn btn-outline btn-sm" to={`/sessions/${s.id}`}>
                        Report
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {dialog && <ReasonDialog {...dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}