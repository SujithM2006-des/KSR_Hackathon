import { useState } from "react";
import { api, config, getUser } from "../api.js";

// Developer page (only routed when running "npm run dev"): checks each backend area
// with the current login and shows OK / which call failed.
const CHECKS = [
  { area: "Backend reachable", role: null, run: () => api.health() },
  { area: "Registration form config", role: null, run: () => api.registrationConfig() },
  { area: "Current user (/me)", role: "ANY", run: () => api.me() },
  { area: "Exercise library", role: "ANY", run: () => api.exercises() },
  { area: "Therapist: my verification", role: "THERAPIST", run: () => api.myVerification() },
  { area: "Therapist: patients", role: "THERAPIST", run: () => api.patients() },
  { area: "Patient: my plans", role: "PATIENT", run: () => api.myPlans() },
  { area: "Patient: my sessions", role: "PATIENT", run: () => api.mySessions() },
  { area: "Admin: overview", role: "ADMIN", run: () => api.adminOverview() },
  { area: "Admin: therapists", role: "ADMIN", run: () => api.adminTherapists() },
  { area: "Admin: patients", role: "ADMIN", run: () => api.adminPatients() },
  { area: "Admin: audit log", role: "ADMIN", run: () => api.adminAuditLog(5) },
];

function summary(data) {
  if (Array.isArray(data)) return `${data.length} item${data.length === 1 ? "" : "s"}`;
  if (data && typeof data === "object") return Object.keys(data).slice(0, 5).join(", ");
  return String(data);
}

export default function IntegrationStatus() {
  const user = getUser();
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);

  async function runAll() {
    setRunning(true);
    setResults({});
    for (const c of CHECKS) {
      const skip =
        (c.role === "ANY" && !user) || (c.role && c.role !== "ANY" && (!user || user.role !== c.role));
      if (skip) {
        setResults((r) => ({ ...r, [c.area]: { state: "skip", text: `Log in as ${c.role === "ANY" ? "anyone" : c.role}` } }));
        continue;
      }
      const t0 = performance.now();
      try {
        const data = await c.run();
        setResults((r) => ({ ...r, [c.area]: { state: "ok", text: summary(data), ms: performance.now() - t0 } }));
      } catch (e) {
        setResults((r) => ({ ...r, [c.area]: { state: "fail", text: `${e.status ?? ""} ${e.message}`, ms: performance.now() - t0 } }));
      }
    }
    setRunning(false);
  }

  return (
    <div className="narrow pad-page">
      <h1>Integration status</h1>
      <p className="muted">
        Mode <b>{config.mode}</b> · API <code>{config.apiBaseUrl}</code> · logged in as{" "}
        <b>{user ? `${user.name} (${user.role})` : "nobody"}</b>
      </p>
      <button className="btn btn-primary" onClick={runAll} disabled={running}>
        {running ? "Checking..." : "Run checks"}
      </button>
      <div className="card table-card" style={{ marginTop: 16 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Area</th>
              <th>Result</th>
              <th>Details</th>
              <th className="right">ms</th>
            </tr>
          </thead>
          <tbody>
            {CHECKS.map((c) => {
              const r = results[c.area];
              const cls = !r ? "grey" : r.state === "ok" ? "green" : r.state === "fail" ? "red" : "grey";
              return (
                <tr key={c.area}>
                  <td>{c.area}</td>
                  <td>
                    <span className={`badge badge-${cls}`}>{r ? r.state.toUpperCase() : "-"}</span>
                  </td>
                  <td className="small">{r ? r.text : ""}</td>
                  <td className="right small">{r && r.ms ? Math.round(r.ms) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}