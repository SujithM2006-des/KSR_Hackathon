import argparse
import csv
import ctypes
import math
import os

import cv2
import numpy as np
from ultralytics import YOLO

MODEL_PATH = "yolo11n-pose.pt"
KP_CONF = 0.50  # same keypoint confidence threshold as AthleteGuard
PROCESS_MAX_SIDE = 1280  # frames are scaled so the longest side is at most this
SCREEN_FILL = 0.85  # window uses at most 85% of screen width/height
EDGE_MARGIN = 8  # keypoints within this many px of the frame edge are ignored
WINDOW_NAME = "ReHabRep - Angle Test"

# COCO keypoint indices
NOSE, LEFT_EYE, RIGHT_EYE, LEFT_EAR, RIGHT_EAR = 0, 1, 2, 3, 4
LEFT_SHOULDER, RIGHT_SHOULDER = 5, 6
LEFT_ELBOW, RIGHT_ELBOW = 7, 8
LEFT_WRIST, RIGHT_WRIST = 9, 10
LEFT_HIP, LEFT_KNEE, LEFT_ANKLE = 11, 13, 15
RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE = 12, 14, 16

# Face keypoints are combined into ONE head point (never drawn individually)
FACE_KEYPOINTS = [NOSE, LEFT_EYE, RIGHT_EYE, LEFT_EAR, RIGHT_EAR]

# Only body keypoints are drawn as individual points
BODY_KEYPOINTS = list(range(5, 17))

# Skeleton lines between body keypoints
# (shoulder-to-shoulder is replaced by neck -> each shoulder)
BODY_SKELETON = [
    (LEFT_SHOULDER, LEFT_ELBOW),
    (LEFT_ELBOW, LEFT_WRIST),
    (RIGHT_SHOULDER, RIGHT_ELBOW),
    (RIGHT_ELBOW, RIGHT_WRIST),
    (LEFT_SHOULDER, LEFT_HIP),
    (RIGHT_SHOULDER, RIGHT_HIP),
    (LEFT_HIP, RIGHT_HIP),
    (LEFT_HIP, LEFT_KNEE),
    (LEFT_KNEE, LEFT_ANKLE),
    (RIGHT_HIP, RIGHT_KNEE),
    (RIGHT_KNEE, RIGHT_ANKLE),
]

# Colours (BGR)
BOX_COLOR = (255, 200, 0)
LINE_COLOR = (255, 255, 255)
POINT_COLOR = (0, 200, 255)
HEAD_COLOR = (255, 0, 255)
NECK_COLOR = (255, 0, 255)
ACTIVE_COLOR = (0, 255, 0)
KNEE_COLOR = (0, 0, 255)
WARN_COLOR = (0, 0, 255)
INFO_COLOR = (255, 255, 0)


def parse_args():
    parser = argparse.ArgumentParser(description="ReHabRep knee angle test")
    parser.add_argument(
        "--source",
        default="0",
        help="Webcam index (e.g. 0) or path to a video file",
    )
    parser.add_argument(
        "--save",
        default=None,
        help="Optional path to save the annotated video (e.g. output\\result.mp4)",
    )
    parser.add_argument(
        "--csv",
        default=None,
        help="Optional path to save per-frame angles (e.g. output\\angles.csv)",
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Screen / window helpers
# ---------------------------------------------------------------------------
def get_screen_size():
    """Return (width, height) of the main screen in pixels."""
    try:
        user32 = ctypes.windll.user32
        user32.SetProcessDPIAware()
        return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
    except Exception:
        return 1366, 768


def resize_to_max_side(frame, max_side):
    """Scale frame down so its longest side is at most max_side."""
    h, w = frame.shape[:2]
    longest = max(h, w)
    if longest <= max_side:
        return frame
    scale = max_side / longest
    return cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


def fit_to_screen(w, h, screen_w, screen_h):
    """Display size that fits inside SCREEN_FILL of the screen (never upscales)."""
    scale = min(screen_w * SCREEN_FILL / w, screen_h * SCREEN_FILL / h, 1.0)
    return int(w * scale), int(h * scale)


def setup_window(display_w, display_h, screen_w, screen_h):
    """Create the window and centre it on the screen."""
    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_AUTOSIZE)
    x = max(0, (screen_w - display_w) // 2)
    y = max(0, (screen_h - display_h) // 2 - 30)  # small lift for title bar/taskbar
    cv2.moveWindow(WINDOW_NAME, x, y)


# ---------------------------------------------------------------------------
# Pose helpers
# ---------------------------------------------------------------------------
def joint_angle(a, b, c):
    """Interior angle at point b (in degrees) formed by a-b-c."""
    ang = math.degrees(
        math.atan2(c[1] - b[1], c[0] - b[0]) - math.atan2(a[1] - b[1], a[0] - b[0])
    )
    ang = abs(ang)
    if ang > 180:
        ang = 360 - ang
    return ang


def is_visible(xy, conf, i, frame_w, frame_h):
    """Keypoint is usable only if confident AND clearly inside the frame."""
    if conf[i] < KP_CONF:
        return False
    x, y = xy[i]
    return (
        EDGE_MARGIN <= x <= frame_w - EDGE_MARGIN
        and EDGE_MARGIN <= y <= frame_h - EDGE_MARGIN
    )


def pick_leg(xy, conf, frame_w, frame_h):
    """Choose the leg (left/right) whose hip, knee and ankle are all visible."""
    left = [LEFT_HIP, LEFT_KNEE, LEFT_ANKLE]
    right = [RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE]

    left_ok = all(is_visible(xy, conf, i, frame_w, frame_h) for i in left)
    right_ok = all(is_visible(xy, conf, i, frame_w, frame_h) for i in right)

    if not left_ok and not right_ok:
        return None, None
    if left_ok and right_ok:
        left_score = min(conf[i] for i in left)
        right_score = min(conf[i] for i in right)
        return ("LEFT", left) if left_score >= right_score else ("RIGHT", right)
    return ("LEFT", left) if left_ok else ("RIGHT", right)


def head_point(xy, conf, frame_w, frame_h):
    """Single head point = average of visible face keypoints."""
    visible = [
        xy[i] for i in FACE_KEYPOINTS if is_visible(xy, conf, i, frame_w, frame_h)
    ]
    if not visible:
        return None
    return np.mean(visible, axis=0)


def neck_point(xy, conf, frame_w, frame_h):
    """Neck point = midpoint between the two shoulders."""
    if is_visible(xy, conf, LEFT_SHOULDER, frame_w, frame_h) and is_visible(
        xy, conf, RIGHT_SHOULDER, frame_w, frame_h
    ):
        return (xy[LEFT_SHOULDER] + xy[RIGHT_SHOULDER]) / 2.0
    return None


def pt(p):
    return int(p[0]), int(p[1])


def draw_body(frame, xy, conf):
    """Draw body skeleton plus single head and neck points (no face points)."""
    frame_h, frame_w = frame.shape[:2]
    head = head_point(xy, conf, frame_w, frame_h)
    neck = neck_point(xy, conf, frame_w, frame_h)

    def vis(i):
        return is_visible(xy, conf, i, frame_w, frame_h)

    for a, b in BODY_SKELETON:
        if vis(a) and vis(b):
            cv2.line(frame, pt(xy[a]), pt(xy[b]), LINE_COLOR, 2)

    if neck is not None:
        cv2.line(frame, pt(neck), pt(xy[LEFT_SHOULDER]), LINE_COLOR, 2)
        cv2.line(frame, pt(neck), pt(xy[RIGHT_SHOULDER]), LINE_COLOR, 2)
        if head is not None:
            cv2.line(frame, pt(head), pt(neck), LINE_COLOR, 2)

    for i in BODY_KEYPOINTS:
        if vis(i):
            cv2.circle(frame, pt(xy[i]), 5, POINT_COLOR, -1)

    if neck is not None:
        cv2.circle(frame, pt(neck), 6, NECK_COLOR, -1)
    if head is not None:
        cv2.circle(frame, pt(head), 9, HEAD_COLOR, -1)


def draw_active_leg(frame, hip, knee, ankle):
    """Highlight the leg being measured."""
    cv2.line(frame, pt(hip), pt(knee), ACTIVE_COLOR, 4)
    cv2.line(frame, pt(knee), pt(ankle), ACTIVE_COLOR, 4)
    cv2.circle(frame, pt(hip), 7, ACTIVE_COLOR, -1)
    cv2.circle(frame, pt(ankle), 7, ACTIVE_COLOR, -1)
    cv2.circle(frame, pt(knee), 9, KNEE_COLOR, -1)


def draw_text(frame, text, org, scale, color):
    """Text with a dark outline so it stays readable on any background."""
    cv2.putText(frame, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), 5)
    cv2.putText(frame, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, color, 2)


# ---------------------------------------------------------------------------
# Source / file helpers
# ---------------------------------------------------------------------------
def open_source(source):
    """Open webcam (if source is a number) or a video file."""
    if source.isdigit():
        return cv2.VideoCapture(int(source)), False
    if not os.path.isfile(source):
        print(f"Video file not found: {source}")
        return None, True
    return cv2.VideoCapture(source), True


def make_dirs_for(path):
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
def main():
    args = parse_args()

    cap, is_video = open_source(args.source)
    if cap is None or not cap.isOpened():
        print("Could not open the source.")
        return

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 1:
        fps = 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) if is_video else 0

    screen_w, screen_h = get_screen_size()
    model = YOLO(MODEL_PATH)

    writer = None
    csv_file = None
    csv_writer = None
    if args.csv:
        make_dirs_for(args.csv)
        csv_file = open(args.csv, "w", newline="")
        csv_writer = csv.writer(csv_file)
        csv_writer.writerow(["frame", "time_s", "side", "knee_flexion_deg"])

    frame_no = 0
    paused = False
    annotated = None
    display_size = None

    try:
        while True:
            if not paused:
                ok, frame = cap.read()
                if not ok:
                    if is_video:
                        print("End of video.")
                    break

                frame = resize_to_max_side(frame, PROCESS_MAX_SIDE)
                frame_h, frame_w = frame.shape[:2]

                frame_no += 1
                time_s = frame_no / fps

                result = model(frame, verbose=False)[0]
                annotated = frame.copy()

                side = None
                flexion = None

                if result.boxes is not None and len(result.boxes) > 0:
                    for box in result.boxes.xyxy.cpu().numpy():
                        x1, y1, x2, y2 = (int(v) for v in box)
                        cv2.rectangle(annotated, (x1, y1), (x2, y2), BOX_COLOR, 2)

                if (
                    result.keypoints is not None
                    and len(result.keypoints) > 0
                    and result.keypoints.conf is not None
                ):
                    all_xy = result.keypoints.xy.cpu().numpy()
                    all_conf = result.keypoints.conf.cpu().numpy()

                    for person_xy, person_conf in zip(all_xy, all_conf):
                        draw_body(annotated, person_xy, person_conf)

                    xy = all_xy[0]
                    conf = all_conf[0]

                    side, idx = pick_leg(xy, conf, frame_w, frame_h)
                    if side:
                        hip, knee, ankle = (xy[i] for i in idx)
                        interior = joint_angle(hip, knee, ankle)
                        flexion = 180 - interior

                        draw_active_leg(annotated, hip, knee, ankle)
                        draw_text(
                            annotated,
                            f"{side} knee flexion: {flexion:.0f} deg",
                            (20, 40),
                            1.0,
                            ACTIVE_COLOR,
                        )

                if side is None:
                    draw_text(
                        annotated,
                        "Leg not clearly visible - step back / turn sideways",
                        (20, 40),
                        0.7,
                        WARN_COLOR,
                    )

                info = f"Frame {frame_no}"
                if total_frames:
                    info += f"/{total_frames}"
                info += f"  |  {time_s:.2f}s"
                draw_text(annotated, info, (20, frame_h - 20), 0.6, INFO_COLOR)

                if csv_writer:
                    csv_writer.writerow(
                        [
                            frame_no,
                            f"{time_s:.3f}",
                            side or "",
                            f"{flexion:.1f}" if flexion is not None else "",
                        ]
                    )

                if args.save:
                    if writer is None:
                        make_dirs_for(args.save)
                        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                        writer = cv2.VideoWriter(
                            args.save, fourcc, fps, (frame_w, frame_h)
                        )
                    writer.write(annotated)

                # First frame: size and centre the window to fit the screen
                if display_size is None:
                    display_size = fit_to_screen(frame_w, frame_h, screen_w, screen_h)
                    setup_window(display_size[0], display_size[1], screen_w, screen_h)

            if annotated is not None and display_size is not None:
                display = cv2.resize(annotated, display_size, interpolation=cv2.INTER_AREA)
                if paused:
                    draw_text(
                        display,
                        "PAUSED (space to resume)",
                        (20, 80),
                        0.8,
                        INFO_COLOR,
                    )
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
        if csv_file:
            csv_file.close()
            print(f"Angle log saved to: {args.csv}")
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()