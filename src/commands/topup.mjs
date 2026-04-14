/**
 * topup 命令：通过 WalletConnect 为本地钱包追加 USDT
 */
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { loadConfig, saveConfig } from "../config.mjs";
import { getBalanceByAddress } from "../balance.mjs";
import {
  initSignClient,
  connectWallet,
  requestERC20Transfer,
  disconnectSession,
  startStatusServer,
  stopStatusServer,
  setStatus,
} from "../walletconnect.mjs";
import {
  BSC_RPC_URL,
  USDT_BSC,
  DEFAULT_WC_PROJECT_ID,
} from "../constants.mjs";

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
  let exitCode = 0;
  let errorPayload = null;

  try {
    console.error("Initializing WalletConnect...");
    signClient = await initSignClient(projectId);

    // 连接钱包（内部会推 connected 状态）
    let peerAddress;
    ({ session, peerAddress } = await connectWallet(signClient, statusPort));
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

    setStatus("confirmed", { txHash: usdtTxHash, amount, token: "USDT" });
    console.error("USDT transfer confirmed.");

    // 写回 mainWallet
    config.mainWallet = peerAddress;
    saveConfig(config);
  } catch (error) {
    const isRejected = error.message?.includes("rejected") || error.code === 5000;
    if (isRejected) {
      setStatus("rejected", { error: "Transaction rejected in wallet." });
      errorPayload = { error: "Transaction rejected in wallet." };
    } else {
      setStatus("failed", { error: error.message });
      errorPayload = { error: `USDT transfer failed: ${error.message}` };
    }
    exitCode = 1;
  } finally {
    // 给浏览器页面留 2s 拿到最终状态，然后强制关闭服务器和 WC 会话
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

  // 查询最终余额
  let finalBalance;
  try {
    finalBalance = await getBalanceByAddress(sessionAddress);
  } catch {
    finalBalance = { usdt: "unknown" };
  }

  console.log(JSON.stringify({
    success: true,
    sessionKey: {
      address: sessionAddress,
      usdt: finalBalance.usdt,
    },
    transactions: {
      usdt: usdtTxHash || null,
    },
  }, null, 2));
}
