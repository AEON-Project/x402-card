import { resolve, loadConfig } from "../config.mjs";
import { getWalletBalance, getBalanceByAddress } from "../balance.mjs";

export async function wallet(opts) {
  const privateKey = resolve(opts.privateKey, "EVM_PRIVATE_KEY", "privateKey");

  if (!privateKey) {
    console.error(JSON.stringify({ error: "Missing private key. Run: x402-card connect or x402-card setup --private-key <0x...>" }));
    process.exit(1);
  }

  try {
    const config = loadConfig();
    const { address, bnb, usdt, bnbRaw, usdtRaw } = await getWalletBalance(privateKey);

    const result = {
      mode: config.mode || "private-key",
      address,
      bnb,
      usdt,
      network: "BSC Mainnet (Chain ID: 56)",
    };

    // session-key 模式下额外展示主钱包余额
    if (config.mode === "session-key" && config.mainWallet) {
      try {
        const mainBal = await getBalanceByAddress(config.mainWallet);
        result.mainWallet = {
          address: config.mainWallet,
          bnb: mainBal.bnb,
          usdt: mainBal.usdt,
        };
      } catch {
        result.mainWallet = { address: config.mainWallet, error: "Failed to query balance" };
      }
    }

    console.log(JSON.stringify(result, null, 2));

    if (usdtRaw === 0n) {
      console.error("Warning: No USDT balance. " +
        (config.mode === "session-key"
          ? "Run 'x402-card topup' to add funds."
          : "Deposit USDT (BEP-20) before purchasing cards."));
    }
    if (bnbRaw === 0n) {
      console.error("Warning: No BNB for gas fees.");
    }
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
  }
}
