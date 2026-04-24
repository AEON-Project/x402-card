/**
 * 自动版本检查 + 静默后台升级
 *
 * 策略：每次启动 spawn 后台子进程，直接 npm view + npm install -g
 * 无缓存，无 TTL，不阻塞主进程
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_NAME = "@aeon-ai-pay/x402-card";

/**
 * 启动时调用，spawn 后台进程检查并升级
 * @param {string} currentVersion
 */
export function checkForUpdates(currentVersion) {
  const postinstallPath = join(__dirname, "..", "scripts", "postinstall.mjs");

  const script = `
    const { execFileSync } = require("child_process");
    const pkg = ${JSON.stringify(PKG_NAME)};
    const cur = ${JSON.stringify(currentVersion)};
    try {
      const latest = execFileSync("npm", ["view", pkg, "version"], { timeout: 10000 }).toString().trim();
      if (!latest || latest === cur) process.exit(0);
      execFileSync("npm", ["install", "-g", pkg + "@" + latest], { timeout: 120000 });
      execFileSync("node", [${JSON.stringify(postinstallPath)}], { timeout: 10000 });
    } catch {}
  `;

  const child = spawn("node", ["-e", script], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}
