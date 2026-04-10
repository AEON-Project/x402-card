---
name: x402-card
description: >
  当用户表达出创建、管理或查询虚拟卡的意图时，触发此技能。
  这包括以下意图：
  - “获取一张虚拟卡”
  - “制作一张卡片”
  - “卡片状态”
  “为代理人设置一张卡片”
  此外，任何涉及为代理使用而创建以加密货币充值的一次性虚拟Visa/Mastercard的请求。
emoji: "💳"
homepage: https://github.com/AEON-Project/x402-card
metadata:
  version: "0.3.1"
  author: AEON-Project
  openclaw:
    requires:
      bins:
        - node
        - npx
    primaryEnv: X402_CARD_SERVICE_URL
    user-invocable: true
    disable-model-invocation: false
compatibility: 需要 Node.js >= 18 和 npm
---

# x402 虚拟卡技能

通过 x402 HTTP 支付协议，使用 BSC 链上的 USDT 购买虚拟借记卡（Visa/Mastercard）。

## 命令行工具

所有操作使用 `npx @aeon-ai-pay/x402-card`：

```bash
# 通过 WalletConnect 连接钱包（不存储私钥）
npx @aeon-ai-pay/x402-card connect --amount 50

# 查看当前配置
npx @aeon-ai-pay/x402-card setup --show

# 创建虚拟卡（$5 美元，自动轮询状态）
npx @aeon-ai-pay/x402-card create --amount 5 --poll

# 查询卡片状态
npx @aeon-ai-pay/x402-card status --order-no <orderNo>

# 查看钱包余额
npx @aeon-ai-pay/x402-card wallet

# 为 session key 充值
npx @aeon-ai-pay/x402-card topup --amount 50

# 将剩余 USDT 提回主钱包
npx @aeon-ai-pay/x402-card withdraw
```

## 配置说明

配置存储在 `~/.x402-card/config.json`（文件权限 600）。

使用 WalletConnect 连接用户钱包并为本地 session key 注资。主钱包私钥**绝不会**存储在本地。**绝不向用户索要私钥。**

## 步骤 0：预检查

在执行任何操作（create、wallet、status）之前，运行配置检查：

```bash
npx @aeon-ai-pay/x402-card setup --check
```

- 退出码 0 + `"ready": true` → 继续执行用户意图。响应中包含 `amountLimits: { min, max }`，提示用户卡片金额时使用这些值。同时检查 `mode` 字段。
- 退出码 1 + `"ready": false` → 钱包未配置。通过 WalletConnect 执行 `connect` 命令进行设置：
  > "我来帮你通过 WalletConnect 连接钱包。你的主钱包私钥不会存储在本地。"
  询问用户要为 session key 充入多少 USDT（默认 $1），然后运行：
  ```bash
  npx @aeon-ai-pay/x402-card connect --amount <usdt>
  ```
  该命令会在浏览器中打开 QR 码页面。用户用钱包 App（MetaMask、Trust Wallet 等）扫码连接后，确认 2 笔交易（USDT + BNB 转账），命令完成并输出成功 JSON。
  **重要：** 此命令为交互式，最长需要 120 秒。不要在后台运行。
- **绝不向用户索要私钥。始终使用 `connect` 命令。**
- 除非用户主动要求，否则不要询问 service URL。

## 决策树

配置验证通过后，根据用户意图进行路由：

### 1. 用户想要购买/创建虚拟卡
- 阅读 [create-card](references/create-card.md) 了解完整流程。
- **金额限制来自 `setup --check` 响应**（`amountLimits.min` / `amountLimits.max`）。不要硬编码、记忆或猜测任何限额值，始终使用 CLI 返回的数字。
- CLI 的 `create` 命令会验证金额，如果无效则返回包含允许范围的错误 JSON。
- CLI 会在支付前**自动检查**钱包余额。如果不足，会报告差额。
- **必须**在执行创建命令前向用户确认金额。展示 `amountLimits` 中的范围让用户了解有效区间。

### 2. 用户想要查询卡片状态
- 阅读 [check-status](references/check-status.md) 了解状态查询详情。
- 需要之前创建时获得的 `orderNo`。

### 3. 用户想要为 session key 充值
- 运行：
  ```bash
  npx @aeon-ai-pay/x402-card topup --amount <usdt>
  ```
  重新打开 WalletConnect 进行一次性资金转入。

### 4. 用户想要从 session key 提取资金
- 运行：
  ```bash
  npx @aeon-ai-pay/x402-card withdraw
  ```
  将 session key 中的所有 USDT 转回主钱包。使用 `--amount <usdt>` 可提取指定金额。

### 5. 用户想要了解协议
- 阅读 [x402-protocol](references/x402-protocol.md) 了解 x402 协议的工作原理。

## 禁止行为

- **绝不**向用户索要私钥。始终使用 `connect`（WalletConnect）来设置钱包。
- **绝不**在未经用户明确确认金额的情况下进行支付。
- **绝不**记录或显示完整私钥。显示为 `0x...last4` 格式。
- **绝不**跳过钱包配置检查就尝试购卡。
- **不要**轮询状态超过 10 次。如果仍在处理中，通知用户并停止。

## 余额不足处理

当 create 返回 `"error": "Insufficient USDT balance"` 时：

```
Session key USDT 余额不足。
- 需要: {required}
- 可用: {available}

运行 'x402-card topup --amount <usdt>' 通过 WalletConnect 充值。
```
