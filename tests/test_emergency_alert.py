"""
Emergency alert (call + SMS via Twilio). Twilio is replaced by a fake client - these tests never
place a real call, even if secrets\\alerts.env holds real keys.

Run from D:\\PROJECT\\KSR (venv active):
    python -m pytest tests -q
"""

import pytest

import alerts
from test_phase4_patient_flow import client, login  # noqa: F401 (client is a fixture)

FAKE = {"sid": "ACtest", "token": "tok", "from": "+15550100", "to": "+919000000000"}


class FakeResponse:
    def __init__(self, status_code, body):
        self.status_code, self._body, self.content = status_code, body, b"x"

    def json(self):
        return self._body


class FakeTwilio:
    def __init__(self, fail=False):
        self.posts, self.fail = [], fail

    def post(self, url, data):
        self.posts.append((url, data))
        if self.fail:
            return FakeResponse(400, {"message": "unverified number"})
        return FakeResponse(201, {"status": "queued"})


@pytest.fixture(autouse=True)
def no_real_twilio(monkeypatch):
    monkeypatch.setattr(alerts, "ALERTS_FILE", "does-not-exist.env")
    for k in ("REHABREP_TWILIO_SID", "REHABREP_TWILIO_TOKEN", "REHABREP_TWILIO_FROM", "REHABREP_ALERT_TO"):
        monkeypatch.delenv(k, raising=False)
    alerts._last_alert.clear()


def test_phone_numbers_are_normalised():
    assert alerts.phone("90000 00000") == "+919000000000"
    assert alerts.phone("+91 90000-00000") == "+919000000000"
    assert alerts.masked("+919000000000") == "+919000••••00"


def test_not_configured_sends_nothing():
    assert alerts.configured() is False
    assert alerts.send_emergency_alert(1, "Ravi", client=FakeTwilio()) == {"configured": False}


def test_call_and_sms_then_cooldown(monkeypatch):
    monkeypatch.setattr(alerts, "settings", lambda: dict(FAKE))
    fake = FakeTwilio()
    r = alerts.send_emergency_alert(1, "Ravi Kumar", client=fake)
    assert r["call"] == "queued" and r["sms"] == "queued" and r["to"] == "+919000••••00"
    (call_url, call), (sms_url, sms) = fake.posts
    assert call_url.endswith("/Accounts/ACtest/Calls.json") and call["To"] == "+919000000000" and "<Say" in call["Twiml"]
    assert sms_url.endswith("/Messages.json") and "Ravi Kumar" in sms["Body"] and "108" in sms["Body"]
    # a second press within a minute does not call again
    again = alerts.send_emergency_alert(1, "Ravi Kumar", client=fake)
    assert again["cooldown"] is True and len(fake.posts) == 2


def test_twilio_errors_are_reported(monkeypatch):
    monkeypatch.setattr(alerts, "settings", lambda: dict(FAKE))
    r = alerts.send_emergency_alert(2, "Ravi", client=FakeTwilio(fail=True))
    assert r["call"].startswith("failed") and "unverified" in r["call"]


def test_endpoint_patient_only_and_falls_back_when_off(client):
    th, _ = login(client, "therapist@rehabrep.demo", "therapist123")
    assert client.post("/me/emergency-alert", headers=th).status_code == 403
    ph, _ = login(client, "patient@rehabrep.demo", "patient123")
    assert client.get("/me/emergency-alert", headers=ph).json() == {"configured": False, "to": None}
    assert client.post("/me/emergency-alert", headers=ph).json() == {"configured": False}
