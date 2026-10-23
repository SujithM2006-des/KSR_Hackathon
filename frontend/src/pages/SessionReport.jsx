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
import { FollowedBadge, ModeBadge, PainBadge, ResultBadge, SessionStatusBadge } from "../components/Badge.jsx";

const RESULT_COLOR = { GOOD: "#16a34a", UNDER: "#d97706", OVER: "#dc2626" };
const UNAVAILABLE = <span className="muted">Unavailable</span>;
const FLAG_TEXT = {
  NOT_WELL: "Patient said they were not well and skipped the exercise.",
  PAIN_STOP: "Patient stopped the exercise because of pain.",
};

function fmtDuration(sec) {
  const total = Math.round(sec);
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${m} min ${rest} s` : `${m} min`;
}

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

  const isTherapist = user.role === "THERAPIST";
  const back = isTherapist ? (
    <Link to={`/therapist/patients/${s.patient_id}?tab=sessions`} className="back">
      ← Back to patient
    </Link>
  ) : (
    <Link to="/patient" className="back">
      ← Back
    </Link>
  );

  const reps = s.reps || [];
  const chartData = reps.map((r) => ({ name: `Rep ${r.rep_number}`, angle: r.peak_angle, result: r.result }));
  const isDown = s.direction === "down";
  const skipped = s.status === "SKIPPED";

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
        <div className="row-gap">
          <SessionStatusBadge status={s.status} />
          <ModeBadge mode={s.mode} />
          {s.measured && <FollowedBadge value={s.plan_followed} />}
        </div>
      </div>

      {s.review_flag && <div className="alert alert-amber">{FLAG_TEXT[s.review_flag] || s.review_flag} Please review.</div>}
      {s.high_pain && (
        <div className="alert alert-red">
          {isTherapist
            ? `Patient reported pain ${s.pain_score}/10 after this session. Consider contacting them before the next session.`
            : `You reported pain ${s.pain_score}/10. Please rest and contact your therapist.`}
        </div>
      )}
      {!s.measured && !skipped && (
        <div className="alert alert-grey">
          Done without the camera. The patient confirmed the sets themselves - no repetitions or angles were measured.
        </div>
      )}
      {skipped && (
        <div className="alert alert-grey">
          Skipped. {s.patient_note ? `Reason: "${s.patient_note}"` : "No reason given."}
        </div>
      )}

      {!skipped && (
        <div className="stats">
          <div className="stat">
            <span className="stat-num">
              {s.reps_done}/{s.prescribed_reps}
            </span>
            <span className="stat-label">{s.measured ? "Reps counted" : "Reps confirmed by patient"}</span>
          </div>
          <div className="stat">
            <span className="stat-num ok">{s.measured ? s.good_reps : UNAVAILABLE}</span>
            <span className="stat-label">In range{s.measured ? ` (${fmtNum(s.accuracy_pct)}%)` : ""}</span>
          </div>
          <div className="stat">
            <span className="stat-num warn">{s.measured ? s.under_reps : UNAVAILABLE}</span>
            <span className="stat-label">{isDown ? "Not straight enough" : "Below range"}</span>
          </div>
          <div className="stat">
            <span className="stat-num bad">{s.measured ? s.over_reps : UNAVAILABLE}</span>
            <span className="stat-label">Above range</span>
          </div>
          <div className="stat">
            <span className="stat-num">{s.max_angle_reached != null ? `${fmtNum(s.max_angle_reached, 1)}°` : UNAVAILABLE}</span>
            <span className="stat-label">Best angle (approx.)</span>
          </div>
          <div className="stat">
            <PainBadge score={s.pain_score} />
            <span className="stat-label">Pain check-in</span>
          </div>
          <div className="stat">
            <span className="stat-num">{s.duration_s ? fmtDuration(s.duration_s) : UNAVAILABLE}</span>
            <span className="stat-label">Exercise time</span>
          </div>
        </div>
      )}

      {s.patient_note && !skipped && (
        <div className="card">
          <h3>Patient's note</h3>
          <p>{s.patient_note}</p>
        </div>
      )}

      {s.measured && (
        <>
          <div className="card">
            <h3>Angle reached in every rep</h3>
            <p className="muted small">Green band = prescribed range. Each bar is coloured by its result (and labelled below).</p>
            {chartData.length === 0 ? (
              <p className="muted">No reps recorded.</p>
            ) : (
              <div className="chart">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#eef0f7" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#5d6585" }} />
                    <YAxis domain={[0, 180]} tick={{ fontSize: 12, fill: "#5d6585" }} unit="°" />
                    <ReferenceArea y1={s.min_angle} y2={s.max_angle} fill="#16a34a" fillOpacity={0.1} stroke="#16a34a" strokeOpacity={0.3} />
                    <Tooltip
                      formatter={(v, n, p) => [`${fmtNum(v, 1)}° (${p.payload.result})`, "Angle"]}
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
                {reps.map((r) => (
                  <tr key={r.rep_number}>
                    <td>{r.rep_number}</td>
                    <td>{fmtNum(r.peak_angle, 1)}°</td>
                    <td>
                      <ResultBadge result={r.result} />
                    </td>
                    <td>{r.duration_s != null ? `${fmtNum(r.duration_s, 1)} s` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted small">Angles are 2-D camera estimates for exercise guidance, not a clinical measurement.</p>
    </div>
  );
}