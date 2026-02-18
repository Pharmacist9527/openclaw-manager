import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { randomBytes, createHmac } from "node:crypto";

var CONFIG_DIR = join(homedir(), ".openclaw-manager");
var CONFIG_FILE = join(CONFIG_DIR, "config.json");

var SESSION_MAX_AGE = 7 * 24 * 3600 * 1000; // 7 days
var RATE_LIMIT_MAX = 5;
var RATE_LIMIT_LOCK_MS = 5 * 60 * 1000; // 5 minutes

// Rate limit store: ip → { count, lockedUntil }
var rateLimitMap = new Map();

export function loadOrCreateConfig(resetToken) {
  var config;
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    config = null;
  }

  if (!config || typeof config !== "object") {
    mkdirSync(CONFIG_DIR, { recursive: true });
    config = {
      token: randomBytes(16).toString("hex"),
      port: 8990
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
    if (platform() !== "win32") {
      try { chmodSync(CONFIG_FILE, 0o600); } catch { /* ignore */ }
    }
    return config;
  }

  if (resetToken) {
    config.token = randomBytes(16).toString("hex");
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
    if (platform() !== "win32") {
      try { chmodSync(CONFIG_FILE, 0o600); } catch { /* ignore */ }
    }
  }

  // Ensure required fields exist; write back if any were missing
  var dirty = false;
  if (!config.token) { config.token = randomBytes(16).toString("hex"); dirty = true; }
  if (!config.port) { config.port = 8990; dirty = true; }
  if (dirty) {
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
    if (platform() !== "win32") {
      try { chmodSync(CONFIG_FILE, 0o600); } catch { /* ignore */ }
    }
  }

  return config;
}

export function signSession(token) {
  var ts = Date.now().toString(36);
  var sig = createHmac("sha256", token).update("openclaw:" + ts).digest("hex").slice(0, 32);
  return ts + "." + sig;
}

export function verifySession(cookie, token) {
  if (!cookie || typeof cookie !== "string") return false;
  var dot = cookie.indexOf(".");
  if (dot === -1) return false;
  var ts = cookie.slice(0, dot);
  var sig = cookie.slice(dot + 1);
  if (!ts || !sig) return false;

  // Check expiration
  var time = parseInt(ts, 36);
  if (isNaN(time) || Date.now() - time > SESSION_MAX_AGE) return false;

  // Recompute HMAC and compare
  var expected = createHmac("sha256", token).update("openclaw:" + ts).digest("hex").slice(0, 32);
  if (sig.length !== expected.length) return false;

  // Constant-time comparison
  var mismatch = 0;
  for (var i = 0; i < sig.length; i++) {
    mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export function checkRateLimit(ip) {
  var entry = rateLimitMap.get(ip);
  if (!entry) return true;
  if (entry.count >= RATE_LIMIT_MAX && entry.lockedUntil > Date.now()) return false;
  if (entry.lockedUntil && entry.lockedUntil <= Date.now()) {
    rateLimitMap.delete(ip);
    return true;
  }
  return true;
}

export function recordFailure(ip) {
  var entry = rateLimitMap.get(ip);
  if (!entry) {
    entry = { count: 0, lockedUntil: 0 };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count >= RATE_LIMIT_MAX) {
    entry.lockedUntil = Date.now() + RATE_LIMIT_LOCK_MS;
  }
}

export function clearFailure(ip) {
  rateLimitMap.delete(ip);
}
