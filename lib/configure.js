import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const GATEWAY_PORT = 28789;

export function generateConfig(apiKey, botToken) {
  return {
    models: {
      providers: {
        anthropic: {
          api: "anthropic-messages",
          baseUrl: "https://code.evolink.ai",
          apiKey: apiKey,
          models: [
            {
              id: "claude-opus-4-6",
              name: "Claude Opus 4.6",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 200000,
              maxTokens: 8192,
            },
          ],
        },
      },
    },
    agents: {
      defaults: {
        model: {
          primary: "anthropic/claude-opus-4-6",
        },
      },
    },
    channels: {
      telegram: {
        enabled: true,
        botToken: botToken,
        dmPolicy: "pairing",
        groups: {
          "*": {
            requireMention: true,
          },
        },
      },
    },
    plugins: {
      entries: {
        telegram: {
          enabled: true,
        },
      },
    },
    gateway: {
      port: GATEWAY_PORT,
    },
  };
}

export async function runSetup(apiKey, botToken) {
  // 1. Write config file
  const configDir = join(homedir(), ".openclaw");
  const configPath = join(configDir, "openclaw.json");

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Merge with existing config if present
  let config = {};
  if (existsSync(configPath)) {
    try {
      const existing = JSON.parse(
        readFileSync(configPath, "utf-8")
      );
      config = existing;
    } catch {
      // ignore parse errors, overwrite
    }
  }

  const generated = generateConfig(apiKey, botToken);
  const merged = deepMerge(config, generated);

  writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf-8");
  console.log(`✓ Config written to ${configPath}`);

  // 2. Run openclaw onboard (skip health check — gateway may not be ready yet)
  console.log("Running OpenClaw onboarding...");
  try {
    execSync(
      `openclaw onboard --install-daemon --flow quickstart --accept-risk --skip-skills --skip-channels --skip-ui --skip-health --non-interactive --gateway-port ${GATEWAY_PORT}`,
      { stdio: "inherit" }
    );
    console.log("✓ OpenClaw onboarding complete.");
  } catch {
    throw new Error(
      "Onboarding failed. You can retry manually: openclaw onboard --install-daemon"
    );
  }

  // 3. Re-write config to ensure our values survive onboard's merge
  const postOnboard = JSON.parse(readFileSync(configPath, "utf-8"));
  const final = deepMerge(postOnboard, generated);
  writeFileSync(configPath, JSON.stringify(final, null, 2), "utf-8");

  // 4. Restart gateway with correct config
  console.log("Restarting gateway...");
  try {
    execSync("openclaw gateway restart", { stdio: "inherit", timeout: 15000 });
    console.log("✓ Gateway restarted.");
  } catch {
    console.log("⚠ Gateway restart skipped (may need manual start).");
  }

  return { configPath };
}

const CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");

export async function connectTelegramUser(telegramId) {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error("Config not found. Please run setup first.");
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));

  // Switch to allowlist mode and add user ID
  if (!config.channels) config.channels = {};
  if (!config.channels.telegram) config.channels.telegram = {};
  config.channels.telegram.dmPolicy = "allowlist";

  const existing = (config.channels.telegram.allowFrom ?? []).map(String);
  if (!existing.includes(telegramId)) {
    existing.push(telegramId);
  }
  config.channels.telegram.allowFrom = existing;

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  console.log(`✓ Telegram user ${telegramId} added to allowlist.`);

  // Restart gateway to pick up changes
  try {
    execSync("openclaw gateway restart", { stdio: "inherit", timeout: 15000 });
    console.log("✓ Gateway restarted.");
  } catch {
    console.log("⚠ Gateway restart skipped.");
  }
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
