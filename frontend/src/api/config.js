// ReHabRep frontend configuration - the ONLY file that reads .env
//
// .env (in the frontend folder):
//   VITE_API_BASE_URL=http://127.0.0.1:8000   # optional; default = this page's host, port 8000
//   VITE_API_MODE=live          # live = real backend, mock = labelled demo data (no backend needed)
//
// Changing these needs a restart of "npm run dev".

const env = import.meta.env;

// Same machine the page came from: localhost on the laptop, the laptop's address on a phone.
const sameHostApi = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:8000` : "http://127.0.0.1:8000";

export const config = {
  apiBaseUrl: (env.VITE_API_BASE_URL || env.VITE_API_URL || sameHostApi).replace(/\/$/, ""),
  mode: env.VITE_API_MODE === "mock" ? "mock" : "live",
  appName: env.VITE_APP_NAME || "ReHabRep",
  clinicianLabel: env.VITE_CLINICIAN_LABEL || "Therapist",
  // DEMO ONLY: number the emergency button really dials (e.g. your own phone for a jury demo).
  // Empty = dial the real emergency number. Keep it in .env so it never reaches Git.
  emergencyDialOverride: (env.VITE_EMERGENCY_DIAL || "").replace(/[^\d+]/g, ""),
  isDev: Boolean(env.DEV),
};

export const isMock = config.mode === "mock";