"""
Portal Face Recognition Service
Uses insightface + onnxruntime — prebuilt wheels, no compilation, ~41MB models.
"""

import os
import io
import json
import base64
import threading
import numpy as np
from PIL import Image
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

DATA_FILE = os.environ.get("FACE_DATA_FILE", "face_data/encodings.json")
_data_dir = os.path.dirname(DATA_FILE)
if _data_dir:
    os.makedirs(_data_dir, exist_ok=True)

# ---------------------------------------------------------------------------
# Model — loaded once in background thread on startup
# buffalo_s: det_500m (~24MB) + w600k_mbf recognition (~17MB) = ~41MB total
# ---------------------------------------------------------------------------

_face_app = None
_model_ready = threading.Event()


def _init_model():
    global _face_app
    try:
        print("Loading face model (buffalo_s)...")
        from insightface.app import FaceAnalysis
        m = FaceAnalysis(name="buffalo_s", providers=["CPUExecutionProvider"])
        m.prepare(ctx_id=0, det_size=(640, 640))
        _face_app = m
        _model_ready.set()
        print("Face model ready.")
    except Exception as e:
        print(f"Model load error: {e}")
        _model_ready.set()  # unblock so health check still works


threading.Thread(target=_init_model, daemon=True).start()


def get_model():
    if not _model_ready.is_set():
        raise HTTPException(status_code=503, detail="Model loading, retry in 10s")
    if _face_app is None:
        raise HTTPException(status_code=503, detail="Model failed to load")
    return _face_app


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
    """Returns BGR numpy array (OpenCV convention) for insightface."""
    raw = base64.b64decode(image_b64.split(",")[-1])
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    arr = np.array(img)
    return arr[:, :, ::-1]  # RGB → BGR


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
        img = decode_image(req.image_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    model = get_model()
    faces = model.get(img)
    if not faces:
        raise HTTPException(status_code=422, detail="No face detected in image")

    embedding = faces[0].embedding.tolist()
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
        img = decode_image(req.image_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    model = get_model()
    faces = model.get(img)
    if not faces:
        return {"match": False, "reason": "no_face_detected", "confidence": 0.0}

    known = np.array(data[req.portal_key])
    live = faces[0].embedding
    # Cosine similarity — insightface embeddings are L2-normalised
    cos_sim = float(np.dot(known, live) / (np.linalg.norm(known) * np.linalg.norm(live)))
    confidence = round(max(0.0, cos_sim), 3)
    match = cos_sim > 0.4  # standard threshold for ArcFace/MobileFaceNet

    return {
        "match": match,
        "confidence": confidence,
        "reason": "ok" if match else "face_mismatch",
    }


@app.post("/detect")
def detect(req: DetectRequest):
    try:
        img = decode_image(req.image_b64)
        h, w = img.shape[:2]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    try:
        model = get_model()
        faces = model.get(img)
        boxes = []
        for face in faces:
            x1, y1, x2, y2 = face.bbox.astype(int)
            boxes.append({
                "x": max(0, x1) / w,
                "y": max(0, y1) / h,
                "w": (x2 - x1) / w,
                "h": (y2 - y1) / h,
            })
        return {"faces": boxes}
    except HTTPException:
        raise
    except Exception:
        return {"faces": []}


@app.get("/health")
def health():
    return {"status": "ok", "model_ready": _model_ready.is_set()}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, workers=1)
