"""Download MobileFaceNet ONNX model at build time."""
import os
import urllib.request
import zipfile

MODELS_DIR = "models"
MODEL_FILE = os.path.join(MODELS_DIR, "w600k_mbf.onnx")

os.makedirs(MODELS_DIR, exist_ok=True)

if os.path.exists(MODEL_FILE):
    print(f"Model already present at {MODEL_FILE}")
else:
    print("Downloading buffalo_s model pack (~122MB)...")
    url = "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip"
    tmp, _ = urllib.request.urlretrieve(url)
    print("Extracting w600k_mbf.onnx...")
    with zipfile.ZipFile(tmp) as zf:
        for member in zf.namelist():
            if os.path.basename(member) == "w600k_mbf.onnx":
                with zf.open(member) as src, open(MODEL_FILE, "wb") as dst:
                    dst.write(src.read())
                break
    os.unlink(tmp)
    print(f"Model saved to {MODEL_FILE} ({os.path.getsize(MODEL_FILE) // 1024 // 1024}MB)")
