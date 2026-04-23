/**
 * 自动版本检查 + 静默后台升级
 *
 * 策略（完全不阻塞主命令）：
 * 1. 启动时同步读缓存（~/.x402-card/.update-check）
 * 2. 如果缓存显示有新版本 → 立即 stderr 提示 + spawn 后台升级
 * 3. 同时 spawn 独立子进程刷新缓存（不等待）
 * 4. 缓存 TTL 1 小时，避免频繁请求 npm registry
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_NAME = "@aeon-ai-pay/x402-card";
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_DIR = join(homedir(), ".x402-card");
const CACHE_FILE = join(CACHE_DIR, ".update-check");

function readCache() {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {}
  return null;
}

/**
 * 后台刷新缓存：spawn 独立 node 进程执行 npm view 并写文件
 */
function refreshCacheInBackground() {
  const script = `
    const { execFileSync } = require("child_process");
    const { writeFileSync, mkdirSync } = require("fs");
    try {
      const latest = execFileSync("npm", ["view", "${PKG_NAME}", "version"], { timeout: 10000 }).toString().trim();
      if (latest) {
        mkdirSync("${CACHE_DIR.replace(/\\/g, "\\\\")}", { recursive: true });
        writeFileSync("${CACHE_FILE.replace(/\\/g, "\\\\")}", JSON.stringify({ latest: latest, ts: Date.now() }));
      }
    } catch {}
  `;
  const child = spawn("node", ["-e", script], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

/**
 * 后台静默升级 + 升级完成后更新 skills
 */
function upgradeInBackground(latest) {
  // 先标记 upgrading
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ latest, upgrading: true, ts: Date.now() }));
  } catch {}

  // npm install -g 后需手动执行 postinstall 复制 skills 到 ~/.claude/skills/
  // 因为 detached 子进程中 npm lifecycle hooks 可能不触发
  const npmRoot = "`npm root -g`";
  const script = `
    const { execFileSync, execSync } = require("child_process");
    const { writeFileSync, mkdirSync } = require("fs");
    try {
      execFileSync("npm", ["install", "-g", "${PKG_NAME}@" + "${latest}"], { timeout: 120000 });
      // 手动执行 postinstall 确保 skills 文件被复制
      const root = execFileSync("npm", ["root", "-g"], { timeout: 10000 }).toString().trim();
      const postinstall = root + "/${PKG_NAME}/scripts/postinstall.mjs";
      execFileSync("node", [postinstall], { timeout: 10000 });
      mkdirSync("${CACHE_DIR.replace(/\\/g, "\\\\")}", { recursive: true });
      writeFileSync("${CACHE_FILE.replace(/\\/g, "\\\\")}", JSON.stringify({ latest: "${latest}", upgraded: true, ts: Date.now() }));
    } catch {
      writeFileSync("${CACHE_FILE.replace(/\\/g, "\\\\")}", JSON.stringify({ latest: "${latest}", ts: Date.now() }));
    }
  `;
  const child = spawn("node", ["-e", script], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

/**
 * 同步执行版本检查，在 CLI 入口顶层调用
 * @param {string} currentVersion
 */
export function checkForUpdates(currentVersion) {
  const cached = readCache();
  const cacheExpired = !cached || (Date.now() - cached.ts > CACHE_TTL_MS);

  // 有缓存且发现新版本
  if (cached?.latest && cached.latest !== currentVersion && !cached.upgrading) {
    console.error(`\n  Update available: ${currentVersion} → ${cached.latest}`);
    console.error(`  Upgrading in background...\n`);
    upgradeInBackground(cached.latest);
  }

  // 缓存过期则后台刷新
  if (cacheExpired) {
    refreshCacheInBackground();
  }
}
