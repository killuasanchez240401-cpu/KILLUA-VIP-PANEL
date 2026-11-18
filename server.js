
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

app.use(cors());
app.use(express.json());

const DB_FILE = "./licenses.json";

function loadKeys() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return [];
  }
}

let keys = loadKeys();

function saveKeys() {
  fs.writeFileSync(DB_FILE, JSON.stringify(keys, null, 2));
}

function adminAuth(req, res, next) {
  const token = req.headers.authorization || "";

  if (!ADMIN_TOKEN || token !== "Bearer " + ADMIN_TOKEN) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  next();
}

function updateExpired() {
  let changed = false;

  keys.forEach(k => {
    if (
      k.status === "active" &&
      Date.now() >= k.expiresAt
    ) {
      k.status = "expired";
      changed = true;
    }
  });

  if (changed) saveKeys();
}

function makeKey() {
  return "KILLUA-" +
    crypto.randomBytes(4).toString("hex").toUpperCase() +
    "-" +
    crypto.randomBytes(4).toString("hex").toUpperCase();
}

app.get("/", (req, res) => {
  res.send("KILLUA VIP API ONLINE");
});

app.get("/api/admin/keys", adminAuth, (req, res) => {
  updateExpired();
  res.json({ keys });
});

app.post("/api/admin/generate", adminAuth, (req, res) => {
  const { duration, unit } = req.body;

  const units = {
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    months: 30 * 24 * 60 * 60 * 1000
  };

  if (
    !Number.isSafeInteger(duration) ||
    duration < 1 ||
    duration > 365 ||
    !units[unit]
  ) {
    return res.status(400).json({
      message: "Invalid duration or unit"
    });
  }

  const key = {
    id: crypto.randomUUID(),
    key: makeKey(),
    status: "active",
    createdAt: Date.now(),
    expiresAt: Date.now() + duration * units[unit],
    duration,
    unit
  };

  keys.push(key);
  saveKeys();

  res.json({
    message: "License generated",
    key: key.key,
    license: key
  });
});

app.post("/api/admin/keys/:id/pause", adminAuth, (req, res) => {
  updateExpired();

  const key = keys.find(k => k.id === req.params.id);

  if (!key) {
    return res.status(404).json({ message: "Key not found" });
  }

  if (key.status !== "active") {
    return res.status(400).json({ message: "Key is not active" });
  }

  key.status = "paused";
  saveKeys();

  res.json({ message: "Key paused" });
});

app.post("/api/admin/keys/:id/resume", adminAuth, (req, res) => {
  updateExpired();

  const key = keys.find(k => k.id === req.params.id);

  if (!key) {
    return res.status(404).json({ message: "Key not found" });
  }

  if (key.status !== "paused") {
    return res.status(400).json({ message: "Key is not paused" });
  }

  key.status = Date.now() >= key.expiresAt ? "expired" : "active";
  saveKeys();

  res.json({ message: "Key status: " + key.status });
});

app.delete("/api/admin/keys/:id", adminAuth, (req, res) => {
  const index = keys.findIndex(k => k.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ message: "Key not found" });
  }

  keys.splice(index, 1);
  saveKeys();

  res.json({ message: "Key deleted" });
});

// License validation for your script
app.post("/api/validate", (req, res) => {
  const { key } = req.body;

  if (typeof key !== "string" || !key.trim()) {
    return res.status(400).json({
      valid: false,
      message: "License key required"
    });
  }

  updateExpired();

  const license = keys.find(k => k.key === key.trim());

  if (!license) {
    return res.status(404).json({
      valid: false,
      message: "Invalid license key"
    });
  }

  if (license.status === "paused") {
    return res.status(403).json({
      valid: false,
      message: "License paused"
    });
  }

  if (license.status === "expired") {
    return res.status(403).json({
      valid: false,
      message: "License expired"
    });
  }

res.json({
  status: "success",
  valid: true,
  message: "License accepted",
  expiresAt: license.expiresAt
});
});

const path = require("path");

app.get("/test", (req, res) => {
  res.sendFile(path.join(__dirname, "test.html"));
});
app.listen(PORT, () => {
  console.log("KILLUA VIP API running on port " + PORT);
});
