# 创建虚拟卡

## 前提检查

创建卡片前，确认以下事项：

1. 钱包已配置 — 运行 `setup --check`。如未就绪，运行 `connect` 通过 WalletConnect 设置。
2. Service URL 已配置（有内置默认值，无需操作，除非用户想要覆盖）
3. `create` 命令会在支付前自动检查钱包余额，余额不足时自动发起 WalletConnect 充值，无需单独运行 `wallet` 或 `topup`。

## 工作流程

### 步骤 1：确认金额

询问用户要充值多少到虚拟卡。

- 金额限制由 CLI 强制执行（`amountLimits.min` ~ `amountLimits.max`，来自 `setup --check`）。
- 货币：USD（服务端处理加密货币兑换）

**若用户未指定金额**，向用户展示有效区间并请求确认（**文案必须完全一致**，仅变量替换）：
> "You can create a card of up to ${min}~${max} based on your current wallet balance. How much would you like to load onto the card？"

用户指定金额后，**立即执行**，不需要二次确认。

### 步骤 2：执行

```bash
# 创建卡片并自动轮询状态
npx @aeon-ai-pay/x402-card create --amount <amount> --poll
```

CLI 自动处理完整流程：
1. 检查本地钱包余额（USDT + BNB）
2. 若余额不足 → 自动发起 WalletConnect 充值（打开 QR 页面，等待用户在钱包 App 确认转账）
3. 充值完成后自动继续
4. 发送 `GET /open/ai/x402/card/create?amount=X` → 收到 HTTP 402
5. 解析支付要求，使用本地钱包签名（EIP-712）
6. 附带 `PAYMENT-SIGNATURE` 头重试请求 → 收到 HTTP 200
7. 使用 `--poll` 时，每 5 秒自动轮询 `/status` 直到卡片就绪

### 步骤 3：解析结果

**stdout** 输出 JSON（可解析），**stderr** 输出进度日志。

成功输出：
```json
{
  "success": true,
  "data": {
    "code": "0",
    "msg": "success",
    "model": { "orderNo": "300217748668047431791" }
  },
  "paymentResponse": {
    "txHash": "0x...",
    "networkId": "eip155:56"
  }
}
```

使用 `--poll` 时，卡片就绪后的额外输出：
```json
{
  "pollResult": {
    "orderNo": "300217748668047431791",
    "orderStatus": "SUCCESS",
    "channelStatus": "COMPLETED",
    "orderAmount": 0.6,
    "txHash": "0xabc...def",
    "cardLastFour": "4321",
    "cardBin": "485932",
    "cardScheme": "VISA",
    "cardBalance": 0.6,
    "cardStatus": "ACTIVE"
  }
}
```

### 步骤 4：展示给用户

查询卡片详情可能需要约 30 秒，先输出等待提示（**文案必须完全一致**）：
```
> Fetching card details, please wait...
```

详情返回后，成功时（**文案必须完全一致**，仅变量替换）：
```
Virtual card ready with ${amount} loaded!
- Card: {cardScheme} •••• {last4}
- Balance: ${amount} USD
- Order No: {orderNo}
- Tx: {txHash}
```

保存 `orderNo` 用于后续状态查询。

## 错误处理

| 场景 | CLI 输出 | 处理方式 |
|------|---------|---------|
| 金额超出范围 | 包含允许范围的错误 JSON | 转达给用户 |
| 钱包未配置 | `Wallet not configured` | 运行 `setup --check` |
| 充值签名超时（5 分钟） | `Payment approval timed out. Please try again.` | 转达给用户，询问是否重试 |
| 用户拒绝签名 | `Payment approval was rejected. Please try again if you'd like to proceed.` | 转达给用户，不自动重试 |
| 充值后余额仍不足 | `Still insufficient USDT after funding` | 转达给用户 |
| 网络错误 | 服务端错误 JSON | 重试一次，然后报告给用户 |
| 交易回滚 | txHash | 建议用户在 BSCScan 上查看 |
