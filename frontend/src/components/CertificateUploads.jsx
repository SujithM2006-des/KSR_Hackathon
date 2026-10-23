// Certificates each profession must upload before an admin can approve the account.
// (The backend sends the same list in /config/registration; this is the fallback.)
export const REQUIRED_DOCUMENTS = {
  DOCTOR: [
    { kind: "NEET", label: "NEET exam certificate / scorecard" },
    { kind: "MEDICAL_REGISTRATION", label: "Medical practice registration certificate (NMC / State Medical Council)" },
  ],
  PHYSIOTHERAPIST: [{ kind: "PHYSIO_REGISTRATION", label: "Physiotherapy council registration certificate" }],
};

// form field the backend expects for each kind
export const FIELD = { NEET: "neet_certificate", MEDICAL_REGISTRATION: "medical_certificate", PHYSIO_REGISTRATION: "physio_certificate" };

export const ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

// One file input per required certificate. files = { kind: File }, onChange(kind, File|null)
// existing = documents already on file ({ kind, name }) - shown as "on file", upload replaces it.
export default function CertificateUploads({ required, files, onChange, maxMb = 5, existing = [], onError }) {
  function pick(kind, e) {
    const f = e.target.files[0] || null;
    if (f && f.size > maxMb * 1024 * 1024) {
      onError && onError(`The file is larger than ${maxMb} MB.`);
      e.target.value = "";
      onChange(kind, null);
      return;
    }
    onError && onError("");
    onChange(kind, f);
  }

  return (
    <div className="cert-list">
      {required.map((r) => {
        const have = existing.find((d) => d.kind === r.kind);
        const chosen = files[r.kind];
        return (
          <label key={r.kind} className={`cert-item ${have || chosen ? "done" : ""}`}>
            <span className="cert-title">
              {r.label} <span className="cert-req">required</span>
            </span>
            {have && !chosen && (
              <span className="cert-have">
                On file: {have.name || "uploaded"}
                {have.uploaded_by_admin ? " (added by admin)" : ""} - choose a file to replace it
              </span>
            )}
            <input type="file" accept={ACCEPT} onChange={(e) => pick(r.kind, e)} />
          </label>
        );
      })}
      <span className="muted small">PDF, JPG or PNG, max {maxMb} MB each. Stored encrypted; only admins can open them.</span>
    </div>
  );
}
