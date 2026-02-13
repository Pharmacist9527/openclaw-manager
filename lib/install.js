import { execSync } from "node:child_process";

const MIN_NODE_MAJOR = 22;
const IS_WIN = process.platform === "win32";

function checkNodeVersion() {
  try {
    const output = execSync("node --version", { stdio: "pipe" }).toString().trim();
    const match = output.match(/^v(\d+)/);
    if (!match) {
      console.warn(
        "WARNING: Could not detect Node.js version.\n" +
        "OpenClaw CLI requires Node.js " + MIN_NODE_MAJOR + "+.\n" +
        "Continuing anyway, but things may not work.\n"
      );
      return;
    }
    const major = parseInt(match[1], 10);
    if (major < MIN_NODE_MAJOR) {
      console.warn(
        "WARNING: Node.js " + output + " detected, but OpenClaw CLI requires Node.js " + MIN_NODE_MAJOR + "+.\n" +
        "Please upgrade: https://nodejs.org\n" +
        "Continuing anyway, but things may not work.\n"
      );
    }
  } catch {
    console.warn(
      "WARNING: Node.js is not installed or not in PATH.\n" +
      "OpenClaw CLI requires Node.js " + MIN_NODE_MAJOR + "+.\n" +
      "Continuing anyway, but things may not work.\n"
    );
  }
}

export async function checkAndInstallOpenclaw() {
  checkNodeVersion();

  try {
    execSync("openclaw --version", { stdio: "pipe" });
    console.log("OpenClaw is already installed.");
  } catch {
    console.log("Installing OpenClaw...");
    try {
      execSync("npm install -g openclaw@latest", {
        stdio: "inherit",
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
