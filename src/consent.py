"""
ReHabRep - Patient consent text (shown on first login) and its version.

Change CONSENT_VERSION whenever the text changes: patients then see the screen again,
and every saved consent record keeps the version it was given for.

DRAFT WORDING for the hackathon - must be reviewed (clinician + legal / DPDP Act 2023)
before real patients use it.
"""

CONSENT_VERSION = "2026-10-v1"

CONSENT_SECTIONS = [
    {
        "title": "What ReHabRep does",
        "text": "ReHabRep helps you do the home exercises your therapist prescribed. It counts repetitions and "
        "estimates joint angles from the camera, and shares the results with your therapist. It does not diagnose "
        "anything and does not replace your therapist's advice.",
    },
    {
        "title": "What we store",
        "text": "Your name and email, the exercises your therapist prescribed, and for each session: the number of "
        "repetitions, estimated angles, how long it took, your pain score and any note you write. All of it is "
        "stored encrypted.",
    },
    {
        "title": "Camera",
        "text": "If you allow the camera, the video is processed on this computer to estimate your movement. "
        "Video is not saved - only the numbers (repetitions and angles) are stored. You can say no to the camera "
        "and still do your exercises: you then confirm them yourself (guided mode).",
    },
    {
        "title": "Who can see your data",
        "text": "Your assigned therapist, and authorised administrators of this service for account and safety "
        "checks. Nobody else.",
    },
    {
        "title": "Your choices",
        "text": "You can stop camera use at any time in Settings. To get a copy of your data or ask for it to be "
        "deleted, contact your therapist or the administrator. Follow your therapist's instructions and contact "
        "them if anything is unclear.",
    },
]

# Safety page content (also shown during sessions). Needs clinician review before release.
EMERGENCY_NUMBER = "112"
RED_FLAGS = [
    "Chest pain or tightness",
    "Fainting, severe dizziness or shortness of breath",
    "Sudden severe pain, or pain that keeps getting worse",
    "New numbness, tingling or weakness",
    "A fall or new injury",
    "New swelling, redness or heat around a wound or joint",
]