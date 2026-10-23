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
  vertical_a True -> if keypoint A is out of view (e.g. hips cropped off), use a point straight
             below B instead (patient standing upright, so the trunk is roughly vertical)
  anatomical_max  optional cap on the reading: a joint can't bend further than this, so a
             bigger number is a camera-angle error (limb pointing at the camera)
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
        "default_min": 90,
        "default_max": 145,  # squat test video peaks at 128-137 deg
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
        "vertical_a": True,
        "default_min": 150,
        "default_max": 180,  # shoulder test video raises the arm fully overhead (~177 deg)
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
        "vertical_a": True,
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
        "anatomical_max": 150,  # filmed front-on the folded forearm reads ~175 deg; a real elbow stops ~150
        "default_min": 90,
        "default_max": 150,
        "cue_under": "Bend your elbow a little more",
        "cue_over": "Don't bend it that far",
        "say_under": "Bend more",
        "say_over": "Too far",
        "instructions": "Stand or sit side-on to the camera. Bend your elbow, then straighten it.",
    },
}

# Old names still accepted (plans saved before the exercise library existed)
ALIASES = {"knee": "mini_squat"}

BUILT_IN = frozenset(EXERCISES)  # the exercises defined above (therapist-added ones are added at runtime)
JOINTS = ("Knee", "Hip", "Shoulder", "Elbow")
CUSTOM_PREFIX = "custom_"


def register_custom(row):
    """
    Add (or refresh) a therapist-added exercise. It copies the tracking settings of its built-in
    `based_on` exercise and uses the therapist's name, default range and instructions.
    `row` is a CustomExercise. Returns the exercise key ("custom_<id>").
    """
    base = EXERCISES[row.based_on]
    key = f"{CUSTOM_PREFIX}{row.id}"
    EXERCISES[key] = {
        **base,
        "name": row.name,
        "default_min": row.default_min,
        "default_max": row.default_max,
        "instructions": row.instructions,
        "custom": True,
        "based_on": row.based_on,
        "created_by_id": row.created_by_id,
        "created_by": row.created_by.name if row.created_by else None,
    }
    return key


def unregister_custom(key):
    if key.startswith(CUSTOM_PREFIX):
        EXERCISES.pop(key, None)


def load_custom_exercises(db):
    """Register every therapist-added exercise from the database (API startup, session runner)."""
    from models import CustomExercise

    for row in db.query(CustomExercise).all():
        if row.based_on in BUILT_IN:
            register_custom(row)


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
                "custom": bool(ex.get("custom")),
                "based_on": ex.get("based_on"),
                "created_by_id": ex.get("created_by_id"),
                "created_by": ex.get("created_by"),
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
        if not all(is_visible(xy, conf, i, frame_w, frame_h) for i in (b, c)):
            continue
        if is_visible(xy, conf, a, frame_w, frame_h):
            pa, score, real_a = xy[a], float(min(conf[a], conf[b], conf[c])), True
        elif ex.get("vertical_a"):
            pa, score, real_a = (xy[b][0], xy[b][1] + frame_h * 0.2), float(min(conf[b], conf[c])), False
        else:
            continue
        interior = joint_angle(pa, xy[b], xy[c])
        angle = 180.0 - interior if ex["mode"] == "flexion" else interior
        if "anatomical_max" in ex:
            angle = min(angle, ex["anatomical_max"])
        candidates.append({"side": side, "angle": angle, "score": score, "points": (pa, xy[b], xy[c]), "real_a": real_a})

    if not candidates:
        return None
    # a side measured from the real keypoint A beats one using the vertical stand-in
    if any(c["real_a"] for c in candidates):
        candidates = [c for c in candidates if c["real_a"]]

    if ex["pick"] == "max":
        if ex["direction"] == "up":
            best = max(candidates, key=lambda c: c["angle"])
        else:
            best = min(candidates, key=lambda c: c["angle"])
    else:
        best = max(candidates, key=lambda c: c["score"])

    return {"side": best["side"], "angle": best["angle"], "points": best["points"]}