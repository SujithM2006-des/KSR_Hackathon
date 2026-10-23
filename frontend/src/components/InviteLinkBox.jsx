import { useRef, useState } from "react";
import { fmtDate } from "../api.js";

// Shows a patient's invitation link with Copy and "Share on WhatsApp".
// There is no email service yet, so the therapist passes the link on themselves.
export default function InviteLinkBox({ name, invitation, onClose }) {
  const inputRef = useRef(null);
  const [copied, setCopied] = useState(false);
  if (!invitation) return null;

  const message = `Hello ${name}, your therapist has set up your ReHabRep home exercise account. Open this link to choose your password: ${invitation.url}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(invitation.url);
      setCopied(true);
    } catch {
      // clipboard blocked (e.g. http on another device): select the text so Ctrl+C works
      inputRef.current?.select();
    }
  }

  return (
    <div className="card invite-box">
      <div className="card-head">
        <h3>Invitation link for {name}</h3>
        {onClose && (
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <p className="muted small">
        Send this link to the patient. They choose their own password - you never see it. The link works once and
        expires on {fmtDate(invitation.expires_at)}. Sending a new link cancels this one.
      </p>
      <div className="invite-row">
        <input ref={inputRef} readOnly value={invitation.url} onFocus={(e) => e.target.select()} />
        <button className="btn btn-primary" onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </button>
        <a
          className="btn btn-outline"
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
        >
          Share on WhatsApp
        </a>
      </div>
    </div>
  );
}