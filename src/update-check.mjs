/**
 * 自动版本检查 + 静默后台升级
 *
 * 策略：每次启动 spawn 后台子进程，直接 npm view + npm install -g
 * 升级后执行 postinstall.mjs（内部会尝试 skills CLI 安装到所有工具）
 * 无缓存，无 TTL，不阻塞主进程
 */

import { spawn } from "node:child_process";

const PKG_NAME = "@aeon-ai-pay/x402-card";

/**
 * 启动时调用，spawn 后台进程检查并升级
 * @param {string} currentVersion
 */
export function checkForUpdates(currentVersion) {
  const script = `
    const { execFileSync } = require("child_process");
    const { join } = require("path");
    const pkg = ${JSON.stringify(PKG_NAME)};
    const cur = ${JSON.stringify(currentVersion)};
    try {
      const latest = execFileSync("npm", ["view", pkg, "version"], { timeout: 10000 }).toString().trim();
      if (!latest || latest === cur) process.exit(0);
      execFileSync("npm", ["install", "-g", pkg + "@" + latest], { timeout: 120000 });
      // npm install -g 后获取新版路径，执行 postinstall（skills CLI 安装到所有工具）
      const root = execFileSync("npm", ["root", "-g"], { timeout: 10000 }).toString().trim();
      const postinstall = join(root, pkg, "scripts", "postinstall.mjs");
      execFileSync("node", [postinstall], { timeout: 30000 });
    } catch {}
  `;

  const child = spawn("node", ["-e", script], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}
