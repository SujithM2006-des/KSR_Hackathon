import { Navigate, Route, Routes } from "react-router-dom";
import { config, getUser, homeFor } from "./api.js";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import TherapistPending from "./pages/TherapistPending.jsx";
import AcceptInvite from "./pages/AcceptInvite.jsx";
import PrescriptionBuilder from "./pages/PrescriptionBuilder.jsx";
import TherapistDashboard from "./pages/TherapistDashboard.jsx";
import PatientDetail from "./pages/PatientDetail.jsx";
import SessionReport from "./pages/SessionReport.jsx";
import PatientHome from "./pages/PatientHome.jsx";
import AdminOverview from "./pages/admin/AdminOverview.jsx";
import AdminTherapists from "./pages/admin/AdminTherapists.jsx";
import TherapistReview from "./pages/admin/TherapistReview.jsx";
import AdminPatients from "./pages/admin/AdminPatients.jsx";
import AdminAudit from "./pages/admin/AdminAudit.jsx";
import AdminAdmins from "./pages/admin/AdminAdmins.jsx";
import IntegrationStatus from "./dev/IntegrationStatus.jsx";

const isApproved = (u) => u.role !== "THERAPIST" || (u.therapist && u.therapist.status === "APPROVED");

// role: required role (or none = any logged-in user)
// approved: therapist must be verified (default true); the verification page passes false
function Guard({ role, approved = true, children }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={homeFor(user)} replace />;
  if (approved && !isApproved(user)) return <Navigate to="/therapist/verification" replace />;
  return <Layout user={user}>{children}</Layout>;
}

function HomeRedirect() {
  return <Navigate to={homeFor(getUser())} replace />;
}

const page = (role, el, approved) => <Guard role={role} approved={approved}>{el}</Guard>;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />

      <Route path="/therapist" element={page("THERAPIST", <TherapistDashboard />)} />
      <Route path="/therapist/verification" element={page("THERAPIST", <TherapistPending />, false)} />
      <Route path="/therapist/patients/:id" element={page("THERAPIST", <PatientDetail />)} />
      <Route path="/therapist/patients/:id/plan/new" element={page("THERAPIST", <PrescriptionBuilder />)} />
      <Route path="/sessions/:id" element={page(null, <SessionReport />)} />
      <Route path="/patient" element={page("PATIENT", <PatientHome />)} />

      <Route path="/admin" element={page("ADMIN", <AdminOverview />)} />
      <Route path="/admin/verification" element={page("ADMIN", <AdminTherapists queue key="queue" />)} />
      <Route path="/admin/therapists" element={page("ADMIN", <AdminTherapists key="all" />)} />
      <Route path="/admin/therapists/:id" element={page("ADMIN", <TherapistReview />)} />
      <Route path="/admin/patients" element={page("ADMIN", <AdminPatients />)} />
      <Route path="/admin/audit" element={page("ADMIN", <AdminAudit />)} />
      <Route path="/admin/admins" element={page("ADMIN", <AdminAdmins />)} />

      {config.isDev && <Route path="/dev/integration" element={<IntegrationStatus />} />}
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}