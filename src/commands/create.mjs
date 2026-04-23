import { createX402Api, decodePaymentResponse, fetchPaymentRequirements } from "../x402.mjs";
import { resolve, loadConfig, saveConfig } from "../config.mjs";
import { getWalletBalance } from "../balance.mjs";
import axios from "axios";
import {
  MIN_AMOUNT, MAX_AMOUNT, POLL_INTERVAL, MAX_POLLS,
  BSC_RPC_URL, USDT_BSC, DEFAULT_WC_PROJECT_ID,
} from "../constants.mjs";
import {
  initSignClient,
  connectWallet,
  requestERC20Transfer,
  requestNativeTransfer,
  disconnectSession,
  normalizeWalletError,
  startStatusServer,
  stopStatusServer,
  setStatus,
} from "../walletconnect.mjs";

const AUTO_GAS_BNB = "0.001";
const FINAL_LINGER_MS = 2000;

export async function create(opts) {
  console.error("Creating Agent Card...");
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
    console.error(JSON.stringify({ error: "Wallet not configured. Run: x402-card setup --check" }));
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

  // 3. 第一次请求 x402，获取实际付款要求（带唯一后缀的真实 USDT 金额）
  const url = `${serviceUrl}/open/ai/x402/card/create?amount=${amount}`;
  console.error("Fetching payment requirements...");
  let requiredUsdt;
  let paymentReq;
  try {
    paymentReq = await fetchPaymentRequirements(url);
    requiredUsdt = paymentReq.amountUsdt;
    console.error(`Required: ${requiredUsdt} USDT (pay to ${paymentReq.payToAddress})`);
  } catch (e) {
    console.error(JSON.stringify({ error: `Failed to fetch payment requirements: ${e.message}` }));
    process.exit(1);
  }

  // 4. 前置余额检查 + 自动 WalletConnect 充值（基于 x402 返回的真实金额）
  console.error("Checking wallet balance...");
  let needTopup = false;
  let needGas = false;
  let sessionAddress;
  let topupAmount = null;

  try {
    const { address, usdt, bnb, bnbRaw } = await getWalletBalance(privateKey);
    sessionAddress = address;
    const usdtNum = parseFloat(usdt);

    console.error(`Wallet: ${address}`);
    console.error(`Balance: ${usdt} USDT, ${bnb} BNB`);

    if (bnbRaw === 0n) {
      needGas = true;
    }
    if (usdtNum < requiredUsdt) {
      needTopup = true;
      const shortfall = requiredUsdt - usdtNum;
      topupAmount = shortfall.toFixed(6);
    }
  } catch (e) {
    console.error(JSON.stringify({ error: `Balance check failed: ${e.message}` }));
    process.exit(1);
  }

  // 余额不足：通过 WalletConnect 内联充值
  if (needTopup || needGas) {
    console.error("Funding flow triggered...");
    await inlineWalletConnectTopup({
      sessionAddress,
      amount: needTopup ? topupAmount : null,
      needGas,
    });

    // 充值完成后重新检查余额
    console.error("Re-checking wallet balance...");
    try {
      const { usdt, bnb, bnbRaw } = await getWalletBalance(privateKey);
      const usdtNum = parseFloat(usdt);
      console.error(`Balance: ${usdt} USDT, ${bnb} BNB`);

      if (bnbRaw === 0n) {
        console.error(JSON.stringify({
          error: "No BNB for approve transaction after funding. Run 'x402-card gas' to add BNB manually.",
          address: sessionAddress,
        }));
        process.exit(1);
      }
      if (usdtNum < requiredUsdt) {
        console.error(JSON.stringify({
          error: `Still insufficient USDT after funding.`,
          required: `${requiredUsdt} USDT`,
          available: `${usdt} USDT`,
          address: sessionAddress,
        }));
        process.exit(1);
      }
    } catch (e) {
      console.error(JSON.stringify({ error: `Balance re-check failed: ${e.message}` }));
      process.exit(1);
    }
  }

  // 5. 用第一次 402 响应手动签名并提交（避免二次请求产生不同金额）
  const { client, address, api } = createX402Api(privateKey);

  console.error(`Creating card: $${amount} USD via ${url}`);

  try {
    const { x402HTTPClient } = await import("@aeon-ai-pay/core/client");
    const httpClient = new x402HTTPClient(client);

    // 从第一次的 402 响应中构造 paymentRequired
    const raw402 = paymentReq.raw402Response;
    const getHeader = (name) => {
      const value = raw402.headers[name] ?? raw402.headers[name.toLowerCase()];
      return typeof value === "string" ? value : undefined;
    };
    const paymentRequired = httpClient.getPaymentRequiredResponse(getHeader, raw402.data);

    // 用第一次的精确金额签名
    const paymentPayload = await client.createPaymentPayload(paymentRequired);
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

    // 带签名头重新请求同一 URL
    const response = await axios.get(url, {
      headers: { ...paymentHeaders, "Access-Control-Expose-Headers": "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE" },
    });
    const paymentResponse = decodePaymentResponse(response.headers);
    const orderNo = paymentReq.orderNo || response.data?.model?.orderNo || response.data?.orderNo;

    const result = {
      success: true,
      orderNo,
      data: response.data,
      paymentResponse,
    };

    console.log(JSON.stringify(result, null, 2));

    // 在整个响应中递归查找 cardStatus
    function findCardStatus(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.cardStatus) return obj.cardStatus;
      for (const v of Object.values(obj)) {
        const found = findCardStatus(v);
        if (found) return found;
      }
      return null;
    }
    const initialOrderStatus = response.data?.model?.orderStatus;
    const initialCardStatus = findCardStatus(response.data);
    if (initialOrderStatus === "SUCCESS" || initialOrderStatus === "FAIL" || initialCardStatus === "ACTIVE") {
      console.error(`Card ready (orderStatus=${initialOrderStatus}, cardStatus=${initialCardStatus}), no polling needed.`);
    } else if (poll && orderNo) {
      console.error(`\nPolling status for orderNo: ${orderNo}`);
      await pollStatus(serviceUrl, orderNo);
    } else if (poll && !orderNo) {
      console.error("Warning: No orderNo available for polling. Query status manually.");
    }
    process.exit(0);
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

/**
 * 内联 WalletConnect 充值：在 create 流程内自动完成 USDT + BNB 充值
 */
async function inlineWalletConnectTopup({ sessionAddress, amount, needGas }) {
  const projectId = DEFAULT_WC_PROJECT_ID;
  const statusPort = await startStatusServer();
  let signClient = null;
  let session = null;
  let exitCode = 0;
  let errorPayload = null;

  try {
    console.error("Initializing WalletConnect...");
    signClient = await initSignClient(projectId);

    let peerAddress;
    ({ session, peerAddress } = await connectWallet(signClient, statusPort, amount));
    console.error(`Wallet connected: ${peerAddress}`);

    const { createPublicClient, http } = await import("viem");
    const { bsc } = await import("viem/chains");
    const publicClient = createPublicClient({
      chain: bsc,
      transport: http(BSC_RPC_URL, { timeout: 15000, retryCount: 2 }),
    });

    // USDT 充值
    if (amount) {
      setStatus("signing", { amount, token: "USDT", to: sessionAddress });
      console.error(`\nRequesting USDT transfer: ${amount} USDT → ${sessionAddress}`);
      console.error("Please confirm the transaction in your wallet app...");

      const usdtTxHash = await requestERC20Transfer(signClient, session, {
        from: peerAddress,
        to: sessionAddress,
        token: USDT_BSC,
        amount,
        decimals: 18,
      });
      setStatus("tx_submitted", { txHash: usdtTxHash, amount, token: "USDT" });
      console.error(`USDT transfer submitted: ${usdtTxHash}`);
      console.error("Waiting for confirmation...");

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: usdtTxHash,
        timeout: 60_000,
      });
      if (receipt.status !== "success") {
        throw new Error("USDT transfer transaction reverted");
      }
      console.error("USDT transfer confirmed.");
    }

    // BNB gas 充值
    if (needGas) {
      try {
        setStatus("signing", { amount: AUTO_GAS_BNB, token: "BNB", to: sessionAddress });
        console.error(`\nRequesting BNB transfer: ${AUTO_GAS_BNB} BNB → ${sessionAddress} (for approve gas)`);
        console.error("Please confirm the transaction in your wallet app...");
        const bnbTxHash = await requestNativeTransfer(signClient, session, {
          from: peerAddress,
          to: sessionAddress,
          value: AUTO_GAS_BNB,
        });
        setStatus("tx_submitted", { txHash: bnbTxHash, amount: AUTO_GAS_BNB, token: "BNB" });
        console.error(`BNB transfer submitted: ${bnbTxHash}`);
        const bnbReceipt = await publicClient.waitForTransactionReceipt({
          hash: bnbTxHash,
          timeout: 60_000,
        });
        if (bnbReceipt.status !== "success") {
          throw new Error("BNB transfer reverted");
        }
        console.error("BNB transfer confirmed.");
      } catch (bnbErr) {
        console.error(`Warning: BNB auto-transfer failed (${bnbErr.message}). Run 'x402-card gas' to add BNB manually.`);
      }
    }

    setStatus("confirmed", { token: amount ? "USDT" : "BNB" });

    // 写回 mainWallet
    const config = loadConfig();
    config.mainWallet = peerAddress;
    saveConfig(config);
  } catch (error) {
    normalizeWalletError(error);
    const isRejected = error.message?.includes("rejected") || error.code === 5000;
    const isTimeout = error.message?.includes("timed out");

    if (isTimeout) {
      setStatus("expired");
      errorPayload = { error: "Payment approval timed out. Please try again." };
    } else if (isRejected) {
      setStatus("rejected", { error: "Payment approval was rejected." });
      errorPayload = { error: "Payment approval was rejected. Please try again if you'd like to proceed." };
    } else {
      setStatus("failed", { error: error.message });
      errorPayload = { error: `Funding failed: ${error.message}` };
    }
    exitCode = 1;
  } finally {
    await new Promise((r) => setTimeout(r, FINAL_LINGER_MS));
    stopStatusServer();
    if (session && signClient) {
      await disconnectSession(signClient, session);
    }
  }

  if (exitCode !== 0) {
    console.error(JSON.stringify(errorPayload));
    process.exit(exitCode);
  }
}

async function pollStatus(serviceUrl, orderNo) {
  const { default: axios } = await import("axios");
  for (let i = 1; i <= MAX_POLLS; i++) {
    // 第一次立即查，前5次每2秒快速轮询，之后每5秒
    if (i > 1) {
      const delay = i <= 5 ? 2000 : POLL_INTERVAL;
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      const res = await axios.get(
        `${serviceUrl}/open/ai/x402/card/status?orderNo=${orderNo}`
      );
      const model = res.data?.model;
      console.error(`[${i}/${MAX_POLLS}] orderStatus=${model?.orderStatus} channelStatus=${model?.channelStatus}`);

      if (model?.orderStatus === "SUCCESS" || model?.orderStatus === "FAIL" || model?.cardStatus === "ACTIVE") {
        console.log(JSON.stringify({ pollResult: model }, null, 2));
        return;
      }
    } catch (e) {
      console.error(`[${i}/${MAX_POLLS}] Poll error: ${e.message}`);
    }
  }
  console.error(`Polling timeout after ${MAX_POLLS} attempts. Check manually with: x402-card status --order-no ${orderNo}`);
}
