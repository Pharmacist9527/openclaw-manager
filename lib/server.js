import express from "express";
import { createServer } from "node:http";
import { execSync } from "node:child_process";
import { platform } from "node:os";
import { INDEX_HTML } from "./html.js";
import { getAllProfiles, MODEL_CATALOG, validateProfileName, runSetupStream, connectTelegramUser, startGateway, stopGateway, restartGateway, deleteProfile, changeModel } from "./configure.js";

// Safely embed JSON inside <script> tags — prevent </script> breakout
function safeStringify(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

export async function startSetupServer() {
  const app = express();
  app.use(express.json());

  // Serve page with server-injected state
  app.get("/", async (_req, res) => {
    const profiles = await getAllProfiles();
    const initScript = "<script>window.__STATE__=" + safeStringify({ profiles, models: MODEL_CATALOG }) + "</script>";
    const html = INDEX_HTML.replace("<!--SERVER_STATE-->", initScript);
    res.type("html").send(html);
  });

  // Get all profiles
  app.get("/profiles", async (_req, res) => {
    res.json(await getAllProfiles());
  });

  // SSE: deploy new instance with progress
  app.get("/setup-stream", (req, res) => {
    var profile = (req.query.profile || "default").trim();
    var apiKey = (req.query.apiKey || "").trim();
    var modelId = (req.query.model || "claude-opus-4-6").trim();
    var channel = (req.query.channel || "telegram").trim();
    var botToken = (req.query.botToken || "").trim();
    var appId = (req.query.appId || "").trim();
    var appSecret = (req.query.appSecret || "").trim();

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
  app.get("/connect-stream", (req, res) => {
    var profile = (req.query.profile || "default").trim();
    var channel = (req.query.channel || "telegram").trim();
    var telegramId = (req.query.telegramId || "").trim();

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
  app.post("/start-gateway", (req, res) => {
    var profile = (req.body.profile || "default").trim();
    try {
      startGateway(profile);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to start gateway." });
    }
  });

  // Stop gateway
  app.post("/stop-gateway", (req, res) => {
    var profile = (req.body.profile || "default").trim();
    try {
      stopGateway(profile);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to stop gateway." });
    }
  });

  // Restart gateway
  app.post("/restart-gateway", (req, res) => {
    var profile = (req.body.profile || "default").trim();
    try {
      restartGateway(profile);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to restart gateway." });
    }
  });

  // Delete profile
  app.post("/delete-profile", (req, res) => {
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
  app.post("/change-model", (req, res) => {
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

  var server = createServer(app);
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

  return new Promise(function(resolve) {
    app.post("/shutdown", function(_req, res) {
      res.json({ ok: true });
      console.log("\nShutting down...");
      server.close(function() { resolve(); });
    });
  });
}
