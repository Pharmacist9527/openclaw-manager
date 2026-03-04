import { platform } from "node:os";

const IS_WIN = platform() === "win32";

export const ERROR_TYPES = {
  NETWORK: "network",
  PERMISSION: "permission",
  VERSION: "version",
  CONFIG: "config",
  UNKNOWN: "unknown",
};

// 常见错误模式匹配库
const ERROR_PATTERNS = [
  {
    pattern: /ENOTFOUND registry\.npmjs\.org/,
    type: ERROR_TYPES.NETWORK,
    title: "npm 仓库无法访问",
    description: "无法连接到 npm 官方仓库",
    solutions: [
      "检查 DNS 设置是否正常",
      "尝试使用国内镜像源：",
      "  npm config set registry https://registry.npmmirror.com",
    ],
  },
  {
    pattern: /EACCES.*\.npm/,
    type: ERROR_TYPES.PERMISSION,
    title: "npm 缓存目录权限不足",
    description: "没有权限访问 npm 缓存目录",
    solutions: IS_WIN
      ? ["以管理员身份运行此程序"]
      : [
          "修复 npm 缓存权限：",
          "  sudo chown -R $(whoami) ~/.npm",
          "或清空缓存后重试：",
          "  npm cache clean --force",
        ],
  },
  {
    pattern: /git clone.*failed|fatal: unable to access.*github\.com/,
    type: ERROR_TYPES.NETWORK,
    title: "Git 克隆失败",
    description: "无法从 GitHub 克隆代码仓库",
    solutions: [
      "检查网络连接是否正常",
      "如果使用代理，配置 Git 代理：",
      "  git config --global http.proxy http://proxy:port",
      "尝试使用 HTTPS 代替 SSH：",
      "  git config --global url.\"https://\".insteadOf git://",
    ],
  },
  {
    pattern: /unable to access|Failed to connect|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/,
    type: ERROR_TYPES.NETWORK,
    title: "网络连接失败",
    description: "无法访问 GitHub 或 npm 仓库",
    solutions: [
      "检查网络连接是否正常",
      "如果使用代理，配置 Git 和 npm 代理：",
      "  git config --global http.proxy http://proxy:port",
      "  npm config set proxy http://proxy:port",
      "尝试切换 npm 镜像源：",
      "  npm config set registry https://registry.npmmirror.com",
    ],
  },
  {
    pattern: /EACCES|permission denied/i,
    type: ERROR_TYPES.PERMISSION,
    title: "权限不足",
    description: "没有足够的权限执行安装操作",
    solutions: IS_WIN
      ? ["右键点击程序，选择\"以管理员身份运行\""]
      : [
          "使用 sudo 运行安装命令：",
          "  sudo npm install -g openclaw@latest",
          "或配置 npm 使用用户目录：",
          "  mkdir ~/.npm-global",
          "  npm config set prefix '~/.npm-global'",
          "  echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc",
          "  source ~/.bashrc",
        ],
  },
  {
    pattern: /Node\.js.*require(?:s|d)?|version.*\d+.*require(?:s|d)?/i,
    type: ERROR_TYPES.VERSION,
    title: "Node.js 版本不兼容",
    description: "当前 Node.js 版本不符合要求（需要 22+）",
    solutions: [
      "访问 https://nodejs.org 下载最新 LTS 版本",
      "或使用版本管理工具升级：",
      "  nvm install 22",
      "  nvm use 22",
      "或使用 fnm：",
      "  fnm install 22",
      "  fnm use 22",
    ],
  },
  {
    pattern: /invalid.*config|configuration.*error|malformed/i,
    type: ERROR_TYPES.CONFIG,
    title: "配置错误",
    description: "配置文件格式错误或参数无效",
    solutions: [
      "检查 API Key 是否正确（无多余空格）",
      "检查 Bot Token 格式是否正确",
      "如果问题持续，删除配置文件重新开始：",
      "  默认 profile: rm -rf ~/.openclaw",
      "  命名 profile: rm -rf ~/.openclaw-[profile-name]",
    ],
  },
];

/**
 * 诊断错误并返回结构化的错误信息
 * @param {string} errorMessage - 错误消息
 * @param {object} context - 上下文信息（profile, logs, stage 等）
 * @returns {object} 诊断结果
 */
export function diagnoseError(errorMessage, context = {}) {
  const { profile, logs, stage } = context;

  // 尝试匹配错误模式
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.pattern.test(errorMessage)) {
      const result = {
        type: pattern.type,
        title: pattern.title,
        description: pattern.description,
        solutions: [...pattern.solutions],
        technicalDetails: errorMessage,
      };

      // 根据上下文调整解决方案
      if (profile && pattern.type === ERROR_TYPES.CONFIG) {
        result.solutions = result.solutions.map(s =>
          s.replace("[profile-name]", profile)
        );
      }

      return result;
    }
  }

  // 如果有日志，尝试从日志中提取更多信息
  if (logs && logs.length > 0) {
    const errorLogs = logs.filter(l => l.level === "error");
    if (errorLogs.length > 0) {
      const lastError = errorLogs[errorLogs.length - 1].message;
      // 递归诊断最后一个错误日志
      for (const pattern of ERROR_PATTERNS) {
        if (pattern.pattern.test(lastError)) {
          return {
            type: pattern.type,
            title: pattern.title,
            description: pattern.description,
            solutions: pattern.solutions,
            technicalDetails: lastError,
          };
        }
      }
    }
  }

  // 根据阶段提供特定建议
  let stageSolutions = [
    "查看完整日志了解详细信息",
    "尝试重新运行安装",
  ];

  if (stage === "onboarding") {
    stageSolutions.push("确保 Node.js 和 Git 已正确安装");
    stageSolutions.push("检查网络连接是否正常");
  } else if (stage === "gateway-install") {
    stageSolutions.push("尝试手动安装 gateway：");
    stageSolutions.push(
      "  openclaw" +
        (profile && profile !== "default" ? " --profile " + profile : "") +
        " gateway install"
    );
  }

  stageSolutions.push("如果问题持续，请联系客服并提供错误日志");

  // 未知错误
  return {
    type: ERROR_TYPES.UNKNOWN,
    title: "安装失败",
    description: "安装过程中遇到未预期的错误",
    solutions: stageSolutions,
    technicalDetails: errorMessage,
  };
}

/**
 * 格式化日志用于显示
 * @param {Array} logs - 日志数组
 * @returns {string} 格式化后的日志文本
 */
export function formatLogs(logs) {
  if (!logs || logs.length === 0) {
    return "无日志记录";
  }

  return logs
    .map(log => {
      const time = new Date(log.time).toLocaleTimeString("zh-CN");
      const level = log.level.toUpperCase().padEnd(5);
      return `${time} [${level}] ${log.message}`;
    })
    .join("\n");
}
