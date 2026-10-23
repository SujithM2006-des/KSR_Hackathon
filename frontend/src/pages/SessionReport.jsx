import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, fmtDate, fmtNum, getUser } from "../api.js";
import { FollowedBadge, PainBadge, ResultBadge } from "../components/Badge.jsx";

const RESULT_COLOR = { GOOD: "#16a34a", UNDER: "#d97706", OVER: "#dc2626" };

export default function SessionReport() {
  const { id } = useParams();
  const user = getUser();
  const [s, setS] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .session(id)
      .then(setS)
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!s) return <p className="muted">Loading...</p>;

  const back =
    user.role === "THERAPIST" ? (
      <Link to={`/therapist/patients/${s.patient_id}`} className="back">
        ← Back to patient
      </Link>
    ) : (
      <Link to="/patient" className="back">
        ← Back
      </Link>
    );

  const chartData = s.reps.map((r) => ({ name: `Rep ${r.rep_number}`, angle: r.peak_angle, result: r.result }));
  const isDown = s.direction === "down";

  return (
    <div>
      {back}
      <div className="page-head">
        <div>
          <h1>Session report</h1>
          <p className="muted">
            {s.exercise_name} · {fmtDate(s.ended_at)} · prescribed range {s.min_angle}° – {s.max_angle}°
          </p>
        </div>
        <FollowedBadge value={s.plan_followed} />
      </div>

      {s.high_pain && (
        <div className="alert alert-red">
          Patient reported pain {s.pain_score}/10 after this session. Consider contacting them before the next session.
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <span className="stat-num">
            {s.reps_done}/{s.prescribed_reps}
          </span>
          <span className="stat-label">Reps done</span>
        </div>
        <div className="stat">
          <span className="stat-num ok">{s.good_reps}</span>
          <span className="stat-label">Correct ({fmtNum(s.accuracy_pct)}%)</span>
        </div>
        <div className="stat">
          <span className="stat-num warn">{s.under_reps}</span>
          <span className="stat-label">{isDown ? "Not straight enough" : "Not enough range"}</span>
        </div>
        <div className="stat">
          <span className="stat-num bad">{s.over_reps}</span>
          <span className="stat-label">Past the limit</span>
        </div>
        <div className="stat">
          <span className="stat-num">{fmtNum(s.max_angle_reached, 1)}°</span>
          <span className="stat-label">Best angle</span>
        </div>
        <div className="stat">
          <PainBadge score={s.pain_score} />
          <span className="stat-label">Pain check-in</span>
        </div>
      </div>

      <div className="card">
        <h3>Angle reached in every rep</h3>
        <p className="muted small">Green band = prescribed range. Each bar is coloured by its result.</p>
        {chartData.length === 0 ? (
          <p className="muted">No reps recorded.</p>
        ) : (
          <div className="chart">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e8edf0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#5b6b75" }} />
                <YAxis domain={[0, 180]} tick={{ fontSize: 12, fill: "#5b6b75" }} unit="°" />
                <ReferenceArea
                  y1={s.min_angle}
                  y2={s.max_angle}
                  fill="#16a34a"
                  fillOpacity={0.1}
                  stroke="#16a34a"
                  strokeOpacity={0.3}
                />
                <Tooltip
                  formatter={(v) => [`${fmtNum(v, 1)}°`, "Angle"]}
                  contentStyle={{ borderRadius: 8, fontSize: 13 }}
                  cursor={{ fill: "rgba(15, 118, 110, 0.06)" }}
                />
                <Bar dataKey="angle" radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false}>
                  {chartData.map((d) => (
                    <Cell key={d.name} fill={RESULT_COLOR[d.result]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card table-card">
        <table className="table">
          <thead>
            <tr>
              <th>Rep</th>
              <th>{isDown ? "Straightest angle" : "Highest angle"}</th>
              <th>Result</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {s.reps.map((r) => (
              <tr key={r.rep_number}>
                <td>{r.rep_number}</td>
                <td>{fmtNum(r.peak_angle, 1)}°</td>
                <td>
                  <ResultBadge result={r.result} />
                </td>
                <td>{fmtNum(r.duration_s, 1)} s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}