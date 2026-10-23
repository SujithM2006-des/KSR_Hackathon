import { useEffect, useState } from "react";
import { api, config, getUser } from "../api.js";

// "Call 108" button.
// - Patient + emergency alert set up on the backend (Twilio): pressing it CALLS and TEXTS the emergency
//   contact automatically, and shows what happened.
// - Otherwise it is a phone link: a phone dials it, a laptop hands it to Windows Phone Link (if set up).
// VITE_EMERGENCY_DIAL (demo only) changes the number dialled; the screen then says so.
export default function EmergencyCall({ number = "108" }) {
  const user = getUser();
  const isPatient = user && user.role === "PATIENT";
  const dial = config.emergencyDialOverride || number;
  const [alertTo, setAlertTo] = useState(null); // masked contact number when the alert is set up
  const [state, setState] = useState(null); // null | "sending" | { ok, text }

  useEffect(() => {
    if (!isPatient) return;
    api
      .emergencyAlertInfo()
      .then((r) => setAlertTo(r.configured ? r.to : null))
      .catch(() => setAlertTo(null));
  }, [isPatient]);

  const dialNow = () => {
    window.location.href = `tel:${dial}`;
  };

  async function press(e) {
    if (!alertTo) return; // plain phone link
    e.preventDefault();
    setState("sending");
    try {
      const r = await api.emergencyAlert();
      if (!r.configured) {
        setState(null);
        dialNow();
      } else if (r.cooldown) {
        setState({ ok: true, text: `Alert already sent to ${r.to} in the last minute.` });
      } else if ([r.call, r.sms].every((x) => String(x).startsWith("failed"))) {
        setState({ ok: false, text: "Automatic call failed - dial the number instead." });
        dialNow();
      } else {
        setState({ ok: true, text: `Calling ${r.to} now and sending an SMS.` });
      }
    } catch {
      setState(null);
      dialNow(); // offline: dial instead
    }
  }

  const note = alertTo
    ? `Demo: this button calls and texts your emergency contact ${alertTo}, not ${number}.`
    : config.emergencyDialOverride
      ? `Demo: this button calls ${dial}, not ${number}.`
      : null;

  return (
    <span className="emergency-call">
      <a href={`tel:${dial}`} onClick={press} aria-busy={state === "sending"}>
        {state === "sending" ? "Calling..." : `Call ${number}`}
      </a>
      {state && state !== "sending" && <small className={state.ok ? "sent" : ""}>{state.text}</small>}
      {note && <small>{note}</small>}
    </span>
  );
}
