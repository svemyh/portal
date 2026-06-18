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
from deepface import DeepFace
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
import io
import tempfile

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
    image_data = base64.b64decode(image_b64.split(",")[-1])
    image = Image.open(io.BytesIO(image_data)).convert("RGB")
    return np.array(image)


def get_embedding(img_array: np.ndarray) -> list:
    """Get face embedding using DeepFace (Facenet model, no dlib required)."""
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        Image.fromarray(img_array).save(f.name)
        tmp_path = f.name
    try:
        result = DeepFace.represent(img_path=tmp_path, model_name="Facenet", enforce_detection=True)
        return result[0]["embedding"]
    finally:
        os.unlink(tmp_path)


class EnrollRequest(BaseModel):
    portal_key: str
    image_b64: str  # base64-encoded image (data URI or raw)


class VerifyRequest(BaseModel):
    portal_key: str
    image_b64: str


@app.post("/enroll")
def enroll(req: EnrollRequest):
    try:
        image = decode_image(req.image_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    try:
        embedding = get_embedding(image)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"No face detected: {e}")

    data = load_encodings()
    data[req.portal_key] = embedding
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

    try:
        live = np.array(get_embedding(image))
    except Exception:
        return {"match": False, "reason": "no_face_detected", "confidence": 0.0}

    stored = np.array(data[req.portal_key])

    # Cosine similarity
    cos_sim = float(np.dot(stored, live) / (np.linalg.norm(stored) * np.linalg.norm(live)))
    confidence = round(cos_sim, 3)
    match = cos_sim > 0.7  # Facenet threshold

    return {
        "match": match,
        "confidence": confidence,
        "reason": "ok" if match else "face_mismatch"
    }


class DetectRequest(BaseModel):
    image_b64: str


@app.post("/detect")
def detect(req: DetectRequest):
    """
    Detect faces in an image and return normalized bounding boxes (0-1 relative to image size).
    Used by the frontend to draw real-time face boxes without face-api.js.
    """
    try:
        img = decode_image(req.image_b64)
        h, w = img.shape[:2]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            Image.fromarray(img).save(f.name)
            tmp_path = f.name

        faces = DeepFace.extract_faces(
            img_path=tmp_path,
            enforce_detection=True,
            align=False
        )
        os.unlink(tmp_path)

        boxes = []
        for face in faces:
            fa = face["facial_area"]
            boxes.append({
                "x": fa["x"] / w,
                "y": fa["y"] / h,
                "w": fa["w"] / w,
                "h": fa["h"] / h,
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
    uvicorn.run("main:app", host="0.0.0.0", port=port)
