import { execSync } from "node:child_process";

export async function checkAndInstallOpenclaw() {
  try {
    execSync("openclaw --version", { stdio: "pipe" });
    console.log("✓ OpenClaw is already installed.");
  } catch {
    console.log("Installing OpenClaw...");
    try {
      execSync("npm install -g openclaw@latest", { stdio: "inherit" });
      console.log("✓ OpenClaw installed successfully.");
    } catch (err) {
      throw new Error(
        "Failed to install OpenClaw. Please run: npm install -g openclaw@latest"
      );
    }
  }
}
