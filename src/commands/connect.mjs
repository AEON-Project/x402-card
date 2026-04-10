/**
 * connect 命令：通过 WalletConnect 连接主钱包，生成 session key 并注资
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
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

export async function connect(opts) {
  const amount = opts.amount || "50";
  const gasBnb = opts.gas || DEFAULT_GAS_BNB;
  const projectId = opts.projectId || DEFAULT_WC_PROJECT_ID;

  if (projectId.includes("YOUR_WALLETCONNECT")) {
    console.error(JSON.stringify({
      error: "Please set a WalletConnect project ID. Get one at https://cloud.walletconnect.com",
      hint: "x402-card connect --project-id <your-project-id>",
    }));
    process.exit(1);
  }

  // 检查是否已有 session key 且有余额
  const existingConfig = loadConfig();
  if (existingConfig.mode === "session-key" && existingConfig.address) {
    try {
      const bal = await getBalanceByAddress(existingConfig.address);
      if (bal.usdtRaw > 0n) {
        console.error(
          `Warning: Existing session key ${existingConfig.address} has ${bal.usdt} USDT. ` +
          `This will be replaced. Transfer remaining funds first if needed.`
        );
      }
    } catch {
      // 余额查询失败不阻塞
    }
  }

  // 1. 生成 session key
  const sessionPrivateKey = generatePrivateKey();
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);
  console.error(`Session key generated: ${sessionAccount.address}`);

  // 2. 初始化 WalletConnect
  let signClient;
  try {
    console.error("Initializing WalletConnect...");
    signClient = await initSignClient(projectId);
  } catch (error) {
    console.error(JSON.stringify({
      error: `Failed to initialize WalletConnect: ${error.message}`,
      hint: "Check your network connection and project ID.",
    }));
    process.exit(1);
  }

  // 3. 连接钱包
  let session, peerAddress;
  try {
    ({ session, peerAddress } = await connectWallet(signClient));
    console.error(`Wallet connected: ${peerAddress}`);
  } catch (error) {
    console.error(JSON.stringify({
      error: `Wallet connection failed: ${error.message}`,
      hint: "Scan the QR code within 120 seconds. Run 'x402-card connect' to retry.",
    }));
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain: bsc,
    transport: http(BSC_RPC_URL, { timeout: 15000, retryCount: 2 }),
  });

  // 4. 转 USDT 到 session key
  let usdtTxHash;
  try {
    console.error(`\nRequesting USDT transfer: ${amount} USDT → ${sessionAccount.address}`);
    console.error("Please confirm the transaction in your wallet app...");
    usdtTxHash = await requestERC20Transfer(signClient, session, {
      from: peerAddress,
      to: sessionAccount.address,
      token: USDT_BSC,
      amount,
      decimals: 18, // BSC USDT 为 18 位精度
    });
    console.error(`USDT transfer submitted: ${usdtTxHash}`);

    // 等待链上确认
    console.error("Waiting for confirmation...");
    const usdtReceipt = await publicClient.waitForTransactionReceipt({
      hash: usdtTxHash,
      timeout: 60_000,
    });
    if (usdtReceipt.status !== "success") {
      throw new Error("USDT transfer transaction reverted");
    }
    console.error("USDT transfer confirmed.");
  } catch (error) {
    const isRejected = error.message?.includes("rejected") || error.code === 5000;
    if (isRejected) {
      console.error(JSON.stringify({
        error: "Transaction rejected in wallet.",
        hint: "Run 'x402-card connect' again to retry.",
      }));
    } else {
      console.error(JSON.stringify({
        error: `USDT transfer failed: ${error.message}`,
      }));
    }
    await disconnectSession(signClient, session);
    process.exit(1);
  }

  // 5. 转 BNB 到 session key（用于 gas）
  let bnbTxHash;
  try {
    console.error(`\nRequesting BNB transfer: ${gasBnb} BNB → ${sessionAccount.address}`);
    console.error("Please confirm the transaction in your wallet app...");
    bnbTxHash = await requestNativeTransfer(signClient, session, {
      from: peerAddress,
      to: sessionAccount.address,
      value: gasBnb,
    });
    console.error(`BNB transfer submitted: ${bnbTxHash}`);

    console.error("Waiting for confirmation...");
    const bnbReceipt = await publicClient.waitForTransactionReceipt({
      hash: bnbTxHash,
      timeout: 60_000,
    });
    if (bnbReceipt.status !== "success") {
      throw new Error("BNB transfer transaction reverted");
    }
    console.error("BNB transfer confirmed.");
  } catch (error) {
    // BNB 失败不致命，保存配置并提示
    console.error(`Warning: BNB transfer failed (${error.message}). Use 'x402-card topup --gas' to retry.`);
  }

  // 6. 断开 WalletConnect
  await disconnectSession(signClient, session);

  // 7. 保存配置
  const config = loadConfig();
  config.mode = "session-key";
  config.privateKey = sessionPrivateKey;
  config.address = sessionAccount.address;
  config.mainWallet = peerAddress;
  config.sessionInfo = {
    fundedUsdt: amount,
    fundedBnb: gasBnb,
    createdAt: new Date().toISOString(),
  };
  saveConfig(config);

  // 8. 查询最终余额
  let finalBalance;
  try {
    finalBalance = await getBalanceByAddress(sessionAccount.address);
  } catch {
    finalBalance = { usdt: "unknown", bnb: "unknown" };
  }

  console.log(JSON.stringify({
    success: true,
    mode: "session-key",
    sessionKey: {
      address: sessionAccount.address,
      usdt: finalBalance.usdt,
      bnb: finalBalance.bnb,
    },
    mainWallet: peerAddress,
    transactions: {
      usdt: usdtTxHash || null,
      bnb: bnbTxHash || null,
    },
  }, null, 2));
}
