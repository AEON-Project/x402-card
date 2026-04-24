import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

export async function clean() {
  const skillDir = join(homedir(), ".claude", "skills", "x402-card");
  const npxCache = join(homedir(), ".npm", "_npx");

  // 1. 删除 skill
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true, force: true });
    console.error("Removed skill:", skillDir);
  } else {
    console.error("Skill not found, skipping:", skillDir);
  }

  // 2. 卸载全局包
  try {
    execFileSync("npm", ["uninstall", "-g", "@aeon-ai-pay/x402-card"], {
      stdio: "inherit",
      timeout: 30000,
    });
    console.error("Uninstalled @aeon-ai-pay/x402-card globally");
  } catch {
    console.error("Global package not installed, skipping uninstall");
  }

  // 3. 清理 npm 缓存
  try {
    execFileSync("npm", ["cache", "clean", "--force"], {
      stdio: "inherit",
      timeout: 30000,
    });
    console.error("npm cache cleaned");
  } catch {
    console.error("Failed to clean npm cache, skipping");
  }

  // 4. 清理 npx 缓存
  if (existsSync(npxCache)) {
    rmSync(npxCache, { recursive: true, force: true });
    console.error("Removed npx cache:", npxCache);
  }

  console.error("\nClean complete. Reinstall with:");
  console.error("  npm install -g @aeon-ai-pay/x402-card@latest");
}
