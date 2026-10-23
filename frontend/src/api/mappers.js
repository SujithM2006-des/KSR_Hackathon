// Backend field names -> frontend field names.
// Today the backend already sends the names the screens use, so these are pass-through.
// If the backend renames a field, change it HERE only - never in the screens.

export const mapUser = (u) => u;
export const mapPatient = (p) => p;
export const mapPlan = (p) => p;
export const mapSession = (s) => s;
export const mapPrescription = (p) => p;
export const mapTherapist = (t) => t;
export const mapAudit = (e) => e;

export const mapList = (fn) => (list) => (Array.isArray(list) ? list.map(fn) : []);