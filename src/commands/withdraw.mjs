/**
 * withdraw 命令：将 session key 中的资金转回主钱包
 */
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { loadConfig } from "../config.mjs";
import { getBalanceByAddress } from "../balance.mjs";
import { BSC_RPC_URL, USDT_BSC } from "../constants.mjs";

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
];

export async function withdraw(opts) {
  const config = loadConfig();

  if (!config.privateKey || !config.address) {
    console.error(JSON.stringify({ error: "No session key found. Nothing to withdraw." }));
    process.exit(1);
  }

  const mainWallet = opts.to || config.mainWallet;
  if (!mainWallet) {
    console.error(JSON.stringify({ error: "No main wallet address found. Use --to <address> to specify." }));
    process.exit(1);
  }

  const sessionAddress = config.address;
  const account = privateKeyToAccount(config.privateKey);

  const publicClient = createPublicClient({
    chain: bsc,
    transport: http(BSC_RPC_URL, { timeout: 15000, retryCount: 2 }),
  });

  const walletClient = createWalletClient({
    account,
    chain: bsc,
    transport: http(BSC_RPC_URL),
  });

  // 查询当前余额
  const balance = await getBalanceByAddress(sessionAddress);
  console.error(`Session key: ${sessionAddress}`);
  console.error(`Balance: ${balance.usdt} USDT, ${balance.bnb} BNB`);
  console.error(`Withdraw to: ${mainWallet}`);

  if (balance.usdtRaw === 0n) {
    console.error(JSON.stringify({ error: "No USDT to withdraw." }));
    process.exit(1);
  }

  // 计算转账金额
  let withdrawAmount = balance.usdtRaw;
  if (opts.amount) {
    const requested = parseUnits(opts.amount, 18);
    if (requested > balance.usdtRaw) {
      console.error(JSON.stringify({
        error: `Requested ${opts.amount} USDT but only ${balance.usdt} available.`,
      }));
      process.exit(1);
    }
    withdrawAmount = requested;
  }

  // 转 USDT 回主钱包
  let usdtTxHash;
  try {
    const data = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [mainWallet, withdrawAmount],
    });

    console.error(`Transferring ${formatUnits(withdrawAmount, 18)} USDT → ${mainWallet}...`);
    usdtTxHash = await walletClient.sendTransaction({
      to: USDT_BSC,
      data,
    });
    console.error(`Transaction submitted: ${usdtTxHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: usdtTxHash,
      timeout: 60_000,
    });
    if (receipt.status !== "success") {
      throw new Error("USDT transfer reverted");
    }
    console.error("USDT transfer confirmed.");
  } catch (error) {
    console.error(JSON.stringify({ error: `Withdraw failed: ${error.message}` }));
    process.exit(1);
  }

  // 查询转账后余额
  let finalBalance;
  try {
    finalBalance = await getBalanceByAddress(sessionAddress);
  } catch {
    finalBalance = { usdt: "unknown", bnb: "unknown" };
  }

  console.log(JSON.stringify({
    success: true,
    withdrawn: formatUnits(withdrawAmount, 18) + " USDT",
    to: mainWallet,
    transaction: usdtTxHash,
    remaining: {
      usdt: finalBalance.usdt,
      bnb: finalBalance.bnb,
    },
  }, null, 2));
}
