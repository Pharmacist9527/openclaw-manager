import express from "express";
import { createServer } from "node:http";
import { execSync } from "node:child_process";
import { platform } from "node:os";
import { INDEX_HTML } from "./html.js";
import { runSetup, connectTelegramUser } from "./configure.js";

export async function startSetupServer() {
  const app = express();
  app.use(express.json());

  // Serve the setup page
  app.get("/", (_req, res) => {
    res.type("html").send(INDEX_HTML);
  });

  // Handle setup submission
  app.post("/setup", async (req, res) => {
    const { apiKey, botToken } = req.body;

    if (!apiKey?.trim() || !botToken?.trim()) {
      return res.status(400).json({ error: "Both fields are required." });
    }

    try {
      const result = await runSetup(apiKey.trim(), botToken.trim());
      res.json({
        success: true,
        message: "OpenClaw installed and configured successfully!",
        configPath: result.configPath,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Handle Telegram user connection
  app.post("/connect", async (req, res) => {
    const { telegramId } = req.body;

    if (!telegramId?.trim()) {
      return res.status(400).json({ error: "Telegram User ID is required." });
    }

    try {
      await connectTelegramUser(telegramId.trim());
      res.json({ success: true, message: "Telegram user connected!" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Find a free port
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;

  console.log(`Setup page ready: ${url}`);
  console.log("Opening browser...\n");

  // Open browser (cross-platform)
  const os = platform();
  try {
    if (os === "win32") {
      execSync(`start "" "${url}"`, { stdio: "ignore" });
    } else if (os === "darwin") {
      execSync(`open "${url}"`, { stdio: "ignore" });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: "ignore" });
    }
  } catch {
    console.log(`Could not open browser. Please visit: ${url}`);
  }

  // Auto-shutdown after setup completes
  return new Promise((resolve) => {
    app.post("/shutdown", (_req, res) => {
      res.json({ ok: true });
      console.log("\nSetup complete. Shutting down...");
      server.close(() => resolve());
    });
  });
}
