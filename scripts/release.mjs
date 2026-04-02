#!/usr/bin/env node

/**
 * 发版脚本：同步 package.json 和 SKILL.md 版本，提交、推送、发布 npm
 *
 * Usage:
 *   node scripts/release.mjs patch    # 0.1.4 → 0.1.4
 *   node scripts/release.mjs minor    # 0.1.4 → 0.2.0
 *   node scripts/release.mjs major    # 0.1.4 → 1.0.0
 *   node scripts/release.mjs 0.2.0    # 指定版本号
 */
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const PKG_PATH = resolve(ROOT, "package.json");
const SKILL_PATH = resolve(ROOT, "skills/x402-card/SKILL.md");

function readPkg() {
  return JSON.parse(readFileSync(PKG_PATH, "utf-8"));
}

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split(".").map(Number);
  switch (type) {
    case "patch": return `${major}.${minor}.${patch + 1}`;
    case "minor": return `${major}.${minor + 1}.0`;
    case "major": return `${major + 1}.0.0`;
    default:
      // 直接指定版本号
      if (/^\d+\.\d+\.\d+$/.test(type)) return type;
      console.error(`Invalid version type: ${type}`);
      process.exit(1);
  }
}

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

// 1. 计算新版本
const type = process.argv[2];
if (!type) {
  console.error("Usage: node scripts/release.mjs <patch|minor|major|x.y.z>");
  process.exit(1);
}

const pkg = readPkg();
const oldVersion = pkg.version;
const newVersion = bumpVersion(oldVersion, type);

console.log(`\nVersion: ${oldVersion} → ${newVersion}\n`);

// 2. 更新 package.json
pkg.version = newVersion;
writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
console.log(`Updated package.json`);

// 3. 更新 SKILL.md
let skillContent = readFileSync(SKILL_PATH, "utf-8");
skillContent = skillContent.replace(
  /version:\s*["']?[\d.]+["']?/,
  `version: "${newVersion}"`
);
writeFileSync(SKILL_PATH, skillContent);
console.log(`Updated SKILL.md`);

// 4. Git commit + tag + push
run(`git add package.json skills/x402-card/SKILL.md`);
run(`git commit -m "release: v${newVersion}"`);
run(`git tag v${newVersion}`);
run(`git push origin main --tags`);

// 5. 发布 npm
run(`npm publish --access public --registry https://registry.npmjs.org/`);

console.log(`\n✅ Released v${newVersion}`);
console.log(`   npm: https://www.npmjs.com/package/@aeon-ai-pay/x402-card`);
console.log(`   git: https://github.com/AEON-Project/x402-card/releases/tag/v${newVersion}`);
