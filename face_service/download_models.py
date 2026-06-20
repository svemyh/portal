"""Download face models at build time."""
import os
import urllib.request
import zipfile

MODELS_DIR = "models"
os.makedirs(MODELS_DIR, exist_ok=True)

# ── MobileFaceNet recognition model (~17MB, from buffalo_s pack) ──────────────
REC_MODEL = os.path.join(MODELS_DIR, "w600k_mbf.onnx")
if os.path.exists(REC_MODEL):
    print(f"Recognition model already present: {REC_MODEL}")
else:
    print("Downloading buffalo_s model pack...")
    tmp, _ = urllib.request.urlretrieve(
        "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip"
    )
    with zipfile.ZipFile(tmp) as zf:
        for member in zf.namelist():
            if os.path.basename(member) == "w600k_mbf.onnx":
                with zf.open(member) as src, open(REC_MODEL, "wb") as dst:
                    dst.write(src.read())
                break
    os.unlink(tmp)
    print(f"Recognition model saved ({os.path.getsize(REC_MODEL) // 1024}KB)")

# ── YuNet face detector (~350KB) ───────────────────────────────────────────────
DET_MODEL = os.path.join(MODELS_DIR, "face_detection_yunet.onnx")
if os.path.exists(DET_MODEL):
    print(f"Detection model already present: {DET_MODEL}")
else:
    print("Downloading YuNet face detection model...")
    urllib.request.urlretrieve(
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        DET_MODEL,
    )
    print(f"Detection model saved ({os.path.getsize(DET_MODEL) // 1024}KB)")
