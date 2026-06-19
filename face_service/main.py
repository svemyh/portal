"""
Portal Face Recognition Service
Stack: OpenCV Haar cascade (detection) + MobileFaceNet ONNX (embeddings)
No large ML frameworks — ~150MB peak RAM.
"""

import os
import io
import json
import base64
import numpy as np
import cv2
import onnxruntime as ort
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
# Models — loaded once at startup
# ---------------------------------------------------------------------------

# Face detection: Haar cascade bundled with OpenCV, zero download
_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)

# Face recognition: MobileFaceNet ONNX (~17MB), downloaded at build time
_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "w600k_mbf.onnx")
_rec_session: ort.InferenceSession | None = None

if os.path.exists(_MODEL_PATH):
    _rec_session = ort.InferenceSession(
        _MODEL_PATH, providers=["CPUExecutionProvider"]
    )
    print(f"Recognition model loaded: {_MODEL_PATH}")
else:
    print(f"WARNING: recognition model not found at {_MODEL_PATH}. "
          f"Enroll/verify will be unavailable.")


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


def decode_image_bgr(image_b64: str) -> np.ndarray:
    """Decode base64 image → BGR numpy array."""
    raw = base64.b64decode(image_b64.split(",")[-1])
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    arr = np.array(img)
    return arr[:, :, ::-1]  # RGB → BGR


def detect_faces(img_bgr: np.ndarray):
    """Return list of (x, y, w, h) face bounding boxes."""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    faces = _cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(48, 48))
    return faces if len(faces) > 0 else []


def get_embedding(img_bgr: np.ndarray, box) -> np.ndarray:
    """
    Crop the face, resize to 112×112, run through MobileFaceNet.
    Returns L2-normalised 512-dim embedding.
    """
    if _rec_session is None:
        raise HTTPException(status_code=503, detail="Recognition model not loaded")

    x, y, w, h = box
    face = img_bgr[y:y+h, x:x+w]
    face = cv2.resize(face, (112, 112))
    # Normalise to [-1, 1] — standard for ArcFace/MobileFaceNet
    face = (face.astype(np.float32) - 127.5) / 127.5
    face = face.transpose(2, 0, 1)          # HWC → CHW
    face = np.expand_dims(face, axis=0)     # add batch dim

    input_name = _rec_session.get_inputs()[0].name
    emb = _rec_session.run(None, {input_name: face})[0][0]

    # L2 normalise
    norm = np.linalg.norm(emb)
    if norm > 0:
        emb = emb / norm
    return emb


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
        img = decode_image_bgr(req.image_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    faces = detect_faces(img)
    if len(faces) == 0:
        raise HTTPException(status_code=422, detail="No face detected in image")

    # Use the largest face
    box = max(faces, key=lambda b: b[2] * b[3])
    emb = get_embedding(img, box)

    data = load_encodings()
    data[req.portal_key] = emb.tolist()
    save_encodings(data)
    return {"status": "enrolled", "portal_key": req.portal_key}


@app.post("/verify")
def verify(req: VerifyRequest):
    data = load_encodings()
    if req.portal_key not in data:
        return {"match": True, "reason": "no_enrollment", "confidence": 1.0}

    try:
        img = decode_image_bgr(req.image_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    faces = detect_faces(img)
    if len(faces) == 0:
        return {"match": False, "reason": "no_face_detected", "confidence": 0.0}

    box = max(faces, key=lambda b: b[2] * b[3])
    live = get_embedding(img, box)
    known = np.array(data[req.portal_key])

    cos_sim = float(np.dot(known, live))  # both are L2-normalised
    confidence = round(max(0.0, cos_sim), 3)
    match = cos_sim > 0.4

    return {
        "match": match,
        "confidence": confidence,
        "reason": "ok" if match else "face_mismatch",
    }


@app.post("/detect")
def detect(req: DetectRequest):
    try:
        img = decode_image_bgr(req.image_b64)
        h, w = img.shape[:2]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    faces = detect_faces(img)
    boxes = []
    for (x, y, fw, fh) in faces:
        boxes.append({
            "x": x / w,
            "y": y / h,
            "w": fw / w,
            "h": fh / h,
        })
    return {"faces": boxes}


@app.get("/health")
def health():
    return {"status": "ok", "model_ready": _rec_session is not None}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, workers=1)
