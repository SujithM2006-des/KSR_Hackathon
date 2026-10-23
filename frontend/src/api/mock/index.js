// MOCK MODE (VITE_API_MODE=mock): labelled demo data that lives in memory only.
// Used to demo or build screens without the backend. Never used in live mode.
// Reloading the page resets everything.

import { getUser } from "../session.js";

const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
const clone = (v) => JSON.parse(JSON.stringify(v));

class MockError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.code = `HTTP_${status}`;
  }
}

const EXERCISES = [
  { key: "mini_squat", name: "Mini squat / sit-to-stand", joint: "Knee", measure: "Knee flexion", direction: "up", view: "side", default_min: 60, default_max: 100, instructions: "Stand side-on to the camera. Bend your knees, then stand up." },
  { key: "seated_knee_extension", name: "Seated knee extension (long arc quad)", joint: "Knee", measure: "Knee flexion (0 = fully straight)", direction: "down", view: "side", default_min: 0, default_max: 15, instructions: "Sit side-on to the camera. Straighten your knee fully, then lower it slowly." },
  { key: "shoulder_flexion", name: "Shoulder flexion (arm raise forward)", joint: "Shoulder", measure: "Shoulder elevation", direction: "up", view: "side", default_min: 90, default_max: 150, instructions: "Stand side-on. Raise your straight arm forward and up, then lower." },
];
const exById = Object.fromEntries(EXERCISES.map((e) => [e.key, e]));

const db = {
  users: [
    { id: 1, name: "ReHabRep Admin (demo)", email: "admin@rehabrep.demo", password: "admin12345", role: "ADMIN", status: "ACTIVE" },
    { id: 2, name: "Dr. Priya (Physio)", email: "therapist@rehabrep.demo", password: "therapist123", role: "THERAPIST", status: "ACTIVE" },
    { id: 3, name: "Dr. Arun (Physio, pending)", email: "pending.therapist@rehabrep.demo", password: "pending123", role: "THERAPIST", status: "ACTIVE" },
    { id: 4, name: "Ravi Kumar", email: "patient@rehabrep.demo", password: "patient123", role: "PATIENT", status: "ACTIVE" },
  ],
  profiles: {
    2: { status: "APPROVED", profession: "PHYSIOTHERAPIST", registration_number: "DEMO-PT-0001", issuing_body: "State Physiotherapy Council", workplace: "Demo Rehab Clinic", phone: "+91 90000 00001", decision_reason: "Demo account", submitted_at: daysAgo(10), reviewed_at: daysAgo(9), has_document: true, document_name: "demo_certificate.pdf", register_check_note: "Demo data" },
    3: { status: "PENDING", profession: "PHYSIOTHERAPIST", registration_number: "DEMO-PT-0002", issuing_body: "Indian Association of Physiotherapists (IAP)", workplace: "Demo Physio Centre", phone: "+91 90000 00002", decision_reason: null, submitted_at: daysAgo(1), reviewed_at: null, has_document: true, document_name: "demo_certificate.pdf" },
  },
  patients: [{ id: 1, user_id: 4, therapist_id: 2, surgery_type: "Knee replacement (left)", notes: null }],
  prescriptions: [{ id: 1, patient_id: 1, created_by: 2, version: 1, status: "ACTIVE", note: null, status_reason: null, previous_id: null, created_at: daysAgo(5), activated_at: daysAgo(5), ended_at: null }],
  plans: [{ id: 1, patient_id: 1, prescription_id: 1, exercise_type: "mini_squat", condition: "Knee replacement (left)", sets: 1, reps_per_set: 8, hold_s: 0, rest_s: 30, side: "BOTH", min_angle: 90, max_angle: 135, days: [0, 1, 2, 3, 4, 5, 6], time_of_day: null, note: null, active: true, created_at: daysAgo(5) }],
  invites: {}, // token -> { user_id, used, revoked, expires_at }
  consents: [], // { user_id, version, action, camera_allowed, created_at }
  sessions: [],
  audit: [],
  nextId: 100,
};

// demo sessions
[[4, [104, 99, 101, 96, 98, 95, 92, 85], 4], [3, [115, 109, 112, 104, 110, 108, 103, 97], 3], [2, [125, 128, 122, 119, 121, 116, 118, 110], 3], [1, [131, 129, 128, 130, 131, 131, 137, 134], 8]].forEach(
  ([d, peaks, pain], i) => {
    const reps = peaks.map((a, n) => ({ rep_number: n + 1, peak_angle: a, result: a < 90 ? "UNDER" : a > 135 ? "OVER" : "GOOD", duration_s: 1.4, time_s: n * 2 }));
    const good = reps.filter((r) => r.result === "GOOD").length;
    db.sessions.push({
      id: i + 1, patient_id: 1, plan_id: 1, ended_at: daysAgo(d), started_at: daysAgo(d), min_angle: 90, max_angle: 135, prescribed_reps: 8,
      reps_done: 8, good_reps: good, under_reps: reps.filter((r) => r.result === "UNDER").length, over_reps: reps.filter((r) => r.result === "OVER").length,
      accuracy_pct: (good / 8) * 100, completion_pct: 100, adherence_pct: (good / 8) * 100, max_angle_reached: Math.max(...peaks),
      avg_peak_angle: peaks.reduce((a, b) => a + b, 0) / 8, duration_s: 16, mode: "TRACKED", status: "COMPLETED", review_flag: null, patient_note: null, plan_followed: good >= 6.4 ? "YES" : good >= 3.2 ? "PARTLY" : "NO", pain_score: pain, reps,
    });
  }
);

const user = (id) => db.users.find((u) => u.id === id);
const me = () => {
  const u = getUser();
  const found = u && user(u.id);
  if (!found) throw new MockError(401, "Not logged in");
  if (found.status === "SUSPENDED") throw new MockError(403, "Account suspended");
  return found;
};
const need = (role) => {
  const u = me();
  if (u.role !== role) throw new MockError(403, `${role.toLowerCase()} only`);
  if (role === "THERAPIST" && db.profiles[u.id]?.status !== "APPROVED") throw new MockError(403, "Your professional verification is not approved yet.");
  return u;
};
const log = (actor, action, type, target, reason) =>
  db.audit.unshift({ id: db.nextId++, created_at: now(), actor_id: actor, actor_name: user(actor)?.name || "System", actor_role: user(actor)?.role || null, action, target_type: type, target_id: target, target_name: type === "USER" ? user(target)?.name : null, reason });

function therapistOut(u) {
  const p = db.profiles[u.id];
  return p ? { ...p } : null;
}
const CONSENT_VERSION = "2026-10-v1";
function consentOut(userId) {
  const rec = db.consents.filter((c) => c.user_id === userId).slice(-1)[0];
  if (!rec) return { given: false, camera_allowed: false, version: null, current_version: CONSENT_VERSION, needs_consent: true, updated_at: null };
  return { given: true, camera_allowed: rec.camera_allowed, version: rec.version, current_version: CONSENT_VERSION, needs_consent: rec.version !== CONSENT_VERSION, action: rec.action, updated_at: rec.created_at };
}
function userOut(u) {
  const patient = db.patients.find((p) => p.user_id === u.id);
  return { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, patient_id: patient ? patient.id : null, therapist: u.role === "THERAPIST" ? therapistOut(u) : null, consent: u.role === "PATIENT" ? consentOut(u.id) : null };
}
function exInfo(key) {
  const ex = exById[key] || {};
  return { exercise_type: key, exercise_name: ex.name || key, joint: ex.joint, direction: ex.direction || "up", view: ex.view, instructions: ex.instructions };
}
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const daysLabel = (d) => (d.length === 7 ? "Every day" : d.join() === "0,1,2,3,4" ? "Mon-Fri" : d.map((x) => DAYS[x]).join(", "));
const todayIdx = () => (new Date().getDay() + 6) % 7;
const planOut = (p) => ({ ...p, ...exInfo(p.exercise_type), prescribed_reps: p.sets * p.reps_per_set, days_label: daysLabel(p.days), scheduled_today: p.days.includes(todayIdx()) });
const presOf = (pid) => db.prescriptions.filter((x) => x.patient_id === pid).sort((a, b) => b.version - a.version || b.id - a.id);
const presOut = (pr) => {
  const items = db.plans.filter((it) => it.prescription_id === pr.id);
  return { ...pr, created_by: user(pr.created_by)?.name, sessions_count: db.sessions.filter((s) => items.some((i) => i.id === s.plan_id)).length, items: items.map(planOut) };
};
function sessionOut(s, withReps) {
  const plan = db.plans.find((p) => p.id === s.plan_id);
  const out = { ...s, ...exInfo(plan ? plan.exercise_type : "mini_squat"), side: plan ? plan.side : "BOTH", measured: s.mode === "TRACKED", high_pain: s.pain_score != null && s.pain_score >= 7 };
  if (!withReps) delete out.reps;
  return out;
}
const sessionsOf = (pid) => db.sessions.filter((s) => s.patient_id === pid).sort((a, b) => b.ended_at.localeCompare(a.ended_at));
function badge(list) {
  const recent = list.slice(0, 5);
  if (!recent.length) return { color: "grey", label: "No sessions yet", avg_adherence_pct: null };
  const avg = Math.round((recent.reduce((a, s) => a + s.adherence_pct, 0) / recent.length) * 10) / 10;
  if (avg >= 80) return { color: "green", label: "On track", avg_adherence_pct: avg };
  if (avg >= 50) return { color: "amber", label: "Needs attention", avg_adherence_pct: avg };
  return { color: "red", label: "Not following plan", avg_adherence_pct: avg };
}
function patientSummary(p) {
  const u = user(p.user_id);
  const ss = sessionsOf(p.id);
  const live = presOf(p.id).find((x) => x.status === "ACTIVE" || x.status === "PAUSED");
  const inv = Object.values(db.invites).find((i) => i.user_id === u.id && !i.used && !i.revoked);
  return {
    id: p.id, user_id: u.id, name: u.name, email: u.email, surgery_type: p.surgery_type, notes: p.notes, account_status: u.status,
    invitation_expires_at: ["INVITED", "DRAFT"].includes(u.status) && inv ? inv.expires_at : null,
    plan_status: live ? live.status : null, plan_version: live ? live.version : null, plan_status_reason: live ? live.status_reason : null,
    has_draft_plan: presOf(p.id).some((x) => x.status === "DRAFT"),
    active_plans: db.plans.filter((pl) => pl.patient_id === p.id && pl.active).map(planOut),
    sessions_count: ss.length, last_session_at: ss[0]?.ended_at || null, last_session: ss[0] ? sessionOut(ss[0]) : null,
    badge: badge(ss.filter((s) => s.adherence_pct != null)), pain_alert: ss.slice(0, 5).some((s) => s.pain_score != null && s.pain_score >= 7),
    review_flags: ss.filter((s) => s.review_flag && Date.now() - new Date(s.ended_at) < 7 * 86400000).map((s) => ({ session_id: s.id, flag: s.review_flag, date: s.ended_at, exercise_name: sessionOut(s).exercise_name, note: s.patient_note })),
  };
}
const ownPatient = (t, id) => {
  const p = db.patients.find((x) => x.id === Number(id));
  if (!p || p.therapist_id !== t.id) throw new MockError(404, "Patient not found");
  return p;
};
function therapistRow(u) {
  return { id: u.id, name: u.name, email: u.email, account_status: u.status, account_status_reason: u.status_reason || null, patient_count: db.patients.filter((p) => p.therapist_id === u.id).length, verification: therapistOut(u), register_check_note: db.profiles[u.id]?.register_check_note || null, reviewed_by: db.profiles[u.id]?.reviewed_by || null };
}
function makeInvite(t, p) {
  Object.values(db.invites).forEach((i) => i.user_id === p.user_id && !i.used && (i.revoked = true));
  const token = `mock-${Math.random().toString(36).slice(2, 12)}`;
  const expires_at = new Date(Date.now() + 7 * 86400000).toISOString();
  db.invites[token] = { user_id: p.user_id, by: t.id, used: false, revoked: false, expires_at };
  const u = user(p.user_id);
  if (u.status === "DRAFT") u.status = "INVITED";
  log(t.id, "PATIENT_INVITED", "PATIENT", p.id, null);
  return { url: `${window.location.origin}/invite/${token}`, expires_at };
}
function formValue(form, key) {
  const v = form && form.get ? form.get(key) : null;
  return typeof v === "string" ? v.trim() : v;
}

export const mock = {
  health: async () => (await wait(), { status: "ok", mode: "mock" }),

  login: async (email, password) => {
    await wait();
    const u = db.users.find((x) => x.email === String(email).trim().toLowerCase());
    if (!u || !u.password || u.password !== password) throw new MockError(401, "Wrong email or password. New patients: open the invitation link from your therapist first.");
    if (u.status === "SUSPENDED") throw new MockError(403, `This account is suspended. Reason: ${u.status_reason || "-"}`);
    return { token: `mock-token-${u.id}`, user: userOut(u) };
  },
  me: async () => (await wait(), userOut(me())),
  registrationConfig: async () => ({ professions: ["PHYSIOTHERAPIST", "DOCTOR"], issuing_bodies: ["State Physiotherapy Council", "Indian Association of Physiotherapists (IAP)", "National Commission for Allied and Healthcare Professions (NCAHP)", "State Medical Council", "National Medical Commission (NMC)", "Other (explain in workplace field)"], max_document_mb: 5, allowed_document_types: ["PDF", "JPG", "PNG"], min_password_length: 8 }),
  registerTherapist: async (form) => {
    await wait();
    const email = String(formValue(form, "email")).toLowerCase();
    if (db.users.some((u) => u.email === email)) throw new MockError(409, "Email already registered");
    if (String(formValue(form, "password")).length < 8) throw new MockError(400, "Password must be at least 8 characters");
    const id = db.nextId++;
    db.users.push({ id, name: formValue(form, "name"), email, password: formValue(form, "password"), role: "THERAPIST", status: "ACTIVE" });
    const doc = form.get("document");
    db.profiles[id] = { status: "PENDING", profession: formValue(form, "profession"), registration_number: formValue(form, "registration_number"), issuing_body: formValue(form, "issuing_body"), workplace: formValue(form, "workplace"), phone: formValue(form, "phone"), decision_reason: null, submitted_at: now(), reviewed_at: null, has_document: Boolean(doc), document_name: doc?.name || null };
    log(id, "THERAPIST_REGISTERED", "USER", id, null);
    return { message: "Registration received (mock mode)." };
  },
  myVerification: async () => (await wait(), therapistOut(me())),
  resubmitVerification: async (form) => {
    await wait();
    const u = me();
    const p = db.profiles[u.id];
    ["registration_number", "issuing_body", "workplace", "phone"].forEach((k) => {
      const v = formValue(form, k);
      if (v) p[k] = v;
    });
    const doc = form.get("document");
    if (doc && doc.name) Object.assign(p, { has_document: true, document_name: doc.name });
    p.status = "PENDING";
    p.submitted_at = now();
    log(u.id, "THERAPIST_RESUBMITTED", "USER", u.id, null);
    return { ...p };
  },

  exercises: async () => (await wait(), clone(EXERCISES)),
  patients: async () => {
    await wait();
    const t = need("THERAPIST");
    return db.patients.filter((p) => p.therapist_id === t.id).map(patientSummary);
  },
  addPatient: async (data) => {
    await wait();
    const t = need("THERAPIST");
    if (db.users.some((u) => u.email === data.email.toLowerCase())) throw new MockError(409, "Email already registered");
    const uid = db.nextId++;
    db.users.push({ id: uid, name: data.name, email: data.email.toLowerCase(), password: null, role: "PATIENT", status: data.send_invite === false ? "DRAFT" : "INVITED" });
    const p = { id: db.nextId++, user_id: uid, therapist_id: t.id, surgery_type: data.surgery_type, notes: data.notes };
    db.patients.push(p);
    log(t.id, "PATIENT_CREATED", "PATIENT", p.id, null);
    const invitation = data.send_invite === false ? null : makeInvite(t, p);
    return { ...patientSummary(p), invitation };
  },
  updatePatient: async (id, data) => {
    await wait();
    const t = need("THERAPIST");
    const p = ownPatient(t, id);
    if (data.name) user(p.user_id).name = data.name;
    if (data.surgery_type !== undefined) p.surgery_type = data.surgery_type || null;
    if (data.notes !== undefined) p.notes = data.notes || null;
    log(t.id, "PATIENT_UPDATED", "PATIENT", p.id, null);
    return patientSummary(p);
  },
  sendInvite: async (id) => {
    await wait();
    const t = need("THERAPIST");
    const p = ownPatient(t, id);
    if (!["INVITED", "DRAFT"].includes(user(p.user_id).status)) throw new MockError(400, "This patient has already activated their account");
    return makeInvite(t, p);
  },
  invitation: async (token) => {
    await wait();
    const inv = db.invites[token];
    if (!inv || inv.revoked) throw new MockError(404, "This invitation link is not valid. Ask your therapist for a new one.");
    if (inv.used) throw new MockError(410, "This invitation has already been used. Log in with your email and password.");
    const u = user(inv.user_id);
    return { name: u.name, email: u.email.replace(/^(..).*@/, "$1***@"), therapist: user(inv.by)?.name, expires_at: inv.expires_at, min_password_length: 8 };
  },
  acceptInvite: async (token, password) => {
    await wait();
    const inv = db.invites[token];
    if (!inv || inv.revoked) throw new MockError(404, "This invitation link is not valid.");
    if (inv.used) throw new MockError(410, "This invitation has already been used.");
    if (String(password).length < 8) throw new MockError(400, "Password must be at least 8 characters");
    const u = user(inv.user_id);
    Object.assign(u, { password, status: "ACTIVE" });
    inv.used = true;
    log(u.id, "INVITE_ACCEPTED", "USER", u.id, null);
    return { token: `mock-token-${u.id}`, user: userOut(u) };
  },
  patient: async (id) => (await wait(), patientSummary(ownPatient(need("THERAPIST"), id))),
  plans: async (id) => (await wait(), presOf(ownPatient(need("THERAPIST"), id).id).map(presOut)),
  savePlan: async (id, data) => {
    await wait();
    const t = need("THERAPIST");
    const p = ownPatient(t, id);
    if (!data.items || !data.items.length) throw new MockError(400, "Select at least one exercise");
    data.items.forEach((it, n) => {
      if (Number(it.min_angle) >= Number(it.max_angle)) throw new MockError(400, `Exercise ${n + 1}: minimum angle must be below maximum angle`);
      if (!it.days || !it.days.length) throw new MockError(400, `Exercise ${n + 1}: choose at least one day`);
    });
    const list = presOf(p.id);
    const now0 = now();
    list.forEach((x) => {
      if (x.status === "DRAFT") Object.assign(x, { status: "DISCARDED", ended_at: now0 });
    });
    const prev = list.find((x) => x.status === "ACTIVE" || x.status === "PAUSED");
    const pr = { id: db.nextId++, patient_id: p.id, created_by: t.id, version: (list[0]?.version || 0) + 1, status: data.status, note: data.note || null, status_reason: null, previous_id: prev ? prev.id : null, created_at: now0, activated_at: data.status === "ACTIVE" ? now0 : null, ended_at: null };
    if (data.status === "ACTIVE" && prev) {
      Object.assign(prev, { status: "SUPERSEDED", ended_at: now0 });
      db.plans.forEach((it) => it.prescription_id === prev.id && (it.active = false));
    }
    db.prescriptions.push(pr);
    data.items.forEach((it) => db.plans.push({ ...it, id: db.nextId++, patient_id: p.id, prescription_id: pr.id, days: [...it.days].sort(), active: data.status === "ACTIVE", created_at: now0 }));
    log(t.id, data.status === "ACTIVE" ? "PLAN_SAVED" : "PLAN_DRAFT_SAVED", "PLAN", pr.id, `Version ${pr.version}`);
    return presOut(pr);
  },
  planAction: async (planId, action, reason) => {
    await wait();
    const t = need("THERAPIST");
    const pr = db.prescriptions.find((x) => x.id === Number(planId));
    if (!pr) throw new MockError(404, "Plan not found");
    ownPatient(t, pr.patient_id);
    const rules = { PAUSE: [["ACTIVE"], "PAUSED"], RESUME: [["PAUSED"], "ACTIVE"], END: [["ACTIVE", "PAUSED"], "ENDED"], DISCARD: [["DRAFT"], "DISCARDED"] };
    const [from, to] = rules[action];
    if (!from.includes(pr.status)) throw new MockError(400, `A ${pr.status.toLowerCase()} plan cannot be changed with ${action.toLowerCase()}`);
    Object.assign(pr, { status: to, status_reason: reason || null, ended_at: ["ENDED", "DISCARDED"].includes(to) ? now() : pr.ended_at });
    db.plans.forEach((it) => it.prescription_id === pr.id && (it.active = to === "ACTIVE"));
    log(t.id, { PAUSE: "PLAN_PAUSED", RESUME: "PLAN_RESUMED", END: "PLAN_ENDED", DISCARD: "PLAN_DRAFT_DISCARDED" }[action], "PLAN", pr.id, reason || null);
    return presOut(pr);
  },
  patientSessions: async (id) => (await wait(), sessionsOf(ownPatient(need("THERAPIST"), id).id).map((s) => sessionOut(s))),
  trend: async (id) => {
    await wait();
    const p = ownPatient(need("THERAPIST"), id);
    return sessionsOf(p.id).filter((s) => s.max_angle_reached != null).reverse().map((s) => {
      const plan = db.plans.find((x) => x.id === s.plan_id);
      return { session_id: s.id, ...exInfo(plan.exercise_type), date: new Date(s.ended_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), max_angle: s.max_angle_reached, avg_peak_angle: s.avg_peak_angle, accuracy_pct: s.accuracy_pct, adherence_pct: s.adherence_pct, pain_score: s.pain_score, target_min: s.min_angle, target_max: s.max_angle };
    });
  },
  session: async (id) => {
    await wait();
    const u = me();
    const s = db.sessions.find((x) => x.id === Number(id));
    const p = s && db.patients.find((x) => x.id === s.patient_id);
    const ok = p && ((u.role === "THERAPIST" && p.therapist_id === u.id) || (u.role === "PATIENT" && p.user_id === u.id));
    if (!ok) throw new MockError(404, "Session not found");
    return sessionOut(s, true);
  },
  myPlans: async () => {
    await wait();
    const p = db.patients.find((x) => x.user_id === need("PATIENT").id);
    return db.plans.filter((pl) => pl.patient_id === p.id && pl.active).map(planOut);
  },
  mySessions: async () => {
    await wait();
    const p = db.patients.find((x) => x.user_id === need("PATIENT").id);
    return sessionsOf(p.id).map((s) => sessionOut(s));
  },
  startSession: async () => {
    throw new MockError(400, "Mock mode cannot open the camera window. Switch VITE_API_MODE to live to run a real session.");
  },
  setPain: async (id, pain, note) => {
    await wait();
    const s = db.sessions.find((x) => x.id === Number(id));
    if (!s) throw new MockError(404, "Session not found");
    s.pain_score = pain;
    if (note) s.patient_note = note;
    return sessionOut(s);
  },
  consentText: async () => ({
    version: CONSENT_VERSION,
    review_note: "Draft wording - to be reviewed. (mock mode)",
    sections: [
      { title: "What ReHabRep does", text: "Counts repetitions and estimates joint angles, and shares results with your therapist. It does not diagnose." },
      { title: "What we store", text: "Your plan, session numbers, pain scores and notes - encrypted." },
      { title: "Camera", text: "Video is processed on this computer and not saved. You can say no and use guided mode." },
      { title: "Who can see your data", text: "Your therapist and authorised administrators." },
    ],
  }),
  safety: async () => ({ emergency_number: "112", red_flags: ["Chest pain or tightness", "Fainting or severe dizziness", "Sudden severe or worsening pain", "New numbness or weakness", "A fall or new injury"], stop_rule: "Stop if you feel sharp, worsening or unusual pain.", not_emergency: "ReHabRep is not an emergency service.", review_note: "Needs clinician review (mock mode)." }),
  myConsent: async () => {
    await wait();
    const u = need("PATIENT");
    return { ...consentOut(u.id), history: db.consents.filter((c) => c.user_id === u.id).slice().reverse() };
  },
  giveConsent: async (version, camera) => {
    await wait();
    const u = need("PATIENT");
    if (version !== CONSENT_VERSION) throw new MockError(409, "The consent text has changed.");
    db.consents.push({ user_id: u.id, version, action: camera ? "AGREED" : "AGREED_NO_CAMERA", camera_allowed: camera, created_at: now() });
    return userOut(u);
  },
  setCamera: async (allow) => {
    await wait();
    const u = need("PATIENT");
    db.consents.push({ user_id: u.id, version: CONSENT_VERSION, action: allow ? "CAMERA_ALLOWED" : "CAMERA_WITHDRAWN", camera_allowed: allow, created_at: now() });
    return userOut(u);
  },
  today: async () => {
    await wait();
    const u = need("PATIENT");
    const p = db.patients.find((x) => x.user_id === u.id);
    const live = presOf(p.id).find((x) => x.status === "ACTIVE" || x.status === "PAUSED");
    const todayStr = new Date().toDateString();
    const items = [];
    const other = [];
    if (live && live.status === "ACTIVE") {
      db.plans.filter((it) => it.prescription_id === live.id).forEach((it) => {
        const todays = db.sessions.filter((s) => s.plan_id === it.id && new Date(s.ended_at).toDateString() === todayStr);
        const st = todays.some((s) => s.status === "COMPLETED") ? "DONE" : todays.some((s) => ["PARTIAL", "INTERRUPTED"].includes(s.status)) ? "PARTIAL" : todays.some((s) => s.status === "SKIPPED") ? "SKIPPED" : "PENDING";
        const out = { ...planOut(it), today_status: st, today_session_ids: todays.map((s) => s.id) };
        (out.scheduled_today ? items : other).push(out);
      });
    }
    const done = items.filter((i) => i.today_status === "DONE").length;
    return {
      date: new Date().toISOString().slice(0, 10), weekday: new Date().toLocaleDateString("en-IN", { weekday: "long" }),
      plan_status: live ? live.status : null, plan_status_reason: live ? live.status_reason : null, plan_note: live ? live.note : null, plan_version: live ? live.version : null,
      items, other_items: other, all_done_today: items.length > 0 && done === items.length,
      streak: { days: items.length > 0 && done === items.length ? 1 : 0, rule: "A day counts when every exercise scheduled for that day is completed. (mock mode: today only)" },
      adherence_7d: done ? { pct: Math.round((100 * done) / items.length), done, scheduled: items.length, days_with_missed: 0 } : null,
      adherence_rule: "Scheduled exercises completed in the last 7 days, divided by exercises scheduled.",
      consent: consentOut(u.id),
    };
  },
  guidedSession: async (data) => {
    await wait();
    const u = need("PATIENT");
    const p = db.patients.find((x) => x.user_id === u.id);
    const dup = db.sessions.find((s) => s.client_request_id === data.client_request_id);
    if (dup) return sessionOut(dup);
    const it = db.plans.find((x) => x.id === Number(data.plan_id) && x.patient_id === p.id && x.active);
    if (!it) throw new MockError(404, "This exercise is not in your active plan");
    const sets = Math.min(data.sets_done, it.sets);
    const status = sets >= it.sets ? "COMPLETED" : data.stopped ? "INTERRUPTED" : sets > 0 ? "PARTIAL" : "INTERRUPTED";
    const s = { id: db.nextId++, client_request_id: data.client_request_id, patient_id: p.id, plan_id: it.id, mode: "GUIDED", status, review_flag: data.pain_stop ? "PAIN_STOP" : null, patient_note: null, started_at: now(), ended_at: now(), min_angle: it.min_angle, max_angle: it.max_angle, prescribed_reps: it.sets * it.reps_per_set, reps_done: sets * it.reps_per_set, good_reps: null, under_reps: null, over_reps: null, accuracy_pct: null, completion_pct: null, adherence_pct: null, max_angle_reached: null, avg_peak_angle: null, duration_s: data.duration_s, plan_followed: null, pain_score: null, reps: [] };
    db.sessions.push(s);
    return sessionOut(s);
  },
  skipToday: async (data) => {
    await wait();
    const u = need("PATIENT");
    const p = db.patients.find((x) => x.user_id === u.id);
    const items = db.plans.filter((x) => x.patient_id === p.id && x.active && (data.plan_id ? x.id === Number(data.plan_id) : planOut(x).scheduled_today));
    items.forEach((it) => db.sessions.push({ id: db.nextId++, patient_id: p.id, plan_id: it.id, mode: "NONE", status: "SKIPPED", review_flag: data.not_well ? "NOT_WELL" : null, patient_note: data.reason, started_at: now(), ended_at: now(), min_angle: it.min_angle, max_angle: it.max_angle, prescribed_reps: it.sets * it.reps_per_set, reps_done: 0, good_reps: null, adherence_pct: null, max_angle_reached: null, plan_followed: null, pain_score: null, reps: [] }));
    return { skipped: items.length };
  },

  // ---------------- admin ----------------
  adminOverview: async () => {
    await wait();
    need("ADMIN");
    const ts = db.users.filter((u) => u.role === "THERAPIST");
    const by = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
    ts.forEach((t) => (by[db.profiles[t.id]?.status || "PENDING"] += 1));
    const week = db.sessions.filter((s) => Date.now() - new Date(s.ended_at) < 7 * 86400000);
    return { therapists_total: ts.length, therapists_by_status: by, patients_total: db.users.filter((u) => u.role === "PATIENT").length, admins_total: db.users.filter((u) => u.role === "ADMIN").length, suspended_accounts: db.users.filter((u) => u.status === "SUSPENDED").length, sessions_total: db.sessions.length, sessions_last_7_days: week.length, high_pain_last_7_days: week.filter((s) => s.pain_score >= 7).length, plan_followed_last_7_days: { YES: week.filter((s) => s.plan_followed === "YES").length, PARTLY: week.filter((s) => s.plan_followed === "PARTLY").length, NO: week.filter((s) => s.plan_followed === "NO").length } };
  },
  adminTherapists: async (status) => {
    await wait();
    need("ADMIN");
    const order = { PENDING: 0, REJECTED: 1, APPROVED: 2 };
    return db.users.filter((u) => u.role === "THERAPIST" && (!status || db.profiles[u.id]?.status === status)).sort((a, b) => order[db.profiles[a.id].status] - order[db.profiles[b.id].status]).map(therapistRow);
  },
  adminTherapist: async (id) => (await wait(), need("ADMIN"), therapistRow(user(Number(id)))),
  adminTherapistDocument: async () => {
    need("ADMIN");
    return new Blob(["DEMO DOCUMENT (mock mode) - not a real certificate"], { type: "text/plain" });
  },
  adminDecide: async (id, decision, reason, note) => {
    await wait();
    const a = need("ADMIN");
    const p = db.profiles[Number(id)];
    Object.assign(p, { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", decision_reason: reason, register_check_note: note || null, reviewed_at: now(), reviewed_by: a.name });
    log(a.id, decision === "APPROVE" ? "THERAPIST_APPROVED" : "THERAPIST_REJECTED", "USER", Number(id), reason);
    return therapistRow(user(Number(id)));
  },
  adminPatients: async () => {
    await wait();
    need("ADMIN");
    return db.users.filter((u) => u.role === "THERAPIST").map((t) => ({ therapist: { id: t.id, name: t.name, email: t.email, verification_status: db.profiles[t.id]?.status, account_status: t.status }, patients: db.patients.filter((p) => p.therapist_id === t.id).map(patientSummary) }));
  },
  adminSetStatus: async (id, suspend, reason) => {
    await wait();
    const a = need("ADMIN");
    const u = user(Number(id));
    if (u.id === a.id) throw new MockError(400, "You cannot change your own account status");
    u.status = suspend ? "SUSPENDED" : "ACTIVE";
    u.status_reason = reason;
    log(a.id, suspend ? "USER_SUSPENDED" : "USER_REACTIVATED", "USER", u.id, reason);
    return { id: u.id, status: u.status };
  },
  adminAdmins: async () => (await wait(), need("ADMIN"), db.users.filter((u) => u.role === "ADMIN").map((u) => ({ id: u.id, name: u.name, email: u.email, status: u.status }))),
  adminAddAdmin: async (data) => {
    await wait();
    const a = need("ADMIN");
    const id = db.nextId++;
    db.users.push({ id, ...data, email: data.email.toLowerCase(), role: "ADMIN", status: "ACTIVE" });
    log(a.id, "ADMIN_CREATED", "USER", id, null);
    return { id, name: data.name, email: data.email, status: "ACTIVE" };
  },
  adminAuditLog: async () => (await wait(), need("ADMIN"), clone(db.audit)),
};