import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE_PORT = 28789;

export function validateProfileName(name) {
  if (!name || name === "default") return;
  if (name.length > 32) throw new Error("Profile name too long (max 32 characters)");
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("Profile name can only contain letters, numbers, hyphens and underscores");
}

export const MODEL_CATALOG = [
  { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
  { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5" },
  { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
  { id: "claude-opus-4-1-20250805", name: "Claude Opus 4.1" },
  { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
];

function profileDir(profile) {
  const suffix = profile === "default" ? "" : `-${profile}`;
  return join(homedir(), `.openclaw${suffix}`);
}

function configPath(profile) {
  return join(profileDir(profile), "openclaw.json");
}

function profileArgs(profile) {
  return profile === "default" ? [] : ["--profile", profile];
}

const IS_WIN = process.platform === "win32";

// Safe command execution: array args prevent injection; shell needed on Windows for .cmd resolution
function execSafe(cmd, args, opts) {
  return execFileSync(cmd, args, Object.assign({ stdio: "ignore", timeout: 15000, shell: IS_WIN }, opts || {}));
}

export function listProfiles() {
  const home = homedir();
  const profiles = [];
  if (existsSync(join(home, ".openclaw", "openclaw.json"))) {
    profiles.push("default");
  }
  try {
    const entries = readdirSync(home, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(".openclaw-")) {
        const name = entry.name.slice(".openclaw-".length);
        if (name && existsSync(join(home, entry.name, "openclaw.json"))) {
          profiles.push(name);
        }
      }
    }
  } catch (e) {
    console.error("Warning: could not scan home directory for profiles:", e.message);
  }
  return profiles;
}

function readPort(profile) {
  try {
    const cfg = JSON.parse(readFileSync(configPath(profile), "utf-8"));
    if (cfg.gateway && cfg.gateway.port) return cfg.gateway.port;
  } catch (e) {
    console.error("Warning: could not read port for profile " + profile + ":", e.message);
  }
  return BASE_PORT;
}

function checkPort(port) {
  return new Promise(function(resolve) {
    const sock = createConnection({ host: "127.0.0.1", port: port }, function() {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", function() { resolve(false); });
    sock.setTimeout(800, function() { sock.destroy(); resolve(false); });
  });
}

export async function getProfileInfo(profile) {
  const cfgPath = configPath(profile);
  const port = readPort(profile);
  const running = await checkPort(port);

  let model = "";
  let modelId = "";
  let channel = "";
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    // Read model
    if (cfg.agents && cfg.agents.defaults && cfg.agents.defaults.model && cfg.agents.defaults.model.primary) {
      const primary = cfg.agents.defaults.model.primary;
      const slash = primary.indexOf("/");
      modelId = slash >= 0 ? primary.slice(slash + 1) : primary;
      const found = MODEL_CATALOG.find(function(m) { return m.id === modelId; });
      model = found ? found.name : modelId;
    }
    // Read channel
    if (cfg.channels) {
      if (cfg.channels.telegram && cfg.channels.telegram.enabled) channel = "Telegram";
      else if (cfg.channels.feishu && cfg.channels.feishu.enabled) channel = "Feishu";
      else {
        var keys = Object.keys(cfg.channels);
        if (keys.length > 0) channel = keys[0];
      }
    }
  } catch (e) {
    console.error("Warning: could not read config for profile " + profile + ":", e.message);
  }

  return { profile, port, gateway: running ? "running" : "stopped", model, modelId, channel };
}

export async function getAllProfiles() {
  const names = listProfiles();
  return Promise.all(names.map(function(n) { return getProfileInfo(n); }));
}

function nextAvailablePort() {
  const usedPorts = new Set();
  for (const p of listProfiles()) {
    usedPorts.add(readPort(p));
  }
  let port = BASE_PORT;
  while (usedPorts.has(port)) port++;
  return port;
}

export function generateConfig(apiKey, modelId, channel, channelCreds, port) {
  const model = MODEL_CATALOG.find(function(m) { return m.id === modelId; }) || MODEL_CATALOG[0];
  const config = {
    models: {
      providers: {
        anthropic: {
          api: "anthropic-messages",
          baseUrl: "https://direct.evolink.ai",
          apiKey: apiKey,
          models: [
            {
              id: model.id,
              name: model.name,
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
          primary: "anthropic/" + model.id,
        },
      },
    },
    gateway: {
      port: port,
    },
  };

  // Channel-specific config
  if (channel === "telegram") {
    config.channels = {
      telegram: {
        enabled: true,
        botToken: channelCreds.botToken,
        dmPolicy: "pairing",
        groups: { "*": { requireMention: true } },
      },
    };
  } else if (channel === "feishu") {
    config.channels = {
      feishu: {
        enabled: true,
        dmPolicy: "pairing",
        groupPolicy: "open",
        requireMention: true,
        accounts: {
          main: {
            appId: channelCreds.appId,
            appSecret: channelCreds.appSecret,
          },
        },
      },
    };
  }

  return config;
}

// Stream-based setup with progress events via SSE
// Returns { promise, abort } — call abort() to kill the child process on client disconnect
export function runSetupStream(profile, apiKey, modelId, channel, channelCreds, onProgress) {
  let child = null;
  const promise = new Promise(function(resolve, reject) {
    const port = nextAvailablePort();
    const dir = profileDir(profile);
    const cfgPath = configPath(profile);

    onProgress(5, "Creating profile directory...");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let config = {};
    if (existsSync(cfgPath)) {
      try { config = JSON.parse(readFileSync(cfgPath, "utf-8")); } catch (e) {
        onProgress(5, "Warning: existing config unreadable, starting fresh");
      }
    }

    onProgress(10, "Writing configuration...");
    const generated = generateConfig(apiKey, modelId, channel, channelCreds, port);
    const merged = deepMerge(config, generated);
    writeFileSync(cfgPath, JSON.stringify(merged, null, 2), "utf-8");

    onProgress(15, "Running onboarding...");
    const args = [...profileArgs(profile), "onboard", "--install-daemon", "--flow", "quickstart", "--accept-risk",
      "--skip-skills", "--skip-channels", "--skip-ui", "--skip-health",
      "--non-interactive", "--gateway-port", String(port)];

    child = spawn("openclaw", args, { stdio: ["ignore", "pipe", "pipe"], shell: IS_WIN });
    let pct = 15;
    const maxOnboard = 80;

    function tick(line) {
      if (pct < maxOnboard) {
        pct = Math.min(pct + 3, maxOnboard);
        const msg = line.length > 60 ? line.slice(0, 60) + "..." : line;
        onProgress(pct, msg || "Onboarding...");
      }
    }

    child.stdout.on("data", function(d) {
      d.toString().split("\n").forEach(function(l) { if (l.trim()) tick(l.trim()); });
    });
    child.stderr.on("data", function(d) {
      d.toString().split("\n").forEach(function(l) { if (l.trim()) tick(l.trim()); });
    });

    child.on("close", function(code) {
      if (code !== 0) {
        onProgress(pct, "Onboarding failed");
        return reject(new Error("Onboarding failed (exit " + code + ")"));
      }

      onProgress(85, "Applying final configuration...");
      try {
        const postOnboard = JSON.parse(readFileSync(cfgPath, "utf-8"));
        const final = deepMerge(postOnboard, generated);
        // Fix plugin entries: onboard writes enabled:false, gateway needs true
        if (!final.plugins) final.plugins = {};
        if (!final.plugins.entries) final.plugins.entries = {};
        if (channel === "telegram") {
          final.plugins.entries.telegram = { enabled: true };
        } else if (channel === "feishu") {
          final.plugins.entries.feishu = { enabled: true };
        }
        writeFileSync(cfgPath, JSON.stringify(final, null, 2), "utf-8");
      } catch (cfgErr) {
        onProgress(85, "Warning: failed to apply final config: " + cfgErr.message);
      }

      onProgress(88, "Installing gateway service...");
      var serviceInstalled = false;
      try {
        execSafe("openclaw", [...profileArgs(profile), "gateway", "install"]);
        serviceInstalled = true;
      } catch (installErr) {
        onProgress(88, "Warning: gateway service install failed — you may need to run 'openclaw" +
          (profile === "default" ? "" : " --profile " + profile) +
          " gateway install' manually in Terminal. (" + installErr.message + ")");
      }

      if (serviceInstalled) {
        onProgress(92, "Starting gateway...");
        try {
          execSafe("openclaw", [...profileArgs(profile), "gateway", "start"]);
        } catch (startErr) {
          onProgress(92, "Warning: gateway start failed: " + startErr.message);
        }
      }

      onProgress(100, "Done");
      resolve({ configPath: cfgPath, port });
    });

    child.on("error", function(err) {
      reject(new Error("Failed to start onboarding: " + err.message));
    });
  });

  return {
    promise: promise,
    abort: function() { if (child && !child.killed) child.kill(); }
  };
}

export function connectTelegramUser(profile, telegramId, onProgress) {
  const cfgPath = configPath(profile);
  if (!existsSync(cfgPath)) throw new Error("Config not found.");

  if (onProgress) onProgress(20, "Reading configuration...");
  const config = JSON.parse(readFileSync(cfgPath, "utf-8"));
  if (!config.channels) config.channels = {};
  if (!config.channels.telegram) config.channels.telegram = {};
  config.channels.telegram.dmPolicy = "allowlist";

  const existing = (config.channels.telegram.allowFrom || []).map(String);
  if (!existing.includes(telegramId)) existing.push(telegramId);
  config.channels.telegram.allowFrom = existing;

  if (onProgress) onProgress(50, "Saving configuration...");
  writeFileSync(cfgPath, JSON.stringify(config, null, 2), "utf-8");

  if (onProgress) onProgress(70, "Restarting gateway...");
  try {
    execSafe("openclaw", [...profileArgs(profile), "gateway", "restart"]);
  } catch (err) {
    if (onProgress) onProgress(70, "Warning: gateway restart failed: " + err.message);
  }

  if (onProgress) onProgress(100, "Connected");
}

export function startGateway(profile) {
  // First ensure the service is installed (launchd/systemd), then start it
  // Port is read from config by the gateway itself
  try {
    execSafe("openclaw", [...profileArgs(profile), "gateway", "install"]);
  } catch {}
  execSafe("openclaw", [...profileArgs(profile), "gateway", "start"], { stdio: "inherit" });
}

export function stopGateway(profile) {
  execSafe("openclaw", [...profileArgs(profile), "gateway", "stop"], { stdio: "inherit" });
}

export function changeModel(profile, modelId) {
  const model = MODEL_CATALOG.find(function(m) { return m.id === modelId; });
  if (!model) throw new Error("Unknown model: " + modelId);

  const cfgPath = configPath(profile);
  if (!existsSync(cfgPath)) throw new Error("Config not found for profile: " + profile);

  const config = JSON.parse(readFileSync(cfgPath, "utf-8"));

  // Update models.providers.anthropic.models[0]
  if (config.models && config.models.providers && config.models.providers.anthropic &&
      Array.isArray(config.models.providers.anthropic.models) && config.models.providers.anthropic.models.length > 0) {
    config.models.providers.anthropic.models[0].id = model.id;
    config.models.providers.anthropic.models[0].name = model.name;
  }

  // Update agents.defaults.model.primary
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  if (!config.agents.defaults.model) config.agents.defaults.model = {};
  config.agents.defaults.model.primary = "anthropic/" + model.id;

  writeFileSync(cfgPath, JSON.stringify(config, null, 2), "utf-8");
  restartGateway(profile);
}

export function restartGateway(profile) {
  // Ensure service is registered first (macOS gateway stop does launchctl bootout)
  try {
    execSafe("openclaw", [...profileArgs(profile), "gateway", "install"]);
  } catch {}
  execSafe("openclaw", [...profileArgs(profile), "gateway", "restart"]);
}

export function deleteProfile(profile) {
  // Stop gateway first
  try { stopGateway(profile); } catch {}

  // Remove scheduled task / daemon
  try {
    execSafe("openclaw", [...profileArgs(profile), "gateway", "uninstall"]);
  } catch {}

  // Remove profile directory
  const dir = profileDir(profile);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
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
