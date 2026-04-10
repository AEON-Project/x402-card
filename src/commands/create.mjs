import { createX402Api, decodePaymentResponse } from "../x402.mjs";
import { resolve } from "../config.mjs";
import { getWalletBalance } from "../balance.mjs";
import { MIN_AMOUNT, MAX_AMOUNT, POLL_INTERVAL, MAX_POLLS } from "../constants.mjs";

export async function create(opts) {
  const serviceUrl = resolve(opts.serviceUrl, "X402_CARD_SERVICE_URL", "serviceUrl");
  const privateKey = resolve(opts.privateKey, "EVM_PRIVATE_KEY", "privateKey");
  const { amount, poll } = opts;
  const amountNum = parseFloat(amount);

  // 1. 参数校验
  if (!serviceUrl) {
    console.error(JSON.stringify({ error: "Missing service URL. This should not happen — default is built-in. Run: x402-card setup --service-url <url> to override." }));
    process.exit(1);
  }
  if (!privateKey) {
    console.error(JSON.stringify({ error: "Wallet not configured. Run: x402-card connect --amount <usdt>" }));
    process.exit(1);
  }

  // 2. 限额校验
  if (isNaN(amountNum) || amountNum < MIN_AMOUNT) {
    console.error(JSON.stringify({ error: `Amount must be at least $${MIN_AMOUNT}. Allowed range: $${MIN_AMOUNT} ~ $${MAX_AMOUNT} USD.`, min: MIN_AMOUNT, max: MAX_AMOUNT }));
    process.exit(1);
  }
  if (amountNum > MAX_AMOUNT) {
    console.error(JSON.stringify({ error: `Amount must not exceed $${MAX_AMOUNT}. Allowed range: $${MIN_AMOUNT} ~ $${MAX_AMOUNT} USD.`, min: MIN_AMOUNT, max: MAX_AMOUNT }));
    process.exit(1);
  }

  // 3. 前置余额检查
  console.error("Checking wallet balance...");
  try {
    const { address, bnb, usdt, bnbRaw, usdtRaw } = await getWalletBalance(privateKey);
    const usdtNum = parseFloat(usdt);

    console.error(`Wallet: ${address}`);
    console.error(`Balance: ${usdt} USDT, ${bnb} BNB`);

    if (bnbRaw === 0n) {
      console.error(JSON.stringify({ error: "No BNB for gas fees. Deposit BNB to your wallet first.", address }));
      process.exit(1);
    }

    // USDT 需大于 amount（x402 协议会加唯一后缀，实际扣款略高于 amount 的 USDT 等值）
    if (usdtNum < amountNum) {
      console.error(JSON.stringify({
        error: `Insufficient USDT balance`,
        required: `${amountNum} USDT (approx)`,
        available: `${usdt} USDT`,
        shortfall: `${(amountNum - usdtNum).toFixed(6)} USDT`,
        address,
      }));
      process.exit(1);
    }
  } catch (e) {
    console.error(JSON.stringify({ error: `Balance check failed: ${e.message}` }));
    process.exit(1);
  }

  // 4. 执行 x402 建卡
  const { api, address, getOrderNo } = createX402Api(privateKey);
  const url = `${serviceUrl}/open/ai/x402/card/create?amount=${amount}`;

  console.error(`Creating card: $${amount} USD via ${url}`);

  try {
    const response = await api.get(url);
    const paymentResponse = decodePaymentResponse(response.headers);
    const orderNo = getOrderNo() || response.data?.model?.orderNo || response.data?.orderNo;

    const result = {
      success: true,
      orderNo,
      data: response.data,
      paymentResponse,
    };

    console.log(JSON.stringify(result, null, 2));

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
