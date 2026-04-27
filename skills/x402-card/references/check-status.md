# 查询卡片状态

## 命令

```bash
# 单次查询
npx @aeon-ai-pay/x402-card status --order-no <orderNo>

# 轮询直到终态（SUCCESS 或 FAIL）
npx @aeon-ai-pay/x402-card status --order-no <orderNo> --poll
```

## 响应格式

```json
{
  "code": "0",
  "msg": "success",
  "model": {
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

## 状态值

### orderStatus（订单状态）

| 状态 | 含义 | 操作 |
|------|------|------|
| `INIT` | 订单已创建，尚未支付 | 等待 |
| `PENDING` | 支付已提交，链上确认中 | 继续轮询 |
| `SUCCESS` | 卡片创建成功 | 展示卡片详情 |
| `FAIL` | 失败 | 显示错误，建议重试 |

### channelStatus（渠道状态）

| 状态 | 含义 |
|------|------|
| `INIT` | 尚未发送到卡片供应商 |
| `PROCESSING` | 供应商正在创建卡片 |
| `COMPLETED` | 卡片已就绪 |
| `FAILED` | 卡片创建失败 |

### cardStatus（卡片状态）

| 状态 | 含义 |
|------|------|
| `PENDING` | 配置中 |
| `ACTIVE` | 可以使用 |
| `FROZEN` | 已冻结 |
| `CANCELLED` | 已注销 |

## 轮询行为

使用 `--poll` 时：
- 最多 **42 次**（前 5 次每 **2 秒**，之后每 **5 秒**）
- 在 `SUCCESS`、`FAIL` 或 `cardStatus=ACTIVE` 时停止
- 如果超时，通知用户并提供手动查询命令
