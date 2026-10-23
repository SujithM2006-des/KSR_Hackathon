import { useEffect, useState } from "react";
import { api, getUser } from "../api.js";
import { JOINT_TONE } from "../components/Dash.jsx";
import { Icon, IconTile } from "../components/Icons.jsx";

const JOINTS = ["Knee", "Hip", "Shoulder", "Elbow"];
const viewText = (v) => (v === "side" ? "Side-on to camera" : "Facing the camera");

// One library card (also used as the live preview in the "Add exercise" form)
function ExerciseCard({ e, mine, onRemove }) {
  return (
    <div className="panel lib-card">
      <div className="person">
        <IconTile name="activity" tone={JOINT_TONE[e.joint] || "violet"} />
        <div>
          <h3>{e.name || "Exercise name"}</h3>
          <span className="muted small">{e.measure}</span>
        </div>
      </div>
      <div className="lib-facts">
        <span className="badge badge-violet">{e.joint}</span>
        <span className="badge badge-blue">{viewText(e.view)}</span>
        <span className="badge badge-green">
          Default {e.default_min}° – {e.default_max}°
        </span>
        {e.custom && <span className="badge badge-amber">{mine ? "Added by you" : `Added by ${e.created_by || "a therapist"}`}</span>}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {e.instructions || "Instructions for the patient appear here."}
      </p>
      {onRemove && (
        <button className="btn btn-ghost btn-sm lib-remove" onClick={() => onRemove(e)}>
          Remove
        </button>
      )}
    </div>
  );
}

function AddExerciseDialog({ builtIns, onSaved, onClose }) {
  const [form, setForm] = useState({ name: "", joint: "Knee", based_on: "", default_min: "", default_max: "", instructions: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bases = builtIns.filter((e) => e.joint === form.joint);
  const base = bases.find((e) => e.key === form.based_on) || bases[0];

  // pick the first movement of the category, and its default range, whenever the category changes
  useEffect(() => {
    if (!base) return;
    setForm((f) => (f.based_on === base.key ? f : { ...f, based_on: base.key, default_min: base.default_min, default_max: base.default_max }));
  }, [form.joint]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (ev) => setForm({ ...form, [k]: ev.target.value });
  function chooseBase(ev) {
    const b = bases.find((x) => x.key === ev.target.value);
    setForm({ ...form, based_on: b.key, default_min: b.default_min, default_max: b.default_max });
  }

  async function submit(ev) {
    ev.preventDefault();
    const min = Number(form.default_min);
    const max = Number(form.default_max);
    if (form.name.trim().length < 3) return setError("Please give the exercise a name (at least 3 letters).");
    if (!(min >= 0 && max <= 180 && min < max)) return setError("The default range must be between 0° and 180°, minimum below maximum.");
    if (form.instructions.trim().length < 10) return setError("Please write short instructions for the patient.");
    setBusy(true);
    setError("");
    try {
      const saved = await api.addExercise({ ...form, name: form.name.trim(), default_min: min, default_max: max, instructions: form.instructions.trim() });
      onSaved(saved);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const preview = base && {
    name: form.name,
    joint: form.joint,
    measure: base.measure,
    view: base.view,
    default_min: form.default_min === "" ? "-" : form.default_min,
    default_max: form.default_max === "" ? "-" : form.default_max,
    instructions: form.instructions,
    custom: true,
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal add-ex-modal" onClick={(ev) => ev.stopPropagation()} onSubmit={submit}>
        <h3>Add an exercise to the library</h3>
        <div className="add-ex-grid">
          <div className="stack">
            <label>
              Exercise name
              <input value={form.name} onChange={set("name")} placeholder="e.g. Wall squat hold" maxLength={80} autoFocus />
            </label>
            <label>
              Category
              <select value={form.joint} onChange={set("joint")}>
                {JOINTS.map((j) => (
                  <option key={j}>{j}</option>
                ))}
              </select>
            </label>
            <label>
              How the camera measures it
              <select value={base ? base.key : ""} onChange={chooseBase}>
                {bases.map((b) => (
                  <option key={b.key} value={b.key}>
                    Like {b.name} ({b.measure.toLowerCase()}, {b.view === "side" ? "side-on" : "facing camera"})
                  </option>
                ))}
              </select>
              <span className="muted small">The camera tracks the same joint the same way, so live sessions work straight away.</span>
            </label>
            <div className="form-grid">
              <label>
                Default min (°)
                <input type="number" min="0" max="180" value={form.default_min} onChange={set("default_min")} />
              </label>
              <label>
                Default max (°)
                <input type="number" min="0" max="180" value={form.default_max} onChange={set("default_max")} />
              </label>
            </div>
            <label>
              Instructions for the patient
              <textarea rows={3} maxLength={400} value={form.instructions} onChange={set("instructions")} placeholder="e.g. Stand side-on to the camera, ..." />
            </label>
          </div>
          <div>
            <span className="muted small">Preview</span>
            {preview && <ExerciseCard e={preview} mine />}
          </div>
        </div>
        {error && <div className="alert alert-red">{error}</div>}
        <div className="row-gap right">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Saving..." : "Add to library"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ExerciseLibrary() {
  const user = getUser();
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [joint, setJoint] = useState("All");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null); // exercise waiting for confirmation
  const [notice, setNotice] = useState("");

  const load = () =>
    api
      .exercises()
      .then(setList)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  async function confirmRemove() {
    try {
      await api.removeExercise(removing.key);
      setNotice(`"${removing.name}" was removed from the library.`);
      setRemoving(null);
      load();
    } catch (e) {
      setError(e.message);
      setRemoving(null);
    }
  }

  const shown = (list || []).filter((e) => joint === "All" || e.joint === joint);
  const builtIns = (list || []).filter((e) => !e.custom);

  return (
    <div>
      <div className="dash-head">
        <div>
          <h1>Exercise Library</h1>
          <p>Every exercise the camera can track, with the default range used when you add it to a prescription.</p>
        </div>
        <button className="btn btn-primary" disabled={!list} onClick={() => setAdding(true)}>
          <Icon name="plus" size={18} /> Add exercise
        </button>
      </div>
      {error && <div className="alert alert-red">{error}</div>}
      {notice && <div className="alert alert-green">{notice}</div>}
      <div className="tabs" style={{ marginBottom: 18 }}>
        {["All", ...JOINTS].map((j) => (
          <button key={j} className={`tab ${joint === j ? "tab-active" : ""}`} onClick={() => setJoint(j)}>
            {j}
            {list && ` (${j === "All" ? list.length : list.filter((e) => e.joint === j).length})`}
          </button>
        ))}
      </div>
      {list === null && !error && <p className="muted">Loading...</p>}
      <div className="lib-grid">
        {shown.map((e) => {
          const mine = e.custom && user && e.created_by_id === user.id;
          return <ExerciseCard key={e.key} e={e} mine={mine} onRemove={mine ? setRemoving : null} />;
        })}
      </div>
      <p className="muted small" style={{ marginTop: 16 }}>
        Instructions and default ranges need clinician review before real use. You set the actual range for each
        patient in their prescription.
      </p>

      {adding && (
        <AddExerciseDialog
          builtIns={builtIns}
          onClose={() => setAdding(false)}
          onSaved={(saved) => {
            setAdding(false);
            setNotice(`"${saved.name}" was added to the library. You can now use it in prescriptions.`);
            setJoint(saved.joint);
            load();
          }}
        />
      )}
      {removing && (
        <div className="modal-backdrop" onClick={() => setRemoving(null)}>
          <div className="modal" onClick={(ev) => ev.stopPropagation()}>
            <h3>Remove "{removing.name}"?</h3>
            <p className="muted">It disappears from the library. Exercises used in a patient's plan cannot be removed.</p>
            <div className="row-gap right">
              <button className="btn btn-ghost" onClick={() => setRemoving(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={confirmRemove}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
