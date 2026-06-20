"""
Portal Face Recognition Service
Stack: YuNet DNN detector + MobileFaceNet ONNX embeddings
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

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

# YuNet face detector — much more robust than Haar cascade
_DET_MODEL = os.path.join(MODELS_DIR, "face_detection_yunet.onnx")
_detector: cv2.FaceDetectorYN | None = None
if os.path.exists(_DET_MODEL):
    _detector = cv2.FaceDetectorYN.create(
        _DET_MODEL, "", (320, 240),
        score_threshold=0.6, nms_threshold=0.3, top_k=5000
    )
    print(f"YuNet detector loaded: {_DET_MODEL}")
else:
    print(f"WARNING: detector model not found at {_DET_MODEL}")

# MobileFaceNet recognition model
_REC_MODEL = os.path.join(MODELS_DIR, "w600k_mbf.onnx")
_rec_session: ort.InferenceSession | None = None
if os.path.exists(_REC_MODEL):
    _rec_session = ort.InferenceSession(_REC_MODEL, providers=["CPUExecutionProvider"])
    print(f"Recognition model loaded: {_REC_MODEL}")
else:
    print(f"WARNING: recognition model not found at {_REC_MODEL}")

MATCH_THRESHOLD = 0.40  # cosine similarity threshold for a positive match

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
    raw = base64.b64decode(image_b64.split(",")[-1])
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    arr = np.array(img)
    return arr[:, :, ::-1]  # RGB → BGR


def detect_faces(img_bgr: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Return list of (x, y, w, h) face boxes using YuNet."""
    if _detector is None:
        return []
    h, w = img_bgr.shape[:2]
    _detector.setInputSize((w, h))
    _, faces = _detector.detect(img_bgr)
    if faces is None:
        return []
    boxes = []
    for f in faces:
        x, y, fw, fh = int(f[0]), int(f[1]), int(f[2]), int(f[3])
        # clamp to image bounds
        x, y = max(0, x), max(0, y)
        fw = min(fw, w - x)
        fh = min(fh, h - y)
        if fw > 0 and fh > 0:
            boxes.append((x, y, fw, fh))
    return boxes


def get_embedding(img_bgr: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray | None:
    """Crop face, resize to 112×112, return L2-normalised embedding."""
    if _rec_session is None:
        return None
    x, y, w, h = box
    face = img_bgr[y:y+h, x:x+w]
    if face.size == 0:
        return None
    face = cv2.resize(face, (112, 112))
    face = (face.astype(np.float32) - 127.5) / 127.5
    face = face.transpose(2, 0, 1)[np.newaxis]
    emb = _rec_session.run(None, {_rec_session.get_inputs()[0].name: face})[0][0]
    norm = np.linalg.norm(emb)
    return emb / norm if norm > 0 else emb


def base_key(k: str) -> str:
    """Strip guest suffix — 'ABCD1234:g2' → 'ABCD1234'."""
    return k.split(":")[0]


def is_guest_key(k: str) -> bool:
    return ":" in k


def next_guest_slot(portal_key: str, data: dict) -> str:
    """Return the next unused guest slot for a key, e.g. 'ABCD1234:g1'."""
    base = portal_key.strip().upper()
    i = 1
    while f"{base}:g{i}" in data:
        i += 1
    return f"{base}:g{i}"


def best_match(emb: np.ndarray, data: dict) -> tuple[str | None, float]:
    """Compare embedding against all enrolled keys. Returns (raw_key, confidence)."""
    best_key, best_sim = None, 0.0
    for k, stored in data.items():
        sim = float(np.dot(np.array(stored), emb))
        if sim > best_sim:
            best_sim = sim
            best_key = k
    if best_sim >= MATCH_THRESHOLD:
        return best_key, round(best_sim, 3)
    return None, round(best_sim, 3)


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
    if not faces:
        raise HTTPException(status_code=422, detail="No face detected in image")

    box = max(faces, key=lambda b: b[2] * b[3])
    emb = get_embedding(img, box)
    if emb is None:
        raise HTTPException(status_code=503, detail="Recognition model not loaded")

    data = load_encodings()
    data[req.portal_key.strip().upper()] = emb.tolist()
    save_encodings(data)
    return {"status": "enrolled", "portal_key": req.portal_key}


@app.post("/verify")
def verify(req: VerifyRequest):
    data = load_encodings()
    key = req.portal_key.strip().upper()
    if key not in data:
        return {"match": True, "reason": "no_enrollment", "confidence": 1.0}

    try:
        img = decode_image_bgr(req.image_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    faces = detect_faces(img)
    if not faces:
        return {"match": False, "reason": "no_face_detected", "confidence": 0.0}

    box = max(faces, key=lambda b: b[2] * b[3])
    emb = get_embedding(img, box)
    if emb is None:
        return {"match": False, "reason": "model_unavailable", "confidence": 0.0}

    cos_sim = float(np.dot(np.array(data[key]), emb))
    match = cos_sim >= MATCH_THRESHOLD
    return {
        "match": match,
        "confidence": round(max(0.0, cos_sim), 3),
        "reason": "ok" if match else "face_mismatch",
    }


@app.post("/identify")
def identify(req: DetectRequest):
    """Detect all faces and match each against enrolled keys."""
    try:
        img = decode_image_bgr(req.image_b64)
        h, w = img.shape[:2]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    faces = detect_faces(img)
    data = load_encodings()
    results = []

    for box in faces:
        x, y, fw, fh = box
        entry = {
            "x": x / w, "y": y / h, "w": fw / w, "h": fh / h,
            "key": None, "is_guest": False, "confidence": 0.0,
        }
        emb = get_embedding(img, box)
        if emb is not None and data:
            raw_key, confidence = best_match(emb, data)
            if raw_key:
                entry["key"] = base_key(raw_key)
                entry["is_guest"] = is_guest_key(raw_key)
            entry["confidence"] = confidence
        results.append(entry)

    return {"faces": results}


@app.post("/detect")
def detect(req: DetectRequest):
    try:
        img = decode_image_bgr(req.image_b64)
        h, w = img.shape[:2]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    faces = detect_faces(img)
    return {"faces": [{"x": x/w, "y": y/h, "w": fw/w, "h": fh/h}
                      for x, y, fw, fh in faces]}


@app.delete("/enrolled/{portal_key}")
def delete_enrolled(portal_key: str):
    data = load_encodings()
    key = portal_key.strip().upper()
    if key not in data:
        raise HTTPException(status_code=404, detail="Key not enrolled")
    del data[key]
    save_encodings(data)
    return {"status": "deleted", "portal_key": key}


@app.post("/enroll-guest")
def enroll_guest(req: EnrollRequest):
    """Enroll a guest face under the keyholder's portal key (KEY:g1, KEY:g2, …)."""
    try:
        img = decode_image_bgr(req.image_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    faces = detect_faces(img)
    if not faces:
        raise HTTPException(status_code=422, detail="No face detected in image")

    box = max(faces, key=lambda b: b[2] * b[3])
    emb = get_embedding(img, box)
    if emb is None:
        raise HTTPException(status_code=503, detail="Recognition model not loaded")

    data = load_encodings()
    slot = next_guest_slot(req.portal_key, data)
    data[slot] = emb.tolist()
    save_encodings(data)
    return {"status": "enrolled", "portal_key": req.portal_key, "guest_slot": slot}


@app.get("/enrolled")
def enrolled():
    data = load_encodings()
    return {"count": len(data), "keys": list(data.keys())}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "detector": _detector is not None,
        "recognizer": _rec_session is not None,
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, workers=1)
