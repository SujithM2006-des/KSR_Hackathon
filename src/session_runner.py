"""
ReHabRep - Exercise session runner.

Camera / video -> YOLO11 Pose -> joint angle (any exercise in exercises.py)
-> rep counter -> range judge
-> live on-screen + spoken cues -> session report for the therapist.

Display:
  default        an OpenCV window on this computer (Q = quit, space = pause)
  --stream-port  no window: the web page shows the video (MJPEG) and live numbers instead;
                 --stream-token must be sent with every request (?t=...)

Plan source:
  --plan-id N   load the therapist's plan from the database and SAVE the
                session + every rep back to the database (normal use)
  no --plan-id  use --min/--max/--sets/--reps from the command line and
                only write the JSON report (quick testing)
"""

import argparse
import json
import os
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import cv2
from ultralytics import YOLO

from exercises import ALIASES, EXERCISES, get_exercise, load_custom_exercises, measure, resolve_exercise
from pose_angle_test import (
    MODEL_PATH,
    PROCESS_MAX_SIDE,
    draw_active_leg,
    draw_body,
    fit_to_screen,
    get_screen_size,
    make_dirs_for,
    open_source,
    resize_to_max_side,
)
from rep_counter import GOOD, OVER, UNDER, RepCounter
from voice import VoiceCoach

WINDOW_NAME = "ReHabRep - Session"
FONT = cv2.FONT_HERSHEY_SIMPLEX
CUE_SECONDS = 1.5  # how long a cue stays on screen
GAUGE_MAX = 180  # top of the angle gauge (degrees)
STREAM_MAX_WIDTH = 960  # frames sent to the web page are scaled down to this width
FINISH_AFTER_DONE_S = 2.5  # web mode: end this long after the last prescribed rep

# Colours (BGR)
WHITE = (255, 255, 255)
GREEN = (0, 220, 0)
ORANGE = (0, 165, 255)
RED = (0, 0, 255)
GREY = (180, 180, 180)
CYAN = (255, 255, 0)

RESULT_COLOR = {GOOD: GREEN, UNDER: ORANGE, OVER: RED}


def parse_args():
    p = argparse.ArgumentParser(description="ReHabRep exercise session")
    p.add_argument("--source", default="0", help="Webcam index (e.g. 0) or video file path")
    p.add_argument(
        "--exercise",
        default="mini_squat",
        choices=list(EXERCISES.keys()) + list(ALIASES.keys()),
        help="Exercise key from exercises.py",
    )
    p.add_argument("--min", type=float, default=None, help="Prescribed minimum angle (default: exercise default)")
    p.add_argument("--max", type=float, default=None, help="Prescribed maximum angle (default: exercise default)")
    p.add_argument("--sets", type=int, default=3, help="Number of sets")
    p.add_argument("--reps", type=int, default=10, help="Reps per set")
    p.add_argument("--patient", default="Demo Patient", help="Patient name for the report")
    p.add_argument("--save", default=None, help="Optional annotated video output path")
    p.add_argument(
        "--report",
        default=None,
        help="Session report path (JSON). Default: output\\reports\\session_<date>_<time>.json",
    )
    p.add_argument("--mute", action="store_true", help="Turn off spoken cues")
    p.add_argument("--plan-id", type=int, default=None, help="Load plan from DB and save the session to DB")
    p.add_argument("--pain", type=int, default=None, help="Pain score 0-10 (asked at the end if not given)")
    p.add_argument("--model", default=MODEL_PATH, help="Pose model, e.g. yolo11s-pose.pt for higher accuracy")
    p.add_argument("--stream-port", type=int, default=None, help="Show the session in the web page instead of a window")
    p.add_argument("--stream-token", default="", help="Secret the web page must send to watch / stop the session")
    p.add_argument("--stream-host", default="127.0.0.1", help="Address the stream listens on")
    return p.parse_args()


class LiveStream:
    """Serves the annotated frames (MJPEG) and the live numbers to the web page instead of a desktop window."""

    def __init__(self, host, port, token):
        self.token = token
        self.lock = threading.Lock()
        self.jpeg = None
        self.status = {"phase": "loading"}
        self.stop = threading.Event()
        self.closed = threading.Event()
        live = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _start(self, content_type):
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

            def do_GET(self):
                url = urlparse(self.path)
                if parse_qs(url.query).get("t", [""])[0] != live.token:
                    self.send_error(403)
                    return
                if url.path == "/status":
                    with live.lock:
                        body = json.dumps(live.status).encode()
                    self._start("application/json")
                    self.wfile.write(body)
                elif url.path == "/stop":
                    live.stop.set()
                    self._start("application/json")
                    self.wfile.write(b'{"stopping": true}')
                elif url.path == "/stream":
                    self._start("multipart/x-mixed-replace; boundary=frame")
                    last = None
                    try:
                        while not live.closed.is_set():
                            with live.lock:
                                jpg = live.jpeg
                            if jpg is not None and jpg is not last:
                                head = b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(jpg)
                                self.wfile.write(head + jpg + b"\r\n")
                                last = jpg
                            time.sleep(0.03)
                    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                        pass
                else:
                    self.send_error(404)

        self.server = ThreadingHTTPServer((host, port), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def frame(self, image):
        h, w = image.shape[:2]
        if w > STREAM_MAX_WIDTH:
            image = cv2.resize(image, (STREAM_MAX_WIDTH, int(h * STREAM_MAX_WIDTH / w)), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 75])
        if ok:
            with self.lock:
                self.jpeg = buf.tobytes()

    def update(self, **values):
        with self.lock:
            self.status.update(values)

    def close(self, linger_s=1.5):
        time.sleep(linger_s)  # let the page read the final status
        self.closed.set()
        self.server.shutdown()
        self.server.server_close()


def load_plan_from_db(args):
    """Fill args (exercise, range, sets, reps, patient) from the DB plan. Returns the plan."""
    from crud import get_plan
    from database import SessionLocal, init_db

    init_db()
    db = SessionLocal()
    try:
        load_custom_exercises(db)  # the plan may use a therapist-added exercise
        plan = get_plan(db, args.plan_id)
        if plan is None:
            return None
        args.exercise = resolve_exercise(plan.exercise_type) or "mini_squat"
        args.min = plan.min_angle
        args.max = plan.max_angle
        args.sets = plan.sets
        args.reps = plan.reps_per_set
        args.patient = plan.patient.user.name
        return plan
    finally:
        db.close()


def ask_pain_score():
    """Simple patient check-in in the terminal (Enter = skip)."""
    while True:
        try:
            value = input("How much pain did you feel? 0 (none) - 10 (worst), Enter to skip: ").strip()
        except EOFError:
            return None
        if value == "":
            return None
        if value.isdigit() and 0 <= int(value) <= 10:
            return int(value)
        print("Please type a number from 0 to 10.")


def save_to_db(plan_id, counter, prescribed, source, pain_score):
    from crud import get_plan, save_session
    from database import SessionLocal

    db = SessionLocal()
    try:
        plan = get_plan(db, plan_id)
        session = save_session(
            db,
            plan,
            counter.summary(prescribed),
            counter.reps,
            source=source,
            pain_score=pain_score,
        )
        return session.id
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------
def ui_scale(frame):
    return max(0.6, frame.shape[0] / 720.0)


def draw_panel(frame, lines, scale):
    """Semi-transparent info panel in the top-left corner (width fits the longest line)."""
    x, y = 15, 15
    line_h = int(34 * scale)
    thick = max(1, int(2 * scale))
    text_w = max(cv2.getTextSize(text, FONT, 0.72 * scale, thick)[0][0] for text, _ in lines)
    width = text_w + int(24 * scale)
    height = line_h * len(lines) + int(14 * scale)

    overlay = frame.copy()
    cv2.rectangle(overlay, (x, y), (x + width, y + height), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)

    for i, (text, color) in enumerate(lines):
        cv2.putText(
            frame,
            text,
            (x + int(12 * scale), y + line_h * (i + 1)),
            FONT,
            0.72 * scale,
            color,
            thick,
        )


def draw_gauge(frame, angle, min_a, max_a, zone, scale):
    """Vertical angle gauge on the right with the prescribed range in green."""
    h, w = frame.shape[:2]
    bar_w = int(28 * scale)
    gx = w - bar_w - int(30 * scale)
    top = int(70 * scale)
    bottom = h - int(110 * scale)

    def ay(a):
        a = max(0.0, min(float(GAUGE_MAX), a))
        return int(bottom - (bottom - top) * a / GAUGE_MAX)

    cv2.rectangle(frame, (gx, top), (gx + bar_w, bottom), (60, 60, 60), -1)
    cv2.rectangle(frame, (gx, ay(max_a)), (gx + bar_w, ay(min_a)), (0, 140, 0), -1)
    cv2.rectangle(frame, (gx, top), (gx + bar_w, bottom), WHITE, 1)

    fs = 0.5 * scale
    thick = max(1, int(scale))
    for val in (min_a, max_a):
        label = f"{val:.0f}"
        (tw, _), _ = cv2.getTextSize(label, FONT, fs, thick)
        cv2.putText(frame, label, (gx - tw - 6, ay(val) + 5), FONT, fs, WHITE, thick)

    if angle is not None:
        color = RESULT_COLOR.get(zone, WHITE)
        y = ay(angle)
        cv2.line(frame, (gx - int(8 * scale), y), (gx + bar_w + int(8 * scale), y), color, max(2, int(4 * scale)))

    title = "ANGLE"
    (tw, _), _ = cv2.getTextSize(title, FONT, fs, thick)
    cv2.putText(frame, title, (gx + bar_w // 2 - tw // 2, top - 10), FONT, fs, WHITE, thick)


def draw_cue(frame, text, color, scale):
    """Big cue banner at the bottom centre."""
    h, w = frame.shape[:2]
    fs = 1.2 * scale
    thick = max(2, int(3 * scale))
    (tw, th), _ = cv2.getTextSize(text, FONT, fs, thick)
    x = max(10, (w - tw) // 2)
    y = h - int(45 * scale)
    pad = int(14 * scale)

    overlay = frame.copy()
    cv2.rectangle(overlay, (x - pad, y - th - pad), (x + tw + pad, y + pad), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)
    cv2.putText(frame, text, (x, y), FONT, fs, color, thick)


def setup_window(display_w, display_h, screen_w, screen_h):
    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_AUTOSIZE)
    x = max(0, (screen_w - display_w) // 2)
    y = max(0, (screen_h - display_h) // 2 - 30)
    cv2.moveWindow(WINDOW_NAME, x, y)


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def build_report(args, ex, counter, prescribed, pain_score=None, session_id=None):
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "session_id": session_id,
        "patient": args.patient,
        "pain_score": pain_score,
        "source": args.source,
        "plan": {
            "exercise_key": args.exercise,
            "exercise": ex["name"],
            "measure": ex["measure"],
            "sets": args.sets,
            "reps_per_set": args.reps,
            "prescribed_reps": prescribed,
            "min_angle": args.min,
            "max_angle": args.max,
        },
        "summary": counter.summary(prescribed),
        "reps": counter.reps,
        "disclaimer": "Exercise aid only. Not a diagnosis. Follow your physiotherapist's advice.",
    }


def print_report(report):
    s = report["summary"]
    p = report["plan"]
    print("\n================ ReHabRep SESSION REPORT ================")
    print(f"Patient      : {report['patient']}")
    print(f"Exercise     : {p['exercise']}  |  Range {p['min_angle']:.0f}-{p['max_angle']:.0f} deg")
    print(f"Plan         : {p['sets']} sets x {p['reps_per_set']} reps = {p['prescribed_reps']} reps")
    print(f"Reps done    : {s['reps_done']} / {s['prescribed_reps']}  ({s['completion_pct']}%)")
    print(f"Correct reps : {s['good_reps']}  (accuracy {s['accuracy_pct']}%)")
    print(f"Under / Over : {s['under_reps']} / {s['over_reps']}")
    print(f"Best angle   : {s['max_angle']}  |  Avg per rep: {s['avg_peak_angle']}")
    print(f"Plan followed: {s['plan_followed']}  (adherence {s['adherence_pct']}%)")
    if report.get("pain_score") is not None:
        flag = "  <-- HIGH, therapist alerted" if report["pain_score"] >= 7 else ""
        print(f"Pain score   : {report['pain_score']}/10{flag}")
    print("----------------------------------------------------------")
    for r in report["reps"]:
        print(f"  Rep {r['rep_number']:>2}: peak {r['peak_angle']:>6.1f} deg  ->  {r['result']}")
    print("==========================================================\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    args = parse_args()
    live = LiveStream(args.stream_host, args.stream_port, args.stream_token) if args.stream_port else None
    try:
        run(args, live)
    finally:
        if live:
            live.close()


def run(args, live):
    if args.plan_id is not None:
        plan = load_plan_from_db(args)
        if plan is None:
            print(f"Plan {args.plan_id} not found. Run: python src\\seed.py")
            return

    args.exercise = resolve_exercise(args.exercise)
    ex = get_exercise(args.exercise)
    if args.min is None:
        args.min = float(ex["default_min"])
    if args.max is None:
        args.max = float(ex["default_max"])
    if args.min >= args.max:
        print("--min must be smaller than --max")
        return
    if args.plan_id is not None:
        print(
            f"Loaded plan {args.plan_id} for {args.patient}: {ex['name']}, "
            f"{args.sets}x{args.reps}, {args.min:.0f}-{args.max:.0f} deg"
        )
    else:
        print(f"Exercise: {ex['name']} | range {args.min:.0f}-{args.max:.0f} deg | camera: {ex['view']} view")

    prescribed = args.sets * args.reps
    say_rep = {GOOD: "Good", UNDER: ex["say_under"], OVER: ex["say_over"]}

    cap, is_video = open_source(args.source)
    if cap is None or not cap.isOpened():
        print("Could not open the source.")
        if live:
            live.update(phase="error", message="Could not open the camera. Close other apps using it and try again.")
            time.sleep(3)
        return

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 1:
        fps = 30.0

    counter = RepCounter(
        args.min,
        args.max,
        direction=ex["direction"],
        rest_angle=ex["rest_angle"],
        cue_under=ex["cue_under"],
        cue_over=ex["cue_over"],
    )
    voice = VoiceCoach(enabled=not args.mute)
    model = YOLO(args.model)
    screen_w, screen_h = get_screen_size()

    writer = None
    display_size = None
    annotated = None
    paused = False
    frame_no = 0
    start_wall = time.perf_counter()

    view_text = "side-on" if ex["view"] == "side" else "facing the camera"
    cue_text, cue_color, cue_until = f"Get ready - {view_text}", CYAN, time.perf_counter() + 3.0
    session_done = False
    done_at = None
    voice.say("Get ready. " + ex["instructions"])
    if live:
        live.update(phase="running", exercise=ex["name"], sets=args.sets, reps=args.reps, prescribed=prescribed,
                    min=args.min, max=args.max, joint=ex["joint"])

    def show_cue(text, color, spoken=None):
        """Show a cue on screen and speak it (spoken text can be shorter)."""
        nonlocal cue_text, cue_color, cue_until
        cue_text, cue_color = text, color
        cue_until = time.perf_counter() + CUE_SECONDS
        voice.say(spoken if spoken is not None else text)
        print(f"[CUE] {text}")

    try:
        while True:
            if live and live.stop.is_set():
                print("Stopped from the web page.")
                break
            if live and done_at and time.perf_counter() - done_at > FINISH_AFTER_DONE_S:
                break
            if not paused:
                ok, frame = cap.read()
                if not ok and is_video and frame_no > 0 and not session_done:
                    # test video: start again so short clips can fill the whole session
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    ok, frame = cap.read()
                if not ok:
                    if is_video:
                        print("End of video.")
                    break

                frame = resize_to_max_side(frame, PROCESS_MAX_SIDE)
                frame_h, frame_w = frame.shape[:2]
                frame_no += 1
                t = frame_no / fps if is_video else time.perf_counter() - start_wall

                result = model(frame, verbose=False)[0]
                annotated = frame.copy()
                scale = ui_scale(annotated)

                flexion = None
                side = None
                if (
                    result.keypoints is not None
                    and len(result.keypoints) > 0
                    and result.keypoints.conf is not None
                ):
                    xy = result.keypoints.xy[0].cpu().numpy()
                    conf = result.keypoints.conf[0].cpu().numpy()
                    draw_body(annotated, xy, conf)

                    m = measure(args.exercise, xy, conf, frame_w, frame_h)
                    if m is not None:
                        side = m["side"]
                        flexion = m["angle"]
                        draw_active_leg(annotated, *m["points"])

                # ---- rep logic ----
                for ev in counter.update(flexion, t):
                    if ev["type"] == "OVER_LIVE":
                        show_cue(ev["message"], RED)
                    elif ev["type"] == "UNDER_LIVE":
                        show_cue(ev["message"], ORANGE)
                    elif ev["type"] == "LOST":
                        show_cue(ev["message"], GREY, "Please stay in front of the camera")
                    elif ev["type"] == "REP":
                        rep = ev["rep"]
                        show_cue(
                            f"Rep {rep['rep_number']}: {ev['message']}",
                            RESULT_COLOR[rep["result"]],
                            f"{rep['rep_number']}. {say_rep[rep['result']]}",
                        )
                        done = len(counter.reps)
                        if done >= prescribed and not session_done:
                            session_done = True
                            done_at = time.perf_counter()
                            show_cue(
                                "Session complete!" if live else "Session complete! Press Q to finish",
                                CYAN,
                                "Session complete. Well done.",
                            )
                        elif done % args.reps == 0 and done < prescribed:
                            set_done = done // args.reps
                            show_cue(
                                f"Set {set_done} done - take a short rest",
                                CYAN,
                                f"Set {set_done} done. Take a short rest.",
                            )

                # ---- HUD ----
                good, under, over = counter.counts()
                done = len(counter.reps)
                set_no = min(done // args.reps + 1, args.sets)
                rep_in_set = min(done - (set_no - 1) * args.reps, args.reps)
                angle_now = counter.smoothed if flexion is not None else None
                zone = counter.zone(angle_now)

                angle_line = (
                    (f"{side} {ex['joint'].lower()}: {angle_now:.0f} deg", RESULT_COLOR.get(zone, WHITE))
                    if angle_now is not None
                    else (f"{ex['joint']} not visible - adjust camera", RED)
                )
                lines = [
                    (ex["name"], WHITE),
                    (f"Target range: {args.min:.0f}-{args.max:.0f} deg", WHITE),
                    (f"Set {set_no}/{args.sets}   Rep {rep_in_set}/{args.reps}", WHITE),
                    (f"Total reps: {done}/{prescribed}", WHITE),
                    angle_line,
                    (f"Good {good}   Under {under}   Over {over}", WHITE),
                ]
                draw_panel(annotated, lines, scale)
                draw_gauge(annotated, angle_now, args.min, args.max, zone, scale)
                if time.perf_counter() < cue_until:
                    draw_cue(annotated, cue_text, cue_color, scale)

                if args.save:
                    if writer is None:
                        make_dirs_for(args.save)
                        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                        writer = cv2.VideoWriter(args.save, fourcc, fps, (frame_w, frame_h))
                    writer.write(annotated)

                if live:
                    live.frame(annotated)
                    live.update(
                        set_no=set_no, rep_in_set=rep_in_set, done=done, good=good, under=under, over=over,
                        angle=None if angle_now is None else round(angle_now), side=side, zone=zone,
                        cue=cue_text if time.perf_counter() < cue_until else None, complete=session_done,
                    )
                    continue  # web mode: no desktop window

                if display_size is None:
                    display_size = fit_to_screen(frame_w, frame_h, screen_w, screen_h)
                    setup_window(display_size[0], display_size[1], screen_w, screen_h)

            if annotated is not None and display_size is not None:
                display = cv2.resize(annotated, display_size, interpolation=cv2.INTER_AREA)
                if paused:
                    cv2.putText(display, "PAUSED (space to resume)", (20, display.shape[0] // 2), FONT, 0.9, CYAN, 2)
                cv2.imshow(WINDOW_NAME, display)

            key = cv2.waitKey(1 if not paused else 50) & 0xFF
            if key == ord("q"):
                break
            if key == ord(" "):
                paused = not paused

    finally:
        cap.release()
        if writer:
            writer.release()
            print(f"Annotated video saved to: {args.save}")
        cv2.destroyAllWindows()
        voice.close()

        pain_score = args.pain
        if pain_score is None and args.plan_id is not None and counter.reps:
            pain_score = ask_pain_score()

        session_id = None
        if live:
            live.update(phase="saving")
        if args.plan_id is not None:
            try:
                session_id = save_to_db(args.plan_id, counter, prescribed, args.source, pain_score)
                print(f"Session saved to database (session id {session_id})")
            except Exception as exc:
                print(f"[DB] Could not save session: {exc}")

        report = build_report(args, ex, counter, prescribed, pain_score, session_id)
        print_report(report)

        report_path = args.report or os.path.join(
            "output",
            "reports",
            f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
        )
        make_dirs_for(report_path)
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        print(f"Session report saved to: {report_path}")
        if live:
            live.update(phase="finished", session_id=session_id, reps_saved=len(counter.reps))


if __name__ == "__main__":
    main()