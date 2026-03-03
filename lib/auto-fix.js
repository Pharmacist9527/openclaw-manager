import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const MIN_NODE_MAJOR = 22;

// 检测系统可用的修复工具
export function detectFixTools() {
  var tools = {
    hasNvm: existsSync(join(homedir(), ".nvm")),
    hasBrew: false,
    hasWinget: false,
    platform: process.platform
  };

  // 检测 Homebrew (macOS)
  if (IS_MAC) {
    try {
      execSync("brew --version", { stdio: "pipe", shell: true });
      tools.hasBrew = true;
    } catch {}
  }

  // 检测 winget (Windows)
  if (IS_WIN) {
    try {
      execSync("winget --version", { stdio: "pipe", shell: true });
      tools.hasWinget = true;
    } catch {}
  }

  return tools;
}

// 自动安装 nvm
export async function installNvm(onProgress) {
  if (IS_WIN) {
    throw new Error(
      "Windows 需要手动安装 nvm-windows\n" +
      "请访问: https://github.com/coreybutler/nvm-windows/releases"
    );
  }

  onProgress(10, "下载 nvm 安装脚本...");

  try {
    execSync(
      "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash",
      { stdio: "inherit", shell: "/bin/bash", timeout: 60000 }
    );
    onProgress(100, "nvm 安装完成");
  } catch (err) {
    throw new Error("nvm 安装失败: " + err.message);
  }
}

// 使用 nvm 升级 Node.js
export async function upgradeNodeWithNvm(version, onProgress) {
  var nvmDir = process.env.NVM_DIR || join(homedir(), ".nvm");
  var nvmScript = join(nvmDir, "nvm.sh");

  if (!existsSync(nvmScript)) {
    throw new Error("nvm 未正确安装，找不到 nvm.sh");
  }

  // 验证 version 参数，防止命令注入
  if (!/^\d+$/.test(version)) {
    throw new Error("无效的 Node.js 版本号: " + version);
  }

  onProgress(20, "安装 Node.js " + version + "...");

  try {
    // 使用模板字符串和转义，避免命令注入
    var escapedScript = nvmScript.replace(/'/g, "'\\''");
    var cmd = "bash -c 'source \"" + escapedScript + "\" && nvm install " + version + " && nvm use " + version + " && nvm alias default " + version + "'";

    execSync(cmd, { stdio: "inherit", shell: "/bin/bash", timeout: 180000 });
    onProgress(100, "Node.js 升级完成");
  } catch (err) {
    throw new Error("Node.js 升级失败: " + err.message);
  }
}

// 使用 Homebrew 升级 Node.js
export async function upgradeNodeWithBrew(onProgress) {
  onProgress(20, "使用 Homebrew 升级 Node.js...");

  try {
    execSync("brew upgrade node", { stdio: "inherit", shell: true, timeout: 120000 });
    onProgress(100, "Node.js 升级完成");
  } catch (err) {
    throw new Error("Homebrew 升级失败: " + err.message);
  }
}

// 使用 winget 升级 Node.js
export async function upgradeNodeWithWinget(onProgress) {
  onProgress(20, "使用 winget 升级 Node.js...");

  try {
    execSync("winget upgrade --id OpenJS.NodeJS --silent", { stdio: "inherit", shell: true, timeout: 120000 });
    onProgress(100, "Node.js 升级完成");
  } catch (err) {
    throw new Error("winget 升级失败: " + err.message);
  }
}

// 安装 Git
export async function installGit(tools, onProgress) {
  onProgress(20, "正在安装 Git...");

  try {
    if (IS_MAC && tools.hasBrew) {
      execSync("brew install git", { stdio: "inherit", shell: true, timeout: 120000 });
    } else if (IS_WIN && tools.hasWinget) {
      execSync("winget install --id Git.Git --silent", { stdio: "inherit", shell: true, timeout: 120000 });
    } else if (process.platform === "linux") {
      // 尝试检测 Linux 发行版
      try {
        execSync("apt-get --version", { stdio: "pipe" });
        execSync("sudo apt-get update && sudo apt-get install -y git", { stdio: "inherit", shell: true, timeout: 120000 });
      } catch {
        try {
          execSync("yum --version", { stdio: "pipe" });
          execSync("sudo yum install -y git", { stdio: "inherit", shell: true, timeout: 120000 });
        } catch {
          throw new Error("无法自动安装 Git，请手动安装");
        }
      }
    } else {
      throw new Error("当前平台不支持自动安装 Git");
    }
    onProgress(100, "Git 安装完成");
  } catch (err) {
    throw new Error("Git 安装失败: " + err.message);
  }
}

// 安装 OpenClaw CLI
export async function installOpenclaw(onProgress) {
  onProgress(20, "正在安装 OpenClaw CLI...");

  try {
    execSync("npm install -g openclaw@latest", { stdio: "inherit", shell: true, timeout: 120000 });
    onProgress(100, "OpenClaw CLI 安装完成");
  } catch (err) {
    throw new Error("OpenClaw CLI 安装失败: " + err.message);
  }
}

// 修复 OpenClaw 配置格式
export async function fixOpenclawConfig(onProgress) {
  onProgress(20, "正在修复 OpenClaw 配置格式...");

  try {
    execSync("openclaw doctor --fix", { stdio: "inherit", shell: true, timeout: 30000 });
    onProgress(100, "配置格式修复完成");
  } catch (err) {
    throw new Error("配置格式修复失败: " + err.message);
  }
}

// 生成修复计划
export function generateFixPlan(envErrors, tools) {
  var plan = [];

  // 检查是否有 Node.js 版本错误
  var hasNodeError = envErrors.some(function(e) {
    return e.message.includes("Node.js") && (
      e.message.includes("requires Node.js") ||
      e.message.includes("not installed") ||
      e.message.includes("Could not detect Node.js version") ||
      e.message.includes("Could not check Node.js version")
    );
  });

  // 检查是否有 Git 错误
  var hasGitError = envErrors.some(function(e) {
    return e.message.includes("Git") || e.message.includes("git");
  });

  // 检查是否有 OpenClaw 错误
  var hasOpenclawError = envErrors.some(function(e) {
    return e.message.includes("OpenClaw") || e.message.includes("openclaw");
  });

  // 检查是否有配置格式错误
  var hasConfigError = envErrors.some(function(e) {
    return e.message.includes("configuration format") || e.message.includes("doctor --fix");
  });

  // Node.js 修复计划
  if (hasNodeError) {
    if (tools.hasNvm) {
      plan.push({
        id: "nvm-upgrade",
        title: "使用 nvm 升级 Node.js",
        commands: ["nvm install " + MIN_NODE_MAJOR, "nvm use " + MIN_NODE_MAJOR],
        estimatedTime: 60000
      });
    } else if (tools.hasBrew) {
      plan.push({
        id: "brew-upgrade",
        title: "使用 Homebrew 升级 Node.js",
        commands: ["brew upgrade node"],
        estimatedTime: 120000
      });
    } else if (tools.hasWinget) {
      plan.push({
        id: "winget-upgrade",
        title: "使用 winget 升级 Node.js",
        commands: ["winget upgrade --id OpenJS.NodeJS"],
        estimatedTime: 180000
      });
    } else {
      // 没有任何工具，先安装 nvm
      if (!IS_WIN) {
        plan.push({
          id: "install-nvm",
          title: "安装 nvm",
          commands: ["curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash"],
          estimatedTime: 30000
        });
        plan.push({
          id: "nvm-upgrade",
          title: "使用 nvm 安装 Node.js " + MIN_NODE_MAJOR,
          commands: ["nvm install " + MIN_NODE_MAJOR, "nvm use " + MIN_NODE_MAJOR],
          estimatedTime: 60000
        });
      }
    }
  }

  // Git 修复计划
  if (hasGitError) {
    if (IS_MAC && tools.hasBrew) {
      plan.push({
        id: "brew-install-git",
        title: "使用 Homebrew 安装 Git",
        commands: ["brew install git"],
        estimatedTime: 120000
      });
    } else if (IS_WIN && tools.hasWinget) {
      plan.push({
        id: "winget-install-git",
        title: "使用 winget 安装 Git",
        commands: ["winget install --id Git.Git"],
        estimatedTime: 180000
      });
    } else if (process.platform === "linux") {
      plan.push({
        id: "linux-install-git",
        title: "使用包管理器安装 Git",
        commands: ["sudo apt-get install git 或 sudo yum install git"],
        estimatedTime: 120000
      });
    }
  }

  // OpenClaw CLI 修复计划
  if (hasOpenclawError) {
    plan.push({
      id: "npm-install-openclaw",
      title: "安装 OpenClaw CLI",
      commands: ["npm install -g openclaw@latest"],
      estimatedTime: 60000
    });
  }

  // OpenClaw 配置格式修复计划
  if (hasConfigError) {
    plan.push({
      id: "fix-openclaw-config",
      title: "修复 OpenClaw 配置格式",
      commands: ["openclaw doctor --fix"],
      estimatedTime: 10000
    });
  }

  return plan;
}

// 执行修复计划
export async function executeFixPlan(plan, onProgress) {
  var totalProgress = 0;
  var stepSize = 100 / plan.length;

  for (var i = 0; i < plan.length; i++) {
    var step = plan[i];
    onProgress(totalProgress, step.title);

    try {
      if (step.id === "install-nvm") {
        await installNvm(function(pct, msg) {
          onProgress(totalProgress + pct * stepSize / 100, msg);
        });
      } else if (step.id === "nvm-upgrade") {
        await upgradeNodeWithNvm(MIN_NODE_MAJOR, function(pct, msg) {
          onProgress(totalProgress + pct * stepSize / 100, msg);
        });
      } else if (step.id === "brew-upgrade") {
        await upgradeNodeWithBrew(function(pct, msg) {
          onProgress(totalProgress + pct * stepSize / 100, msg);
        });
      } else if (step.id === "winget-upgrade") {
        await upgradeNodeWithWinget(function(pct, msg) {
          onProgress(totalProgress + pct * stepSize / 100, msg);
        });
      } else if (step.id === "brew-install-git" || step.id === "winget-install-git" || step.id === "linux-install-git") {
        await installGit(detectFixTools(), function(pct, msg) {
          onProgress(totalProgress + pct * stepSize / 100, msg);
        });
      } else if (step.id === "npm-install-openclaw") {
        await installOpenclaw(function(pct, msg) {
          onProgress(totalProgress + pct * stepSize / 100, msg);
        });
      } else if (step.id === "fix-openclaw-config") {
        await fixOpenclawConfig(function(pct, msg) {
          onProgress(totalProgress + pct * stepSize / 100, msg);
        });
      }
    } catch (err) {
      throw new Error("修复步骤失败 (" + step.title + "): " + err.message);
    }

    totalProgress += stepSize;
  }

  onProgress(100, "修复完成");
}
