import { Link } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Icon, IconTile } from "./Icons.jsx";

// KPI card: coloured icon tile + label + big value + small line. `to` makes it a link.
export function Kpi({ icon, tone = "violet", label, value, sub, valueClass = "", to }) {
  const body = (
    <>
      <IconTile name={icon} tone={tone} />
      <span className="kpi-body">
        <span className="kpi-label">{label}</span>
        <span className={`kpi-value ${valueClass}`}>{value}</span>
        {sub && <span className="kpi-sub">{sub}</span>}
      </span>
    </>
  );
  return to ? (
    <Link to={to} className="kpi">
      {body}
    </Link>
  ) : (
    <div className="kpi">{body}</div>
  );
}

export function Panel({ title, icon, action, flush = false, className = "", children }) {
  return (
    <section className={`panel ${flush ? "panel-flush" : ""} ${className}`}>
      {(title || action) && (
        <div className="panel-head">
          <h3>
            {icon && <Icon name={icon} />}
            {title}
          </h3>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PanelLink({ to, children = "View all" }) {
  return (
    <Link to={to} className="panel-link">
      {children} <Icon name="arrowRight" size={16} />
    </Link>
  );
}

// Horizontal bar with a % number; colour follows the adherence badge colour.
export function PctBar({ pct, color = "green" }) {
  if (pct === null || pct === undefined) return <span className="muted small">No data yet</span>;
  const v = Math.max(0, Math.min(100, pct));
  return (
    <span className="bar">
      <span className="bar-track">
        <span className={`bar-fill fill-${color}`} style={{ width: `${v}%` }} />
      </span>
      <span className="bar-num">{Math.round(pct)}%</span>
    </span>
  );
}

// Donut with a legend. parts: [{ label, value, color }]
export function Donut({ parts, center, centerLabel }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const data = total ? parts.filter((p) => p.value > 0) : [{ label: "none", value: 1, color: "#e6e8f3" }];
  return (
    <div className="donut-wrap">
      <div className="donut-box">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="70%" outerRadius="100%" stroke="none" startAngle={90} endAngle={-270}>
              {data.map((p) => (
                <Cell key={p.label} fill={p.color} />
              ))}
            </Pie>
            {total > 0 && <Tooltip formatter={(v, n) => [v, n]} />}
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <b>{center}</b>
          <span>{centerLabel}</span>
        </div>
      </div>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.label}>
            <span className="swatch" style={{ background: p.color }} />
            {p.label}
            <b>{p.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Session result chip: best angle + plan-followed colour (measured), or the status (guided / skipped)
export function SessionChip({ s }) {
  if (s.measured && s.max_angle_reached != null) {
    const tone = { YES: "green", PARTLY: "amber", NO: "red" }[s.plan_followed] || "grey";
    const word = { YES: "ON PLAN", PARTLY: "PARTLY", NO: "OFF PLAN" }[s.plan_followed] || "";
    return (
      <span className={`score-chip chip-${tone}`}>
        {Math.round(s.max_angle_reached)}°<small>{word}</small>
      </span>
    );
  }
  const map = { COMPLETED: ["green", "DONE"], SKIPPED: ["grey", "SKIPPED"], PARTIAL: ["amber", "PARTLY"], INTERRUPTED: ["red", "STOPPED"] };
  const [tone, word] = map[s.status] || ["grey", s.status];
  return (
    <span className={`score-chip chip-${tone}`}>
      {s.mode === "GUIDED" ? `${s.reps_done}` : "-"}
      <small>{word}</small>
    </span>
  );
}

// tone used for a joint across the app
export const JOINT_TONE = { Knee: "violet", Hip: "teal", Shoulder: "blue", Elbow: "amber" };

export const PIE = { green: "#22c55e", blue: "#5b34ea", amber: "#f59e0b", grey: "#cbd2e1", red: "#ef4444" };
