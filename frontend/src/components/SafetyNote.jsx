import { Link } from "react-router-dom";

// The short stop-if-pain message shown on every exercise screen.
export default function SafetyNote({ onStop, stopLabel = "Stop" }) {
  return (
    <div className="safety-note" role="note">
      <span>
        <b>Stop if you feel sharp, worsening or unusual pain.</b> In an emergency call <b>108</b>.{" "}
        <Link to="/safety" target="_blank">
          Safety and help
        </Link>
      </span>
      {onStop && (
        <button className="btn btn-danger btn-sm" onClick={onStop}>
          {stopLabel}
        </button>
      )}
    </div>
  );
}