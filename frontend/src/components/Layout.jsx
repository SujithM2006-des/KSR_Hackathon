import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { api, config, homeFor, isMock, logout } from "../api.js";
import { Avatar, Icon, Logo } from "./Icons.jsx";

const ROLE_LABEL = { ADMIN: "Administrator", THERAPIST: config.clinicianLabel, PATIENT: "Patient" };

// [path, label, icon, exact match]
const NAV = {
  ADMIN: [
    ["/admin", "Dashboard", "home", true],
    ["/admin/verification", "Verification queue", "badgeCheck"],
    ["/admin/therapists", "Clinicians", "stethoscope"],
    ["/admin/patients", "Patients", "users"],
    ["/admin/audit", "Audit log", "file"],
    ["/admin/admins", "Admins", "shield"],
  ],
  THERAPIST: [
    ["/therapist", "Dashboard", "home", true],
    ["/therapist/patients", "My Patients", "users"],
    ["/therapist/exercises", "Exercise Library", "library"],
    ["/safety", "Safety and help", "heart"],
  ],
  THERAPIST_PENDING: [["/therapist/verification", "Verification status", "badgeCheck"]],
  PATIENT: [
    ["/patient", "Dashboard", "home", true],
    ["/patient/plan", "My Exercise Plan", "clipboard"],
    ["/patient/sessions", "Session History", "history"],
    ["/patient/settings", "Profile & Settings", "settings"],
    ["/safety", "Safety and help", "heart"],
  ],
};

function navFor(user) {
  if (user.role === "PATIENT" && (!user.consent || user.consent.needs_consent)) return [];
  if (user.role === "THERAPIST" && !(user.therapist && user.therapist.status === "APPROVED")) return NAV.THERAPIST_PENDING;
  return NAV[user.role] || [];
}

const todayLabel = () =>
  new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export default function Layout({ user, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false); // mobile sidebar
  const [pending, setPending] = useState(0); // admin: therapists waiting for verification
  const links = navFor(user);
  const dark = user.role !== "PATIENT";

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (user.role !== "ADMIN") return;
    api
      .adminOverview()
      .then((o) => setPending(o.therapists_by_status.PENDING || 0))
      .catch(() => {});
  }, [user.role, location.pathname]);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className={`shell ${dark ? "shell-dark" : "shell-light"}`}>
      {isMock && (
        <div className="mock-banner">
          DEMO DATA - mock mode, nothing is saved. Set VITE_API_MODE=live to use the real backend.
        </div>
      )}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-head">
          <Link to={homeFor(user)} className="sidebar-brand">
            <Logo light={dark} />
          </Link>
          <button className="icon-btn sidebar-close" onClick={() => setOpen(false)} aria-label="Close menu">
            <Icon name="x" />
          </button>
        </div>
        <nav className="side-nav">
          {links.map(([to, label, icon, end]) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `side-link ${isActive ? "active" : ""}`}>
              <Icon name={icon} />
              <span>{label}</span>
              {to === "/admin/verification" && pending > 0 && <span className="side-count">{pending}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="side-secure">
          <Icon name="shield" size={26} />
          <div>
            <b>Secure &amp; encrypted</b>
            <span>Patient data is encrypted in the database and shared only with the care team.</span>
          </div>
        </div>
      </aside>
      {open && <div className="sidebar-scrim" onClick={() => setOpen(false)} />}

      <div className="shell-main">
        <header className="appbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <span className="appbar-date">
            <Icon name="calendar" size={18} /> {todayLabel()}
          </span>
          <div className="appbar-user">
            <Avatar name={user.name} />
            <span className="appbar-who">
              <b>{user.name}</b>
              <span>{ROLE_LABEL[user.role] || user.role}</span>
            </span>
            <button className="icon-btn" onClick={handleLogout} title="Log out" aria-label="Log out">
              <Icon name="logout" />
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
        <footer className="disclaimer">
          Exercise aid only. Not a diagnosis. Follow your therapist's advice. <Link to="/safety">Safety and help</Link> ·
          Emergency: 108
        </footer>
      </div>
    </div>
  );
}
