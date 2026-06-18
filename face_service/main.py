"""
Portal Face Recognition Service
FastAPI service that handles face enrollment and verification.
Each portal key is associated with a face encoding at purchase time.
During connection, the user's face is verified against the stored encoding.
"""

import os
import json
import base64
import numpy as np
import face_recognition
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
import io

app = FastAPI(title="Portal Face Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Face encodings stored as JSON: { "KEY12345": [[...128 floats...]] }
DATA_FILE = os.environ.get("FACE_DATA_FILE", "face_data/encodings.json")

os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)


def load_encodings() -> dict:
    if not os.path.exists(DATA_FILE):
        return {}
    with open(DATA_FILE, "r") as f:
        return json.load(f)


def save_encodings(data: dict):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f)


def decode_image(image_b64: str) -> np.ndarray:
    """Decode a base64 image string to a numpy RGB array."""
    image_data = base64.b64decode(image_b64.split(",")[-1])  # strip data URI prefix
    image = Image.open(io.BytesIO(image_data)).convert("RGB")
    return np.array(image)


class EnrollRequest(BaseModel):
    portal_key: str
    image_b64: str  # base64-encoded image (data URI or raw)


class VerifyRequest(BaseModel):
    portal_key: str
    image_b64: str


@app.post("/enroll")
def enroll(req: EnrollRequest):
    """
    Store a face encoding for a portal key.
    Called once during key purchase after the transaction confirms.
    """
    try:
        image = decode_image(req.image_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    encodings = face_recognition.face_encodings(image)
    if not encodings:
        raise HTTPException(status_code=422, detail="No face detected in image. Please try again.")

    # Store the first detected face
    data = load_encodings()
    data[req.portal_key] = encodings[0].tolist()
    save_encodings(data)

    return {"status": "enrolled", "portal_key": req.portal_key}


@app.post("/verify")
def verify(req: VerifyRequest):
    """
    Verify a face against the stored encoding for a portal key.
    Returns match: true/false and a confidence score.
    """
    data = load_encodings()

    if req.portal_key not in data:
        return {"match": None, "reason": "no_enrollment", "confidence": None}

    try:
        image = decode_image(req.image_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    live_encodings = face_recognition.face_encodings(image)
    if not live_encodings:
        return {"match": False, "reason": "no_face_detected", "confidence": 0}

    stored = np.array(data[req.portal_key])
    live = live_encodings[0]

    distance = face_recognition.face_distance([stored], live)[0]
    confidence = round(float(1 - distance), 3)
    match = bool(distance < 0.5)  # standard threshold; lower = stricter

    return {
        "match": match,
        "confidence": confidence,
        "reason": "ok" if match else "face_mismatch"
    }


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
