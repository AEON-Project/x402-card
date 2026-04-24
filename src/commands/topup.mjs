/**
 * topup 命令：通过 WalletConnect 为本地钱包追加 USDT
 */
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { loadConfig, saveConfig } from "../config.mjs";
import { getBalanceByAddress } from "../balance.mjs";
import {
  initSignClient,
  getOrConnectWallet,
  requestERC20Transfer,
  requestNativeTransfer,
  disconnectSession,
  normalizeWalletError,
  startStatusServer,
  stopStatusServer,
  setStatus,
} from "../walletconnect.mjs";
import {
  BSC_RPC_URL,
  USDT_BSC,
  DEFAULT_WC_PROJECT_ID,
} from "../constants.mjs";

const AUTO_GAS_BNB = "0.001"; // 自动附带的 BNB 用于 approve 授权 gas

const FINAL_LINGER_MS = 2000; // 终态保留窗口，让浏览器页面拿到最后状态

export async function topup(opts) {
  const config = loadConfig();

  if (!config.privateKey || !config.address) {
    console.error(JSON.stringify({
      error: "No session key found. Run 'x402-card setup --check' first to auto-create one.",
    }));
    process.exit(1);
  }

  const amount = opts.amount || "50";
  const projectId = opts.projectId || DEFAULT_WC_PROJECT_ID;

  if (projectId.includes("YOUR_WALLETCONNECT")) {
    console.error(JSON.stringify({
      error: "Please set a WalletConnect project ID. Get one at https://cloud.walletconnect.com",
      hint: "x402-card topup --project-id <your-project-id>",
    }));
    process.exit(1);
  }

  const sessionAddress = config.address;
  console.error(`Session key: ${sessionAddress}`);

  try {
    const bal = await getBalanceByAddress(sessionAddress);
    console.error(`Current balance: ${bal.usdt} USDT`);
  } catch {}

  // 启动状态服务器（用于页面状态轮询）
  const statusPort = await startStatusServer();
  let signClient = null;
  let session = null;
  let usdtTxHash = null;
  let bnbTxHash = null;
  let exitCode = 0;
  let errorPayload = null;

  try {
    console.error("Initializing WalletConnect...");
    signClient = await initSignClient(projectId);

    // 尝试复用已有 session，失败则重新连接
    let peerAddress, reused;
    ({ session, peerAddress, reused } = await getOrConnectWallet(signClient, statusPort));
    console.error(`Wallet connected: ${peerAddress}`);

    const publicClient = createPublicClient({
      chain: bsc,
      transport: http(BSC_RPC_URL, { timeout: 15000, retryCount: 2 }),
    });

    setStatus("signing", { amount, token: "USDT", to: sessionAddress });
    console.error(`\nRequesting USDT transfer: ${amount} USDT → ${sessionAddress}`);
    console.error("Please confirm the transaction in your wallet app...");

    usdtTxHash = await requestERC20Transfer(signClient, session, {
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

    // 自动附带少量 BNB（用于 BSC USDT approve 授权的 gas）
    // 在同一 WalletConnect 会话内完成，用户需在钱包内确认第 2 笔交易
    const skipGas = opts.skipGas || false;
    if (!skipGas) {
      try {
        setStatus("signing", { amount: AUTO_GAS_BNB, token: "BNB", to: sessionAddress });
        console.error(`\nRequesting BNB transfer: ${AUTO_GAS_BNB} BNB → ${sessionAddress} (for approve gas)`);
        console.error("Please confirm the second transaction in your wallet app...");
        bnbTxHash = await requestNativeTransfer(signClient, session, {
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
        // BNB 失败不阻断——USDT 已到账，BNB 可后续用 x402-card gas 补充
        console.error(`Warning: BNB auto-transfer failed (${bnbErr.message}). USDT was transferred successfully. Run 'x402-card gas' to add BNB manually.`);
      }
    }

    setStatus("confirmed", { txHash: usdtTxHash, amount, token: "USDT", bnbTxHash });

    // 写回 mainWallet
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
      errorPayload = { error: `USDT transfer failed: ${error.message}` };
    }
    exitCode = 1;
  } finally {
    // 给浏览器页面留 2s 拿到最终状态
    await new Promise((r) => setTimeout(r, FINAL_LINGER_MS));
    stopStatusServer();
    // 不再断开 session，保留供后续命令复用
    // 仅在出错时断开（避免脏 session 残留）
    if (exitCode !== 0 && session && signClient) {
      await disconnectSession(signClient, session);
    }
  }

  if (exitCode !== 0) {
    console.error(JSON.stringify(errorPayload));
    process.exit(exitCode);
  }

  // 查询最终余额
  let finalBalance;
  try {
    finalBalance = await getBalanceByAddress(sessionAddress);
  } catch {
    finalBalance = { usdt: "unknown", bnb: "unknown" };
  }

  console.log(JSON.stringify({
    success: true,
    sessionKey: {
      address: sessionAddress,
      usdt: finalBalance.usdt,
      bnb: finalBalance.bnb,
    },
    transactions: {
      usdt: usdtTxHash || null,
      bnb: bnbTxHash || null,
    },
    note: "BNB is included automatically for BSC USDT approve gas.",
  }, null, 2));
}
