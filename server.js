/**
 * Run once: node download-models.js
 * Downloads face-api.js model weights into public/models/
 * Required models: tiny_face_detector + age_gender_net
 */

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const BASE  = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/";
const DEST  = path.join(__dirname, "public", "models");

const FILES = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model-shard1",
  "age_gender_model-weights_manifest.json",
  "age_gender_model-shard1",
];

if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });

function download(filename) {
  return new Promise((resolve, reject) => {
    const dest = path.join(DEST, filename);
    if (fs.existsSync(dest)) { console.log("skip (exists):", filename); return resolve(); }
    const file = fs.createWriteStream(dest);
    https.get(BASE + filename, (res) => {
      res.pipe(file);
      file.on("finish", () => { file.close(); console.log("downloaded:", filename); resolve(); });
    }).on("error", (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

(async () => {
  for (const f of FILES) await download(f);
  console.log("done — models in public/models/");
})();