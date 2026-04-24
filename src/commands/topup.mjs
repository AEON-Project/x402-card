/**
 * topup 命令：通过 WalletConnect 为本地钱包追加 USDT
 */
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { loadConfig } from "../config.mjs";
import { getBalanceByAddress, getAllowance } from "../balance.mjs";
import {
  withWallet,
  requestERC20Transfer,
  requestNativeTransfer,
  setStatus,
} from "../walletconnect.mjs";
import { BSC_RPC_URL, USDT_BSC } from "../constants.mjs";

const AUTO_GAS_BNB = "0.001"; // 自动附带的 BNB 用于 approve 授权 gas

export async function topup(opts) {
  const config = loadConfig();

  if (!config.privateKey || !config.address) {
    console.error(JSON.stringify({
      error: "No session key found. Run 'x402-card setup --check' first to auto-create one.",
    }));
    process.exit(1);
  }

  const amount = opts.amount || "50";
  const sessionAddress = config.address;
  console.error(`Session key: ${sessionAddress}`);

  try {
    const bal = await getBalanceByAddress(sessionAddress);
    console.error(`Current balance: ${bal.usdt} USDT`);
  } catch {}

  let usdtTxHash = null;
  let bnbTxHash = null;

  await withWallet({ amount }, async ({ signClient, session, peerAddress }) => {
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

    // 检查是否已有无限额度 approve，已授权则跳过 BNB
    const skipGas = opts.skipGas || false;
    let needGas = !skipGas;
    if (needGas) {
      try {
        const allowance = await getAllowance(sessionAddress);
        if (allowance > 0n) {
          needGas = false;
          console.error("Allowance sufficient, skipping BNB transfer.");
        }
      } catch {}
    }
    if (needGas) {
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
        console.error(`Warning: BNB auto-transfer failed (${bnbErr.message}). USDT was transferred successfully. Run 'x402-card gas' to add BNB manually.`);
      }
    }

    setStatus("confirmed", { txHash: usdtTxHash, amount, token: "USDT", bnbTxHash });
  });

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
