import express from "express";
import { createServer } from "node:http";
import { execSync } from "node:child_process";
import { platform } from "node:os";
import { randomUUID } from "node:crypto";
import { INDEX_HTML } from "./html.js";
import { signSession, verifySession, checkRateLimit, recordFailure, clearFailure } from "./auth.js";
import { getAllProfiles, MODEL_CATALOG, validateProfileName, runSetupStream, connectTelegramUser, startGateway, stopGateway, restartGateway, deleteProfile, changeModel } from "./configure.js";

// Safely embed JSON inside <script> tags — prevent </script> breakout
function safeStringify(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

// Parse a named cookie from raw Cookie header
function parseCookie(headers, name) {
  var raw = headers.cookie;
  if (!raw) return "";
  var pairs = raw.split(";");
  for (var i = 0; i < pairs.length; i++) {
    var pair = pairs[i].trim();
    var eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq) === name) return pair.slice(eq + 1);
  }
  return "";
}

export async function startSetupServer(opts) {
  opts = opts || {};
  var serverMode = opts.serverMode || false;
  var token = opts.token || "";
  var configPort = opts.port || 0;

  var app = express();
  app.use(express.json());

  // --- Ticket store for SSE ---
  var ticketStore = new Map();

  var cleanupTimer = setInterval(function() {
    var now = Date.now();
    for (var entry of ticketStore) {
      if (entry[1].expiresAt < now) ticketStore.delete(entry[0]);
    }
  }, 60000);
  cleanupTimer.unref();

  // --- Auth routes (server mode only) ---
  if (serverMode) {
    // Login endpoint (no auth required)
    app.post("/auth/login", function(req, res) {
      var ip = req.ip;
      if (!checkRateLimit(ip)) {
        res.status(429).json({ error: "Too many attempts. Try again later." });
        return;
      }
      if (!req.body || req.body.token !== token) {
        recordFailure(ip);
        res.status(401).json({ error: "Invalid token" });
        return;
      }
      clearFailure(ip);
      var cookie = signSession(token);
      res.setHeader("Set-Cookie",
        "session=" + cookie
        + "; HttpOnly"
        + "; SameSite=Strict"
        + "; Max-Age=" + (7 * 24 * 3600)
        + "; Path=/"
      );
      res.json({ success: true });
    });

    // Auth middleware (exclude GET / and POST /auth/login)
    app.use(function(req, res, next) {
      if (req.path === "/" && req.method === "GET") return next();
      var sessionCookie = parseCookie(req.headers, "session");
      if (!sessionCookie || !verifySession(sessionCookie, token)) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    });
  }

  // --- Serve page with server-injected state ---
  app.get("/", async function(_req, res) {
    if (serverMode) {
      var sessionCookie = parseCookie(_req.headers, "session");
      if (!sessionCookie || !verifySession(sessionCookie, token)) {
        // Not authenticated: return HTML without __STATE__
        var html = INDEX_HTML.replace("<!--SERVER_STATE-->", "");
        res.type("html").send(html);
        return;
      }
    }
    // Authenticated or local mode: inject state
    var profiles = await getAllProfiles();
    var initScript = "<script>window.__STATE__=" + safeStringify({ profiles: profiles, models: MODEL_CATALOG }) + "</script>";
    var htmlFull = INDEX_HTML.replace("<!--SERVER_STATE-->", initScript);
    res.type("html").send(htmlFull);
  });

  // Get all profiles
  app.get("/profiles", async function(_req, res) {
    res.json(await getAllProfiles());
  });

  // --- Ticket endpoints ---
  app.post("/setup/prepare", function(req, res) {
    var body = req.body || {};
    if (!body.apiKey) {
      res.status(400).json({ error: "API Key required" });
      return;
    }
    var ticketId = randomUUID();
    ticketStore.set(ticketId, {
      data: body,
      expiresAt: Date.now() + 60000
    });
    res.json({ ticket: ticketId });
  });

  app.post("/connect/prepare", function(req, res) {
    var body = req.body || {};
    var ticketId = randomUUID();
    ticketStore.set(ticketId, {
      data: body,
      expiresAt: Date.now() + 60000
    });
    res.json({ ticket: ticketId });
  });

  // --- SSE: deploy new instance with progress ---
  app.get("/setup-stream", function(req, res) {
    var ticket = ticketStore.get(req.query.ticket);
    if (!ticket || ticket.expiresAt < Date.now()) {
      res.status(400).json({ error: "Invalid or expired ticket" });
      return;
    }
    ticketStore.delete(req.query.ticket);

    var data = ticket.data;
    var profile = (data.profile || "default").trim();
    var apiKey = (data.apiKey || "").trim();
    var modelId = (data.model || "claude-opus-4-6").trim();
    var channel = (data.channel || "telegram").trim();
    var botToken = (data.botToken || "").trim();
    var appId = (data.appId || "").trim();
    var appSecret = (data.appSecret || "").trim();

    if (!apiKey) { res.status(400).json({ error: "API Key required" }); return; }

    try { validateProfileName(profile); } catch (e) {
      res.status(400).json({ error: e.message }); return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    var channelCreds = {};
    if (channel === "telegram") channelCreds.botToken = botToken;
    else if (channel === "feishu") { channelCreds.appId = appId; channelCreds.appSecret = appSecret; }

    function sendProgress(pct, msg) {
      res.write("data: " + JSON.stringify({ percent: pct, message: msg }) + "\n\n");
    }

    var handle = runSetupStream(profile, apiKey, modelId, channel, channelCreds, sendProgress);

    // Kill child process if client disconnects
    req.on("close", function() { handle.abort(); });

    handle.promise
      .then(function(result) {
        res.write("data: " + JSON.stringify({ percent: 100, message: "Done", done: true, port: result.port }) + "\n\n");
        res.end();
      })
      .catch(function(err) {
        res.write("data: " + JSON.stringify({ percent: -1, message: err.message, error: true }) + "\n\n");
        res.end();
      });
  });

  // SSE: connect user with progress
  app.get("/connect-stream", function(req, res) {
    var ticket = ticketStore.get(req.query.ticket);
    if (!ticket || ticket.expiresAt < Date.now()) {
      res.status(400).json({ error: "Invalid or expired ticket" });
      return;
    }
    ticketStore.delete(req.query.ticket);

    var data = ticket.data;
    var profile = (data.profile || "default").trim();
    var channel = (data.channel || "telegram").trim();
    var telegramId = (data.telegramId || "").trim();

    if (channel === "telegram" && !telegramId) {
      res.status(400).json({ error: "Telegram User ID required" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    function sendProgress(pct, msg) {
      res.write("data: " + JSON.stringify({ percent: pct, message: msg }) + "\n\n");
    }

    try {
      if (channel === "telegram") {
        connectTelegramUser(profile, telegramId, sendProgress);
      }
      res.write("data: " + JSON.stringify({ percent: 100, message: "Connected", done: true }) + "\n\n");
      res.end();
    } catch (err) {
      res.write("data: " + JSON.stringify({ percent: -1, message: err.message, error: true }) + "\n\n");
      res.end();
    }
  });

  // Start gateway
  app.post("/start-gateway", function(req, res) {
    var profile = (req.body.profile || "default").trim();
    try {
      startGateway(profile);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to start gateway." });
    }
  });

  // Stop gateway
  app.post("/stop-gateway", function(req, res) {
    var profile = (req.body.profile || "default").trim();
    try {
      stopGateway(profile);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to stop gateway." });
    }
  });

  // Restart gateway
  app.post("/restart-gateway", function(req, res) {
    var profile = (req.body.profile || "default").trim();
    try {
      restartGateway(profile);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to restart gateway." });
    }
  });

  // Delete profile
  app.post("/delete-profile", function(req, res) {
    var profile = (req.body.profile || "").trim();
    if (!profile) { res.status(400).json({ error: "Profile name required" }); return; }
    try {
      deleteProfile(profile);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete profile." });
    }
  });

  // Change model
  app.post("/change-model", function(req, res) {
    var profile = (req.body.profile || "").trim();
    var modelId = (req.body.modelId || "").trim();
    if (!profile) { res.status(400).json({ error: "Profile name required" }); return; }
    if (!modelId) { res.status(400).json({ error: "Model ID required" }); return; }
    try {
      changeModel(profile, modelId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to change model." });
    }
  });

  // Shutdown (local mode only)
  if (!serverMode) {
    var shutdownResolve;
    var shutdownPromise = new Promise(function(resolve) { shutdownResolve = resolve; });

    app.post("/shutdown", function(_req, res) {
      res.json({ ok: true });
      console.log("\nShutting down...");
      server.close(function() { shutdownResolve(); });
    });
  }

  // --- Bind server ---
  var server = createServer(app);
  if (serverMode) {
    await new Promise(function(resolve) { server.listen(configPort, "0.0.0.0", resolve); });
    console.log("Manager ready: http://0.0.0.0:" + configPort);
  } else {
    await new Promise(function(resolve) { server.listen(0, "127.0.0.1", resolve); });
    var port = server.address().port;
    var url = "http://127.0.0.1:" + port;

    console.log("Manager ready: " + url);
    console.log("Opening browser...\n");

    var os = platform();
    try {
      if (os === "win32") {
        execSync('start "" "' + url + '"', { stdio: "ignore" });
      } else if (os === "darwin") {
        execSync('open "' + url + '"', { stdio: "ignore" });
      } else {
        execSync('xdg-open "' + url + '"', { stdio: "ignore" });
      }
    } catch {
      console.log("Could not open browser. Please visit: " + url);
    }
  }

  if (!serverMode) {
    return shutdownPromise;
  }

  // Server mode: keep running indefinitely
  return new Promise(function() {});
}
