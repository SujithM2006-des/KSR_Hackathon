import { useEffect, useState } from "react";
import { api } from "../api.js";
import { JOINT_TONE } from "../components/Dash.jsx";
import { IconTile } from "../components/Icons.jsx";

const JOINTS = ["All", "Knee", "Hip", "Shoulder", "Elbow"];

export default function ExerciseLibrary() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [joint, setJoint] = useState("All");

  useEffect(() => {
    api.exercises().then(setList).catch((e) => setError(e.message));
  }, []);

  const shown = (list || []).filter((e) => joint === "All" || e.joint === joint);

  return (
    <div>
      <div className="dash-head">
        <div>
          <h1>Exercise Library</h1>
          <p>Every exercise the camera can track, with the default range used when you add it to a prescription.</p>
        </div>
      </div>
      {error && <div className="alert alert-red">{error}</div>}
      <div className="tabs" style={{ marginBottom: 18 }}>
        {JOINTS.map((j) => (
          <button key={j} className={`tab ${joint === j ? "tab-active" : ""}`} onClick={() => setJoint(j)}>
            {j}
            {list && ` (${j === "All" ? list.length : list.filter((e) => e.joint === j).length})`}
          </button>
        ))}
      </div>
      {list === null && !error && <p className="muted">Loading...</p>}
      <div className="lib-grid">
        {shown.map((e) => (
          <div className="panel lib-card" key={e.key}>
            <div className="person">
              <IconTile name="activity" tone={JOINT_TONE[e.joint] || "violet"} />
              <div>
                <h3>{e.name}</h3>
                <span className="muted small">{e.measure}</span>
              </div>
            </div>
            <div className="lib-facts">
              <span className="badge badge-violet">{e.joint}</span>
              <span className="badge badge-blue">{e.view === "side" ? "Side-on to camera" : "Facing the camera"}</span>
              <span className="badge badge-green">
                Default {e.default_min}° – {e.default_max}°
              </span>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {e.instructions}
            </p>
          </div>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 16 }}>
        Instructions and default ranges need clinician review before real use. You set the actual range for each
        patient in their prescription.
      </p>
    </div>
  );
}
