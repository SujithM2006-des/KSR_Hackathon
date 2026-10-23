// Small coloured labels used across the app.

export function AdherenceBadge({ badge }) {
  if (!badge) return null;
  const pct = badge.avg_adherence_pct;
  return (
    <span className={`badge badge-${badge.color}`}>
      <span className="dot" />
      {badge.label}
      {pct !== null && pct !== undefined ? ` · ${pct}%` : ""}
    </span>
  );
}

export function ResultBadge({ result }) {
  const cls = { GOOD: "green", UNDER: "amber", OVER: "red" }[result] || "grey";
  return <span className={`badge badge-${cls}`}>{result}</span>;
}

export function FollowedBadge({ value }) {
  const cls = { YES: "green", PARTLY: "amber", NO: "red" }[value] || "grey";
  return <span className={`badge badge-${cls}`}>{value}</span>;
}

export function PainBadge({ score }) {
  if (score === null || score === undefined) return <span className="muted">-</span>;
  const cls = score >= 7 ? "red" : score >= 4 ? "amber" : "green";
  return (
    <span className={`badge badge-${cls}`}>
      {score}/10{score >= 7 ? " · HIGH" : ""}
    </span>
  );
}

export function VerificationBadge({ status }) {
  const cls = { APPROVED: "green", PENDING: "amber", REJECTED: "red" }[status] || "grey";
  const label = { APPROVED: "Verified", PENDING: "Pending review", REJECTED: "Rejected" }[status] || status || "-";
  return <span className={`badge badge-${cls}`}>{label}</span>;
}

export function AccountBadge({ status }) {
  const map = {
    SUSPENDED: ["red", "Suspended"],
    INVITED: ["amber", "Invited"],
    DRAFT: ["grey", "Draft - not invited"],
  };
  const [cls, label] = map[status] || ["green", "Active"];
  return <span className={`badge badge-${cls}`}>{label}</span>;
}

export function PlanStatusBadge({ status }) {
  const map = {
    ACTIVE: ["green", "Active"],
    PAUSED: ["amber", "Paused"],
    DRAFT: ["grey", "Draft"],
    ENDED: ["grey", "Ended"],
    SUPERSEDED: ["grey", "Replaced by newer version"],
    DISCARDED: ["grey", "Draft discarded"],
  };
  const [cls, label] = map[status] || ["grey", status || "No plan"];
  return <span className={`badge badge-${cls}`}>{label}</span>;
}

export function SessionStatusBadge({ status }) {
  const map = {
    COMPLETED: ["green", "Completed"],
    PARTIAL: ["amber", "Partly done"],
    INTERRUPTED: ["red", "Stopped early"],
    SKIPPED: ["grey", "Skipped"],
    DONE: ["green", "Done"],
    PENDING: ["grey", "To do"],
  };
  const [cls, label] = map[status] || ["grey", status || "-"];
  return <span className={`badge badge-${cls}`}>{label}</span>;
}

export function ModeBadge({ mode }) {
  if (mode === "GUIDED") return <span className="badge badge-grey">Patient-confirmed</span>;
  if (mode === "NONE") return null;
  return <span className="badge badge-green">Camera-measured</span>;
}