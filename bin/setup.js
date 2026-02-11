#!/usr/bin/env node

import { checkAndInstallOpenclaw } from "../lib/install.js";
import { startSetupServer } from "../lib/server.js";
import { createInterface } from "node:readline";

function waitForKey(msg = "Press Enter to exit...") {
  return new Promise((resolve) => {
    console.log(`\n${msg}`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.once("line", () => { rl.close(); resolve(); });
    // Also resolve after 60s in case stdin is not interactive
    setTimeout(() => { rl.close(); resolve(); }, 60000);
  });
}

async function main() {
  console.log("\n🐾 OpenClaw Quick Setup\n");

  // Step 1: ensure openclaw is installed
  await checkAndInstallOpenclaw();

  // Step 2: launch browser-based setup UI
  await startSetupServer();
}

main().catch(async (err) => {
  console.error("\nSetup failed:", err.message);
  await waitForKey();
  process.exit(1);
});
