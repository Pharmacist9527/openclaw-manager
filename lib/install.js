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
    throw new Error(
      "Node.js is not installed or not in PATH.\n" +
      "OpenClaw CLI requires Node.js " + MIN_NODE_MAJOR + "+.\n" +
      "Please install Node.js from: https://nodejs.org\n" +
      "Or use a version manager:\n" +
      "  nvm install " + MIN_NODE_MAJOR + "\n" +
      "  nvm use " + MIN_NODE_MAJOR
    );
  }

  try {
    var cmd = nodePath === "node" ? "node --version" : '"' + nodePath + '" --version';
    var output = execSync(cmd, { stdio: "pipe", shell: true }).toString().trim();
    var match = output.match(/^v(\d+)/);
    if (!match) {
      throw new Error(
        "Could not detect Node.js version.\n" +
        "OpenClaw CLI requires Node.js " + MIN_NODE_MAJOR + "+.\n" +
        "Please ensure Node.js is properly installed: https://nodejs.org"
      );
    }
    var major = parseInt(match[1], 10);
    if (major < MIN_NODE_MAJOR) {
      throw new Error(
        "Node.js " + output + " detected, but OpenClaw CLI requires Node.js " + MIN_NODE_MAJOR + "+.\n" +
        "Please upgrade Node.js:\n" +
        "  Download from: https://nodejs.org\n" +
        "  Or use nvm: nvm install " + MIN_NODE_MAJOR + " && nvm use " + MIN_NODE_MAJOR + "\n" +
        "  Or use fnm: fnm install " + MIN_NODE_MAJOR + " && fnm use " + MIN_NODE_MAJOR
      );
    } else {
      console.log("Node.js " + output + " detected.");
    }
  } catch (err) {
    // 如果是我们抛出的错误，直接传递
    if (err.message.includes("Node.js")) throw err;
    // 其他错误
    throw new Error(
      "Could not check Node.js version.\n" +
      "Please ensure Node.js " + MIN_NODE_MAJOR + "+ is properly installed: https://nodejs.org"
    );
  }
}

function ensureGit() {
  // Check if git is available — same PATH issue as Node.js in pkg exe
  var gitFound = false;
  try {
    execSync("git --version", { stdio: "pipe", shell: true });
    gitFound = true;
  } catch {}

  // If not in PATH, check common install locations and fix PATH
  if (!gitFound && IS_WIN) {
    var gitCandidates = [
      join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd"),
      "C:\\Program Files\\Git\\cmd",
      join(process.env.LOCALAPPDATA || "", "Programs", "Git", "cmd"),
    ];
    for (var g = 0; g < gitCandidates.length; g++) {
      if (gitCandidates[g] && existsSync(join(gitCandidates[g], "git.exe"))) {
        process.env.PATH = gitCandidates[g] + ";" + process.env.PATH;
        gitFound = true;
        break;
      }
    }
  }

  if (gitFound) return;

  // Windows: auto-install via winget (we already have admin privileges)
  if (IS_WIN) {
    console.log("Git not found. Installing Git via winget...");
    try {
      execSync("winget install --id Git.Git -e --silent --source winget --accept-package-agreements --accept-source-agreements", {
        stdio: "inherit", shell: true, timeout: 180000,
      });
      // Add Git to PATH for current process
      var gitPath = join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd");
      if (existsSync(gitPath)) {
        process.env.PATH = gitPath + ";" + process.env.PATH;
      }
      execSync("git --version", { stdio: "pipe", shell: true });
      console.log("Git installed successfully.");
      return;
    } catch {
      throw new Error(
        "Git is required but could not be installed automatically.\n" +
        "Please install Git manually: https://git-scm.com/download/win\n" +
        "Then restart this program."
      );
    }
  }

  // Mac/Linux: give clear instructions instead of trying to auto-install
  var instructions = IS_MAC
    ? "Install via: brew install git\n  Or: xcode-select --install"
    : "Install via: sudo apt install git\n  Or: sudo yum install git";

  throw new Error(
    "Git is required but not found.\n" +
    "Please install Git first:\n  " + instructions + "\n" +
    "Then restart this program."
  );
}

export async function checkAndInstallOpenclaw() {
  ensureNodeInPath();
  checkNodeVersion();
  ensureGit();

  try {
    execSync("openclaw --version", { stdio: "pipe", shell: true });
    console.log("OpenClaw is already installed.");

    // 检查 Gateway 是否需要安装
    try {
      var doctorOutput = execSync("openclaw doctor", {
        stdio: "pipe",
        shell: true,
        timeout: 10000
      }).toString();

      // 直接检查 Gateway 是否未安装，跳过无效的 doctor --fix
      if (doctorOutput.includes("Gateway service not installed")) {
        console.log("检测到 Gateway 服务未安装，正在安装...");
        try {
          execSync("openclaw gateway install", {
            stdio: "inherit",
            shell: true,
            timeout: 60000
          });
          console.log("Gateway 服务安装完成。");
        } catch (gatewayErr) {
          console.warn("Warning: Gateway 安装失败: " + gatewayErr.message);
          console.warn("这可能会导致后续部署失败，但不影响程序启动。");
        }
      }
    } catch (err) {
      // doctor 命令失败不影响程序启动
      console.warn("Warning: openclaw doctor 检查失败: " + err.message);
    }
  } catch (err) {
    // 如果是配置格式错误，重新抛出
    if (err.message && err.message.includes("configuration format")) {
      throw err;
    }
    // 否则是 OpenClaw 未安装，继续安装流程
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
      var msg = (err.stderr || err.message || "").toString();
      var hint;
      if (/unable to access|Failed to connect|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|443/.test(msg)) {
        hint = "Network error: cannot reach github.com.\n" +
          "Please check your internet connection or proxy settings.\n" +
          "If you are behind a proxy, run:\n" +
          "  git config --global http.proxy http://your-proxy:port\n" +
          "  npm config set proxy http://your-proxy:port";
      } else if (/EACCES|permission denied/i.test(msg)) {
        hint = IS_WIN
          ? "Permission denied. Try running this program as Administrator."
          : "Permission denied. Try: sudo npm install -g openclaw@latest";
      } else {
        hint = IS_WIN
          ? "Try running this program as Administrator."
          : "Try: sudo npm install -g openclaw@latest";
      }
      throw new Error(
        "Failed to install OpenClaw.\n" + hint
      );
    }
  }
}
