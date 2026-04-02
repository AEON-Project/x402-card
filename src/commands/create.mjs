import { createX402Api, decodePaymentResponse } from "../x402.mjs";
import { resolve } from "../config.mjs";

const MIN_AMOUNT = 0.6;
const POLL_INTERVAL = 5000;
const MAX_POLLS = 10;

export async function create(opts) {
  const serviceUrl = resolve(opts.serviceUrl, "X402_CARD_SERVICE_URL", "serviceUrl");
  const privateKey = resolve(opts.privateKey, "EVM_PRIVATE_KEY", "privateKey");
  const { amount, poll } = opts;

  if (!serviceUrl) {
    console.error(JSON.stringify({ error: "Missing service URL. Run: x402-card setup --service-url <url>" }));
    process.exit(1);
  }
  if (!privateKey) {
    console.error(JSON.stringify({ error: "Missing private key. Run: x402-card setup --private-key <0x...>" }));
    process.exit(1);
  }
  if (parseFloat(amount) < MIN_AMOUNT) {
    console.error(JSON.stringify({ error: `Amount must be at least $${MIN_AMOUNT}` }));
    process.exit(1);
  }

  const { api, address, getOrderNo } = createX402Api(privateKey);
  const url = `${serviceUrl}/open/ai/x402/card/create?amount=${amount}`;

  console.error(`Wallet: ${address}`);
  console.error(`Creating card: $${amount} USD via ${url}`);

  try {
    // x402 两阶段协议由 wrapAxiosWithPayment 自动处理：
    // 1. 首次请求 → 收到 402 → 自动签名 → 自动重试
    // 2. 带 PAYMENT-SIGNATURE 重试 → 收到 200
    const response = await api.get(url);
    const paymentResponse = decodePaymentResponse(response.headers);

    // orderNo 来自 402 响应体（被拦截器捕获），不在 200 响应体中
    const orderNo = getOrderNo() || response.data?.model?.orderNo || response.data?.orderNo;

    const result = {
      success: true,
      orderNo,
      data: response.data,
      paymentResponse,
    };

    console.log(JSON.stringify(result, null, 2));

    // 自动轮询建卡状态
    if (poll && orderNo) {
      console.error(`\nPolling status for orderNo: ${orderNo}`);
      await pollStatus(serviceUrl, orderNo);
    } else if (poll && !orderNo) {
      console.error("Warning: No orderNo available for polling. Query status manually.");
    }
  } catch (error) {
    const result = {
      success: false,
      status: error.response?.status,
      data: error.response?.data,
      error: error.message,
    };
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
}

async function pollStatus(serviceUrl, orderNo) {
  const { default: axios } = await import("axios");
  for (let i = 1; i <= MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    try {
      const res = await axios.get(
        `${serviceUrl}/open/ai/x402/card/status?orderNo=${orderNo}`
      );
      const model = res.data?.model;
      console.error(`[${i}/${MAX_POLLS}] orderStatus=${model?.orderStatus} channelStatus=${model?.channelStatus}`);

      if (model?.orderStatus === "SUCCESS" || model?.orderStatus === "FAIL") {
        console.log(JSON.stringify({ pollResult: model }, null, 2));
        return;
      }
    } catch (e) {
      console.error(`[${i}/${MAX_POLLS}] Poll error: ${e.message}`);
    }
  }
  console.error(`Polling timeout after ${MAX_POLLS} attempts. Check manually with: x402-card status --order-no ${orderNo}`);
}
