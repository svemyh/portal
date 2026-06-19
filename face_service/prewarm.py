"""
Run during Render build to download and cache DeepFace model weights.
This prevents the 92MB download from happening on the first request,
which would cause Render's 30-second timeout to kill enrollment.
"""

import numpy as np
import tempfile
import os
from PIL import Image
from deepface import DeepFace

print("Downloading and caching DeepFace models...")

dummy = np.ones((160, 160, 3), dtype=np.uint8) * 128

with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
    Image.fromarray(dummy).save(f.name)
    tmp = f.name

try:
    # Download + cache Facenet weights (used by /enroll and /verify)
    DeepFace.represent(img_path=tmp, model_name="Facenet", enforce_detection=False)
    print("Facenet model ready.")

    # Download + cache face detector (used by /detect)
    DeepFace.extract_faces(img_path=tmp, enforce_detection=False)
    print("Face detector ready.")
except Exception as e:
    print(f"Pre-warm error (non-fatal): {e}")
finally:
    os.unlink(tmp)

print("Model pre-warm complete.")
