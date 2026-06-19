"""
Portal Face Recognition Service
FastAPI service that handles face enrollment and verification.
"""

import os
import io
import json
import base64
import threading
import tempfile

import numpy as np
from PIL import Image
from deepface import DeepFace
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Portal Face Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serialize all DeepFace calls — TensorFlow global state is not thread-safe
_lock = threading.Lock()

# Face encodings stored as JSON: { "KEY12345": [...128 floats...] }
DATA_FILE = os.environ.get("FACE_DATA_FILE", "face_data/encodings.json")
os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)


# ---------------------------------------------------------------------------
# Model pre-warm — runs once in background after startup so the first real
# request doesn't pay the cold-start penalty.
# Uses opencv detector (bundled, no download) for detect, and loads Facenet
# weights (92 MB) for enroll/verify — all safely serialised behind _lock.
# ---------------------------------------------------------------------------

def _prewarm():
    with _lock:
        try:
            print("Pre-warming DeepFace models...")
            dummy = np.ones((160, 160, 3), dtype=np.uint8) * 128
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
                Image.fromarray(dummy).save(f.name)
                tmp = f.name
            try:
                DeepFace.extract_faces(img_path=tmp, detector_backend="opencv",
                                       enforce_detection=False, align=False)
                DeepFace.represent(img_path=tmp, model_name="Facenet",
                                   enforce_detection=False)
                print("Models ready.")
            finally:
                os.unlink(tmp)
        except Exception as e:
            print(f"Pre-warm error (non-fatal): {e}")

threading.Thread(target=_prewarm, daemon=True).start()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_encodings() -> dict:
    if not os.path.exists(DATA_FILE):
        return {}
    with open(DATA_FILE, "r") as f:
        return json.load(f)


def save_encodings(data: dict):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f)


def decode_image(image_b64: str) -> np.ndarray:
    image_data = base64.b64decode(image_b64.split(",")[-1])
    image = Image.open(io.BytesIO(image_data)).convert("RGB")
    return np.array(image)


def get_embedding(img_array: np.ndarray) -> list:
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        Image.fromarray(img_array).save(f.name)
        tmp_path = f.name
    try:
        with _lock:
            result = DeepFace.represent(img_path=tmp_path, model_name="Facenet",
                                        enforce_detection=True)
        return result[0]["embedding"]
    finally:
        os.unlink(tmp_path)


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
    cos_sim = float(np.dot(stored, live) / (np.linalg.norm(stored) * np.linalg.norm(live)))
    confidence = round(cos_sim, 3)
    match = cos_sim > 0.7

    return {"match": match, "confidence": confidence,
            "reason": "ok" if match else "face_mismatch"}


@app.post("/detect")
def detect(req: DetectRequest):
    try:
        img = decode_image(req.image_b64)
        h, w = img.shape[:2]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            Image.fromarray(img).save(f.name)
            tmp_path = f.name
        with _lock:
            faces = DeepFace.extract_faces(img_path=tmp_path,
                                           detector_backend="opencv",
                                           enforce_detection=True,
                                           align=False)
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
    uvicorn.run("main:app", host="0.0.0.0", port=port, workers=1)
