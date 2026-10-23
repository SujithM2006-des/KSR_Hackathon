"""
ReHabRep - Validation tool.

Runs test videos through the SAME pipeline as a real session (pose model ->
exercise angle -> rep counter -> range judge) without voice or database, and
compares the result with what really happened in the video.

1) One video:
    python src\\validate.py --video videos\\squat_test.mp4 --exercise mini_squat --min 90 --max 135 --expect 8

2) A whole test set (recommended) - list your videos in a CSV manifest:
    python src\\validate.py --manifest videos\\test_manifest.csv

   test_manifest.csv columns:
       video,exercise,min,max,expected
   expected = either a number of reps ("5")
              or the result of every rep in order ("GOOD GOOD UNDER OVER GOOD")

Outputs (in output\\validation\\):
    summary.csv               one row per video (PASS / FAIL)
    <video>_angles.csv        angle of every frame (compare with a goniometer)
"""

import argparse
import csv
import os
import time

import cv2
from ultralytics import YOLO

from exercises import EXERCISES, get_exercise, measure, resolve_exercise
from pose_angle_test import MODEL_PATH, PROCESS_MAX_SIDE, draw_active_leg, draw_body, open_source, resize_to_max_side
from rep_counter import RepCounter

OUT_DIR = os.path.join("output", "validation")
VALID_RESULTS = {"GOOD", "UNDER", "OVER"}


def parse_args():
    p = argparse.ArgumentParser(description="ReHabRep validation")
    p.add_argument("--manifest", default=None, help="CSV with columns video,exercise,min,max,expected")
    p.add_argument("--video", default=None, help="Single video to test")
    p.add_argument("--exercise", default="mini_squat", help="Exercise key (single video mode)")
    p.add_argument("--min", type=float, default=None, help="Prescribed min angle (single video mode)")
    p.add_argument("--max", type=float, default=None, help="Prescribed max angle (single video mode)")
    p.add_argument("--expect", default="", help='Expected reps: "8" or "GOOD GOOD UNDER ..."')
    p.add_argument("--model", default=MODEL_PATH, help="Pose model (e.g. yolo11s-pose.pt)")
    p.add_argument("--show", action="store_true", help="Show the video while testing (slower)")
    return p.parse_args()


def parse_expected(text):
    """Returns (expected_count or None, expected_results list or None)."""
    text = (text or "").strip().upper()
    if not text:
        return None, None
    if text.isdigit():
        return int(text), None
    results = text.replace(",", " ").split()
    bad = [r for r in results if r not in VALID_RESULTS]
    if bad:
        raise ValueError(f"Unknown expected result(s): {bad} (use GOOD / UNDER / OVER)")
    return len(results), results


def run_video(model, video, exercise, min_angle, max_angle, show=False):
    ex_key = resolve_exercise(exercise)
    if ex_key is None:
        raise ValueError(f"Unknown exercise '{exercise}'. Options: {', '.join(EXERCISES)}")
    ex = get_exercise(ex_key)
    min_angle = float(ex["default_min"] if min_angle is None else min_angle)
    max_angle = float(ex["default_max"] if max_angle is None else max_angle)

    cap, is_video = open_source(video)
    if cap is None or not cap.isOpened() or not is_video:
        raise FileNotFoundError(f"Cannot open video: {video}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 1:
        fps = 30.0

    counter = RepCounter(
        min_angle, max_angle,
        direction=ex["direction"], rest_angle=ex["rest_angle"],
        cue_under=ex["cue_under"], cue_over=ex["cue_over"],
    )

    frame_rows = []
    frames = measured = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame = resize_to_max_side(frame, PROCESS_MAX_SIDE)
        h, w = frame.shape[:2]
        frames += 1
        t = frames / fps

        result = model(frame, verbose=False)[0]
        m = None
        if result.keypoints is not None and len(result.keypoints) > 0 and result.keypoints.conf is not None:
            xy = result.keypoints.xy[0].cpu().numpy()
            conf = result.keypoints.conf[0].cpu().numpy()
            m = measure(ex_key, xy, conf, w, h)
            if show:
                draw_body(frame, xy, conf)
                if m:
                    draw_active_leg(frame, *m["points"])

        angle = m["angle"] if m else None
        if angle is not None:
            measured += 1
        counter.update(angle, t)
        frame_rows.append(
            [frames, f"{t:.3f}", m["side"] if m else "",
             f"{angle:.1f}" if angle is not None else "",
             f"{counter.smoothed:.1f}" if (angle is not None and counter.smoothed is not None) else ""]
        )

        if show:
            label = f"{ex['name']}  angle: {angle:.0f}" if angle is not None else "not visible"
            cv2.putText(frame, label, (15, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
            cv2.putText(frame, f"reps: {len(counter.reps)}", (15, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
            cv2.imshow("ReHabRep - Validation", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    if show:
        cv2.destroyAllWindows()

    os.makedirs(OUT_DIR, exist_ok=True)
    stem = os.path.splitext(os.path.basename(video))[0]
    angles_path = os.path.join(OUT_DIR, f"{stem}_{ex_key}_angles.csv")
    with open(angles_path, "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["frame", "time_s", "side", "angle_deg", "smoothed_deg"])
        wr.writerows(frame_rows)

    return {
        "exercise": ex_key,
        "min": min_angle,
        "max": max_angle,
        "frames": frames,
        "coverage_pct": round(100.0 * measured / frames, 1) if frames else 0.0,
        "reps": counter.reps,
        "angles_csv": angles_path,
    }


def check(run, expected_text):
    exp_count, exp_results = parse_expected(expected_text)
    got = [r["result"] for r in run["reps"]]
    count_ok = None if exp_count is None else (len(got) == exp_count)
    results_ok = None
    matched = None
    if exp_results is not None:
        matched = sum(1 for g, e in zip(got, exp_results) if g == e)
        results_ok = got == exp_results
    if exp_count is None:
        verdict = "NO EXPECTATION"
    elif results_ok is False or count_ok is False:
        verdict = "FAIL"
    else:
        verdict = "PASS"
    return {
        "expected_count": exp_count,
        "expected_results": exp_results,
        "got_results": got,
        "count_ok": count_ok,
        "results_ok": results_ok,
        "matched_reps": matched,
        "verdict": verdict,
    }


def print_video_report(video, run, chk):
    print(f"\n--- {video}  [{run['exercise']}, range {run['min']:.0f}-{run['max']:.0f}]")
    print(f"    Tracking coverage : {run['coverage_pct']}% of {run['frames']} frames")
    print(f"    Reps found        : {len(run['reps'])}" + (f"  (expected {chk['expected_count']})" if chk["expected_count"] is not None else ""))
    for r in run["reps"]:
        print(f"      rep {r['rep_number']:>2}: best {r['peak_angle']:>6.1f} deg -> {r['result']}  ({r['duration_s']}s)")
    if chk["expected_results"]:
        print(f"    Expected results  : {' '.join(chk['expected_results'])}")
        print(f"    Got results       : {' '.join(chk['got_results']) or '-'}")
    if run["coverage_pct"] < 90:
        print("    WARNING: joint hidden in many frames - check camera angle / full body in view")
    print(f"    RESULT            : {chk['verdict']}")


def main():
    args = parse_args()
    if not args.manifest and not args.video:
        print("Give --manifest videos\\test_manifest.csv  or  --video <file>")
        return

    jobs = []
    if args.manifest:
        with open(args.manifest, newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                if not row.get("video"):
                    continue
                jobs.append(
                    {
                        "video": row["video"].strip(),
                        "exercise": (row.get("exercise") or "mini_squat").strip(),
                        "min": float(row["min"]) if row.get("min") else None,
                        "max": float(row["max"]) if row.get("max") else None,
                        "expected": row.get("expected", ""),
                    }
                )
    else:
        jobs.append(
            {"video": args.video, "exercise": args.exercise, "min": args.min, "max": args.max, "expected": args.expect}
        )

    model = YOLO(args.model)
    summary = []
    t0 = time.perf_counter()
    for job in jobs:
        try:
            run = run_video(model, job["video"], job["exercise"], job["min"], job["max"], show=args.show)
            chk = check(run, job["expected"])
            print_video_report(job["video"], run, chk)
            summary.append((job, run, chk))
        except Exception as exc:
            print(f"\n--- {job['video']}: ERROR {exc}")
            summary.append((job, None, {"verdict": "ERROR"}))

    # ---- overall ----
    os.makedirs(OUT_DIR, exist_ok=True)
    summary_path = os.path.join(OUT_DIR, "summary.csv")
    with open(summary_path, "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["video", "exercise", "min", "max", "coverage_pct", "reps_found", "expected_reps",
                     "expected_results", "got_results", "verdict"])
        for job, run, chk in summary:
            wr.writerow([
                job["video"], job["exercise"], job["min"], job["max"],
                run["coverage_pct"] if run else "",
                len(run["reps"]) if run else "",
                chk.get("expected_count", ""),
                " ".join(chk.get("expected_results") or []),
                " ".join(chk.get("got_results") or []),
                chk["verdict"],
            ])

    tested = [s for s in summary if s[2].get("expected_count") is not None]
    passed = sum(1 for s in tested if s[2]["verdict"] == "PASS")
    count_ok = sum(1 for s in tested if s[2].get("count_ok"))
    total_exp = sum(len(s[2]["expected_results"]) for s in tested if s[2].get("expected_results"))
    total_match = sum(s[2]["matched_reps"] or 0 for s in tested if s[2].get("expected_results"))

    print("\n==================== VALIDATION SUMMARY ====================")
    print(f"Videos tested           : {len(summary)}  ({time.perf_counter() - t0:.0f}s)")
    if tested:
        print(f"Videos PASS             : {passed}/{len(tested)}")
        print(f"Rep count exactly right : {count_ok}/{len(tested)} videos")
    if total_exp:
        print(f"Rep results correct     : {total_match}/{total_exp} reps ({100.0 * total_match / total_exp:.1f}%)")
    print(f"Summary saved to        : {summary_path}")
    print("=============================================================")


if __name__ == "__main__":
    main()