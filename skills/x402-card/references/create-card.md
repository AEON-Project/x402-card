# 创建虚拟卡

## 前提检查

创建卡片前，确认以下事项：

1. 钱包已配置 — 运行 `setup --check`。如未就绪，运行 `connect` 通过 WalletConnect 设置。
2. Service URL 已配置（有内置默认值，无需操作，除非用户想要覆盖）
3. `create` 命令会在支付前自动检查钱包余额，无需单独运行 `wallet`。

## 工作流程

### 步骤 1：确认金额

询问用户要充值多少到虚拟卡。

- 金额限制由 CLI 强制执行。不要硬编码或说出具体的最小/最大数字。
- 货币：USD（服务端处理加密货币兑换）

**必须**在执行前获得用户明确确认：
> "我将创建一张充值 $X.XX 的虚拟卡。这将从你的 BSC 钱包扣除约 X.XX USDT。确认继续？"

### 步骤 2：执行

```bash
# 创建卡片并自动轮询状态
npx @aeon-ai-pay/x402-card create --amount <amount> --poll
```

CLI 自动处理完整的 x402 两阶段协议：
1. 发送 `GET /open/ai/x402/card/create?amount=X` → 收到 HTTP 402
2. 解析支付要求，使用 EVM 钱包签名（EIP-712）
3. 附带 `PAYMENT-SIGNATURE` 头重试请求 → 收到 HTTP 200
4. 使用 `--poll` 时，每 5 秒自动轮询 `/status` 直到卡片就绪

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

成功时：
```
虚拟卡创建成功！
- 卡片: VISA •••• 4321
- 余额: $5.00 USD
- 订单号: 300217748668047431791
- 交易: 0xabc...def
```

保存 `orderNo` 用于后续状态查询。

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| 金额超出范围 | CLI 返回包含允许范围的错误 JSON — 转达给用户 |
| 钱包未配置 | 运行 `connect --amount <usdt>` 通过 WalletConnect 设置 |
| USDT 不足 | 运行 `topup --amount <usdt>` 通过 WalletConnect 充值 |
| 网络错误 | 重试一次，然后报告给用户 |
| 交易回滚 | 显示 txHash，建议用户在 BSCScan 上查看 |
