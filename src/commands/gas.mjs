/**
 * gas 命令：通过 WalletConnect 从主钱包向本地钱包转入少量 BNB，专门用于 withdraw 时支付 gas
 * （x402 建卡是 gasless 的，仅 withdraw 这类直发链上交易需要 BNB）
 */
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { loadConfig, saveConfig } from "../config.mjs";
import { getBalanceByAddress } from "../balance.mjs";
import {
  initSignClient,
  connectWallet,
  requestNativeTransfer,
  disconnectSession,
} from "../walletconnect.mjs";
import { BSC_RPC_URL, DEFAULT_WC_PROJECT_ID } from "../constants.mjs";

const DEFAULT_GAS_AMOUNT = "0.001";

export async function gas(opts) {
  const config = loadConfig();

  if (!config.privateKey || !config.address) {
    console.error(JSON.stringify({
      error: "No local wallet found. Run 'x402-card setup --check' first to auto-create one.",
    }));
    process.exit(1);
  }

  const amount = opts.amount || DEFAULT_GAS_AMOUNT;
  const projectId = opts.projectId || DEFAULT_WC_PROJECT_ID;

  if (projectId.includes("YOUR_WALLETCONNECT")) {
    console.error(JSON.stringify({
      error: "Please set a WalletConnect project ID. Get one at https://cloud.walletconnect.com",
      hint: "x402-card gas --project-id <your-project-id>",
    }));
    process.exit(1);
  }

  const sessionAddress = config.address;
  console.error(`Local wallet: ${sessionAddress}`);

  // 查询当前 BNB 余额
  try {
    const bal = await getBalanceByAddress(sessionAddress);
    console.error(`Current balance: ${bal.bnb} BNB`);
  } catch {
    // 非关键错误
  }

  // 初始化 WalletConnect
  let signClient;
  try {
    console.error("Initializing WalletConnect...");
    signClient = await initSignClient(projectId);
  } catch (error) {
    console.error(JSON.stringify({
      error: `Failed to initialize WalletConnect: ${error.message}`,
    }));
    process.exit(1);
  }

  // 连接钱包
  let session, peerAddress;
  try {
    ({ session, peerAddress } = await connectWallet(signClient));
    console.error(`Wallet connected: ${peerAddress}`);
  } catch (error) {
    console.error(JSON.stringify({
      error: `Wallet connection failed: ${error.message}`,
    }));
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain: bsc,
    transport: http(BSC_RPC_URL, { timeout: 15000, retryCount: 2 }),
  });

  // 转 BNB
  let bnbTxHash;
  try {
    console.error(`\nRequesting BNB transfer: ${amount} BNB → ${sessionAddress}`);
    console.error("Please confirm the transaction in your wallet app...");
    bnbTxHash = await requestNativeTransfer(signClient, session, {
      from: peerAddress,
      to: sessionAddress,
      value: amount,
    });
    console.error(`BNB transfer submitted: ${bnbTxHash}`);
    console.error("Waiting for confirmation...");
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: bnbTxHash,
      timeout: 60_000,
    });
    if (receipt.status !== "success") {
      throw new Error("BNB transfer transaction reverted");
    }
    console.error("BNB transfer confirmed.");
  } catch (error) {
    const isRejected = error.message?.includes("rejected") || error.code === 5000;
    if (isRejected) {
      console.error(JSON.stringify({ error: "Transaction rejected in wallet." }));
    } else {
      console.error(JSON.stringify({ error: `BNB transfer failed: ${error.message}` }));
    }
    await disconnectSession(signClient, session);
    process.exit(1);
  }

  // 断开
  await disconnectSession(signClient, session);

  // 记录 mainWallet（withdraw 时可省略 --to）
  config.mainWallet = peerAddress;
  saveConfig(config);

  // 查询最终余额
  let finalBalance;
  try {
    finalBalance = await getBalanceByAddress(sessionAddress);
  } catch {
    finalBalance = { bnb: "unknown" };
  }

  console.log(JSON.stringify({
    success: true,
    localWallet: {
      address: sessionAddress,
      bnb: finalBalance.bnb,
    },
    transaction: bnbTxHash,
  }, null, 2));
}
