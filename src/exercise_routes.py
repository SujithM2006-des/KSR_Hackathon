"""
ReHabRep - Therapist-added exercises (the Exercise Library).

  POST    /exercises          add an exercise (approved therapists). It is measured like a built-in one.
  DELETE  /exercises/{key}    remove your own added exercise, if no plan uses it

GET /exercises (api.py) lists built-in and added exercises together.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

from crud import log_action
from database import get_db
from exercises import BUILT_IN, CUSTOM_PREFIX, EXERCISES, JOINTS, register_custom, unregister_custom
from models import CustomExercise, ExercisePlan, User
from security import require_therapist

router = APIRouter(tags=["exercises"])


class ExerciseIn(BaseModel):
    name: str = Field(min_length=3, max_length=80)
    joint: str
    based_on: str  # built-in exercise whose camera measurement is reused
    default_min: float = Field(ge=0, le=180)
    default_max: float = Field(ge=0, le=180)
    instructions: str = Field(min_length=10, max_length=400)


def _public(key):
    ex = EXERCISES[key]
    return {
        "key": key,
        "name": ex["name"],
        "joint": ex["joint"],
        "measure": ex["measure"],
        "direction": ex["direction"],
        "view": ex["view"],
        "default_min": ex["default_min"],
        "default_max": ex["default_max"],
        "instructions": ex["instructions"],
        "custom": True,
        "based_on": ex["based_on"],
        "created_by_id": ex["created_by_id"],
        "created_by": ex["created_by"],
    }


@router.post("/exercises", status_code=201)
def add_exercise(body: ExerciseIn, therapist: User = Depends(require_therapist), db: DbSession = Depends(get_db)):
    name = " ".join(body.name.split())
    if body.joint not in JOINTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Category must be one of: {', '.join(JOINTS)}")
    if body.based_on not in BUILT_IN or EXERCISES[body.based_on]["joint"] != body.joint:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose how the camera measures it from the same category")
    if body.default_min >= body.default_max:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The minimum angle must be smaller than the maximum")
    if any(ex["name"].lower() == name.lower() for ex in EXERCISES.values()):
        raise HTTPException(status.HTTP_409_CONFLICT, f"An exercise called '{name}' is already in the library")

    row = CustomExercise(
        created_by_id=therapist.id,
        name=name,
        joint=body.joint,
        based_on=body.based_on,
        default_min=body.default_min,
        default_max=body.default_max,
        instructions=body.instructions.strip(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    key = register_custom(row)
    log_action(db, therapist.id, "EXERCISE_ADDED", "EXERCISE", row.id, f"{name} ({body.joint})")
    return _public(key)


@router.delete("/exercises/{key}")
def remove_exercise(key: str, therapist: User = Depends(require_therapist), db: DbSession = Depends(get_db)):
    row = None
    if key.startswith(CUSTOM_PREFIX) and key[len(CUSTOM_PREFIX):].isdigit():
        row = db.query(CustomExercise).filter(CustomExercise.id == int(key[len(CUSTOM_PREFIX):])).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exercise not found (built-in exercises cannot be removed)")
    if row.created_by_id != therapist.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the therapist who added this exercise can remove it")
    # exercise_type is encrypted, so check the plans in Python
    if any(p.exercise_type == key for p in db.query(ExercisePlan).all()):
        raise HTTPException(status.HTTP_409_CONFLICT, "This exercise is used in a patient's plan, so it cannot be removed")
    name = row.name
    db.delete(row)
    db.commit()
    unregister_custom(key)
    log_action(db, therapist.id, "EXERCISE_REMOVED", "EXERCISE", int(key[len(CUSTOM_PREFIX):]), name)
    return {"removed": key}
