"""
Portal Face Recognition Service
Uses face_recognition (dlib) — lightweight, no TensorFlow, ~150MB peak RAM.
"""

import os
import io
import json
import base64
import numpy as np
from PIL import Image
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import face_recognition

app = FastAPI(title="Portal Face Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_FILE = os.environ.get("FACE_DATA_FILE", "face_data/encodings.json")
_data_dir = os.path.dirname(DATA_FILE)
if _data_dir:
    os.makedirs(_data_dir, exist_ok=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_encodings() -> dict:
    if not os.path.exists(DATA_FILE):
        return {}
    with open(DATA_FILE, "r") as f:
        return json.load(f)


def save_encodings(data: dict):
    if _data_dir:
        os.makedirs(_data_dir, exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(data, f)


def decode_image(image_b64: str) -> np.ndarray:
    raw = base64.b64decode(image_b64.split(",")[-1])
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    return np.array(image)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

class EnrollRequest(BaseModel):
    portal_key: str
    image_b64: str


class VerifyRequest(BaseModel):
    portal_key: str
    image_b64: str


class DetectRequest(BaseModel):
    image_b64: str


@app.post("/enroll")
def enroll(req: EnrollRequest):
    try:
        image = decode_image(req.image_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    locations = face_recognition.face_locations(image, model="hog")
    if not locations:
        raise HTTPException(status_code=422, detail="No face detected in image")

    encodings = face_recognition.face_encodings(image, locations)
    if not encodings:
        raise HTTPException(status_code=422, detail="Could not extract face encoding")

    data = load_encodings()
    data[req.portal_key] = encodings[0].tolist()
    save_encodings(data)
    return {"status": "enrolled", "portal_key": req.portal_key}


@app.post("/verify")
def verify(req: VerifyRequest):
    data = load_encodings()
    if req.portal_key not in data:
        return {"match": True, "reason": "no_enrollment", "confidence": 1.0}

    try:
        image = decode_image(req.image_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    locations = face_recognition.face_locations(image, model="hog")
    if not locations:
        return {"match": False, "reason": "no_face_detected", "confidence": 0.0}

    encodings = face_recognition.face_encodings(image, locations)
    if not encodings:
        return {"match": False, "reason": "no_face_detected", "confidence": 0.0}

    known = np.array(data[req.portal_key])
    live = encodings[0]

    # Lower distance = better match; threshold 0.6 is standard for dlib
    distance = float(face_recognition.face_distance([known], live)[0])
    confidence = round(max(0.0, 1.0 - distance), 3)
    match = distance < 0.6

    return {
        "match": match,
        "confidence": confidence,
        "distance": round(distance, 3),
        "reason": "ok" if match else "face_mismatch",
    }


@app.post("/detect")
def detect(req: DetectRequest):
    try:
        image = decode_image(req.image_b64)
        h, w = image.shape[:2]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    try:
        # HOG model: fast, CPU-friendly, no download required
        locations = face_recognition.face_locations(image, model="hog")
        boxes = []
        for (top, right, bottom, left) in locations:
            boxes.append({
                "x": left / w,
                "y": top / h,
                "w": (right - left) / w,
                "h": (bottom - top) / h,
            })
        return {"faces": boxes}
    except Exception:
        return {"faces": []}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, workers=1)
