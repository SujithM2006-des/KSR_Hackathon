"""
ReHabRep - Rep counter and range judge (works for every exercise).

Feeds on one joint angle per frame and:
  - smooths the angle over the last few frames (trimmed mean: removes spikes + jitter)
  - counts a rep: leaves the rest position past a START threshold,
    comes back past an END threshold
  - judges each rep against the therapist's prescribed range [min, max]
  - raises LIVE cues during the rep (not only after it ends)
  - builds the session summary / adherence report

Direction:
  "up"   (bend / raise): the angle INCREASES during the rep.
         Judged on the HIGHEST angle reached:
             peak < min -> UNDER,  peak > max -> OVER,  otherwise GOOD
  "down" (straighten):   the angle DECREASES during the rep.
         Judged on the LOWEST angle reached:
             best > max -> UNDER (not straight enough), best < min -> OVER

Internally a "down" exercise is handled by flipping the sign of the angle,
so the same state machine is used for every exercise.

Thresholds are placed between the rest position and the target
(gap = distance from rest to the prescribed minimum):
    start = rest + max(8, 45% of the gap)   (never closer than 3 deg to the target)
    end   = rest + max(5, 20% of the gap)
so a shallow rep that gets about half-way is still counted (as UNDER).

Plan followed (based on CORRECT reps vs prescribed reps):
    YES    -> at least 80% of prescribed reps were correct
    PARTLY -> at least 40% of prescribed reps were correct
    NO     -> less than 40%
"""

from collections import deque

SMOOTH_WINDOW = 5  # frames averaged for smoothing
MIN_REP_SECONDS = 0.5  # shorter "reps" are treated as noise
FOLLOWED_YES_PCT = 0.80  # correct reps / prescribed reps for "YES"
FOLLOWED_PARTLY_PCT = 0.40  # correct reps / prescribed reps for "PARTLY"
TURN_BACK_DEG = 8.0  # movement back from the peak that means "patient is returning"
LOST_TIMEOUT = 1.0  # seconds without a valid angle before the rep is cancelled
START_MIN_DEG = 8.0  # start threshold is at least this far from rest
END_MIN_DEG = 5.0  # end threshold is at least this far from rest
START_FRACTION = 0.45  # start threshold = this fraction of the rest->target gap
END_FRACTION = 0.20  # end threshold = this fraction of the rest->target gap

GOOD, UNDER, OVER = "GOOD", "UNDER", "OVER"


class RepCounter:
    def __init__(
        self,
        min_angle,
        max_angle,
        direction="up",
        rest_angle=None,
        cue_under="Bend a little more",
        cue_over="Don't go that far",
    ):
        if min_angle >= max_angle:
            raise ValueError("min_angle must be smaller than max_angle")
        if direction not in ("up", "down"):
            raise ValueError("direction must be 'up' or 'down'")

        self.min_angle = float(min_angle)
        self.max_angle = float(max_angle)
        self.direction = direction
        self._sign = 1.0 if direction == "up" else -1.0

        if rest_angle is None:
            rest_angle = 10.0 if direction == "up" else 90.0
        self.rest_angle = float(rest_angle)

        self.cue_text = {GOOD: "Good rep!", UNDER: cue_under, OVER: cue_over}
        self.rep_end_text = {GOOD: "Good rep!", UNDER: cue_under, OVER: cue_over}

        # ---- internal space: value always INCREASES with effort ----
        if direction == "up":
            self._lo, self._hi = self.min_angle, self.max_angle
        else:
            self._lo, self._hi = -self.max_angle, -self.min_angle
        rest_i = self._sign * self.rest_angle

        gap = max(self._lo - rest_i, 10.0)
        start_i = rest_i + max(START_MIN_DEG, START_FRACTION * gap)
        end_i = rest_i + max(END_MIN_DEG, END_FRACTION * gap)
        start_i = min(start_i, self._lo - 3.0)  # a rep that reaches the target is always counted
        end_i = min(end_i, start_i - 4.0)

        self._start_i = start_i
        self._end_i = end_i
        # Real-angle versions (for display / debugging)
        self.start_threshold = self._sign * start_i
        self.rest_threshold = self._sign * end_i

        self._window = deque(maxlen=SMOOTH_WINDOW)
        self.smoothed = None
        self.state = "REST"
        self.reps = []

        self._peak_i = 0.0
        self._rep_start = None
        self._last_seen = None
        self._warned_over = False
        self._warned_under = False
        self._first_time = None
        self._last_time = None

    # ------------------------------------------------------------------
    def _reset_tracking(self):
        self._window.clear()
        self.smoothed = None
        self.state = "REST"
        self._peak_i = 0.0
        self._rep_start = None

    def _judge_i(self, peak_i):
        if peak_i < self._lo:
            return UNDER
        if peak_i > self._hi:
            return OVER
        return GOOD

    def zone(self, angle):
        """Where the current (real) angle sits relative to the range, for UI colours."""
        if angle is None:
            return None
        return self._judge_i(self._sign * angle)

    # ------------------------------------------------------------------
    def update(self, angle, t):
        """
        angle: real joint angle in degrees, or None if the joint isn't visible
        t:     time in seconds
        Returns a list of event dicts:
            {"type": "OVER_LIVE" | "UNDER_LIVE" | "LOST" | "REP", "message": str, "rep": dict|None}
        """
        events = []
        if self._first_time is None:
            self._first_time = t
        self._last_time = t

        if angle is None:
            if self._last_seen is not None and t - self._last_seen > LOST_TIMEOUT:
                if self.state == "IN_REP":
                    events.append(
                        {"type": "LOST", "message": "Tracking lost - rep not counted", "rep": None}
                    )
                self._reset_tracking()
                self._last_seen = None
            return events

        self._last_seen = t
        self._window.append(float(angle))
        # Median of the last frames removes single-frame keypoint spikes,
        # then a mean over the middle values smooths the remaining jitter.
        ordered = sorted(self._window)
        n = len(ordered)
        middle = ordered[1:-1] if n >= 5 else ordered
        s = sum(middle) / len(middle)
        self.smoothed = s
        s_i = self._sign * s

        if self.state == "REST":
            if s_i >= self._start_i:
                self.state = "IN_REP"
                self._peak_i = s_i
                self._rep_start = t
                self._warned_over = False
                self._warned_under = False
            return events

        # ---- IN_REP ----
        if s_i > self._peak_i:
            self._peak_i = s_i

        # Live safety cue: gone past the prescribed limit
        if s_i > self._hi and not self._warned_over:
            self._warned_over = True
            events.append({"type": "OVER_LIVE", "message": self.cue_text[OVER], "rep": None})

        # Live cue: patient is returning without reaching the target
        if (
            not self._warned_under
            and not self._warned_over
            and self._peak_i < self._lo
            and self._peak_i - s_i >= TURN_BACK_DEG
        ):
            self._warned_under = True
            events.append({"type": "UNDER_LIVE", "message": self.cue_text[UNDER], "rep": None})

        # Rep finished
        if s_i <= self._end_i:
            duration = t - self._rep_start
            self.state = "REST"
            if duration >= MIN_REP_SECONDS:
                result = self._judge_i(self._peak_i)
                rep = {
                    "rep_number": len(self.reps) + 1,
                    "peak_angle": round(self._sign * self._peak_i, 1),  # real angle at the best point
                    "result": result,
                    "duration_s": round(duration, 2),
                    "time_s": round(t, 2),
                }
                self.reps.append(rep)
                events.append({"type": "REP", "message": self.rep_end_text[result], "rep": rep})

        return events

    # ------------------------------------------------------------------
    def counts(self):
        good = sum(1 for r in self.reps if r["result"] == GOOD)
        under = sum(1 for r in self.reps if r["result"] == UNDER)
        over = sum(1 for r in self.reps if r["result"] == OVER)
        return good, under, over

    def summary(self, prescribed_reps):
        """
        Note: "max_angle" is the BEST angle reached in the session
        (highest for "up" exercises, lowest for "down" exercises).
        """
        good, under, over = self.counts()
        done = len(self.reps)
        peaks = [r["peak_angle"] for r in self.reps]

        if prescribed_reps > 0 and good >= FOLLOWED_YES_PCT * prescribed_reps:
            followed = "YES"
        elif prescribed_reps > 0 and good >= FOLLOWED_PARTLY_PCT * prescribed_reps:
            followed = "PARTLY"
        else:
            followed = "NO"

        duration = 0.0
        if self._first_time is not None and self._last_time is not None:
            duration = self._last_time - self._first_time

        if peaks:
            best = max(peaks) if self.direction == "up" else min(peaks)
        else:
            best = None

        return {
            "prescribed_reps": prescribed_reps,
            "reps_done": done,
            "good_reps": good,
            "under_reps": under,
            "over_reps": over,
            "accuracy_pct": round(100.0 * good / done, 1) if done else 0.0,
            "completion_pct": round(min(100.0, 100.0 * done / prescribed_reps), 1)
            if prescribed_reps
            else 0.0,
            "adherence_pct": round(min(100.0, 100.0 * good / prescribed_reps), 1)
            if prescribed_reps
            else 0.0,
            "max_angle": best,
            "avg_peak_angle": round(sum(peaks) / len(peaks), 1) if peaks else None,
            "duration_s": round(duration, 1),
            "plan_followed": followed,
        }