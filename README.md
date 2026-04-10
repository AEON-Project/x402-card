# x402-card

通过 [x402 协议](https://www.x402.org/) 购买虚拟借记卡的 Agent 技能。

使用加密货币（BSC 链上的 USDT）支付，获取即用型虚拟 Visa/Mastercard。

## 安装技能

```bash
# 安装到所有检测到的 Agent（Claude Code、Cursor、Codex、OpenClaw、Gemini CLI 等）
npx skills add AEON-Project/x402-card -g -y

# 安装到指定 Agent
npx skills add AEON-Project/x402-card -a claude-code -a cursor -a codex -g -y
```

支持的 Agent：Claude Code、Cursor、Codex、OpenClaw、Gemini CLI、GitHub Copilot、Windsurf、Roo Code 及 [39+ 更多](https://agentskills.io)。

## 命令行用法

```bash
# 首次使用：通过 WalletConnect 连接钱包（私钥绝不存储在本地）
npx @aeon-ai-pay/x402-card connect --amount 50

# 创建虚拟卡（$5 美元，自动轮询状态）
npx @aeon-ai-pay/x402-card create --amount 5 --poll

# 查询卡片状态
npx @aeon-ai-pay/x402-card status --order-no <orderNo>

# 查看钱包余额（BNB + USDT）
npx @aeon-ai-pay/x402-card wallet

# 余额不足时为 session key 充值
npx @aeon-ai-pay/x402-card topup --amount 50

# 将剩余 USDT 提回主钱包
npx @aeon-ai-pay/x402-card withdraw

# 查看当前配置
npx @aeon-ai-pay/x402-card setup --show
```

## 前提条件

- Node.js >= 18
- 一个支持 WalletConnect 的手机钱包 App（MetaMask、Trust Wallet 等）
- BSC 链上的 USDT (BEP-20) 用于购卡
- 少量 BNB 用于 gas 费（约 $0.01/笔）

## 工作原理

```
1. 通过 WalletConnect 连接钱包（扫码、确认注资）
2. CLI 在本地生成 session key，由主钱包注资
3. Session key 自动签名 x402 支付 — 无需手动确认

Agent 流程：
  用户意图 -> Agent 激活技能 -> x402 两阶段协议：
    1. GET /create?amount=X         -> HTTP 402 + 支付要求
    2. Session key 签名并重试       -> HTTP 200 + 支付确认
    3. 轮询 /status?orderNo=X      -> 卡片详情就绪
```

## 配置

配置存储在 `~/.x402-card/config.json`（文件权限 600）。

运行 `connect` 命令通过 WalletConnect 设置钱包。主钱包私钥**绝不会**存储在本地，仅保存 session key（一个有限额的临时钱包）。

覆盖默认 service URL（可选）：
```bash
npx @aeon-ai-pay/x402-card setup --service-url https://custom-api.example.com
```

## 许可证

MIT
