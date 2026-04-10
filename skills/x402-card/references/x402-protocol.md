# x402 协议

基于 HTTP 的原生支付协议，通过区块链实现 API 变现。

## 工作原理

x402 协议使用 HTTP 状态码 `402 Payment Required` 扩展了 HTTP 的两阶段支付流程：

```
阶段 1：发现
  客户端  ──GET /resource──>  服务端
  客户端  <──HTTP 402──      服务端（返回支付要求）

阶段 2：支付
  客户端  ──GET /resource──>  服务端
           + PAYMENT-SIGNATURE 头（签名后的支付信息）
  客户端  <──HTTP 200──      服务端（返回资源 + PAYMENT-RESPONSE 头）
```

## 支付要求（402 响应）

当服务端返回 402 时，响应体包含一个 `accepts` 数组：

```json
{
  "accepts": [
    {
      "scheme": "exact",
      "namespace": "evm",
      "networkId": "eip155:56",
      "asset": "USDT",
      "tokenAddress": "0x55d398326f99059fF775485246999027B3197955",
      "tokenDecimals": 18,
      "amountRequired": "5000000000000000000",
      "payToAddress": "0xRecipient...",
      "resource": "https://api.example.com/callback"
    }
  ],
  "x402Version": 2
}
```

## 支付签名头

客户端签署一个 EIP-712 类型化数据结构，并以 Base64 编码的头发送：

| 协议版本 | 头名称 |
|---------|--------|
| v2（当前） | `PAYMENT-SIGNATURE` |
| v1（旧版） | `X-PAYMENT` |

签名载荷包含：
- `from`：付款方钱包地址
- `to`：收款方地址
- `value`：精确支付金额（每个订单唯一，用于匹配）
- `validAfter` / `validBefore`：支付有效时间窗口
- `nonce`：随机值，防止重放攻击

## 支付响应头

成功时，服务端返回 `PAYMENT-RESPONSE` 头（Base64 编码）：

```json
{
  "txHash": "0xabc...def",
  "networkId": "eip155:56"
}
```

## 核心概念

### 唯一金额匹配
服务端为每个订单生成略微调整的唯一金额（例如 $5.000001 而非 $5.00）。这允许服务端通过 Redis 缓存查找，仅凭链上支付金额匹配到特定订单，无需在支付头中包含订单 ID。

### Facilitator（促进者）
一个中间服务，负责：
1. 验证签名支付的有效性
2. 在链上提交交易
3. 确认结算
4. 返回交易哈希

### 支持的网络

| 网络 | Chain ID | 代币 |
|------|----------|------|
| BSC 主网 | eip155:56 | USDT (BEP-20) |

## 客户端库

- `@x402/axios` — Axios 拦截器，自动处理 402 响应
- `@x402/fetch` — Fetch API 封装
- `@x402/evm` — EVM 签名工具（EIP-712）
