#!/usr/bin/env node

import { checkAndInstallOpenclaw } from "../lib/install.js";
import { startSetupServer } from "../lib/server.js";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";

function waitForKey(msg) {
  msg = msg || "Press Enter to exit...";
  return new Promise(function(resolve) {
    console.log("\n" + msg);
    var rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.once("line", function() { rl.close(); resolve(); });
    setTimeout(function() { rl.close(); resolve(); }, 60000);
  });
}

function checkAdmin() {
  if (process.platform !== "win32") return;
  try {
    execSync("net session", { stdio: "ignore" });
  } catch {
    throw new Error(
      "This program requires Administrator privileges.\n" +
      "Please right-click the exe and select \"Run as administrator\"."
    );
  }
}

async function main() {
  console.log("\nOpenClaw Manager\n");

  // 收集环境检查错误，但不中断启动
  var envErrors = [];

  try {
    checkAdmin();
  } catch (err) {
    envErrors.push({ type: "admin", message: err.message });
    console.error("Warning: " + err.message);
  }

  try {
    await checkAndInstallOpenclaw();
  } catch (err) {
    envErrors.push({ type: "openclaw", message: err.message });
    console.error("Warning: " + err.message);
  }

  // 无论环境检查是否通过，都启动前端服务器
  // 将错误信息传递给服务器，在前端显示
  await startSetupServer(envErrors);
}

main().catch(async function(err) {
  console.error("\nFailed: " + err.message);
  await waitForKey();
  process.exit(1);
});
