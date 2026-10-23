import { useState } from "react";

// A small modal that asks for a reason before an admin action (approve, reject, suspend...).
// onConfirm(reason, note) must return a Promise; errors are shown inside the dialog.
export default function ReasonDialog({ title, text, confirmLabel, danger, withNote, onConfirm, onClose }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (reason.trim().length < 3) return setError("Please write a reason (at least 3 characters).");
    setBusy(true);
    setError("");
    try {
      await onConfirm(reason.trim(), note.trim());
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title}</h3>
        {text && <p className="muted">{text}</p>}
        <label>
          Reason (saved in the audit log{withNote ? " and shown to the therapist" : ""})
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </label>
        {withNote && (
          <label>
            Register check note (optional, admins only)
            <input
              value={note}
              placeholder="e.g. Checked on council website, number matches"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        )}
        {error && <div className="alert alert-red">{error}</div>}
        <div className="row-gap right">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={busy}>
            {busy ? "Saving..." : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}