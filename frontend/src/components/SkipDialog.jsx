import { useState } from "react";
import { api, newRequestId } from "../api.js";

// "Skip today" for one exercise (item) or all of today's exercises (item = null).
export default function SkipDialog({ item, onDone, onClose }) {
  const [reason, setReason] = useState("");
  const [notWell, setNotWell] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.skipToday({
        plan_id: item ? item.id : null,
        reason: reason.trim() || null,
        not_well: notWell,
        client_request_id: newRequestId(),
      });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{item ? `Skip ${item.exercise_name} today?` : "Skip today's exercises?"}</h3>
        <p className="muted">Your therapist will see this. A short reason helps them.</p>
        <label className="check-row">
          <input type="checkbox" checked={notWell} onChange={(e) => setNotWell(e.target.checked)} />
          <span>I'm not feeling well today</span>
        </label>
        <label>
          Reason (optional)
          <textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {notWell && (
          <div className="alert alert-amber small">
            If you have chest pain, fainting, sudden severe pain or a fall, stop and call 108 or see a doctor.
          </div>
        )}
        {error && <div className="alert alert-red">{error}</div>}
        <div className="row-gap right">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Saving..." : "Skip and tell my therapist"}
          </button>
        </div>
      </form>
    </div>
  );
}
