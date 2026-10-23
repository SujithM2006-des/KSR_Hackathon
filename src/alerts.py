"""
ReHabRep - Emergency alert: phone call + SMS to the patient's emergency contact (via Twilio).

When a patient presses the emergency button, the backend asks Twilio to
  1. CALL the emergency contact and read out a short spoken alert, and
  2. send an SMS with the same message.

Settings (environment variables, or the file secrets\\alerts.env - never committed to Git):
    REHABREP_TWILIO_SID      Twilio Account SID        (starts with AC...)
    REHABREP_TWILIO_TOKEN    Twilio Auth Token
    REHABREP_TWILIO_FROM     your Twilio phone number  (e.g. +1 415 555 0100)
    REHABREP_ALERT_TO        who gets the alert        (e.g. +91 90000 00000)

If they are not set, nothing is sent and the app falls back to the phone's dialler.
This is a demo convenience: it does NOT contact 108 or any emergency service.
"""

import os
import re
from datetime import datetime, timedelta

import httpx

from database import PROJECT_ROOT

ALERTS_FILE = os.path.join(PROJECT_ROOT, "secrets", "alerts.env")
TWILIO_API = "https://api.twilio.com/2010-04-01/Accounts/{sid}/{what}.json"
COOLDOWN = timedelta(seconds=60)  # one alert per patient per minute (stops double presses)
TIMEOUT_S = 10

_last_alert = {}  # user id -> time of the last alert


def _file_settings():
    values = {}
    if os.path.isfile(ALERTS_FILE):
        with open(ALERTS_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def phone(number):
    """'+91 90000 00000' -> '+919000000000'. A bare 10-digit number is taken as Indian (+91)."""
    digits = re.sub(r"[^\d+]", "", number or "")
    if digits and not digits.startswith("+"):
        digits = "+91" + digits[-10:] if len(digits) >= 10 else digits
    return digits


def settings():
    f = _file_settings()
    get = lambda k: os.getenv(k) or f.get(k, "")
    return {
        "sid": get("REHABREP_TWILIO_SID"),
        "token": get("REHABREP_TWILIO_TOKEN"),
        "from": phone(get("REHABREP_TWILIO_FROM")),
        "to": phone(get("REHABREP_ALERT_TO")),
    }


def configured(s=None):
    s = s or settings()
    return all(s[k] for k in ("sid", "token", "from", "to"))


def masked(number):
    return number[:-6] + "••••" + number[-2:] if len(number) > 6 else number


def alert_text(patient_name):
    when = datetime.now().strftime("%I:%M %p")
    return (
        f"ReHabRep emergency alert. Your contact {patient_name} pressed the emergency button at {when}. "
        f"Please call them now. If they need urgent medical help, call 108."
    )


def _say(text):
    """TwiML that reads the message twice (in case the first words are missed)."""
    safe = text.replace("&", "and").replace("<", "").replace(">", "")
    return f'<Response><Say voice="alice">{safe}</Say><Pause length="1"/><Say voice="alice">{safe}</Say></Response>'


def send_emergency_alert(user_id, patient_name, client=None):
    """
    Call + SMS the emergency contact. Returns
      {"configured", "to" (masked), "call": "queued"|..|"failed: ...", "sms": ..., "cooldown": bool}
    """
    s = settings()
    if not configured(s):
        return {"configured": False}

    now = datetime.utcnow()
    last = _last_alert.get(user_id)
    if last and now - last < COOLDOWN:
        return {"configured": True, "to": masked(s["to"]), "cooldown": True}
    _last_alert[user_id] = now

    text = alert_text(patient_name)
    result = {"configured": True, "to": masked(s["to"]), "cooldown": False}
    http = client or httpx.Client(timeout=TIMEOUT_S, auth=(s["sid"], s["token"]))
    try:
        for what, data in (
            ("Calls", {"To": s["to"], "From": s["from"], "Twiml": _say(text)}),
            ("Messages", {"To": s["to"], "From": s["from"], "Body": text}),
        ):
            key = "call" if what == "Calls" else "sms"
            try:
                r = http.post(TWILIO_API.format(sid=s["sid"], what=what), data=data)
                body = r.json() if r.content else {}
                result[key] = body.get("status", "queued") if r.status_code < 300 else f"failed: {body.get('message', r.status_code)}"
            except httpx.HTTPError as exc:
                result[key] = f"failed: {exc.__class__.__name__}"
    finally:
        if client is None:
            http.close()
    return result


if __name__ == "__main__":
    # Check your Twilio settings:  python src\alerts.py   (really calls + texts REHABREP_ALERT_TO)
    s = settings()
    if not configured(s):
        missing = [k for k in ("sid", "token", "from", "to") if not s[k]]
        print(f"Not set up yet - fill these in {ALERTS_FILE}: {', '.join(missing)}")
    else:
        print(f"Sending a TEST alert to {masked(s['to'])} ...")
        print(send_emergency_alert(0, "Test patient"))
