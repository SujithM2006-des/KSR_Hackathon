"""
ReHabRep - Voice coach.

Speaks cues with pyttsx3 (offline text-to-speech) in a background thread,
so the camera / video loop never freezes while speaking.

- Only the NEWEST waiting cue is kept: if several cues arrive while one is
  being spoken, the older waiting ones are dropped (no pile-up / lag).
- If pyttsx3 is missing or fails, the app keeps running silently.
"""

import queue
import threading

try:
    import pyttsx3
except ImportError:  # app still works without voice
    pyttsx3 = None


class VoiceCoach:
    def __init__(self, enabled=True, rate=170):
        self.enabled = bool(enabled) and pyttsx3 is not None
        self._queue = queue.Queue()
        self._thread = None

        if enabled and pyttsx3 is None:
            print("[VOICE] pyttsx3 not installed - voice cues disabled (pip install pyttsx3)")

        if self.enabled:
            self._thread = threading.Thread(target=self._run, args=(rate,), daemon=True)
            self._thread.start()

    # ------------------------------------------------------------------
    def say(self, text):
        """Queue a cue. Older cues that haven't started yet are dropped."""
        if not self.enabled or not text:
            return
        try:
            while True:
                self._queue.get_nowait()
        except queue.Empty:
            pass
        self._queue.put(text)

    def close(self, timeout=3.0):
        """Let the current/last cue finish (up to timeout seconds), then stop."""
        if self._thread is not None:
            self._queue.put(None)
            self._thread.join(timeout)
            self._thread = None

    # ------------------------------------------------------------------
    def _run(self, rate):
        # The engine must be created and used inside this same thread
        try:
            engine = pyttsx3.init()
            engine.setProperty("rate", rate)
        except Exception as exc:
            print(f"[VOICE] Could not start text-to-speech: {exc}")
            self.enabled = False
            return

        while True:
            text = self._queue.get()
            if text is None:
                break
            try:
                engine.say(text)
                engine.runAndWait()
            except Exception as exc:
                print(f"[VOICE] Error while speaking: {exc}")

        try:
            engine.stop()
        except Exception:
            pass