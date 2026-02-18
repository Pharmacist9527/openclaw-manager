#!/usr/bin/env node

import { checkAndInstallOpenclaw } from "../lib/install.js";
import { startSetupServer } from "../lib/server.js";
import { loadOrCreateConfig } from "../lib/auth.js";
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

  var args = process.argv.slice(2);
  var serverMode = args.indexOf("--server") !== -1;
  var resetToken = args.indexOf("--reset-token") !== -1;
  var portOverride = 0;
  var portIdx = args.indexOf("--port");
  if (portIdx !== -1 && args[portIdx + 1]) {
    portOverride = parseInt(args[portIdx + 1], 10);
    if (isNaN(portOverride) || portOverride < 1 || portOverride > 65535) {
      throw new Error("Invalid port number: " + args[portIdx + 1]);
    }
  }

  checkAdmin();
  await checkAndInstallOpenclaw();

  if (serverMode) {
    var config = loadOrCreateConfig(resetToken);
    var port = portOverride || config.port;
    var W = 42; // interior width between │ and │
    function boxLine(text) {
      return "\u2502  " + text + " ".repeat(Math.max(0, W - 2 - text.length)) + "\u2502";
    }
    console.log("\u250C" + "\u2500".repeat(W) + "\u2510");
    console.log(boxLine("Server Mode"));
    console.log(boxLine(""));
    console.log(boxLine("URL:   http://0.0.0.0:" + port));
    console.log(boxLine("Token: " + config.token));
    console.log(boxLine(""));
    console.log(boxLine("SSH tunnel example:"));
    console.log(boxLine("ssh -L " + port + ":localhost:" + port + " user@server"));
    console.log("\u2514" + "\u2500".repeat(W) + "\u2518");
    console.log("");
    await startSetupServer({ serverMode: true, port: port, token: config.token });
  } else {
    await startSetupServer({ serverMode: false });
  }
}

main().catch(async function(err) {
  console.error("\nFailed: " + err.message);
  await waitForKey();
  process.exit(1);
});
