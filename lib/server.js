import express from "express";
import { createServer } from "node:http";
import { execSync, spawn } from "node:child_process";
import { platform, homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { INDEX_HTML } from "./html.js";
import { getAllProfiles, MODEL_CATALOG, validateProfileName, validateApiKey, validateBotToken, validateModelId, validateChannel, runSetupStream, connectTelegramUser, startGateway, stopGateway, restartGateway, deleteProfile, changeModel, listPairingRequests, approvePairing } from "./configure.js";
import { detectFixTools, generateFixPlan, executeFixPlan } from "./auto-fix.js";

// Safely embed JSON inside <script> tags — prevent </script> breakout
function safeStringify(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

export async function startSetupServer(envErrors) {
  const app = express();
  app.use(express.json());

  // Serve page with server-injected state
  app.get("/", async (_req, res) => {
    const profiles = await getAllProfiles();
    const initScript = "<script>window.__STATE__=" + safeStringify({
      profiles,
      models: MODEL_CATALOG,
      envErrors: envErrors || []
    }) + "</script>";
    const html = INDEX_HTML.replace("<!--SERVER_STATE-->", initScript);
    res.type("html").send(html);
  });

  // Get all profiles
  app.get("/profiles", async (_req, res) => {
    res.json(await getAllProfiles());
  });

  // SSE: deploy new instance with progress - 使用 POST 防止 CSRF
  app.post("/setup-stream", (req, res) => {
    // CSRF 防护：严格检查 Origin/Referer
    var origin = req.headers.origin || req.headers.referer;
    var host = req.headers.host;
    if (origin) {
      // 提取 origin 的 host 部分进行严格匹配
      try {
        var originUrl = new URL(origin);
        if (originUrl.host !== host) {
          res.status(403).json({ error: "Forbidden: Invalid origin" });
          return;
        }
      } catch (e) {
        res.status(403).json({ error: "Forbidden: Invalid origin format" });
        return;
      }
    }

    var profile = (req.body.profile || "default").trim();
    var apiKey = (req.body.apiKey || "").trim();
    var modelId = (req.body.model || "claude-opus-4-6").trim();
    var channel = (req.body.channel || "telegram").trim();
    var botToken = (req.body.botToken || "").trim();
    var appId = (req.body.appId || "").trim();
    var appSecret = (req.body.appSecret || "").trim();

    // 输入验证
    try {
      validateProfileName(profile);
      apiKey = validateApiKey(apiKey);
      modelId = validateModelId(modelId);
      channel = validateChannel(channel);
      if (channel === "telegram" && botToken) {
        botToken = validateBotToken(botToken);
      }
    } catch (e) {
      res.status(400).json({ error: e.message });
      return;
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
        res.write("data: " + JSON.stringify({
          percent: -1,
          message: err.message || "安装失败",
          error: true,
          diagnosis: err.diagnosis || null,
          logs: err.logs || []
        }) + "\n\n");
        res.end();
      });
  });

  // SSE: connect user with progress - 使用 POST 防止 CSRF
  app.post("/connect-stream", (req, res) => {
    // CSRF 防护：严格检查 Origin/Referer
    var origin = req.headers.origin || req.headers.referer;
    var host = req.headers.host;
    if (origin) {
      try {
        var originUrl = new URL(origin);
        if (originUrl.host !== host) {
          res.status(403).json({ error: "Forbidden: Invalid origin" });
          return;
        }
      } catch (e) {
        res.status(403).json({ error: "Forbidden: Invalid origin format" });
        return;
      }
    }

    var profile = (req.body.profile || "default").trim();
    var channel = (req.body.channel || "telegram").trim();
    var telegramId = (req.body.telegramId || "").trim();

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
      res.write("data: " + JSON.stringify({
        percent: -1,
        message: err.message || "连接失败",
        error: true,
        diagnosis: err.diagnosis || null,
        logs: err.logs || []
      }) + "\n\n");
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

  // List pending pairing requests
  app.get("/pairing-requests", (req, res) => {
    var profile = (req.query.profile || "default").trim();
    var channel = (req.query.channel || "").trim();
    if (!channel) { res.status(400).json({ error: "Channel required" }); return; }
    var result = listPairingRequests(profile, channel);
    res.json(result);
  });

  // Approve a pairing request
  app.post("/pairing-approve", (req, res) => {
    var profile = (req.body.profile || "default").trim();
    var channel = (req.body.channel || "").trim();
    var code = (req.body.code || "").trim();
    if (!channel || !code) { res.status(400).json({ error: "Channel and code required" }); return; }
    try {
      approvePairing(profile, channel, code);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to approve: " + (err.message || "unknown error") });
    }
  });

  // Get auto-fix plan (不执行)
  app.get("/auto-fix-plan", (req, res) => {
    try {
      var tools = detectFixTools();
      var plan = generateFixPlan(envErrors || [], tools);
      res.json({ plan: plan, tools: tools });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Execute auto-fix (SSE 流) - 使用 POST 防止 CSRF
  app.post("/auto-fix-stream", (req, res) => {
    // CSRF 防护：严格检查 Origin/Referer
    var origin = req.headers.origin || req.headers.referer;
    var host = req.headers.host;
    if (origin) {
      try {
        var originUrl = new URL(origin);
        if (originUrl.host !== host) {
          res.status(403).json({ error: "Forbidden: Invalid origin" });
          return;
        }
      } catch (e) {
        res.status(403).json({ error: "Forbidden: Invalid origin format" });
        return;
      }
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
      var tools = detectFixTools();
      var plan = generateFixPlan(envErrors || [], tools);

      if (plan.length === 0) {
        res.write("data: " + JSON.stringify({
          percent: -1,
          message: "没有可自动修复的问题",
          error: true
        }) + "\n\n");
        res.end();
        return;
      }

      executeFixPlan(plan, sendProgress)
        .then(function() {
          res.write("data: " + JSON.stringify({
            percent: 100,
            message: "修复完成！",
            done: true,
            success: true
          }) + "\n\n");
          res.end();
        })
        .catch(function(err) {
          res.write("data: " + JSON.stringify({
            percent: -1,
            message: err.message || "修复失败",
            error: true
          }) + "\n\n");
          res.end();
        });
    } catch (err) {
      // 捕获 detectFixTools 或 generateFixPlan 的错误
      res.write("data: " + JSON.stringify({
        percent: -1,
        message: "初始化修复计划失败: " + (err.message || "未知错误"),
        error: true
      }) + "\n\n");
      res.end();
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
