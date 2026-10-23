"""
ReHabRep - Exercise library.

Every exercise is defined by:
  points     the 3 keypoints (A, B, C) for LEFT and RIGHT; the angle is measured at B
  mode       "flexion"  -> 180 - interior angle   (0 = limb straight)
             "interior" -> interior angle A-B-C   (e.g. arm elevation at the shoulder)
  direction  "up"   -> angle INCREASES during the movement (bend, raise)
             "down" -> angle DECREASES during the movement (straighten)
  rest_angle angle in the starting position, at the HIGH end of what the camera
             reads at rest (standing knee reads 5-14 deg -> 15), used for rep thresholds
  view       how the camera should see the patient ("side" or "front")
  pick       "visible" -> use the side whose 3 keypoints are most confident
             "max"     -> use the side with the bigger movement (one limb moves, e.g. marching)
  default_min / default_max   suggested range (the THERAPIST always sets the real one)

Adding an exercise = adding one entry here. No other code changes needed.
Lying-down exercises (heel slides, straight leg raise, bridges) are not included:
pose models are much less reliable on lying bodies.
"""

from pose_angle_test import is_visible, joint_angle

# COCO keypoint indices
L_SHOULDER, R_SHOULDER = 5, 6
L_ELBOW, R_ELBOW = 7, 8
L_WRIST, R_WRIST = 9, 10
L_HIP, R_HIP = 11, 12
L_KNEE, R_KNEE = 13, 14
L_ANKLE, R_ANKLE = 15, 16

KNEE_POINTS = {"LEFT": (L_HIP, L_KNEE, L_ANKLE), "RIGHT": (R_HIP, R_KNEE, R_ANKLE)}
HIP_POINTS = {"LEFT": (L_SHOULDER, L_HIP, L_KNEE), "RIGHT": (R_SHOULDER, R_HIP, R_KNEE)}
SHOULDER_POINTS = {"LEFT": (L_HIP, L_SHOULDER, L_ELBOW), "RIGHT": (R_HIP, R_SHOULDER, R_ELBOW)}
ELBOW_POINTS = {"LEFT": (L_SHOULDER, L_ELBOW, L_WRIST), "RIGHT": (R_SHOULDER, R_ELBOW, R_WRIST)}

EXERCISES = {
    # ------------------------------ KNEE ------------------------------
    "mini_squat": {
        "name": "Mini squat / sit-to-stand",
        "joint": "Knee",
        "measure": "Knee flexion",
        "points": KNEE_POINTS,
        "mode": "flexion",
        "direction": "up",
        "rest_angle": 15,
        "view": "side",
        "pick": "visible",
        "default_min": 60,
        "default_max": 100,
        "cue_under": "Bend a little more",
        "cue_over": "Don't go that far",
        "say_under": "Bend more",
        "say_over": "Too far",
        "instructions": "Stand side-on to the camera, feet hip-width apart. Bend your knees, then stand up.",
    },
    "seated_knee_extension": {
        "name": "Seated knee extension (long arc quad)",
        "joint": "Knee",
        "measure": "Knee flexion (0 = fully straight)",
        "points": KNEE_POINTS,
        "mode": "flexion",
        "direction": "down",
        "rest_angle": 90,
        "view": "side",
        "pick": "visible",
        "default_min": 0,
        "default_max": 15,
        "cue_under": "Straighten your knee more",
        "cue_over": "Don't lock your knee",
        "say_under": "Straighten more",
        "say_over": "Don't lock",
        "instructions": "Sit side-on to the camera. Straighten your knee fully, then lower it slowly.",
    },
    "seated_knee_flexion": {
        "name": "Seated knee flexion (foot slide back)",
        "joint": "Knee",
        "measure": "Knee flexion",
        "points": KNEE_POINTS,
        "mode": "flexion",
        "direction": "up",
        "rest_angle": 90,
        "view": "side",
        "pick": "visible",
        "default_min": 105,
        "default_max": 130,
        "cue_under": "Slide your foot back a little more",
        "cue_over": "Don't bend that far",
        "say_under": "Bend more",
        "say_over": "Too far",
        "instructions": "Sit side-on to the camera. Slide your foot back under the chair, then forward again.",
    },
    "hamstring_curl": {
        "name": "Standing hamstring curl",
        "joint": "Knee",
        "measure": "Knee flexion",
        "points": KNEE_POINTS,
        "mode": "flexion",
        "direction": "up",
        "rest_angle": 10,
        "view": "side",
        "pick": "max",
        "default_min": 60,
        "default_max": 100,
        "cue_under": "Bring your heel up a little more",
        "cue_over": "Don't bring it that far",
        "say_under": "Higher",
        "say_over": "Too far",
        "instructions": "Stand side-on holding a chair. Bend one knee to bring your heel up behind you, then lower.",
    },
    # ------------------------------ HIP -------------------------------
    "hip_flexion": {
        "name": "Standing hip flexion (marching)",
        "joint": "Hip",
        "measure": "Hip flexion",
        "points": HIP_POINTS,
        "mode": "flexion",
        "direction": "up",
        "rest_angle": 10,
        "view": "side",
        "pick": "max",
        "default_min": 45,
        "default_max": 90,
        "cue_under": "Lift your knee a little higher",
        "cue_over": "Don't lift that high",
        "say_under": "Higher",
        "say_over": "Too high",
        "instructions": "Stand side-on holding a chair. Lift one knee up in front of you, then lower.",
    },
    "hip_abduction": {
        "name": "Standing hip abduction",
        "joint": "Hip",
        "measure": "Hip abduction",
        "points": HIP_POINTS,
        "mode": "flexion",
        "direction": "up",
        "rest_angle": 12,
        "view": "front",
        "pick": "max",
        "default_min": 30,
        "default_max": 50,
        "cue_under": "Move your leg out a little more",
        "cue_over": "Don't lift it that far",
        "say_under": "Wider",
        "say_over": "Too far",
        "instructions": "Face the camera holding a chair. Move one straight leg out to the side, then back.",
    },
    # ---------------------------- SHOULDER ----------------------------
    "shoulder_flexion": {
        "name": "Shoulder flexion (arm raise forward)",
        "joint": "Shoulder",
        "measure": "Shoulder elevation",
        "points": SHOULDER_POINTS,
        "mode": "interior",
        "direction": "up",
        "rest_angle": 15,
        "view": "side",
        "pick": "visible",
        "default_min": 90,
        "default_max": 150,
        "cue_under": "Raise your arm a little higher",
        "cue_over": "Don't raise it that high",
        "say_under": "Higher",
        "say_over": "Too high",
        "instructions": "Stand side-on to the camera. Raise your straight arm forward and up, then lower.",
    },
    "shoulder_abduction": {
        "name": "Shoulder abduction (arm raise to side)",
        "joint": "Shoulder",
        "measure": "Shoulder elevation",
        "points": SHOULDER_POINTS,
        "mode": "interior",
        "direction": "up",
        "rest_angle": 15,
        "view": "front",
        "pick": "max",
        "default_min": 60,
        "default_max": 120,
        "cue_under": "Raise your arm a little higher",
        "cue_over": "Don't raise it that high",
        "say_under": "Higher",
        "say_over": "Too high",
        "instructions": "Face the camera. Raise one straight arm out to the side, then lower.",
    },
    # ------------------------------ ELBOW -----------------------------
    "elbow_flexion": {
        "name": "Elbow flexion (bend and straighten)",
        "joint": "Elbow",
        "measure": "Elbow flexion",
        "points": ELBOW_POINTS,
        "mode": "flexion",
        "direction": "up",
        "rest_angle": 10,
        "view": "side",
        "pick": "visible",
        "default_min": 90,
        "default_max": 140,
        "cue_under": "Bend your elbow a little more",
        "cue_over": "Don't bend it that far",
        "say_under": "Bend more",
        "say_over": "Too far",
        "instructions": "Stand or sit side-on to the camera. Bend your elbow, then straighten it.",
    },
}

# Old names still accepted (plans saved before the exercise library existed)
ALIASES = {"knee": "mini_squat"}


def resolve_exercise(key):
    """Return the real exercise key, or None if unknown."""
    if key in EXERCISES:
        return key
    return ALIASES.get(key)


def get_exercise(key):
    real = resolve_exercise(key)
    if real is None:
        raise KeyError(f"Unknown exercise '{key}'")
    return EXERCISES[real]


def exercise_list():
    """Public info for the API / frontend (no keypoint internals)."""
    out = []
    for key, ex in EXERCISES.items():
        out.append(
            {
                "key": key,
                "name": ex["name"],
                "joint": ex["joint"],
                "measure": ex["measure"],
                "direction": ex["direction"],
                "view": ex["view"],
                "default_min": ex["default_min"],
                "default_max": ex["default_max"],
                "instructions": ex["instructions"],
            }
        )
    return out


def measure(exercise_key, xy, conf, frame_w, frame_h):
    """
    Measure the exercise angle for one person.
    Returns {"side", "angle", "points": (A, B, C) pixel coords} or None if not visible.
    """
    ex = get_exercise(exercise_key)
    candidates = []
    for side, (a, b, c) in ex["points"].items():
        if not all(is_visible(xy, conf, i, frame_w, frame_h) for i in (a, b, c)):
            continue
        interior = joint_angle(xy[a], xy[b], xy[c])
        angle = 180.0 - interior if ex["mode"] == "flexion" else interior
        score = float(min(conf[a], conf[b], conf[c]))
        candidates.append({"side": side, "angle": angle, "score": score, "points": (xy[a], xy[b], xy[c])})

    if not candidates:
        return None

    if ex["pick"] == "max":
        if ex["direction"] == "up":
            best = max(candidates, key=lambda c: c["angle"])
        else:
            best = min(candidates, key=lambda c: c["angle"])
    else:
        best = max(candidates, key=lambda c: c["score"])

    return {"side": best["side"], "angle": best["angle"], "points": best["points"]}