"""
Therapists add exercises to the library; they can be prescribed like built-in ones.

Run from D:\\PROJECT\\KSR (venv active):
    python -m pytest tests -q
"""

from test_phase4_patient_flow import client, login, new_patient_with_plan  # noqa: F401 (client is a fixture)

GOOD = {
    "name": "Wall squat hold",
    "joint": "Knee",
    "based_on": "mini_squat",
    "default_min": 60,
    "default_max": 95,
    "instructions": "Lean your back on a wall and slide down until your knees bend, then hold.",
}


def test_therapist_adds_exercise_and_it_is_listed(client):
    th, _ = login(client, "therapist@rehabrep.demo", "therapist123")
    r = client.post("/exercises", json=GOOD, headers=th)
    assert r.status_code == 201, r.text
    ex = r.json()
    assert ex["key"].startswith("custom_") and ex["custom"] is True
    assert ex["measure"] == "Knee flexion" and ex["view"] == "side"  # taken from the mini squat
    assert ex["created_by"] == "Dr. Priya (Physio)"

    listed = {e["key"]: e for e in client.get("/exercises").json()}
    assert listed[ex["key"]]["name"] == "Wall squat hold" and listed["mini_squat"]["custom"] is False

    # same name again -> refused
    assert client.post("/exercises", json=GOOD, headers=th).status_code == 409


def test_bad_input_is_refused(client):
    th, _ = login(client, "therapist@rehabrep.demo", "therapist123")
    bad = [
        {**GOOD, "name": "Bad joint", "joint": "Ankle"},
        {**GOOD, "name": "Wrong base", "based_on": "elbow_flexion"},  # elbow movement for a knee exercise
        {**GOOD, "name": "Wrong range", "default_min": 100, "default_max": 90},
    ]
    for body in bad:
        assert client.post("/exercises", json=body, headers=th).status_code == 400, body
    assert client.post("/exercises", json={**GOOD, "name": "x"}, headers=th).status_code == 422


def test_only_therapists_can_add(client):
    body = {**GOOD, "name": "Not allowed"}
    for email, pw in (("patient@rehabrep.demo", "patient123"), ("admin@rehabrep.demo", "admin12345")):
        headers, _ = login(client, email, pw)
        assert client.post("/exercises", json=body, headers=headers).status_code == 403
    assert client.post("/exercises", json=body).status_code == 401


def test_added_exercise_can_be_prescribed_and_not_removed_while_used(client):
    th, ph, _, pid = new_patient_with_plan(client, "custom-ex@x.com")
    ex = client.post("/exercises", json={**GOOD, "name": "Step-up"}, headers=th).json()
    items = [{"exercise_type": ex["key"], "sets": 2, "reps_per_set": 8, "min_angle": 60, "max_angle": 95}]
    assert client.post(f"/patients/{pid}/exercise-plans", json={"items": items}, headers=th).status_code == 201

    version = client.get("/consent").json()["version"]
    client.post("/me/consent", json={"version": version, "camera_allowed": True}, headers=ph)
    today = client.get("/me/today", headers=ph).json()["items"]
    assert today[0]["exercise_name"] == "Step-up" and today[0]["joint"] == "Knee"

    assert client.delete(f"/exercises/{ex['key']}", headers=th).status_code == 409  # used in a plan
    assert client.delete("/exercises/mini_squat", headers=th).status_code == 404  # built-in


def test_unused_added_exercise_can_be_removed(client):
    th, _ = login(client, "therapist@rehabrep.demo", "therapist123")
    ex = client.post("/exercises", json={**GOOD, "name": "Temporary one", "joint": "Elbow", "based_on": "elbow_flexion",
                                         "default_min": 80, "default_max": 140}, headers=th).json()
    assert client.delete(f"/exercises/{ex['key']}", headers=th).json() == {"removed": ex["key"]}
    assert ex["key"] not in {e["key"] for e in client.get("/exercises").json()}
    ah, _ = login(client, "admin@rehabrep.demo", "admin12345")
    actions = [e["action"] for e in client.get("/admin/audit-log?limit=50", headers=ah).json()]
    assert "EXERCISE_ADDED" in actions and "EXERCISE_REMOVED" in actions
