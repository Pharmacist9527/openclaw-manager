#!/usr/bin/env node

import { checkAndInstallOpenclaw } from "../lib/install.js";
import { startSetupServer } from "../lib/server.js";

async function main() {
  console.log("\n🐾 OpenClaw Quick Setup\n");

  // Step 1: ensure openclaw is installed
  await checkAndInstallOpenclaw();

  // Step 2: launch browser-based setup UI
  await startSetupServer();
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
