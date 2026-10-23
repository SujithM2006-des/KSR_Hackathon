// The ONLY place that sends HTTP requests to the backend.
// - adds the login token
// - turns every failure into one ApiError { status, code, message }
// - on 401 (expired/invalid login) clears the session and goes to /login

import { config } from "./config.js";
import { getToken, logout } from "./session.js";

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || `HTTP_${status}`;
  }
}

function errorMessage(data, status) {
  if (data && typeof data.detail === "string") return data.detail;
  if (data && Array.isArray(data.detail)) {
    return data.detail.map((d) => `${(d.loc || []).slice(-1)[0] || "field"}: ${d.msg}`).join(", ");
  }
  return `Request failed (${status})`;
}

/**
 * request("GET", "/patients")
 * request("POST", "/patients", { json: {...} })
 * request("POST", "/auth/register-therapist", { form: FormData })
 * request("GET", "/admin/therapists/5/document", { raw: true })  -> Blob
 */
export async function request(method, path, { json, form, raw, auth = true } = {}) {
  const headers = {};
  const token = auth ? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form; // browser sets the multipart boundary itself
  }

  let res;
  try {
    res = await fetch(config.apiBaseUrl + path, { method, headers, body });
  } catch {
    throw new ApiError(0, `Cannot reach the server at ${config.apiBaseUrl}. Is the backend running?`, "NETWORK");
  }

  if (res.status === 401 && path !== "/auth/login") {
    logout();
    if (window.location.pathname !== "/login") window.location.href = "/login";
    throw new ApiError(401, "Your login has expired - please log in again", "UNAUTHORIZED");
  }

  if (raw) {
    if (!res.ok) {
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* not json */
      }
      throw new ApiError(res.status, errorMessage(data, res.status));
    }
    return res.blob();
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, res.status));
  return data;
}