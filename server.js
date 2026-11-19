
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app = express();
const PORT = process.env.PORT || 8080;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

app.use(cors());
app.use(express.json());

const LIFETIME_EXPIRY = "9999-12-31T23:59:59.999Z";

function makeKey() {
  const random = crypto.randomBytes(12).toString("hex").toUpperCase();
  return "KILLUA-" + random.match(/.{1,4}/g).join("-");
}

function adminAuth(req, res, next) {
  const token = req.headers.authorization || "";

  if (!ADMIN_TOKEN || token !== "Bearer " + ADMIN_TOKEN) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  next();
}

function toApiLicense(row) {
  return {
    id: row.id,
    key: row.license_key,
    status: row.status,
    createdAt: Date.parse(row.created_at),
    expiresAt: Date.parse(row.expires_at),
    duration: row.duration,
    unit: row.unit
  };
}

async function updateExpired() {
  const { error } = await supabase
    .from("licenses")
    .update({ status: "expired" })
    .eq("status", "active")
    .neq("unit", "lifetime")
    .lte("expires_at", new Date().toISOString());

  if (error) throw error;
}

function dbError(res, error) {
  console.error("Supabase error:", error);
  return res.status(500).json({
    message: "Database error",
    error: error.message
  });
}

app.get("/", (req, res) => {
  res.send("KILLUA VIP API ONLINE");
});

app.get("/api/admin/keys", adminAuth, async (req, res) => {
  try {
    await updateExpired();

    const { data, error } = await supabase
      .from("licenses")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return dbError(res, error);

    res.json({ keys: data.map(toApiLicense) });
  } catch (error) {
    return dbError(res, error);
  }
});

app.post("/api/admin/generate", adminAuth, async (req, res) => {
  try {
    const { duration, unit } = req.body;

    const units = {
      minutes: 60 * 1000,
      hours: 60 * 60 * 1000,
      days: 24 * 60 * 60 * 1000,
      months: 30 * 24 * 60 * 60 * 1000,
      years: 365 * 24 * 60 * 60 * 1000
    };

    const isLifetime = unit === "lifetime";

    if (
      (!isLifetime &&
        (!Number.isSafeInteger(duration) ||
          duration < 1 ||
          duration > 365)) ||
      (!isLifetime && !units[unit])
    ) {
      return res.status(400).json({
        message: "Invalid duration or unit"
      });
    }

    const validDuration = isLifetime ? 1 : duration;

    const expiresAt = isLifetime
      ? LIFETIME_EXPIRY
      : new Date(
          Date.now() + validDuration * units[unit]
        ).toISOString();

    const { data, error } = await supabase
      .from("licenses")
      .insert({
        license_key: makeKey(),
        status: "active",
        expires_at: expiresAt,
        duration: validDuration,
        unit
      })
      .select("*")
      .single();

    if (error) return dbError(res, error);

    const license = toApiLicense(data);

    res.json({
      message: "License generated",
      key: license.key,
      license
    });
  } catch (error) {
    return dbError(res, error);
  }
});

app.post("/api/admin/keys/:id/pause", adminAuth, async (req, res) => {
  try {
    await updateExpired();

    const { data: key, error } = await supabase
      .from("licenses")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) return dbError(res, error);

    if (!key) {
      return res.status(404).json({ message: "Key not found" });
    }

    if (key.status !== "active") {
      return res.status(400).json({ message: "Key is not active" });
    }

    const { error: updateError } = await supabase
      .from("licenses")
      .update({ status: "paused" })
      .eq("id", req.params.id);

    if (updateError) return dbError(res, updateError);

    res.json({ message: "Key paused" });
  } catch (error) {
    return dbError(res, error);
  }
});

app.post("/api/admin/keys/:id/resume", adminAuth, async (req, res) => {
  try {
    await updateExpired();

    const { data: key, error } = await supabase
      .from("licenses")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) return dbError(res, error);

    if (!key) {
      return res.status(404).json({ message: "Key not found" });
    }

    if (key.status !== "paused") {
      return res.status(400).json({ message: "Key is not paused" });
    }

    const newStatus =
      key.unit === "lifetime" ||
      Date.now() < Date.parse(key.expires_at)
        ? "active"
        : "expired";

    const { error: updateError } = await supabase
      .from("licenses")
      .update({ status: newStatus })
      .eq("id", req.params.id);

    if (updateError) return dbError(res, updateError);

    res.json({ message: "Key status: " + newStatus });
  } catch (error) {
    return dbError(res, error);
  }
});

app.delete("/api/admin/keys/:id", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("licenses")
      .delete()
      .eq("id", req.params.id)
      .select("id")
      .maybeSingle();

    if (error) return dbError(res, error);

    if (!data) {
      return res.status(404).json({ message: "Key not found" });
    }

    res.json({ message: "Key deleted" });
  } catch (error) {
    return dbError(res, error);
  }
});

app.post("/api/validate", async (req, res) => {
  try {
    const { key } = req.body;

    if (typeof key !== "string" || !key.trim()) {
      return res.status(400).json({
        valid: false,
        message: "License key required"
      });
    }

    await updateExpired();

    const { data: license, error } = await supabase
      .from("licenses")
      .select("*")
      .eq("license_key", key.trim())
      .maybeSingle();

    if (error) return dbError(res, error);

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

    const isLifetime = license.unit === "lifetime";

    if (
      license.status === "expired" ||
      (!isLifetime &&
        Date.now() >= Date.parse(license.expires_at))
    ) {
      return res.status(403).json({
        valid: false,
        message: "License expired"
      });
    }

    res.json({
      status: "success",
      valid: true,
      message: "License accepted",
      expiresAt: Date.parse(license.expires_at)
    });
  } catch (error) {
    return dbError(res, error);
  }
});

app.get("/test", (req, res) => {
  res.sendFile(path.join(__dirname, "test.html"));
});

app.listen(PORT, () => {
  console.log("KILLUA VIP API running on port " + PORT);
});
