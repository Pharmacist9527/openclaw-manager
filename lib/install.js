import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const MIN_NODE_MAJOR = 22;
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

// Find node executable — pkg exe may not have it in PATH
function findNodePath() {
  // Try PATH first
  try {
    execSync("node --version", { stdio: "pipe", shell: true });
    return "node";
  } catch {}

  var home = homedir();
  var candidates = [];

  if (IS_WIN) {
    candidates = [
      join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe"),
      join(process.env.LOCALAPPDATA || "", "Programs", "nodejs", "node.exe"),
      "C:\\Program Files\\nodejs\\node.exe",
    ];
  } else if (IS_MAC) {
    candidates = [
      "/opt/homebrew/bin/node",           // Homebrew ARM (Apple Silicon)
      "/usr/local/bin/node",              // Homebrew Intel
      join(home, ".nvm/current/bin/node"),// nvm symlink
      join(home, ".fnm/current/bin/node"),// fnm symlink
    ];
  } else {
    // Linux
    candidates = [
      "/usr/bin/node",                    // system package manager
      "/usr/local/bin/node",              // manual install
      join(home, ".nvm/current/bin/node"),// nvm symlink
      join(home, ".fnm/current/bin/node"),// fnm symlink
      "/snap/node/current/bin/node",      // snap
    ];
  }

  // Also scan nvm versions directories for any installed node
  var nvmDir = process.env.NVM_DIR || join(home, ".nvm");
  if (!IS_WIN && existsSync(join(nvmDir, "versions", "node"))) {
    try {
      var dirs = readdirSync(join(nvmDir, "versions", "node"))
        .filter(function(d) { return d.startsWith("v"); })
        .sort()
        .reverse();
      for (var d = 0; d < dirs.length; d++) {
        candidates.push(join(nvmDir, "versions", "node", dirs[d], "bin", "node"));
      }
    } catch {}
  }

  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i] && existsSync(candidates[i])) return candidates[i];
  }
  return null;
}

// Ensure PATH includes Node.js directory so child commands (npm, openclaw) work
function ensureNodeInPath() {
  var nodePath = findNodePath();
  if (!nodePath || nodePath === "node") return; // already in PATH or not found
  var nodeDir = nodePath.replace(/[/\\]node(\.exe)?$/i, "");
  if (process.env.PATH && process.env.PATH.indexOf(nodeDir) === -1) {
    process.env.PATH = nodeDir + (IS_WIN ? ";" : ":") + process.env.PATH;
  }
}

function checkNodeVersion() {
  var nodePath = findNodePath();
  if (!nodePath) {
    console.warn(
      "WARNING: Node.js is not installed or not in PATH.\n" +
      "OpenClaw CLI requires Node.js " + MIN_NODE_MAJOR + "+.\n" +
      "Continuing anyway, but things may not work.\n"
    );
    return;
  }

  try {
    var cmd = nodePath === "node" ? "node --version" : '"' + nodePath + '" --version';
    var output = execSync(cmd, { stdio: "pipe", shell: true }).toString().trim();
    var match = output.match(/^v(\d+)/);
    if (!match) {
      console.warn(
        "WARNING: Could not detect Node.js version.\n" +
        "OpenClaw CLI requires Node.js " + MIN_NODE_MAJOR + "+.\n" +
        "Continuing anyway, but things may not work.\n"
      );
      return;
    }
    var major = parseInt(match[1], 10);
    if (major < MIN_NODE_MAJOR) {
      console.warn(
        "WARNING: Node.js " + output + " detected, but OpenClaw CLI requires Node.js " + MIN_NODE_MAJOR + "+.\n" +
        "Please upgrade: https://nodejs.org\n" +
        "Continuing anyway, but things may not work.\n"
      );
    } else {
      console.log("Node.js " + output + " detected.");
    }
  } catch {
    console.warn(
      "WARNING: Could not check Node.js version.\n" +
      "Continuing anyway, but things may not work.\n"
    );
  }
}

export async function checkAndInstallOpenclaw() {
  ensureNodeInPath();
  checkNodeVersion();

  try {
    execSync("openclaw --version", { stdio: "pipe", shell: true });
    console.log("OpenClaw is already installed.");
  } catch {
    console.log("Installing OpenClaw...");
    try {
      execSync("npm install -g openclaw@latest", {
        stdio: "inherit",
        shell: true,
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "url.https://github.com/.insteadOf",
          GIT_CONFIG_VALUE_0: "ssh://git@github.com/",
        },
      });
      console.log("OpenClaw installed successfully.");
    } catch (err) {
      var hint = IS_WIN
        ? "Try running this program as Administrator."
        : "Try: sudo npm install -g openclaw@latest";
      throw new Error(
        "Failed to install OpenClaw.\n" + hint
      );
    }
  }
}
