// ReHabRep frontend configuration - the ONLY file that reads .env
//
// .env (in the frontend folder):
//   VITE_API_BASE_URL=http://127.0.0.1:8000
//   VITE_API_MODE=live          # live = real backend, mock = labelled demo data (no backend needed)
//
// Changing these needs a restart of "npm run dev".

const env = import.meta.env;

export const config = {
  apiBaseUrl: (env.VITE_API_BASE_URL || env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/$/, ""),
  mode: env.VITE_API_MODE === "mock" ? "mock" : "live",
  appName: env.VITE_APP_NAME || "ReHabRep",
  clinicianLabel: env.VITE_CLINICIAN_LABEL || "Therapist",
  isDev: Boolean(env.DEV),
};

export const isMock = config.mode === "mock";