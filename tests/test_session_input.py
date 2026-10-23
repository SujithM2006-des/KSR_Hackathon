"""
Session input tests: each exercise plays its own test video, and REHABREP_INPUT=camera switches to the webcam.

Run from D:\\PROJECT\\KSR (venv active):
    python -m pytest tests -q
"""

import os

import api
from test_phase4_patient_flow import client, new_patient_with_plan  # noqa: F401 (client is a fixture)


def setup_patient(client, email):
    th, ph, user, pid = new_patient_with_plan(client, email)
    version = client.get("/consent").json()["version"]
    client.post("/me/consent", json={"version": version, "camera_allowed": True}, headers=ph)
    items = {i["exercise_type"]: i for i in client.get("/me/today", headers=ph).json()["items"]}
    return ph, items


def test_each_exercise_gets_its_test_video(client, monkeypatch):
    monkeypatch.setattr(api, "INPUT_MODE", "video")
    monkeypatch.setattr(api, "TEST_VIDEOS", {"mini_squat": "squat_test.mp4"})  # elbow_flexion has no video here
    ph, items = setup_patient(client, "input-a@x.com")

    squat = client.get(f"/my/sessions/input?plan_id={items['mini_squat']['id']}", headers=ph).json()
    # videos/ is not in Git, so "available" depends on whether the file is on this machine
    on_disk = os.path.isfile(os.path.join(api.PROJECT_ROOT, "videos", "squat_test.mp4"))
    assert squat == {"mode": "video", "video": "squat_test.mp4", "available": on_disk}

    elbow = client.get(f"/my/sessions/input?plan_id={items['elbow_flexion']['id']}", headers=ph).json()
    assert elbow == {"mode": "video", "video": None, "available": False}
    # no video for this exercise -> start is refused instead of playing the wrong video
    r = client.post("/my/sessions/start", json={"plan_id": items["elbow_flexion"]["id"]}, headers=ph)
    assert r.status_code == 400 and "no test video" in r.json()["detail"]


def test_camera_mode_uses_webcam_for_every_exercise(client, monkeypatch):
    monkeypatch.setattr(api, "INPUT_MODE", "camera")
    ph, items = setup_patient(client, "input-b@x.com")
    for item in items.values():
        info = client.get(f"/my/sessions/input?plan_id={item['id']}", headers=ph).json()
        assert info == {"mode": "camera", "video": None, "available": True}


def test_input_needs_own_active_plan(client):
    ph, _ = setup_patient(client, "input-c@x.com")
    assert client.get("/my/sessions/input?plan_id=999999", headers=ph).status_code == 404


def test_patient_can_choose_live_camera_in_video_mode(monkeypatch):
    monkeypatch.setattr(api, "INPUT_MODE", "video")
    monkeypatch.setattr(api, "TEST_VIDEOS", {})

    class Plan:
        exercise_type = "elbow_flexion"

    assert api.session_input(Plan())["available"] is False  # no test video
    live = api.session_input(Plan(), use_camera=True)
    assert live["mode"] == "camera" and live["source"] == api.CAMERA_INDEX and live["available"] is True
