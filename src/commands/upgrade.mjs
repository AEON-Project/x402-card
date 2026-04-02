import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

const REPO = "AEON-Project/x402-card";
const SKILL_NAME = "x402-card";

// 已安装 skill 的路径（npx skills 安装到通用目录，其他 agent symlink 过来）
const INSTALLED_SKILL_MD = join(homedir(), ".agents", "skills", SKILL_NAME, "SKILL.md");

/**
 * 从 SKILL.md frontmatter 中提取 version
 */
function extractVersion(content) {
  const match = content.match(/version:\s*["']?([\d.]+)["']?/);
  return match ? match[1] : null;
}

/**
 * 从 GitHub raw 获取远程 SKILL.md 的 version
 */
async function getRemoteVersion() {
  const url = `https://raw.githubusercontent.com/${REPO}/main/skills/${SKILL_NAME}/SKILL.md`;
  const { default: axios } = await import("axios");
  const res = await axios.get(url, { timeout: 10000 });
  return extractVersion(res.data);
}

/**
 * 获取本地已安装的 version
 */
function getLocalVersion() {
  try {
    const content = readFileSync(INSTALLED_SKILL_MD, "utf-8");
    return extractVersion(content);
  } catch {
    return null;
  }
}

export async function upgrade(opts) {
  const localVersion = getLocalVersion();

  if (!localVersion) {
    console.log(JSON.stringify({ installed: false, action: "install" }));
    if (!opts.check) {
      console.error("Skill not installed. Installing...");
      execSync(`npx skills add ${REPO} -g -y`, { stdio: "inherit" });
    }
    return;
  }

  let remoteVersion;
  try {
    remoteVersion = await getRemoteVersion();
  } catch (e) {
    console.error(JSON.stringify({ error: `Failed to check remote version: ${e.message}` }));
    // 网络失败不阻塞，继续使用本地版本
    console.log(JSON.stringify({ localVersion, remoteVersion: null, upToDate: true, skipped: true }));
    return;
  }

  const upToDate = localVersion === remoteVersion;

  console.log(JSON.stringify({
    localVersion,
    remoteVersion,
    upToDate,
  }));

  if (!upToDate && !opts.check) {
    console.error(`Upgrading skill: ${localVersion} → ${remoteVersion}`);
    execSync(`npx skills add ${REPO} -g -y`, { stdio: "inherit" });
    console.error("Upgrade complete.");
  } else if (!upToDate && opts.check) {
    console.error(`Update available: ${localVersion} → ${remoteVersion}. Run: npx @aeon-project/x402-card upgrade`);
  }
}
