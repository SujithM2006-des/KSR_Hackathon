// ReHabRep API layer - screens import ONLY from here (or from ../api.js, which re-exports this).
// Each function picks mock or live mode from config.js. In live mode mock data can never appear.

import { isMock } from "./config.js";
import { request } from "./client.js";
import { mapAudit, mapList, mapPatient, mapPlan, mapPrescription, mapSession, mapTherapist, mapUser } from "./mappers.js";
import { mock } from "./mock/index.js";

export { config, isMock } from "./config.js";
export { ApiError } from "./client.js";
export { getUser, saveLogin, updateUser, logout, homeFor } from "./session.js";

const live = {
  health: () => request("GET", "/health", { auth: false }),

  // auth + registration
  login: (email, password) =>
    request("POST", "/auth/login", { json: { email, password }, auth: false }).then((r) => ({
      ...r,
      user: mapUser(r.user),
    })),
  me: () => request("GET", "/me").then(mapUser),
  registrationConfig: () => request("GET", "/config/registration", { auth: false }),
  registerTherapist: (formData) => request("POST", "/auth/register-therapist", { form: formData, auth: false }),
  invitation: (token) => request("GET", `/invitations/${encodeURIComponent(token)}`, { auth: false }),
  acceptInvite: (token, password) =>
    request("POST", `/auth/invitations/${encodeURIComponent(token)}/accept`, { json: { password }, auth: false }).then(
      (r) => ({ ...r, user: mapUser(r.user) })
    ),
  consentText: () => request("GET", "/consent", { auth: false }),
  safety: () => request("GET", "/safety", { auth: false }),
  myVerification: () => request("GET", "/therapist/verification"),
  resubmitVerification: (formData) => request("POST", "/therapist/verification", { form: formData }),

  // exercises
  exercises: () => request("GET", "/exercises"),

  // therapist
  patients: () => request("GET", "/patients").then(mapList(mapPatient)),
  addPatient: (data) => request("POST", "/patients", { json: data }).then(mapPatient), // returns .invitation {url}
  updatePatient: (id, data) => request("PATCH", `/patients/${id}`, { json: data }).then(mapPatient),
  sendInvite: (id) => request("POST", `/patients/${id}/invitation`),
  patient: (id) => request("GET", `/patients/${id}`).then(mapPatient),

  // prescriptions (versioned plans)
  plans: (patientId) => request("GET", `/patients/${patientId}/exercise-plans`).then(mapList(mapPrescription)),
  savePlan: (patientId, data) =>
    request("POST", `/patients/${patientId}/exercise-plans`, { json: data }).then(mapPrescription),
  planAction: (planId, action, reason) =>
    request("PATCH", `/exercise-plans/${planId}`, { json: { action, reason: reason || null } }).then(mapPrescription),
  patientSessions: (id) => request("GET", `/patients/${id}/sessions`).then(mapList(mapSession)),
  trend: (id) => request("GET", `/patients/${id}/trend`),
  session: (id) => request("GET", `/sessions/${id}`).then(mapSession),

  // patient
  myPlans: () => request("GET", "/my/plans").then(mapList(mapPlan)),
  mySessions: () => request("GET", "/my/sessions").then(mapList(mapSession)),
  startSession: (planId, source) =>
    request("POST", "/my/sessions/start", { json: { plan_id: planId, source: source || null } }),
  setPain: (sessionId, pain, note) =>
    request("PATCH", `/sessions/${sessionId}/pain`, { json: { pain_score: pain, note: note || null } }).then(mapSession),
  today: () => request("GET", "/me/today"),
  myConsent: () => request("GET", "/me/consent"),
  giveConsent: (version, cameraAllowed) =>
    request("POST", "/me/consent", { json: { version, camera_allowed: cameraAllowed } }).then(mapUser),
  setCamera: (allow) => request("POST", "/me/consent/camera", { json: { allow } }).then(mapUser),
  guidedSession: (data) => request("POST", "/my/sessions/guided", { json: data }).then(mapSession),
  skipToday: (data) => request("POST", "/my/sessions/skip", { json: data }),

  // admin
  adminOverview: () => request("GET", "/admin/overview"),
  adminTherapists: (status) =>
    request("GET", `/admin/therapists${status ? `?status=${encodeURIComponent(status)}` : ""}`).then(
      mapList(mapTherapist)
    ),
  adminTherapist: (id) => request("GET", `/admin/therapists/${id}`).then(mapTherapist),
  adminTherapistDocument: (id) => request("GET", `/admin/therapists/${id}/document`, { raw: true }),
  adminDecide: (id, decision, reason, registerCheckNote) =>
    request("POST", `/admin/therapists/${id}/decision`, {
      json: { decision, reason, register_check_note: registerCheckNote || null },
    }).then(mapTherapist),
  adminPatients: () => request("GET", "/admin/patients"),
  adminSetStatus: (userId, suspend, reason) =>
    request("POST", `/admin/users/${userId}/${suspend ? "suspend" : "reactivate"}`, { json: { reason } }),
  adminAdmins: () => request("GET", "/admin/admins"),
  adminAddAdmin: (data) => request("POST", "/admin/admins", { json: data }),
  adminAuditLog: (limit = 200) => request("GET", `/admin/audit-log?limit=${limit}`).then(mapList(mapAudit)),
};

export const api = isMock ? mock : live;

// ---------- small display helpers ----------
export function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// one id per user action, so a double click or a retry never creates two sessions
export function newRequestId() {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function fmtNum(v, digits = 0) {
  return v === null || v === undefined ? "-" : Number(v).toFixed(digits);
}