import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { DAY_NAMES, api } from "../api.js";

// Prescription builder: choose exercises (nothing pre-ticked), set parameters per exercise,
// review, then save as a NEW plan version (or as a draft the patient cannot see).
//
// Phase 2 will add the condition library (Core / Additional exercises per condition).
// Until then the exercises are grouped by joint and the condition is free text.

const SIDES = [
  ["BOTH", "Both"],
  ["LEFT", "Left"],
  ["RIGHT", "Right"],
];
const LIMITS = {
  sets: [1, 10],
  reps_per_set: [1, 50],
  hold_s: [0, 120],
  rest_s: [0, 600],
  min_angle: [0, 180],
  max_angle: [0, 180],
};
const LABEL = {
  sets: "Sets",
  reps_per_set: "Reps per set",
  hold_s: "Hold (seconds)",
  rest_s: "Rest between sets (s)",
  min_angle: "Min angle (°, approx.)",
  max_angle: "Max angle (°, approx.)",
};
let uid = 0;

function newItem(ex, condition) {
  uid += 1;
  return {
    uid,
    exercise_type: ex.key,
    condition: condition || "",
    sets: 3,
    reps_per_set: 10,
    hold_s: 0,
    rest_s: 30,
    side: "BOTH",
    min_angle: ex.default_min,
    max_angle: ex.default_max,
    days: [0, 1, 2, 3, 4, 5, 6],
    time_of_day: "",
    note: "",
  };
}

function fromPlanItem(it) {
  uid += 1;
  return {
    uid,
    exercise_type: it.exercise_type,
    condition: it.condition || "",
    sets: it.sets,
    reps_per_set: it.reps_per_set,
    hold_s: it.hold_s ?? 0,
    rest_s: it.rest_s ?? 30,
    side: it.side || "BOTH",
    min_angle: it.min_angle,
    max_angle: it.max_angle,
    days: it.days && it.days.length ? it.days : [0, 1, 2, 3, 4, 5, 6],
    time_of_day: it.time_of_day || "",
    note: it.note || "",
  };
}

function problemsOf(items) {
  const out = [];
  const seen = new Set();
  if (!items.length) out.push("Select at least one exercise.");
  items.forEach((it, n) => {
    const name = `Exercise ${n + 1}`;
    Object.entries(LIMITS).forEach(([k, [lo, hi]]) => {
      const v = Number(it[k]);
      if (it[k] === "" || !Number.isFinite(v) || v < lo || v > hi) out.push(`${name}: ${LABEL[k]} must be ${lo}–${hi}.`);
      else if (k !== "min_angle" && k !== "max_angle" && !Number.isInteger(v)) out.push(`${name}: ${LABEL[k]} must be a whole number.`);
    });
    if (Number(it.min_angle) >= Number(it.max_angle)) out.push(`${name}: min angle must be below max angle.`);
    if (!it.days.length) out.push(`${name}: choose at least one day.`);
    if (it.time_of_day && !/^([01]\d|2[0-3]):[0-5]\d$/.test(it.time_of_day)) out.push(`${name}: time must look like 08:30.`);
    const key = `${it.exercise_type}-${it.side}`;
    if (seen.has(key)) out.push(`${name}: the same exercise and side is already in the plan.`);
    seen.add(key);
  });
  return out;
}

export default function PrescriptionBuilder() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const from = params.get("from");
  const navigate = useNavigate();

  const [patient, setPatient] = useState(null);
  const [exercises, setExercises] = useState([]);
  const [items, setItems] = useState([]);
  const [planNote, setPlanNote] = useState("");
  const [base, setBase] = useState(null); // the version being edited
  const [info, setInfo] = useState(null); // exercise key whose details are open
  const [reviewed, setReviewed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.patient(id), api.exercises(), api.plans(id)])
      .then(([p, ex, plans]) => {
        setPatient(p);
        setExercises(ex);
        const b = from ? plans.find((x) => String(x.id) === String(from)) : null;
        if (b) {
          setBase(b);
          setItems(b.items.map(fromPlanItem));
          setPlanNote(b.note || "");
        }
      })
      .catch((e) => setError(e.message));
  }, [id, from]);

  const exByKey = useMemo(() => Object.fromEntries(exercises.map((e) => [e.key, e])), [exercises]);
  const groups = useMemo(() => {
    const g = {};
    exercises.forEach((e) => (g[e.joint] = g[e.joint] || []).push(e));
    return Object.entries(g);
  }, [exercises]);
  const problems = problemsOf(items);

  function changed() {
    setReviewed(false);
    setDirty(true);
    setSaveError("");
  }

  function toggle(ex) {
    const has = items.some((it) => it.exercise_type === ex.key);
    setItems(has ? items.filter((it) => it.exercise_type !== ex.key) : [...items, newItem(ex, patient?.surgery_type)]);
    changed();
  }

  function update(u, field, value) {
    setItems(items.map((it) => (it.uid === u ? { ...it, [field]: value } : it)));
    changed();
  }

  function toggleDay(u, d) {
    const it = items.find((x) => x.uid === u);
    update(u, "days", it.days.includes(d) ? it.days.filter((x) => x !== d) : [...it.days, d].sort());
  }

  function remove(u) {
    setItems(items.filter((it) => it.uid !== u));
    changed();
  }

  function cancel() {
    if (dirty && !window.confirm("Discard your changes to this plan?")) return;
    navigate(`/therapist/patients/${id}?tab=plan`);
  }

  async function save(status) {
    setSaveError("");
    if (problems.length) return setSaveError(problems[0]);
    setSaving(true);
    try {
      await api.savePlan(id, {
        status,
        note: planNote.trim() || null,
        draft_id: base && base.status === "DRAFT" ? base.id : null,
        items: items.map((it) => ({
          exercise_type: it.exercise_type,
          condition: it.condition.trim() || null,
          sets: Number(it.sets),
          reps_per_set: Number(it.reps_per_set),
          hold_s: Number(it.hold_s),
          rest_s: Number(it.rest_s),
          side: it.side,
          min_angle: Number(it.min_angle),
          max_angle: Number(it.max_angle),
          days: it.days,
          time_of_day: it.time_of_day || null,
          note: it.note.trim() || null,
        })),
      });
      setDirty(false);
      navigate(`/therapist/patients/${id}?tab=plan`);
    } catch (err) {
      setSaveError(err.message);
      setSaving(false);
    }
  }

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!patient) return <p className="muted">Loading...</p>;

  return (
    <div className="builder">
      <Link to={`/therapist/patients/${id}?tab=plan`} className="back">
        ← {patient.name}
      </Link>
      <div className="page-head">
        <div>
          <h1>{base && base.status !== "DRAFT" ? `Edit plan - new version` : base ? "Continue draft" : "New plan"}</h1>
          <p className="muted">
            {patient.name} · {patient.surgery_type || "no condition recorded"}
            {base && base.status !== "DRAFT" ? ` · starting from version ${base.version}. Old versions and their reports stay unchanged.` : ""}
          </p>
        </div>
      </div>

      {/* ---------- Step 1: choose exercises ---------- */}
      <div className="card">
        <h3>1. Choose exercises</h3>
        <p className="muted small">
          Nothing is pre-selected - tick only what this patient should do. The condition library (core and additional
          exercises per condition) arrives in Phase 2.
        </p>
        {groups.map(([joint, list]) => (
          <div key={joint} className="ex-group">
            <div className="ex-group-title">{joint}</div>
            <div className="ex-grid">
              {list.map((ex) => {
                const picked = items.some((it) => it.exercise_type === ex.key);
                return (
                  <div key={ex.key} className={`ex-card ${picked ? "picked" : ""}`}>
                    <label className="ex-pick">
                      <input type="checkbox" checked={picked} onChange={() => toggle(ex)} />
                      <span>
                        <span className="strong">{ex.name}</span>
                        <span className="muted small">
                          {" "}
                          · {ex.view} view · default {ex.default_min}°–{ex.default_max}°
                        </span>
                      </span>
                    </label>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInfo(info === ex.key ? null : ex.key)}>
                      {info === ex.key ? "Hide" : "Details"}
                    </button>
                    {info === ex.key && (
                      <div className="ex-info small">
                        <p>{ex.instructions}</p>
                        <p className="muted">
                          Measures: {ex.measure}. Camera: {ex.view === "side" ? "patient side-on" : "patient facing the camera"}.
                          Tracking: AI camera tracking (approximate 2-D angle).
                        </p>
                        <span className="badge badge-amber">Needs clinician review</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ---------- Step 2: parameters ---------- */}
      <div className="card">
        <h3>2. Set parameters ({items.length} selected)</h3>
        {items.length === 0 && <p className="muted">Tick an exercise above to set its parameters.</p>}
        {items.map((it, n) => {
          const ex = exByKey[it.exercise_type] || { name: it.exercise_type };
          return (
            <div key={it.uid} className="item-card">
              <div className="card-head">
                <div className="strong">
                  {n + 1}. {ex.name}
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(it.uid)}>
                  Remove
                </button>
              </div>
              <div className="item-grid">
                {["sets", "reps_per_set", "hold_s", "rest_s"].map((k) => (
                  <label key={k}>
                    {LABEL[k]}
                    <input type="number" min={LIMITS[k][0]} max={LIMITS[k][1]} value={it[k]} onChange={(e) => update(it.uid, k, e.target.value)} />
                  </label>
                ))}
                <label>
                  Side
                  <select value={it.side} onChange={(e) => update(it.uid, "side", e.target.value)}>
                    {SIDES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {LABEL.min_angle}
                  <input type="number" min="0" max="180" value={it.min_angle} onChange={(e) => update(it.uid, "min_angle", e.target.value)} />
                </label>
                <label>
                  {LABEL.max_angle}
                  <input type="number" min="0" max="180" value={it.max_angle} onChange={(e) => update(it.uid, "max_angle", e.target.value)} />
                </label>
                <label>
                  Time of day (optional)
                  <input type="time" value={it.time_of_day} onChange={(e) => update(it.uid, "time_of_day", e.target.value)} />
                </label>
              </div>
              {ex.direction && (
                <p className="muted small">
                  {ex.direction === "down"
                    ? "Lower angle = straighter. The patient must reach at most the max angle."
                    : "The patient must reach at least the min angle and not go past the max."}
                </p>
              )}
              <div className="days-row">
                <span className="muted small">Days:</span>
                {DAY_NAMES.map((d, i) => (
                  <button
                    type="button"
                    key={d}
                    className={`day ${it.days.includes(i) ? "on" : ""}`}
                    onClick={() => toggleDay(it.uid, i)}
                    aria-pressed={it.days.includes(i)}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="item-grid two">
                <label>
                  Condition this exercise is for
                  <input value={it.condition} placeholder="e.g. Knee replacement (left)" onChange={(e) => update(it.uid, "condition", e.target.value)} />
                </label>
                <label>
                  Note to patient (optional)
                  <input value={it.note} maxLength={300} placeholder="e.g. Go slowly, stop if pain increases" onChange={(e) => update(it.uid, "note", e.target.value)} />
                </label>
              </div>
            </div>
          );
        })}
        {items.length > 0 && (
          <label>
            General note to the patient (optional)
            <textarea rows={2} maxLength={500} value={planNote} onChange={(e) => (setPlanNote(e.target.value), changed())} />
          </label>
        )}
      </div>

      {/* ---------- Step 3: review and save ---------- */}
      <div className="card">
        <h3>3. Review and save</h3>
        {!reviewed ? (
          <>
            {items.length > 0 && problems.length > 0 && (
              <div className="alert alert-amber small">
                {problems.slice(0, 4).map((p) => (
                  <div key={p}>{p}</div>
                ))}
              </div>
            )}
            <div className="row-gap">
              <button className="btn btn-primary" disabled={problems.length > 0} onClick={() => setReviewed(true)}>
                Review plan
              </button>
              <button className="btn btn-outline" disabled={saving || items.length === 0} onClick={() => save("DRAFT")}>
                Save as draft
              </button>
              <button className="btn btn-ghost" onClick={cancel}>
                Cancel
              </button>
            </div>
            <p className="muted small">Save becomes available after you review the plan.</p>
          </>
        ) : (
          <>
            <table className="table review-table">
              <thead>
                <tr>
                  <th>Exercise</th>
                  <th>Side</th>
                  <th>Amount</th>
                  <th>Range</th>
                  <th>When</th>
                  <th>For / note</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.uid}>
                    <td className="strong">{(exByKey[it.exercise_type] || {}).name}</td>
                    <td>{it.side}</td>
                    <td>
                      {it.sets} × {it.reps_per_set}
                      {Number(it.hold_s) ? `, hold ${it.hold_s}s` : ""}, rest {it.rest_s}s
                    </td>
                    <td>
                      {it.min_angle}°–{it.max_angle}°
                    </td>
                    <td>
                      {it.days.length === 7 ? "Every day" : it.days.map((d) => DAY_NAMES[d]).join(", ")}
                      {it.time_of_day ? ` at ${it.time_of_day}` : ""}
                    </td>
                    <td className="small">
                      {it.condition || "-"}
                      {it.note ? ` · "${it.note}"` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {planNote.trim() && <p className="small">General note: {planNote}</p>}
            {saveError && <div className="alert alert-red">{saveError}</div>}
            <div className="row-gap">
              <button className="btn btn-primary" disabled={saving} onClick={() => save("ACTIVE")}>
                {saving ? "Saving..." : "Save plan"}
              </button>
              <button className="btn btn-outline" disabled={saving} onClick={() => save("DRAFT")}>
                Save as draft
              </button>
              <button className="btn btn-ghost" onClick={() => setReviewed(false)}>
                Back to editing
              </button>
            </div>
            <p className="muted small">
              Save plan shows these exercises on the patient's home page
              {base && base.status !== "DRAFT" ? ` and replaces version ${base.version}` : ""}.
            </p>
          </>
        )}
        {!reviewed && saveError && <div className="alert alert-red">{saveError}</div>}
      </div>
    </div>
  );
}