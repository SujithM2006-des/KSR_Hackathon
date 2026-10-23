import { Link, NavLink, useNavigate } from "react-router-dom";
import { config, homeFor, isMock, logout } from "../api.js";

const ROLE_LABEL = { ADMIN: "Admin", THERAPIST: config.clinicianLabel, PATIENT: "Patient" };

const NAV = {
  ADMIN: [
    ["/admin", "Overview", true],
    ["/admin/verification", "Verification queue"],
    ["/admin/therapists", "Therapists"],
    ["/admin/patients", "Patients"],
    ["/admin/audit", "Audit log"],
    ["/admin/admins", "Admins"],
  ],
  PATIENT: [
    ["/patient", "Today", true],
    ["/patient/settings", "Settings"],
    ["/safety", "Safety and help"],
  ],
};

export default function Layout({ user, children }) {
  const navigate = useNavigate();
  const consentPending = user.role === "PATIENT" && (!user.consent || user.consent.needs_consent);
  const links = consentPending ? [] : NAV[user.role] || [];

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="app">
      {isMock && (
        <div className="mock-banner">
          DEMO DATA - mock mode, nothing is saved. Set VITE_API_MODE=live to use the real backend.
        </div>
      )}
      <header className="topbar">
        <Link to={homeFor(user)} className="brand">
          <span className="brand-mark">R</span>
          <span>
            ReHab<b>Rep</b>
          </span>
        </Link>
        <div className="topbar-right">
          <span className="who">
            {user.name}
            <span className="role-chip">{ROLE_LABEL[user.role] || user.role}</span>
          </span>
          <button className="btn btn-ghost" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>
      {links.length > 0 && (
        <nav className="subnav">
          {links.map(([to, label, end]) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `subnav-link ${isActive ? "active" : ""}`}>
              {label}
            </NavLink>
          ))}
        </nav>
      )}
      <main className="content">{children}</main>
      <footer className="disclaimer">
        Exercise aid only. Not a diagnosis. Follow your therapist's advice. <Link to="/safety">Safety and help</Link> ·
        Emergency: 112
      </footer>
    </div>
  );
}