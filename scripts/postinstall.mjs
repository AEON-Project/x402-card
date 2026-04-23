#!/usr/bin/env node

// 将 skills 目录复制到 ~/.claude/skills/，使 Claude Code 能识别该技能

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '..', 'skills', 'x402-card');
const dest = join(homedir(), '.claude', 'skills', 'x402-card');

if (!existsSync(src)) {
  // 开发环境下 skills 目录可能不存在，跳过
  process.exit(0);
}

// 确保目标父目录存在
mkdirSync(dirname(dest), { recursive: true });

// 递归复制，覆盖已有文件
cpSync(src, dest, { recursive: true, force: true });

console.log(`✔ x402-card skill installed to ${dest}`);
