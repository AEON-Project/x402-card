/**
 * gas 命令：通过 WalletConnect 从主钱包向本地钱包转 BNB（withdraw 时支付 gas）
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
  normalizeWalletError,
  startStatusServer,
  stopStatusServer,
  setStatus,
} from "../walletconnect.mjs";
import { BSC_RPC_URL, DEFAULT_WC_PROJECT_ID } from "../constants.mjs";

const DEFAULT_GAS_AMOUNT = "0.001";
const FINAL_LINGER_MS = 2000;

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

  try {
    const bal = await getBalanceByAddress(sessionAddress);
    console.error(`Current balance: ${bal.bnb} BNB`);
  } catch {}

  const statusPort = await startStatusServer();
  let signClient = null;
  let session = null;
  let bnbTxHash = null;
  let exitCode = 0;
  let errorPayload = null;

  try {
    console.error("Initializing WalletConnect...");
    signClient = await initSignClient(projectId);

    let peerAddress;
    ({ session, peerAddress } = await connectWallet(signClient, statusPort));
    console.error(`Wallet connected: ${peerAddress}`);

    const publicClient = createPublicClient({
      chain: bsc,
      transport: http(BSC_RPC_URL, { timeout: 15000, retryCount: 2 }),
    });

    setStatus("signing", { amount, token: "BNB", to: sessionAddress });
    console.error(`\nRequesting BNB transfer: ${amount} BNB → ${sessionAddress}`);
    console.error("Please confirm the transaction in your wallet app...");

    bnbTxHash = await requestNativeTransfer(signClient, session, {
      from: peerAddress,
      to: sessionAddress,
      value: amount,
    });
    setStatus("tx_submitted", { txHash: bnbTxHash, amount, token: "BNB" });
    console.error(`BNB transfer submitted: ${bnbTxHash}`);
    console.error("Waiting for confirmation...");

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: bnbTxHash,
      timeout: 60_000,
    });
    if (receipt.status !== "success") {
      throw new Error("BNB transfer transaction reverted");
    }

    setStatus("confirmed", { txHash: bnbTxHash, amount, token: "BNB" });
    console.error("BNB transfer confirmed.");

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
      errorPayload = { error: `BNB transfer failed: ${error.message}` };
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
