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
  checkAdmin();
  await checkAndInstallOpenclaw();
  await startSetupServer();
}

main().catch(async function(err) {
  console.error("\nFailed: " + err.message);
  await waitForKey();
  process.exit(1);
});
