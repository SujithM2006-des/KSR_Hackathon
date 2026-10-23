// Login token + current user, kept in the browser (localStorage).
// Every read/write is wrapped in try/catch so private windows don't crash the app.

const TOKEN_KEY = "rehabrep_token";
const USER_KEY = "rehabrep_user";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

export function saveLogin(token, user) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

export function updateUser(user) {
  saveLogin(null, user);
}

export function logout() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

export function homeFor(user) {
  if (!user) return "/login";
  if (user.role === "ADMIN") return "/admin";
  if (user.role === "THERAPIST") {
    return user.therapist && user.therapist.status === "APPROVED" ? "/therapist" : "/therapist/verification";
  }
  return "/patient";
}