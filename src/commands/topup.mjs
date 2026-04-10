/**
 * topup 命令：通过 WalletConnect 为现有 session key 追加资金
 */
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { loadConfig, saveConfig } from "../config.mjs";
import { getBalanceByAddress } from "../balance.mjs";
import {
  initSignClient,
  connectWallet,
  requestERC20Transfer,
  requestNativeTransfer,
  disconnectSession,
} from "../walletconnect.mjs";
import {
  BSC_RPC_URL,
  USDT_BSC,
  DEFAULT_WC_PROJECT_ID,
  DEFAULT_GAS_BNB,
} from "../constants.mjs";

export async function topup(opts) {
  const config = loadConfig();

  if (!config.privateKey || !config.address) {
    console.error(JSON.stringify({
      error: "No session key found. Run 'x402-card connect' first.",
    }));
    process.exit(1);
  }

  const amount = opts.amount || "50";
  const sendGas = opts.gas || false;
  const gasBnb = DEFAULT_GAS_BNB;
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

  // 查询当前余额
  try {
    const bal = await getBalanceByAddress(sessionAddress);
    console.error(`Current balance: ${bal.usdt} USDT, ${bal.bnb} BNB`);
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

  // 转 USDT
  let usdtTxHash;
  try {
    console.error(`\nRequesting USDT transfer: ${amount} USDT → ${sessionAddress}`);
    console.error("Please confirm the transaction in your wallet app...");
    usdtTxHash = await requestERC20Transfer(signClient, session, {
      from: peerAddress,
      to: sessionAddress,
      token: USDT_BSC,
      amount,
      decimals: 18,
    });
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
  } catch (error) {
    console.error(JSON.stringify({ error: `USDT transfer failed: ${error.message}` }));
    await disconnectSession(signClient, session);
    process.exit(1);
  }

  // 可选：转 BNB
  let bnbTxHash;
  if (sendGas) {
    try {
      console.error(`\nRequesting BNB transfer: ${gasBnb} BNB → ${sessionAddress}`);
      console.error("Please confirm the transaction in your wallet app...");
      bnbTxHash = await requestNativeTransfer(signClient, session, {
        from: peerAddress,
        to: sessionAddress,
        value: gasBnb,
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
      console.error(`Warning: BNB transfer failed (${error.message}).`);
    }
  }

  // 断开 WalletConnect
  await disconnectSession(signClient, session);

  // 更新配置中的 mainWallet（可能换了钱包）
  config.mainWallet = peerAddress;
  saveConfig(config);

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
  }, null, 2));
}
